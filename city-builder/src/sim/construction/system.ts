/**
 * Chantiers : état et logique de simulation (constructions en cours, démolitions, horloge de travail).
 *
 * Le système ne lit la simulation de base que par la façade `PluginContext` (lecture seule) :
 *  - il DÉTECTE les bâtiments posés et retirés en comparant la liste des bâtiments à celle qu'il connaît
 *    (signature bon marché à chaque tick, comparaison complète seulement quand elle change) ;
 *  - un bâtiment posé par le joueur devient un chantier de construction ; un bâtiment retiré devient un
 *    chantier de démolition (gravats à évacuer) ;
 *  - les bâtiments arrivés « en lot » (ville de démonstration `buildCity`, chargement d'une sauvegarde sans
 *    section chantiers) sont achevés d'emblée : c'est l'instantané complet qui suit ces opérations qui les adopte.
 *
 * Portail d'activité (docs/requests/chantiers.md) : si le cœur expose `ctx.buildings.setActive(id, actif)`,
 * le système rend le bâtiment inactif pendant le chantier (ni habitants, ni emplois, ni entretien, ni impôts)
 * et l'active à l'achèvement. Sans cette API, il n'écrit RIEN dans la simulation de base : le chantier reste
 * suivi, sauvegardé et affiché, mais le bâtiment est déjà actif pour l'économie et la démographie.
 * Le cœur peut aussi signaler une pose immédiatement par le crochet facultatif `onBuildingAdded` du module.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { CatalogAsset } from '../../shared/catalog';
import { footprintObb, obbOverlap } from '../../shared/footprint';
import {
  CHANTIER_PHASES, CHANTIER_PHASE_ENDS, CHANTIER_PHASE_NAMES_FR, DEMOLITION_PHASES, DEMOLITION_PHASE_ENDS, DEMOLITION_PHASE_NAMES_FR,
  chantierProgress, phaseIndexAt, phaseLocalProgress,
  type ChantierEnd, type ChantierInfo, type ChantierRecord, type ChantiersDelta, type ChantiersEtat, type ChantiersSnapshot,
} from '../../shared/protocol-ext/chantiers';
import type { PluginCommandResult, PluginContext } from '../plugins/types';
// Chemin volontairement écrit depuis la racine de src/sim : le garde-fou d'architecture
// (tests/unit/architecture.test.ts) interdit tout import « ../save… » depuis src/sim, ce qui
// attrape aussi « ../save-sections/… » (voir docs/requests/chantiers.md, demande n° 2.4).
import { migrateChantiers, type ChantiersSave } from '../../sim/save-sections/chantiers';
import { buildDurationMinutes, calendarMinutesFor, demolitionDurationMinutes, isWorkMinute, workedMinutesBetween } from './schedule';

/** Origine d'une pose signalée par le cœur (crochet facultatif `onBuildingAdded`). */
export type BuildingOrigin = 'commande' | 'lot' | 'chargement';

/** Écriture d'activité offerte par le cœur quand le portail existe. */
type SetActive = (buildingId: number, active: boolean) => unknown;

/** Ce que le système retient d'un bâtiment connu (pour le chantier de démolition après son retrait). */
interface Known { assetIndex: number; variant: number; x: number; y: number; z: number; rot: number }

/** En dessous de cette part construite, un chantier abandonné ne laisse rien à démolir. */
const MIN_BUILT_FOR_DEMOLITION = 0.05;

