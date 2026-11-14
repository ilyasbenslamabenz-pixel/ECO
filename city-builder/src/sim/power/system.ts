/**
 * Électricité (phase 2B, sous-étape 4) — moteur du service, branché sur le contrat municipal.
 *
 * Installations = bâtiments du catalogue étiquetés `elec:centrale:<type>` / `elec:poste` (posés par le joueur :
 * coût de construction, emplois et entretien du catalogue gérés par la simulation de base). Lignes haute tension
 * = objets du module (commande `buildLine`). Chaque heure de jeu :
 *  1. pannes aléatoires (PRNG du module ; taux × 1/financement²) et réparations ;
 *  2. production disponible par installation (vent, soleil, débit, panne, site) ;
 *  3. demande de chaque bâtiment (classe, taille, occupants, heure, saison) agrégée par installation de
 *     distribution (la plus proche à portée) et par classe ;
 *  4. graphe municipal reconstruit : producteur -> jeu de barres (J) -> transformateur -> nœud de distribution (D)
 *     -> un consommateur par classe (priorité = rang de la classe) ; lignes = arêtes J–J (capacité, pertes/km) ;
 *  5. répartition (`Networks.allocate`, ordre de mérite, délestage des priorités basses) ; dans une classe
 *     partiellement servie, les bâtiments sont alimentés dans un ordre tournant (hachage id × heure) ;
 *  6. effets : bâtiments coupés, emplois / habitants sans courant, pollution de l'air (thermique), bruit,
 *     satisfaction (pénalité réversible et bornée), registre d'effets (causes : panne, pénurie, réglage).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import {
  baseDemandKw, consumerClassOf, FACILITY_SPECS, facilityKindOf, failureMultiplier, hash32, hourlyFactor, hydroShare,
  hydroSiteCheck, LINE_SPEC, lineCost, nominalKwOf, repairMultiplier, ROOFTOP_SPEC, seasonDemandFactor, solarShare,
  TARIFF_CENTS_PER_KWH, windPowerShare, windProfile,
} from '../../shared/power/model';
import {
  type ClassBalance, CONSUMER_CLASSES, type ConsumerClass, COVER_CUT, COVER_NONE, COVER_OK, COVER_PARTIAL, COVER_UNLINKED,
  DEFAULT_PRIORITY_ORDER, type ElectriciteBudget, type ElectriciteCoverage, type ElectriciteDelta, type ElectriciteEvent,
  type ElectriciteSettings, type ElectriciteSummary, ELECTRICITE_NETWORK, type FacilityKind, type FacilityView, FUNDING_MAX,
  FUNDING_MIN, type LineView, type PlantType, SOURCE_IDS, type SourceBalance, type SourceId, WEATHER_SERVICE, type WeatherLike,
} from '../../shared/power/types';
import { TILE_SIZE } from '../../shared/constants';
import type { Municipal } from '../municipal/municipal';
import { decodeFloat32, encodeFloat32 } from '../municipal/codec';
import type { PluginContext } from '../plugins/types';

/* ------------------------------- État sauvegardé ------------------------------- */

export interface LineState { id: number; a: number; b: number; lengthM: number; failedUntil: number; builtAt: number }
export interface FacilityState { failedUntil: number; failures: number }

/** Distance maximale d'un bâtiment / d'une installation à la route pour être raccordé (m). */
const ROAD_ATTACH_M = 80;
/** Repli sans route : installation et bâtiment voisins (m). */
const LOCAL_FALLBACK_M = 80;

export interface PowerState {
  settings: ElectriciteSettings;
  lines: LineState[];
  nextLineId: number;
  /** État par installation (clé = identifiant de bâtiment). */
  facilities: Record<string, FacilityState>;
  /** Logements équipés de panneaux en toiture. */
  rooftopIds: number[];
  windForce: number | null;
  /** Cause de la pénurie en cours dans le registre d'effets (0 = aucune). */
  shortageCause: number;
  /** Coupures par classe au dernier enregistrement d'effet (détection des changements). */
  lastCutByClass: Record<string, number>;
  /** Pénalité de satisfaction appliquée par le module, par cellule (base64 Float32 ; '' = aucune). */
  penalty: string;
  penaltyCells: number;
  events: ElectriciteEvent[];
  month: { producedKwh: number; deliveredKwh: number; shedKwh: number; failures: number };
  lastMonth: { income: number; expense: number; failures: number };
  investments: number;
  /** Dernière heure traitée (minutes de jeu). */
  lastHourAt: number;
  /** Bâtiments sans courant au dernier calcul (rechargement identique : la démographie les consulte). */
  unpowered?: number[];
}

export function emptyPowerState(): PowerState {
  return {
    settings: { funding: 1, priorities: [...DEFAULT_PRIORITY_ORDER], rooftops: false },
    lines: [], nextLineId: 1, facilities: {}, rooftopIds: [], windForce: null, shortageCause: 0, lastCutByClass: {},
    penalty: '', penaltyCells: 0, events: [],
    month: { producedKwh: 0, deliveredKwh: 0, shedKwh: 0, failures: 0 },
    lastMonth: { income: 0, expense: 0, failures: 0 },
    investments: 0, lastHourAt: -1,
  };
}

/* --------------------------------- Constantes --------------------------------- */

const MAX_EVENTS = 40;
/** Capacité minimale du transformateur de distribution d'une centrale (kW). */
const PLANT_DISTRIBUTION_MIN_KW = 20_000;
/** Raccordement local automatique (moyenne tension) entre installations proches : capacité (kW), pertes / km. */
const LOCAL_LINK_KW = 20_000;
const LOCAL_LINK_LOSS_PER_KM = 0.015;
/** Pénalité de satisfaction : +3/h quand coupé (plafond 20), −1,5/h quand alimenté. */
const PENALTY_STEP_CUT = 3;
const PENALTY_RECOVER = 1.5;
const PENALTY_MAX = 20;

interface Facility {
  id: number;
  kind: FacilityKind;
  nameFr: string;
  x: number; y: number; z: number; rot: number;
  nominalKw: number;
  radius: number;
  halfSize: number;
  siteOk: boolean;
  siteReason: string;
  upkeep: number;
}

interface Consumer {
  id: number;
  x: number; z: number;
  cls: ConsumerClass;
  demandKw: number;
  residents: number;
  jobs: number;
  hub: number; // identifiant de l'installation de distribution, -1 = non raccordé
  cell: number;
}

export class PowerSystem {
  state: PowerState = emptyPowerState();
  /** Installations courantes (reconstruites à chaque répartition depuis les bâtiments). */
  private facilities = new Map<number, Facility>();
  /** Part servie par bâtiment consommateur (absent = non consommateur, compté comme alimenté). */
  private served = new Map<number, number>();
  private cutList: number[] = [];
  private summaryCache: ElectriciteSummary | undefined;
  private facilityViews: FacilityView[] = [];
  private lineViews: LineView[] = [];
  private coverage: ElectriciteCoverage | undefined;
  private penaltyGrid: Float32Array | null = null;
  private rooftopSet = new Set<number>();
  /** Version de contenu (deltas) et dernière version envoyée. */
  version = 1;
  private sentVersion = -1;
  private coverageSent = -1;
  private eventsSent = 0;
  /** Mode d'hébergement du contrat municipal. */
  municipalMode: 'service' | 'integre' = 'service';

  constructor(private readonly getMunicipal: () => Municipal | undefined) {}

  /* ------------------------------ Cycle de vie ------------------------------ */

  reset(): void {
    this.state = emptyPowerState();
    this.facilities.clear();
    this.served.clear();
    this.cutList = [];
    this.summaryCache = undefined;
    this.facilityViews = [];
    this.lineViews = [];
    this.coverage = undefined;
    this.penaltyGrid = null;
    this.rooftopSet = new Set();
    this.version++;
    this.sentVersion = -1;
    this.coverageSent = -1;
    this.eventsSent = 0;
  }

  load(s: PowerState): void {
    this.reset();
    this.state = s;
    this.rooftopSet = new Set(s.rooftopIds);
    this.penaltyGrid = s.penalty && s.penaltyCells > 0 ? decodeFloat32(s.penalty, s.penaltyCells) : null;
    this.eventsSent = s.events.length;
    for (const id of s.unpowered ?? []) this.served.set(id, 0);
  }

  toJSON(): PowerState {
    const s = this.state;
    s.rooftopIds = [...this.rooftopSet].sort((a, b) => a - b);
    const off: number[] = [];
    for (const [id, f] of this.served) if (f < 1) off.push(id);
    if (off.length) s.unpowered = off.sort((a, b) => a - b); else delete s.unpowered;
    if (this.penaltyGrid) { s.penalty = encodeFloat32(this.penaltyGrid); s.penaltyCells = this.penaltyGrid.length; } else { s.penalty = ''; s.penaltyCells = 0; }
    return s;
  }

  /** Vrai si la partie n'a ni installation, ni ligne, ni réglage modifié (aucune section, aucun delta). */
  isIdle(ctx: PluginContext): boolean {
    if (this.state.lines.length || this.state.events.length || this.rooftopSet.size) return false;
    const s = this.state.settings;
    if (s.funding !== 1 || s.rooftops || s.priorities.join() !== DEFAULT_PRIORITY_ORDER.join()) return false;
    return this.scanFacilities(ctx).size === 0;
  }

  /* --------------------------------- Lecture --------------------------------- */

  powerFactor(id: number): number { return this.served.get(id) ?? 1; }
  /** Installations connues (état sauvegardé : identique avant et après un rechargement). */
  facilityCount(): number { return Math.max(this.facilities.size, Object.keys(this.state.facilities).length); }
  summary(): ElectriciteSummary | undefined { return this.summaryCache; }
  exportableKw(): number { return this.summaryCache?.exportableKw ?? 0; }

  private event(ctx: PluginContext, kind: ElectriciteEvent['kind'], message: string, ref?: number): void {
    const e: ElectriciteEvent = { at: ctx.clock.totalMinutes, kind, message };
    if (ref !== undefined) e.ref = ref;
    this.state.events.push(e);
    if (this.state.events.length > MAX_EVENTS) {
      const drop = this.state.events.length - MAX_EVENTS;
      this.state.events.splice(0, drop);
      this.eventsSent = Math.max(0, this.eventsSent - drop);
    }
    this.version++;
  }

  /* ------------------------------ Installations ------------------------------ */

  /** Installations présentes (bâtiments étiquetés), avec validation de site. */
  scanFacilities(ctx: PluginContext): Map<number, Facility> {
    const out = new Map<number, Facility>();
    const b = ctx.buildings;
    const st = b.store;
    const assets = ctx.catalog?.assets;
    if (!assets) return out;
    for (let i = 0; i < b.count; i++) {
      const a = assets[st.assetIndex[i]!];
      const kind = facilityKindOf(a);
      if (!kind || !a) continue;
      const id = st.id[i]!;
      const x = st.x[i]!, z = st.z[i]!;
      const halfSize = (Math.max(a.footprint.tilesX, a.footprint.tilesZ) * TILE_SIZE) / 2;
      let siteOk = true, siteReason = '';
      if (kind === 'hydro') {
        const prev = this.facilities.get(id);
        if (prev && prev.kind === 'hydro' && prev.x === x && prev.z === z) { siteOk = prev.siteOk; siteReason = prev.siteReason; } else {
          const c = hydroSiteCheck(x, z, halfSize, (px, pz) => ctx.terrain.isWet(px, pz));
          siteOk = c.ok; siteReason = c.reason;
        }
      }
      out.set(id, {
        id, kind, nameFr: a.nameFr, x, y: st.y[i]!, z, rot: st.rot[i]!, nominalKw: nominalKwOf(a, kind),
        radius: FACILITY_SPECS[kind].radius, halfSize, siteOk, siteReason, upkeep: a.upkeepPerMonth,
      });
    }
    return out;
  }

  /** Synchronise la liste des installations (nouvelles, démolies) : lignes orphelines retirées, sites signalés. */
  private syncFacilities(ctx: PluginContext): void {
    const next = this.scanFacilities(ctx);
    for (const [id, f] of next) {
      if (!this.facilities.has(id) && !(String(id) in this.state.facilities)) {
        this.state.facilities[String(id)] = { failedUntil: 0, failures: 0 };
        if (f.kind === 'hydro') {
          this.event(ctx, 'site', `${f.nameFr} n° ${id} : ${f.siteReason}`, id);
          if (!f.siteOk) ctx.notify('warn', `${f.nameFr} : ${f.siteReason}.`);
        }
      }
    }
    for (const key of Object.keys(this.state.facilities)) if (!next.has(Number(key))) delete this.state.facilities[key];
    const before = this.state.lines.length;
    this.state.lines = this.state.lines.filter((l) => next.has(l.a) && next.has(l.b));
    if (this.state.lines.length !== before) this.version++;
    this.facilities = next;
  }

  /* ---------------------------------- Lignes ---------------------------------- */

  lineLength(a: Facility, b: Facility): number { return Math.hypot(a.x - b.x, a.z - b.z); }

  /* ----------------------- Réseau de distribution par les routes ----------------------- */

  /**
   * Distribution basse / moyenne tension LE LONG DES ROUTES (comme l'eau) : un bâtiment est raccordé à une
   * installation (centrale ou poste) reliée à lui par le réseau routier. Composantes connexes des routes,
   * recalculées quand la voirie change.
   */
  private compVersion = -1;
  private nodeComp = new Map<number, number>();
  /** Composante routière de chaque installation (-1 : à plus de 80 m d'une route). */
  private facComp = new Map<number, number>();