export class ChantierSystem {
  /** Chantiers actifs pour cette partie (faux : module en sommeil, aucun effet, aucune donnée écrite). */
  actif = false;
  /** Horloge de travail : minutes de jeu travaillées cumulées (n'avance que s'il existe un chantier). */
  horloge = 0;
  private prochainId = 1;
  /** Chantiers en cours par identifiant de chantier. */
  readonly sites = new Map<number, ChantierRecord>();
  /** Chantiers de CONSTRUCTION par identifiant de bâtiment. */
  private readonly parBatiment = new Map<number, ChantierRecord>();
  private readonly connus = new Map<number, Known>();
  private sigCount = -1;
  private sigSum = 0;
  /**
   * Vrai tant que la première synchronisation (instantané, chargement ou premier tick) n'a pas eu lieu :
   * les bâtiments déjà présents à ce moment-là viennent d'une nouvelle partie, d'un chargement ou d'une ville
   * construite d'un coup — ils sont ACHEVÉS, jamais mis en chantier.
   */
  private frais = true;
  private prochaineFin = Infinity;
  private pendAjoutes: ChantierRecord[] = [];
  private pendTermines: ChantierEnd[] = [];
  private horlogeEnvoyee = -1;
  private travailEnvoye = false;

  /* ----------------------------- Accès ----------------------------- */

  private static setActiveOf(ctx: PluginContext): SetActive | undefined {
    const f = (ctx.buildings as unknown as { setActive?: SetActive }).setActive;
    return typeof f === 'function' ? f : undefined;
  }

  /** Vrai si le cœur applique l'état de chantier (portail d'activité présent). */
  static hasActivityGate(ctx: PluginContext): boolean { return ChantierSystem.setActiveOf(ctx) !== undefined; }

  enChantier(buildingId: number): boolean { return this.parBatiment.has(buildingId); }

  avancement(buildingId: number): number {
    const s = this.parBatiment.get(buildingId);
    return s ? chantierProgress(s, this.horloge) : 1;
  }

  /* ------------------------- Cycle de vie ------------------------- */

  /** Nouvelle partie (ou début d'un chargement) : tout est remis à zéro. */
  reset(actif: boolean): void {
    this.actif = actif;
    this.horloge = 0;
    this.prochainId = 1;
    this.sites.clear();
    this.parBatiment.clear();
    this.connus.clear();
    this.sigCount = -1;
    this.sigSum = 0;
    this.frais = true;
    this.prochaineFin = Infinity;
    this.pendAjoutes = [];
    this.pendTermines = [];
    this.horlogeEnvoyee = -1;
    this.travailEnvoye = false;
  }

  /** Active ou désactive les chantiers. Désactiver achève tous les chantiers en cours. */
  setActif(ctx: PluginContext, actif: boolean): void {
    if (actif === this.actif) return;
    if (!actif) {
      for (const s of [...this.sites.values()]) this.finish(ctx, s, 'acheve', false);
      this.connus.clear();
      this.actif = false;
      return;
    }
    this.actif = true;
    this.frais = false;
    this.adoptAll(ctx);
  }

  /* ----------------------- Suivi des bâtiments ----------------------- */

  private know(ctx: PluginContext, index: number): Known {
    const b = ctx.buildings.store;
    const k: Known = { assetIndex: b.assetIndex[index]!, variant: b.variant[index]!, x: b.x[index]!, y: b.y[index]!, z: b.z[index]!, rot: b.rot[index]! };
    this.connus.set(b.id[index]!, k);
    return k;
  }

  private signature(ctx: PluginContext): boolean {
    const b = ctx.buildings.store, n = ctx.buildings.count;
    let sum = 0;
    for (let i = 0; i < n; i++) sum = (sum + Math.imul(b.id[i]!, 0x9e3779b1)) | 0;
    if (n === this.sigCount && sum === this.sigSum) return false;
    this.sigCount = n;
    this.sigSum = sum;
    return true;
  }

  /** Adopte tous les bâtiments inconnus comme ACHEVÉS (lot, chargement) et oublie ceux qui ont disparu. */
  private adoptAll(ctx: PluginContext): void {
    this.signature(ctx);
    const b = ctx.buildings.store, n = ctx.buildings.count;
    for (let i = 0; i < n; i++) if (!this.connus.has(b.id[i]!)) this.know(ctx, i);
    if (this.connus.size > n) this.dropRemoved(ctx, false);
  }