  private refreshRoadComponents(ctx: PluginContext): void {
    const roads = ctx.roads;
    if (roads.version === this.compVersion) return;
    this.compVersion = roads.version;
    const parent = new Map<number, number>();
    const find = (a: number): number => { let r = a; while (parent.get(r)! !== r) r = parent.get(r)!; let x = a; while (parent.get(x)! !== r) { const n = parent.get(x)!; parent.set(x, r); x = n; } return r; };
    for (const id of roads.nodeIds()) parent.set(id, id);
    for (const s of roads.segmentIds()) {
      const [a, b] = roads.endpoints(s);
      if (!parent.has(a) || !parent.has(b)) continue;
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb));
    }
    this.nodeComp.clear();
    for (const id of parent.keys()) this.nodeComp.set(id, find(id));
  }

  /** Composante routière d'un point (tronçon le plus proche dans `reach` m), -1 sinon. */
  private compAt(ctx: PluginContext, x: number, z: number, reach: number): number {
    const s = ctx.roads.segmentNear(x, z, reach);
    if (!s) return -1;
    const [a] = ctx.roads.endpoints(s.segId);
    return this.nodeComp.get(a) ?? -1;
  }

  /**
   * Raccordements locaux automatiques (réseau moyenne tension) : deux installations distantes de moins que le plus
   * petit de leurs rayons de distribution sont reliées sans ligne HT (capacité limitée, pertes plus fortes).
   */
  localLinks(): [number, number, number][] {
    const facs = [...this.facilities.values()].sort((a, b) => a.id - b.id);
    const out: [number, number, number][] = [];
    for (let i = 0; i < facs.length; i++) {
      for (let j = i + 1; j < facs.length; j++) {
        const a = facs[i]!, b = facs[j]!;
        const d = this.lineLength(a, b);
        // Même réseau routier (distribution le long des routes) ; repli : très proches l'une de l'autre.
        const ca = this.facComp.get(a.id) ?? -1, cb = this.facComp.get(b.id) ?? -1;
        if ((ca >= 0 && ca === cb) || d <= LOCAL_FALLBACK_M) out.push([a.id, b.id, d]);
      }
    }
    return out;
  }

  quoteLine(ctx: PluginContext, a: number, b: number): { ok: true; lengthM: number; cost: number; upkeepPerMonth: number } | { ok: false; code: string; message: string } {
    this.syncFacilities(ctx);
    const fa = this.facilities.get(a), fb = this.facilities.get(b);
    if (!fa || !fb) return { ok: false, code: 'NOT_FOUND', message: 'Les deux extrémités doivent être des centrales ou des postes' };
    if (a === b) return { ok: false, code: 'INVALID_ARGS', message: 'Une ligne relie deux installations différentes' };
    const L = this.lineLength(fa, fb);
    if (L > LINE_SPEC.maxLengthM) return { ok: false, code: 'OUT_OF_BOUNDS', message: `Portée trop longue (${Math.round(L)} m > ${LINE_SPEC.maxLengthM} m) : ajouter un poste intermédiaire` };
    if (this.state.lines.some((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a))) return { ok: false, code: 'COLLISION', message: 'Ces installations sont déjà reliées' };
    return { ok: true, lengthM: L, ...lineCost(L) };
  }

  buildLine(ctx: PluginContext, a: number, b: number): { ok: true; line: LineView; cost: number } | { ok: false; code: string; message: string } {
    const q = this.quoteLine(ctx, a, b);
    if (!q.ok) return q;
    const line: LineState = { id: this.state.nextLineId++, a, b, lengthM: Math.round(q.lengthM * 10) / 10, failedUntil: 0, builtAt: ctx.clock.totalMinutes };
    this.state.lines.push(line);
    this.state.investments += q.cost;
    const m = this.getMunicipal();
    const fa = this.facilities.get(a)!, fb = this.facilities.get(b)!;
    if (m) {
      m.budget.post('expense', 'investissement:lignes_ht', q.cost, 'electricite');
      const cause = m.effects.cause({ kind: 'electricite:ligne', label: `Ligne HT ${fa.nameFr} – ${fb.nameFr}`, source: 'joueur', at: ctx.clock.totalMinutes, x: (fa.x + fb.x) / 2, z: (fa.z + fb.z) / 2, ref: line.id });
      m.effects.record(cause, 'budget:investissement', -q.cost, '¢', ctx.clock.totalMinutes, { x: (fa.x + fb.x) / 2, z: (fa.z + fb.z) / 2 });
    }
    this.event(ctx, 'ligne', `Ligne HT construite (${(q.lengthM / 1000).toFixed(2)} km, ${Math.round(q.cost / 100).toLocaleString('fr-FR')} CHF)`, line.id);
    this.allocate(ctx, false);
    return { ok: true, line: this.lineViews.find((l) => l.id === line.id)!, cost: q.cost };
  }

  removeLine(ctx: PluginContext, id: number): boolean {
    const n = this.state.lines.length;
    this.state.lines = this.state.lines.filter((l) => l.id !== id);
    if (this.state.lines.length === n) return false;
    this.event(ctx, 'ligne', `Ligne HT n° ${id} démolie`, id);
    this.allocate(ctx, false);
    return true;
  }

  /** Relie l'installation `id` à l'installation alimentée (ou centrale) la plus proche non encore reliée. */
  autoConnect(ctx: PluginContext, id: number): ReturnType<PowerSystem['buildLine']> {
    this.syncFacilities(ctx);
    const f = this.facilities.get(id);
    if (!f) return { ok: false, code: 'NOT_FOUND', message: 'Installation inconnue' };
    const energized = this.energizedSet();
    let best: Facility | undefined, bestD = Infinity;
    for (const g of this.facilities.values()) {
      if (g.id === id) continue;
      if (this.state.lines.some((l) => (l.a === id && l.b === g.id) || (l.b === id && l.a === g.id))) continue;
      const bonus = energized.has(g.id) && !energized.has(id) ? 0 : 1;
      const d = this.lineLength(f, g) + bonus * 1e6;
      if (d < bestD) { bestD = d; best = g; }
    }
    if (!best) return { ok: false, code: 'NOT_FOUND', message: 'Aucune autre installation à relier' };
    return this.buildLine(ctx, id, best.id);
  }

  /* --------------------------------- Réglages --------------------------------- */

  private settingCause(ctx: PluginContext, label: string): number {
    const m = this.getMunicipal();
    return m ? m.effects.cause({ kind: 'electricite:reglage', label, source: 'joueur', at: ctx.clock.totalMinutes }) : 0;
  }

  setFunding(ctx: PluginContext, funding: number): void {
    const f = Math.round(Math.min(FUNDING_MAX, Math.max(FUNDING_MIN, funding)) * 100) / 100;
    const before = this.state.settings.funding;
    if (f === before) return;
    this.state.settings.funding = f;
    const cause = this.settingCause(ctx, `Financement de l'entretien électrique : ${Math.round(before * 100)} % -> ${Math.round(f * 100)} %`);
    const m = this.getMunicipal();
    if (m && cause) {
      m.effects.record(cause, 'electricite:taux_panne', failureMultiplier(f) / failureMultiplier(before), '×', ctx.clock.totalMinutes, {}, 'multiplicateur du taux de pannes');
      m.effects.record(cause, 'budget:entretien_reseau', Math.round(this.upkeepNominal() * (f - before)), '¢/mois', ctx.clock.totalMinutes);
    }
    this.event(ctx, 'reglage', `Financement de l'entretien : ${Math.round(f * 100)} %`);
  }

  setPriorities(ctx: PluginContext, order: ConsumerClass[]): boolean {
    if (order.length !== CONSUMER_CLASSES.length || new Set(order).size !== order.length || !order.every((c) => CONSUMER_CLASSES.includes(c))) return false;
    const before = this.allocate(ctx, false).byClass;
    this.state.settings.priorities = [...order];
    const cause = this.settingCause(ctx, `Priorités de délestage : ${order.join(' > ')}`);
    this.event(ctx, 'reglage', `Priorités de délestage modifiées`);
    const after = this.allocate(ctx, false).byClass;
    const m = this.getMunicipal();
    if (m && cause) {
      for (const a of after) {
        const b = before.find((x) => x.cls === a.cls)!;
        const dkw = a.deliveredKw - b.deliveredKw;
        if (Math.abs(dkw) > 1e-6 || a.cut !== b.cut) m.effects.record(cause, `electricite:livre:${a.cls}`, dkw, 'kW', ctx.clock.totalMinutes, {}, `coupés : ${b.cut} -> ${a.cut}`);
      }
      m.effects.record(cause, 'electricite:priorites', 0, 'rang', ctx.clock.totalMinutes, {}, order.join(' > '));
    }
    return true;
  }

  setRooftops(ctx: PluginContext, enabled: boolean): void {
    if (this.state.settings.rooftops === enabled) return;
    this.state.settings.rooftops = enabled;
    this.settingCause(ctx, `Programme de toitures solaires ${enabled ? 'lancé' : 'arrêté'}`);
    this.event(ctx, 'reglage', `Toitures solaires : programme ${enabled ? 'lancé' : 'arrêté (installations conservées)'}`);
  }

  /** Priorité numérique d'une classe (rang inversé : la première de la liste a la plus haute priorité). */
  priorityOf(cls: ConsumerClass): number {
    const i = this.state.settings.priorities.indexOf(cls);
    return (CONSUMER_CLASSES.length - (i < 0 ? CONSUMER_CLASSES.length : i)) * 2;
  }

  /* ------------------------------ Météo / soleil ------------------------------ */

  windNow(ctx: PluginContext): { ms: number; source: ElectriciteSummary['windSource'] } {
    if (this.state.windForce !== null) return { ms: this.state.windForce, source: 'force' };
    const w = ctx.use<WeatherLike>(WEATHER_SERVICE);
    const ww = w ? (typeof w.state === 'function' ? w.state()?.wind : w.wind) : undefined;
    if (typeof ww === 'number' && Number.isFinite(ww)) return { ms: Math.max(0, ww), source: 'meteo' };
    return { ms: windProfile(ctx.clock.totalMinutes, ctx.params?.seed ?? 0), source: 'profil' };
  }

  cloudNow(ctx: PluginContext): number {
    const w = ctx.use<WeatherLike>(WEATHER_SERVICE);
    const c = w ? (typeof w.state === 'function' ? w.state()?.cloud : w.cloud) : undefined;
    return typeof c === 'number' && Number.isFinite(c) ? c : 0;
  }

  /* -------------------------------- Fiabilité --------------------------------- */

  private facilityState(id: number): FacilityState {
    const k = String(id);
    return (this.state.facilities[k] ??= { failedUntil: 0, failures: 0 });
  }

  /** Tirage horaire des pannes et fin des réparations. Renvoie le nombre de nouvelles pannes. */
  rollFailures(ctx: PluginContext): number {
    const now = ctx.clock.totalMinutes;
    const fund = this.state.settings.funding;
    const mult = failureMultiplier(fund);
    const rep = repairMultiplier(fund);
    const m = this.getMunicipal();
    let n = 0;
    const ids = [...this.facilities.keys()].sort((a, b) => a - b);
    for (const id of ids) {
      const f = this.facilities.get(id)!;
      const fs = this.facilityState(id);
      if (fs.failedUntil > 0 && now >= fs.failedUntil) {
        fs.failedUntil = 0;
        this.event(ctx, 'reparation', `${f.nameFr} n° ${id} réparée`, id);
      }
      const spec = FACILITY_SPECS[f.kind];
      const draw = ctx.rng.next();
      if (fs.failedUntil === 0 && draw < spec.failurePerHour * mult) {
        const hours = Math.max(1, Math.round(spec.repairHours * rep * (0.6 + 0.8 * ctx.rng.next())));
        fs.failedUntil = now + hours * 60;
        fs.failures++;
        n++;
        this.state.month.failures++;
        const msg = `Panne : ${f.nameFr} n° ${id} hors service (réparation ≈ ${hours} h)`;
        this.event(ctx, 'panne', msg, id);
        ctx.notify('warn', msg);
        if (m) {
          const cause = m.effects.cause({ kind: 'electricite:panne', label: msg, source: 'electricite', at: now, x: f.x, z: f.z, ref: id });
          m.effects.record(cause, f.kind === 'poste' ? 'electricite:transformation' : 'electricite:capacite', -f.nominalKw, 'kW', now, { x: f.x, z: f.z, radius: f.radius }, `financement ${Math.round(fund * 100)} %`);
        }
      }
    }
    for (const l of this.state.lines) {
      if (l.failedUntil > 0 && now >= l.failedUntil) { l.failedUntil = 0; this.event(ctx, 'reparation', `Ligne HT n° ${l.id} réparée`, l.id); }
      const draw = ctx.rng.next();
      if (l.failedUntil === 0 && draw < LINE_SPEC.failurePerKmHour * (l.lengthM / 1000) * mult) {
        const hours = Math.max(1, Math.round(LINE_SPEC.repairHours * rep * (0.6 + 0.8 * ctx.rng.next())));
        l.failedUntil = now + hours * 60;
        n++;
        this.state.month.failures++;
        const msg = `Panne : ligne HT n° ${l.id} coupée (réparation ≈ ${hours} h)`;
        this.event(ctx, 'panne', msg, l.id);
        if (m) {
          const fa = this.facilities.get(l.a), fb = this.facilities.get(l.b);
          const x = fa && fb ? (fa.x + fb.x) / 2 : undefined, z = fa && fb ? (fa.z + fb.z) / 2 : undefined;
          const cause = m.effects.cause({ kind: 'electricite:panne', label: msg, source: 'electricite', at: now, ...(x !== undefined && z !== undefined ? { x, z } : {}), ref: l.id });
          m.effects.record(cause, 'electricite:transport', -LINE_SPEC.capacityKw, 'kW', now, x !== undefined && z !== undefined ? { x, z } : {}, `financement ${Math.round(fund * 100)} %`);
        }
      }
    }
    if (n) this.version++;
    return n;
  }

  /* -------------------------------- Production -------------------------------- */

  private availableKw(ctx: PluginContext, f: Facility, wind: number, sun: number): number {
    if (this.facilityState(f.id).failedUntil > 0) return 0;
    switch (f.kind) {
      case 'thermique': return f.nominalKw;
      case 'eolien': return f.nominalKw * windPowerShare(wind);
      case 'solaire': return f.nominalKw * sun;
      case 'hydro': return f.siteOk ? f.nominalKw * hydroShare(ctx.clock.season) : 0;
      case 'poste': return 0;
    }
  }

  /** Installations reliées (lignes en service) à une centrale disponible. */
  private energizedSet(avail?: Map<number, number>): Set<number> {
    const adj = new Map<number, number[]>();
    for (const l of this.state.lines) {
      if (l.failedUntil > 0) continue;
      if (!this.facilities.has(l.a) || !this.facilities.has(l.b)) continue;
      (adj.get(l.a) ?? adj.set(l.a, []).get(l.a)!).push(l.b);
      (adj.get(l.b) ?? adj.set(l.b, []).get(l.b)!).push(l.a);
    }
    for (const [a, b] of this.localLinks()) {
      (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
      (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
    }
    const out = new Set<number>();
    const stack: number[] = [];
    for (const f of this.facilities.values()) {
      if (f.kind === 'poste') continue;
      const ok = avail ? (avail.get(f.id) ?? 0) > 0 : this.facilityState(f.id).failedUntil === 0;
      if (ok) { out.add(f.id); stack.push(f.id); }
    }
    while (stack.length) {
      const u = stack.pop()!;
      if (this.facilities.get(u)?.kind === 'poste' && this.facilityState(u).failedUntil > 0) continue; // poste en panne : pas de transit
      for (const v of adj.get(u) ?? []) if (!out.has(v)) { out.add(v); stack.push(v); }
    }
    return out;
  }

  /* -------------------------------- Répartition -------------------------------- */

  /** Heure de jeu : pannes, toitures, répartition, effets. */
  hour(ctx: PluginContext): void {
    this.syncFacilities(ctx);
    this.rollFailures(ctx);
    this.allocate(ctx, true);
    this.state.lastHourAt = ctx.clock.totalMinutes;
  }

  /**
   * Reconstruit le graphe municipal et répartit. `hourly` = vraie heure de jeu (énergie comptée, pollution,
   * satisfaction) ; sinon recalcul immédiat après une décision du joueur (état seulement).
   */
  allocate(ctx: PluginContext, hourly: boolean): ElectriciteSummary {
    if (!hourly) this.syncFacilities(ctx);
    const m = this.getMunicipal();
    const now = ctx.clock.totalMinutes;
    const hourOfDay = ctx.clock.hourOfDay;
    const season = ctx.clock.season;
    const wind = this.windNow(ctx);
    const cloud = this.cloudNow(ctx);
    const sun = solarShare(hourOfDay, season, cloud);

    // 1. Production disponible par installation.
    const avail = new Map<number, number>();
    for (const f of this.facilities.values()) avail.set(f.id, this.availableKw(ctx, f, wind.ms, sun));

    // 2. Consommateurs (demande horaire) et rattachement : installation la plus proche RELIÉE PAR LA ROUTE
    //    (réseau de distribution le long des routes) ; repli : installation à moins de 80 m (sans route).
    const facs = [...this.facilities.values()].sort((a, b) => a.id - b.id);
    this.refreshRoadComponents(ctx);
    this.facComp.clear();
    for (const f of facs) this.facComp.set(f.id, this.compAt(ctx, f.x, f.z, ROAD_ATTACH_M));
    const geom = m?.grids.defaultGeometry;
    const consumers: Consumer[] = [];
    const st = ctx.buildings.store;
    const assets = ctx.catalog?.assets ?? [];
    const seasonF = seasonDemandFactor(season);
    for (let i = 0; i < ctx.buildings.count; i++) {
      const a = assets[st.assetIndex[i]!];
      if (!a || facilityKindOf(a)) continue;
      if (a.category === 'vehicle' || a.footprint.tilesX * a.footprint.tilesZ === 0) continue;
      const cls = consumerClassOf(a);
      const tiles = a.footprint.tilesX * a.footprint.tilesZ;
      const residents = st.residents[i]!, workers = st.workers[i]!;
      const demand = baseDemandKw(cls, tiles, residents, workers, a.capacity.jobs) * hourlyFactor(cls, hourOfDay) * seasonF;
      const x = st.x[i]!, z = st.z[i]!;
      let hub = -1, best = Infinity;
      const comp = this.compAt(ctx, x, z, ROAD_ATTACH_M);
      for (const f of facs) {
        const d = Math.hypot(f.x - x, f.z - z);
        const linked = (comp >= 0 && this.facComp.get(f.id) === comp) || d <= LOCAL_FALLBACK_M;
        if (linked && d < best) { best = d; hub = f.id; }
      }
      let cell = -1;
      if (geom) {
        const ci = Math.min(geom.cols - 1, Math.max(0, Math.floor((x - geom.originX) / geom.cellSize)));
        const cj = Math.min(geom.rows - 1, Math.max(0, Math.floor((z - geom.originZ) / geom.cellSize)));
        cell = cj * geom.cols + ci;
      }
      consumers.push({ id: st.id[i]!, x, z, cls, demandKw: demand, residents, jobs: workers, hub, cell });
    }

    // 3. Toitures solaires (production répartie au nœud de distribution du logement).
    const rooftopByHub = new Map<number, number>();
    let rooftopKw = 0, rooftopNominal = 0, rooftopCount = 0;
    if (this.rooftopSet.size) {
      for (const c of consumers) {
        if (!this.rooftopSet.has(c.id)) continue;
        rooftopCount++;
        rooftopNominal += ROOFTOP_SPEC.peakKwPerBuilding;
        if (c.hub < 0) continue;
        const kw = ROOFTOP_SPEC.peakKwPerBuilding * sun;
        rooftopKw += kw;
        rooftopByHub.set(c.hub, (rooftopByHub.get(c.hub) ?? 0) + kw);
      }
    }

    // 4. Graphe municipal (reconstruit : la topologie suit les bâtiments et les lignes du module).
    const prio: Record<ConsumerClass, number> = {} as Record<ConsumerClass, number>;
    for (const c of CONSUMER_CLASSES) prio[c] = this.priorityOf(c);
    const demandBy = new Map<string, number>(); // `${hub}|${cls}`
    for (const c of consumers) if (c.hub >= 0) demandBy.set(`${c.hub}|${c.cls}`, (demandBy.get(`${c.hub}|${c.cls}`) ?? 0) + c.demandKw);

    // 5. Répartition puis choix des bâtiments servis (ordre tournant dans chaque (installation, classe)).
    //    L'énergie attribuée à une classe mais inutilisable (le bâtiment suivant ne tient pas dans le reliquat)
    //    est rendue : la demande de la classe est ramenée à la part utilisable et la répartition est refaite,
    //    ce qui libère le reliquat pour les classes moins prioritaires (2 à 3 itérations en pratique).
    const groups = new Map<string, Consumer[]>();
    for (const c of consumers) if (c.hub >= 0) (groups.get(`${c.hub}|${c.cls}`) ?? groups.set(`${c.hub}|${c.cls}`, []).get(`${c.hub}|${c.cls}`)!).push(c);
    const hourIndex = Math.floor(now / 60);
    for (const list of groups.values()) list.sort((p, q) => hash32(p.id, hourIndex) - hash32(q.id, hourIndex) || p.id - q.id);
    const pick = (list: Consumer[], budget: number): { on: Set<number>; used: number } => {
      const on = new Set<number>();
      let used = 0;
      for (const c of list) if (c.demandKw <= budget - used + 1e-6) { on.add(c.id); used += c.demandKw; }
      return { on, used };
    };
    let report = this.runNetwork(m, facs, avail, rooftopByHub, demandBy, prio);
    let picks = new Map<string, { on: Set<number>; used: number }>();
    for (let iter = 0; iter < 6; iter++) {
      picks = new Map();
      let wasted = false;
      for (const [key, list] of groups) {
        const got = report.deliveredBy.get(key) ?? 0;
        const pk = pick(list, got);
        picks.set(key, pk);
        if (got - pk.used > 1e-3 && pk.used < (demandBy.get(key) ?? 0) - 1e-6) { demandBy.set(key, pk.used); wasted = true; }
      }
      if (!wasted) break;
      report = this.runNetwork(m, facs, avail, rooftopByHub, demandBy, prio);
    }
    this.served.clear();
    for (const c of consumers) if (c.hub < 0) this.served.set(c.id, 0);
    for (const [key, list] of groups) {
      const pk = picks.get(key)!;
      for (const c of list) this.served.set(c.id, pk.on.has(c.id) ? 1 : 0);
    }

    // 6. Bilans.
    const byClass: ClassBalance[] = CONSUMER_CLASSES.map((cls) => ({ cls, priority: prio[cls], demandKw: 0, deliveredKw: 0, buildings: 0, cut: 0, unlinked: 0 }));
    const clsIdx = new Map(CONSUMER_CLASSES.map((c, i) => [c, i]));
    let demandKw = 0, unlinkedKw = 0, cut = 0, unlinked = 0, jobsOff = 0, resOff = 0;
    this.cutList = [];
    for (const c of consumers) {
      const b = byClass[clsIdx.get(c.cls)!]!;
      b.buildings++;
      b.demandKw += c.demandKw;
      demandKw += c.demandKw;
      const on = this.served.get(c.id) === 1;
      if (on) b.deliveredKw += c.demandKw;
      else {
        if (c.hub < 0) { unlinked++; b.unlinked++; unlinkedKw += c.demandKw; } else { cut++; b.cut++; this.cutList.push(c.id); }
        jobsOff += c.jobs; resOff += c.residents;
      }
    }
    this.cutList.sort((a, b) => a - b);
    const bySource: SourceBalance[] = SOURCE_IDS.map((source) => ({ source, nominalKw: 0, availableKw: 0, outputKw: 0, count: 0 }));
    const srcIdx = new Map<SourceId, number>(SOURCE_IDS.map((s, i) => [s, i]));
    let availableKw = 0;
    for (const f of facs) {
      if (f.kind === 'poste') continue;
      const s = bySource[srcIdx.get(f.kind as PlantType)!]!;
      s.count++; s.nominalKw += f.nominalKw; s.availableKw += avail.get(f.id)!; s.outputKw += report.outputOf.get(f.id) ?? 0;
      availableKw += avail.get(f.id)!;
    }
    const roof = bySource[srcIdx.get('toitures')!]!;
    roof.count = rooftopCount; roof.nominalKw = rooftopNominal; roof.availableKw = rooftopKw; roof.outputKw = report.rooftopOut;
    availableKw += rooftopKw;
    const producedKw = report.produced;
    const deliveredKw = byClass.reduce((t, b) => t + b.deliveredKw, 0);
    const summary: ElectriciteSummary = {
      at: now, hour: Math.round(hourOfDay * 100) / 100,
      availableKw, producedKw, demandKw, deliveredKw, lossesKw: report.losses,
      shortfallKw: Math.max(0, demandKw - unlinkedKw - deliveredKw),
      unlinkedKw, exportableKw: Math.max(0, availableKw - producedKw),
      windMs: Math.round(wind.ms * 10) / 10, windSource: wind.source, sun: Math.round(sun * 1000) / 1000,
      bySource, byClass, buildings: consumers.length, powered: consumers.length - cut - unlinked, cut, unlinked,
      jobsWithoutPower: jobsOff, residentsWithoutPower: resOff,
    };
    this.summaryCache = summary;

    // 7. Vues (rendu / interface).
    const energized = this.energizedSet(avail);
    this.facilityViews = facs.map((f) => ({
      id: f.id, kind: f.kind, nameFr: f.nameFr, x: f.x, y: f.y, z: f.z, rot: f.rot,
      availableKw: avail.get(f.id)!, nominalKw: f.nominalKw, outputKw: report.outputOf.get(f.id) ?? 0,
      failedUntil: this.facilityState(f.id).failedUntil, siteOk: f.siteOk, energized: energized.has(f.id), radius: f.radius,
    }));
    this.lineViews = this.state.lines.map((l) => {
      const fa = this.facilities.get(l.a)!, fb = this.facilities.get(l.b)!;
      return { id: l.id, a: l.a, b: l.b, ax: fa.x, az: fa.z, bx: fb.x, bz: fb.z, lengthM: l.lengthM, capacityKw: LINE_SPEC.capacityKw, load: report.lineLoad.get(l.id) ?? 0, failedUntil: l.failedUntil };
    });
    this.updateCoverage(m, consumers);

    // 8. Effets de l'heure (énergie, pollution, satisfaction, registre).
    if (hourly) {
      this.state.month.producedKwh += producedKw;
      this.state.month.deliveredKwh += deliveredKw;
      this.state.month.shedKwh += summary.shortfallKw;
      if (m) this.hourlyEffects(ctx, m, summary, consumers);
    }
    this.version++;
    return summary;
  }

  /** Construit le réseau municipal et répartit ; renvoie les quantités utiles (indépendantes des ids de nœuds). */
  private runNetwork(m: Municipal | undefined, facs: Facility[], avail: Map<number, number>, rooftopByHub: Map<number, number>, demandBy: Map<string, number>, prio: Record<ConsumerClass, number>): {
    deliveredBy: Map<string, number>; outputOf: Map<number, number>; lineLoad: Map<number, number>; rooftopOut: number; produced: number; delivered: number; losses: number;
  } {
    const deliveredBy = new Map<string, number>();
    const outputOf = new Map<number, number>();
    const lineLoad = new Map<number, number>();
    const res = { deliveredBy, outputOf, lineLoad, rooftopOut: 0, produced: 0, delivered: 0, losses: 0 };
    if (!m) return res;
    m.networks.remove(ELECTRICITE_NETWORK);
    if (facs.length === 0) return res;
    const net = m.networks.ensure(ELECTRICITE_NETWORK);
    const busOf = new Map<number, number>();
    const prodOf = new Map<number, number>(); // nœud producteur -> installation
    const roofNodes = new Set<number>();
    const consumerKey = new Map<number, string>();
    for (const f of facs) {
      const failed = this.facilityState(f.id).failedUntil > 0;
      const J = net.addNode({ role: 'junction', x: f.x, z: f.z, ref: f.id, enabled: !(f.kind === 'poste' && failed) });
      busOf.set(f.id, J);
      const D = net.addNode({ role: 'junction', x: f.x, z: f.z, ref: f.id, enabled: !(f.kind === 'poste' && failed) });
      const trCap = f.kind === 'poste' ? f.nominalKw : Math.max(PLANT_DISTRIBUTION_MIN_KW, f.nominalKw);
      net.addEdge(J, D, trCap, 0.01);
      if (f.kind !== 'poste') {
        const cap = avail.get(f.id) ?? 0;
        const P = net.addNode({ role: 'producer', capacity: cap, cost: FACILITY_SPECS[f.kind].meritCost, x: f.x, z: f.z, ref: f.id, enabled: cap > 0 });
        prodOf.set(P, f.id);
        net.addEdge(P, J, Math.max(cap, 1), 0);
      }
      const roof = rooftopByHub.get(f.id) ?? 0;
      if (roof > 0) {
        const R = net.addNode({ role: 'producer', capacity: roof, cost: 0, x: f.x, z: f.z, ref: f.id });
        roofNodes.add(R);
        net.addEdge(R, D, roof, 0);
      }
      for (const cls of CONSUMER_CLASSES) {
        const d = demandBy.get(`${f.id}|${cls}`) ?? 0;
        if (d <= 0) continue;
        const C = net.addNode({ role: 'consumer', demand: d, priority: prio[cls], x: f.x, z: f.z, ref: f.id });
        consumerKey.set(C, `${f.id}|${cls}`);
        net.addEdge(D, C, d * 2 + 1, 0);
      }
    }
    const lineEdge = new Map<number, number>();
    for (const l of this.state.lines) {
      const a = busOf.get(l.a), b = busOf.get(l.b);
      if (a === undefined || b === undefined) continue;
      const e = net.addEdge(a, b, LINE_SPEC.capacityKw, Math.min(0.5, LINE_SPEC.lossPerKm * (l.lengthM / 1000)));
      if (l.failedUntil > 0) net.setEdgeEnabled(e, false);
      lineEdge.set(e, l.id);
    }
    for (const [a, b, d] of this.localLinks()) net.addEdge(busOf.get(a)!, busOf.get(b)!, LOCAL_LINK_KW, Math.min(0.5, LOCAL_LINK_LOSS_PER_KM * (d / 1000)));
    const r = m.networks.allocate(ELECTRICITE_NETWORK);
    for (const c of r.consumers) { const k = consumerKey.get(c.node); if (k) deliveredBy.set(k, c.delivered); }
    for (const p of r.producers) {
      if (roofNodes.has(p.node)) { res.rooftopOut += p.output; continue; }
      const f = prodOf.get(p.node);
      if (f !== undefined) outputOf.set(f, (outputOf.get(f) ?? 0) + p.output);
    }
    for (const e of r.edges) { const l = lineEdge.get(e.edge); if (l !== undefined) lineLoad.set(l, e.load); }
    res.produced = r.produced; res.delivered = r.delivered; res.losses = r.losses;
    return res;
  }

  /** Calque « réseau électrique » : état par cellule de la grille municipale. */
  private updateCoverage(m: Municipal | undefined, consumers: Consumer[]): void {
    const g = m?.grids.defaultGeometry;
    if (!g) { this.coverage = undefined; return; }
    const n = g.cols * g.rows;
    const on = new Uint16Array(n), off = new Uint16Array(n), unl = new Uint16Array(n);
    for (const c of consumers) {
      if (c.cell < 0) continue;
      const s = this.served.get(c.id) === 1;
      if (s) on[c.cell]!++; else if (c.hub < 0) unl[c.cell]!++; else off[c.cell]!++;
    }
    const cells = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      const a = on[k]!, b = off[k]!, u = unl[k]!;
      cells[k] = a + b + u === 0 ? COVER_NONE : b === 0 && u === 0 ? COVER_OK : a === 0 && b > 0 ? COVER_CUT : a === 0 ? COVER_UNLINKED : COVER_PARTIAL;
    }
    const prev = this.coverage;
    const same = prev && prev.cols === g.cols && prev.rows === g.rows && prev.cells.length === n && prev.cells.every((v, k) => v === cells[k]);
    if (same) return;
    this.coverage = { originX: g.originX, originZ: g.originZ, cellSize: g.cellSize, cols: g.cols, rows: g.rows, cells, version: (prev?.version ?? 0) + 1 };
  }

  private hourlyEffects(ctx: PluginContext, m: Municipal, s: ElectriciteSummary, consumers: Consumer[]): void {
    const now = ctx.clock.totalMinutes;
    // Pollution de l'air (thermique, au prorata de la production appelée) et bruit (éoliennes, centrales).
    let air: ReturnType<Municipal['grids']['ensure']> | undefined;
    let noise: ReturnType<Municipal['grids']['ensure']> | undefined;
    for (const v of this.facilityViews) {
      const spec = FACILITY_SPECS[v.kind];
      const share = v.nominalKw > 0 ? v.outputKw / v.nominalKw : 0;
      if (spec.airPerHourAtFull > 0 && share > 0) (air ??= m.grids.ensure('pollution_air')).stamp(v.x, v.z, spec.airRadius, spec.airPerHourAtFull * share * 40, 'linear');
      if (spec.noisePerHourAtFull > 0 && share > 0) (noise ??= m.grids.ensure('bruit')).stamp(v.x, v.z, 120, spec.noisePerHourAtFull * share * 8, 'linear');
    }
    // Satisfaction : pénalité réversible (monte quand coupé, redescend quand rétabli).
    const g = m.grids.defaultGeometry;
    const n = g.cols * g.rows;
    if (this.penaltyGrid && this.penaltyGrid.length !== n) this.penaltyGrid = null;
    const cutCells = new Uint8Array(n);
    let anyCut = false;
    for (const c of consumers) if (c.cell >= 0 && c.residents > 0 && this.served.get(c.id) !== 1) { cutCells[c.cell] = 1; anyCut = true; }
    if (anyCut || this.penaltyGrid) {
      const pen = (this.penaltyGrid ??= new Float32Array(n));
      const sat = m.grids.ensure('satisfaction');
      let any = false;
      for (let k = 0; k < n; k++) {
        const old = pen[k]!;
        const nv = cutCells[k] ? Math.min(PENALTY_MAX, old + PENALTY_STEP_CUT) : Math.max(0, old - PENALTY_RECOVER);
        if (nv !== old) {
          pen[k] = nv;
          const j = Math.floor(k / g.cols), i = k - j * g.cols;
          sat.add(i, j, -(nv - old));
        }
        if (nv > 0) any = true;
      }
      if (!any) this.penaltyGrid = null;
    }
    // Registre d'effets : pénurie (début, évolution des coupures par classe, fin).
    const cutBy: Record<string, number> = {};
    for (const b of s.byClass) if (b.cut) cutBy[b.cls] = b.cut;
    const changed = JSON.stringify(cutBy) !== JSON.stringify(this.state.lastCutByClass);
    if (s.cut > 0 && !this.state.shortageCause) {
      const label = s.shortfallKw > 0 ? `Pénurie électrique : ${Math.round(s.shortfallKw)} kW non servis` : 'Coupures électriques (pannes du réseau)';
      this.state.shortageCause = m.effects.cause({ kind: 'electricite:penurie', label, source: 'electricite', at: now });
      this.event(ctx, 'penurie', `${label} — ${s.cut} bâtiments coupés`);
      ctx.notify('warn', `${label} : ${s.cut} bâtiments coupés (${s.byClass.filter((b) => b.cut).map((b) => b.cls).join(', ')}).`);
    }
    if (this.state.shortageCause && changed) {
      const cause = this.state.shortageCause;
      for (const b of s.byClass) {
        if ((cutBy[b.cls] ?? 0) === (this.state.lastCutByClass[b.cls] ?? 0)) continue;
        m.effects.record(cause, `electricite:coupure:${b.cls}`, -(b.demandKw - b.deliveredKw), 'kW', now, {}, `${b.cut} bâtiments coupés sur ${b.buildings}, priorité ${b.priority}`);
      }
      m.effects.record(cause, 'emplois:sans_courant', -s.jobsWithoutPower, 'emplois', now);
      m.effects.record(cause, 'habitants:sans_courant', -s.residentsWithoutPower, 'habitants', now);
    }
    if (s.cut === 0 && this.state.shortageCause) {
      m.effects.record(this.state.shortageCause, 'electricite:retablissement', s.deliveredKw, 'kW', now, {}, 'tous les bâtiments raccordés sont alimentés');
      this.state.shortageCause = 0;
      this.event(ctx, 'fin_penurie', 'Alimentation rétablie pour tous les bâtiments raccordés');
    }
    this.state.lastCutByClass = cutBy;
  }

  /* -------------------------------- Toitures / mois -------------------------------- */

  /** Installation journalière de panneaux en toiture (logements habités, raccordés, du plus ancien au plus récent). */
  day(ctx: PluginContext): void {
    for (const id of [...this.rooftopSet]) if (ctx.buildings.indexOf(id) < 0) this.rooftopSet.delete(id);
    if (!this.state.settings.rooftops) return;
    const st = ctx.buildings.store;
    const assets = ctx.catalog?.assets ?? [];
    const cands: number[] = [];
    for (let i = 0; i < ctx.buildings.count; i++) {
      const a = assets[st.assetIndex[i]!];
      if (!a || facilityKindOf(a) || consumerClassOf(a) !== 'residentiel' || st.residents[i]! <= 0) continue;
      if (!this.rooftopSet.has(st.id[i]!)) cands.push(st.id[i]!);
    }
    cands.sort((a, b) => a - b);
    const add = cands.slice(0, ROOFTOP_SPEC.installsPerDay);
    if (!add.length) return;
    for (const id of add) this.rooftopSet.add(id);
    const cost = add.length * ROOFTOP_SPEC.costPerBuilding;
    this.state.investments += cost;
    this.getMunicipal()?.budget.post('expense', 'investissement:toitures_solaires', cost, 'electricite');
    this.version++;
  }

  upkeepNominal(): number {
    let s = 0;
    for (const l of this.state.lines) s += lineCost(l.lengthM).upkeepPerMonth;
    // Entretien du réseau de distribution : 1 500 ¢ par installation et par mois.
    s += this.facilities.size * 1_500;
    return s;
  }

  /** Clôture mensuelle : lignes budgétaires du service (entretien selon le financement, vente d'électricité). */
  month(ctx: PluginContext): void {
    const m = this.getMunicipal();
    const expense = Math.round(this.upkeepNominal() * this.state.settings.funding);
    const income = Math.round(this.state.month.deliveredKwh * TARIFF_CENTS_PER_KWH);
    if (m) {
      if (expense > 0) m.budget.post('expense', 'entretien:reseau_electrique', expense, 'electricite');
      if (income > 0) m.budget.post('income', 'vente:electricite', income, 'electricite');
    }
    this.state.lastMonth = { income, expense, failures: this.state.month.failures };
    this.state.month = { producedKwh: 0, deliveredKwh: 0, shedKwh: 0, failures: 0 };
    void ctx;
    this.version++;
  }

  budget(): ElectriciteBudget {
    let fac = 0;
    for (const f of this.facilities.values()) fac += f.upkeep;
    const nominal = this.upkeepNominal();
    return {
      upkeepNominal: nominal, upkeepActual: Math.round(nominal * this.state.settings.funding), facilitiesUpkeep: fac,
      lastIncome: this.state.lastMonth.income, lastExpense: this.state.lastMonth.expense, investments: this.state.investments,
      monthProducedKwh: Math.round(this.state.month.producedKwh), monthDeliveredKwh: Math.round(this.state.month.deliveredKwh),
      monthShedKwh: Math.round(this.state.month.shedKwh), monthFailures: this.state.month.failures, lastMonthFailures: this.state.lastMonth.failures,
    };
  }

  /* ---------------------------------- Messages ---------------------------------- */

  full(): ElectriciteDelta {
    const d: ElectriciteDelta = {
      facilities: this.facilityViews, lines: this.lineViews, settings: { ...this.state.settings, priorities: [...this.state.settings.priorities] },
      budget: this.budget(), events: this.state.events.slice(-20), cutIds: [...this.cutList], municipal: this.municipalMode,
    };
    if (this.summaryCache) d.summary = this.summaryCache;
    if (this.coverage) d.coverage = { ...this.coverage, cells: this.coverage.cells.slice() };
    return d;
  }

  takeDelta(): ElectriciteDelta | undefined {
    if (this.version === this.sentVersion) return undefined;
    this.sentVersion = this.version;
    const d: ElectriciteDelta = {
      facilities: this.facilityViews, lines: this.lineViews, settings: { ...this.state.settings, priorities: [...this.state.settings.priorities] },
      budget: this.budget(), cutIds: [...this.cutList], municipal: this.municipalMode,
    };
    if (this.summaryCache) d.summary = this.summaryCache;
    if (this.state.events.length > this.eventsSent) d.events = this.state.events.slice(this.eventsSent);
    this.eventsSent = this.state.events.length;
    if (this.coverage && this.coverage.version !== this.coverageSent) {
      this.coverageSent = this.coverage.version;
      d.coverage = { ...this.coverage, cells: this.coverage.cells.slice() };
    }
    return d;
  }

  markSnapshotSent(): void {
    this.sentVersion = this.version;
    this.eventsSent = this.state.events.length;
    this.coverageSent = this.coverage?.version ?? -1;
  }

  /** Forçage du vent (tests, démonstration). */
  forceWind(ms: number | null): void { this.state.windForce = ms === null ? null : Math.max(0, ms); this.version++; }

  /** Diagnostic (tests) : installations courantes. */
  facilityList(): Facility[] { return [...this.facilities.values()].sort((a, b) => a.id - b.id); }
  rooftopCount(): number { return this.rooftopSet.size; }
}