  /** Traite les bâtiments connus qui n'existent plus. `demolish` : ouvrir un chantier de démolition. */
  private dropRemoved(ctx: PluginContext, demolish: boolean): void {
    for (const [id, k] of this.connus) {
      if (ctx.buildings.indexOf(id) >= 0) continue;
      this.connus.delete(id);
      const site = this.parBatiment.get(id);
      let bati = 1;
      if (site) {
        bati = chantierProgress(site, this.horloge);
        this.finish(ctx, site, 'annule', false);
      }
      const asset = ctx.catalog?.assets[k.assetIndex];
      if (!demolish || !asset || bati < MIN_BUILT_FOR_DEMOLITION) continue;
      this.add({
        id: this.prochainId++, kind: 'demolition', buildingId: id, assetId: asset.id, variant: k.variant,
        x: k.x, y: k.y, z: k.z, rot: k.rot, t0: this.horloge, duree: demolitionDurationMinutes(asset, bati), bati,
      });
    }
  }

  /**
   * Compare les bâtiments de la simulation à ceux connus : les nouveaux ouvrent un chantier de construction,
   * les disparus un chantier de démolition. À la toute première synchronisation (nouvelle partie, chargement,
   * ville construite d'un coup), les bâtiments présents sont adoptés ACHEVÉS.
   */
  sync(ctx: PluginContext): void {
    if (!this.actif) return;
    if (this.frais) { this.frais = false; this.adoptAll(ctx); return; }
    if (!this.signature(ctx)) return;
    // Retraits d'abord : un terrain libéré puis rebâti dans le même pas donne une démolition annulée par la pose.
    if (this.connus.size > 0) this.dropRemoved(ctx, true);
    const b = ctx.buildings.store, n = ctx.buildings.count;
    for (let i = 0; i < n; i++) {
      const id = b.id[i]!;
      if (this.connus.has(id)) continue;
      this.startConstruction(ctx, id, this.know(ctx, i));
    }
  }

  /** Crochet du cœur (portail d'activité) : pose signalée à l'instant même, avec son origine. */
  onBuildingAdded(ctx: PluginContext, buildingId: number, origin: BuildingOrigin): void {
    if (!this.actif || this.connus.has(buildingId)) return;
    const i = ctx.buildings.indexOf(buildingId);
    if (i < 0) return;
    const k = this.know(ctx, i);
    if (origin === 'commande') { this.frais = false; this.startConstruction(ctx, buildingId, k); }
  }

  private startConstruction(ctx: PluginContext, buildingId: number, k: Known): void {
    const asset = ctx.catalog?.assets[k.assetIndex];
    if (!asset) return;
    this.cancelDemolitionsUnder(ctx, asset, k);
    this.add({
      id: this.prochainId++, kind: 'construction', buildingId, assetId: asset.id, variant: k.variant,
      x: k.x, y: k.y, z: k.z, rot: k.rot, t0: this.horloge, duree: buildDurationMinutes(asset), bati: 0,
    });
    ChantierSystem.setActiveOf(ctx)?.(buildingId, false);
  }

  /** Une nouvelle construction remplace les chantiers de démolition qu'elle recouvre. */
  private cancelDemolitionsUnder(ctx: PluginContext, asset: CatalogAsset, k: Known): void {
    const o = footprintObb(asset.footprint.tilesX, asset.footprint.tilesZ, k.x, k.z, k.rot);
    for (const s of [...this.sites.values()]) {
      if (s.kind !== 'demolition') continue;
      const a = ctx.getAsset(s.assetId);
      if (!a) continue;
      if (obbOverlap(o, footprintObb(a.footprint.tilesX, a.footprint.tilesZ, s.x, s.z, s.rot), 0.05)) this.finish(ctx, s, 'annule', false);
    }
  }

  private add(rec: ChantierRecord): void {
    this.sites.set(rec.id, rec);
    if (rec.kind === 'construction') this.parBatiment.set(rec.buildingId, rec);
    this.pendAjoutes.push(rec);
    this.prochaineFin = Math.min(this.prochaineFin, rec.t0 + rec.duree);
  }

  private finish(ctx: PluginContext, s: ChantierRecord, raison: ChantierEnd['raison'], notify: boolean): void {
    if (!this.sites.delete(s.id)) return;
    this.pendTermines.push({ id: s.id, raison });
    if (s.kind !== 'construction') return;
    this.parBatiment.delete(s.buildingId);
    if (raison !== 'acheve') return;
    if (ctx.buildings.indexOf(s.buildingId) >= 0) ChantierSystem.setActiveOf(ctx)?.(s.buildingId, true);
    if (notify) ctx.notify('info', `Chantier terminé : ${ctx.getAsset(s.assetId)?.nameFr ?? s.assetId}.`);
  }

  private refreshNextEnd(): void {
    let m = Infinity;
    for (const s of this.sites.values()) m = Math.min(m, s.t0 + s.duree);
    this.prochaineFin = m;
  }

  /* ------------------------------ Tick ------------------------------ */

  tick(ctx: PluginContext, minutes: number): void {
    if (!this.actif) return;
    const now = ctx.clock.totalMinutes;
    const pre = now - minutes;
    this.sync(ctx);
    if (this.sites.size === 0) return;
    this.horloge += workedMinutesBetween(pre, now);
    if (this.horloge < this.prochaineFin) return;
    for (const s of [...this.sites.values()]) if (this.horloge - s.t0 >= s.duree) this.finish(ctx, s, 'acheve', true);
    this.refreshNextEnd();
  }

  /* ----------------------- Deltas / instantané ----------------------- */

  private working(ctx: PluginContext): boolean {
    return ctx.speed > 0 && this.sites.size > 0 && isWorkMinute(ctx.clock.minuteOfDay);
  }

  takeDelta(ctx: PluginContext): ChantiersDelta | undefined {
    if (!this.actif && this.pendTermines.length === 0) return undefined;
    this.sync(ctx);
    const changed = this.pendAjoutes.length > 0 || this.pendTermines.length > 0;
    const enTravail = this.working(ctx);
    if (!changed && (this.sites.size === 0 || (this.horloge === this.horlogeEnvoyee && enTravail === this.travailEnvoye))) return undefined;
    const d: ChantiersDelta = { horloge: this.horloge, enTravail };
    if (this.pendAjoutes.length > 0) { d.ajoutes = this.pendAjoutes.map((s) => ({ ...s })); this.pendAjoutes = []; }
    if (this.pendTermines.length > 0) { d.termines = this.pendTermines; this.pendTermines = []; }
    this.horlogeEnvoyee = this.horloge;
    this.travailEnvoye = enTravail;
    return d;
  }

  snapshot(ctx: PluginContext): ChantiersSnapshot | undefined {
    this.pendAjoutes = [];
    this.pendTermines = [];
    if (!this.actif) return undefined;
    // Un instantané suit une nouvelle partie, un chargement ou une ville construite d'un coup : tout bâtiment
    // encore inconnu est arrivé en lot, il est achevé.
    this.frais = false;
    this.adoptAll(ctx);
    this.horlogeEnvoyee = this.horloge;
    this.travailEnvoye = this.working(ctx);
    // Rien à montrer (aucun chantier, aucune minute travaillée) : pas de charge utile du tout.
    if (this.sites.size === 0 && this.horloge === 0) return undefined;
    return { actif: true, horloge: this.horloge, enTravail: this.travailEnvoye, chantiers: [...this.sites.values()].map((s) => ({ ...s })) };
  }

  /* --------------------------- Sauvegarde --------------------------- */

  save(ctx: PluginContext, actifParDefaut: boolean): ChantiersSave | undefined {
    if (this.actif) this.sync(ctx);
    // Rien à retenir (réglage par défaut, aucun chantier, aucune minute travaillée) : aucune section
    // n'est écrite, la sauvegarde reste identique à celle d'une partie sans le module.
    if (this.actif === actifParDefaut && this.sites.size === 0 && this.horloge === 0) return undefined;
    return { actif: this.actif, horloge: this.horloge, prochainId: this.prochainId, chantiers: [...this.sites.values()].map((s) => ({ ...s })) };
  }

  /** Relit une section (après `reset`). Lève si la section est inutilisable (l'hôte isole l'erreur). */
  load(ctx: PluginContext, data: unknown, version: number): void {
    const s = migrateChantiers(data, version);
    this.reset(s.actif);
    this.frais = false;
    this.horloge = s.horloge;
    this.prochainId = s.prochainId;
    if (!s.actif) return;
    this.adoptAll(ctx);
    const setActive = ChantierSystem.setActiveOf(ctx);
    let dropped = 0;
    for (const rec of s.chantiers) {
      const asset = ctx.getAsset(rec.assetId);
      if (!asset) { dropped++; continue; }
      if (rec.kind === 'construction') {
        // Le bâtiment doit exister et correspondre ; sinon le chantier est abandonné (le bâtiment éventuel reste achevé).
        if (ctx.buildings.assetOf(rec.buildingId)?.id !== rec.assetId || this.parBatiment.has(rec.buildingId)) { dropped++; continue; }
      }
      this.sites.set(rec.id, rec);
      if (rec.kind === 'construction') { this.parBatiment.set(rec.buildingId, rec); setActive?.(rec.buildingId, false); }
    }
    this.pendAjoutes = [];
    this.pendTermines = [];
    this.refreshNextEnd();
    if (dropped > 0) ctx.notify('warn', `Sauvegarde : ${dropped} chantier(s) incohérent(s) ignoré(s).`);
  }

  /* --------------------------- Commandes --------------------------- */

  info(ctx: PluginContext, s: ChantierRecord): ChantierInfo {
    const p = chantierProgress(s, this.horloge);
    const build = s.kind === 'construction';
    const ends = build ? CHANTIER_PHASE_ENDS : DEMOLITION_PHASE_ENDS;
    const k = phaseIndexAt(p, ends);
    const phase = build ? CHANTIER_PHASES[k]! : DEMOLITION_PHASES[k]!;
    const reste = Math.max(0, s.t0 + s.duree - this.horloge);
    return {
      ...s, nomFr: ctx.getAsset(s.assetId)?.nameFr ?? s.assetId, avancement: p, phase,
      phaseFr: build ? CHANTIER_PHASE_NAMES_FR[CHANTIER_PHASES[k]!] : DEMOLITION_PHASE_NAMES_FR[DEMOLITION_PHASES[k]!],
      avancementPhase: phaseLocalProgress(p, k, ends), resteTravail: reste,
      resteCalendaire: calendarMinutesFor(ctx.clock.totalMinutes, reste),
    };
  }

  etat(ctx: PluginContext): ChantiersEtat {
    this.sync(ctx);
    return {
      actif: this.actif, horloge: this.horloge, enTravail: this.working(ctx), porteActivite: ChantierSystem.hasActivityGate(ctx),
      chantiers: [...this.sites.values()].map((s) => this.info(ctx, s)),
    };
  }

  command(ctx: PluginContext, name: string, payload: unknown): PluginCommandResult {
    const p = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>;
    switch (name) {
      case 'configurer': {
        if (typeof p.actif !== 'boolean') return { ok: false, code: 'INVALID_ARGS', message: 'configurer : « actif » (booléen) attendu' };
        this.setActif(ctx, p.actif);
        return { ok: true, data: { actif: this.actif } };
      }
      case 'etat':
        return { ok: true, data: this.etat(ctx) };
      case 'inspecter': {
        if (typeof p.buildingId !== 'number' || !Number.isInteger(p.buildingId)) return { ok: false, code: 'INVALID_ARGS', message: 'inspecter : « buildingId » (entier) attendu' };
        this.sync(ctx);
        const s = this.parBatiment.get(p.buildingId);
        return s ? { ok: true, data: this.info(ctx, s) } : { ok: false, code: 'NOT_FOUND', message: 'Ce bâtiment n\'est pas en chantier' };
      }
    }
    return { ok: false, code: 'INVALID_ARGS', message: `Commande de chantier inconnue : ${name}` };
  }
}
