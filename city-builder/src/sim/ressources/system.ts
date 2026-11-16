/**
 * Ressources — simulation des zones spécialisées du zonage (docs/ZONAGE.md §8) :
 *
 *  - FORÊT : chaque case de la zone forestière porte un stock sur pied (0..capacité), la capacité étant la densité
 *    de la forêt naturelle du terrain au moment du zonage. Chaque jour, les exploitations (bâtiments nés de la zone)
 *    coupent dans un rayon `rayonCoupe` autour d'elles, en proportion de leurs EMPLOYÉS effectifs, dans les cases
 *    les plus fournies (au plus `coupeMaxCase` de la capacité par case et par jour) ; le bois produit vaut
 *    `boisParCase` m³ par case pleine. La forêt repousse (croissance logistique + semis). Une case sous
 *    `seuilDeboise` est DÉBOISÉE (le rendu retire ses arbres) ; au-dessus de `seuilRepousse`, elle a repoussé.
 *    Surexploiter une forêt fait donc chuter la production jusqu'à la repousse.
 *  - AGRICOLE : chaque ferme produit de la nourriture selon ses employés, la fertilité moyenne des cases agricoles
 *    voisines, la part de champs libres autour d'elle et la saison.
 *  - MIXTE : aucun calcul propre (les bâtiments ont des logements ET des emplois de commerce : la démographie et la
 *    demande du zonage les comptent dans R et C) ; statistiques seulement.
 *
 * Économie : la ville consomme du bois (emplois industriels, habitants) et de la nourriture (habitants). La
 * production couvre d'abord la consommation locale ; l'excédent est exporté et la ville perçoit une part fiscale
 * (taux industriel × `partFiscale` de la valeur exportée), versée chaque jour par `economy.applyService`. Le manque
 * de bois ou de nourriture relève la DEMANDE des zones forêt / agricole (service `ressources:demande` lu par le
 * zonage) ; les emplois des exploitations et des fermes comptent dans l'industrie (demande I, chômage).
 *
 * Sans zone spécialisée, le module est inerte (aucun delta, aucun instantané, aucune section, aucune recette).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { ResourceFlow, RessourcesDelta, RessourcesSnapshot, RessourcesStats } from '../../shared/protocol-ext/ressources';
import { ZONE_TYPES, type SpecialZone, type ZoneType } from '../../shared/protocol-ext/zonage';
import type { PluginContext } from '../plugins/types';
import { ZONAGE_ETAT_SERVICE, type SpecialDemandProvider, type ZonageEtat } from '../zoning/system';
import { DEFAULT_RESSOURCES_TUNING, regrow, resourceDemand, seasonYield, type RessourcesTuning } from './model';
import type { RessourcesSave } from './save';

const emptyFlow = (): ResourceFlow => ({ production: 0, consumption: 0, exported: 0, imported: 0, totalProduced: 0 });
const codeOf = (z: ZoneType): number => ZONE_TYPES.indexOf(z) + 1;
const SPECIAL: readonly SpecialZone[] = ['foret', 'agricole', 'mixte'];
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

export class RessourcesSystem {
  tuning: RessourcesTuning = { ...DEFAULT_RESSOURCES_TUNING };
  /** Forêt : case -> stock et capacité (0..1). */
  readonly stock = new Map<number, number>();
  readonly cap = new Map<number, number>();
  /** Cases forestières déboisées (stock sous le seuil). */
  readonly cleared = new Set<number>();
  regrownTotal = 0;
  bois: ResourceFlow = emptyFlow();
  nourriture: ResourceFlow = emptyFlow();
  recetteMois = 0;
  recetteMoisPrecedent = 0;
  /** Vrai dès qu'une zone spécialisée existe (ou après un chargement avec section). */
  active = false;
  private zoneVersion = -1;
  private fert = new Map<number, number>();
  private readonly tinted = new Map<number, number>();
  private pendingTints: number[] = [];
  private pendingCleared: number[] = [];
  private pendingRegrown: number[] = [];
  private statsDirty = false;
  private lastStats: RessourcesStats | null = null;

  reset(): void {
    this.tuning = { ...DEFAULT_RESSOURCES_TUNING };
    this.stock.clear(); this.cap.clear(); this.cleared.clear(); this.fert.clear(); this.tinted.clear();
    this.regrownTotal = 0;
    this.bois = emptyFlow(); this.nourriture = emptyFlow();
    this.recetteMois = this.recetteMoisPrecedent = 0;
    this.active = false;
    this.zoneVersion = -1;
    this.pendingTints = []; this.pendingCleared = []; this.pendingRegrown = [];
    this.statsDirty = false;
    this.lastStats = null;
  }

  /** Service de demande lu par le zonage (manque de bois / de nourriture). */
  demandProvider(): SpecialDemandProvider {
    return {
      demand: (zone, industry) => {
        const f = zone === 'foret' ? this.bois : this.nourriture;
        return resourceDemand(industry, f.production, f.consumption);
      },
    };
  }

  private etat(ctx: PluginContext): ZonageEtat | undefined { return ctx.use<ZonageEtat>(ZONAGE_ETAT_SERVICE); }

  /** Suit les cases de la zone forestière (capacité = forêt naturelle) ; active le module si une zone spécialisée existe. */
  sync(ctx: PluginContext): ZonageEtat | undefined {
    const e = this.etat(ctx);
    if (!e) return undefined;
    if (e.version === this.zoneVersion) return e;
    this.zoneVersion = e.version;
    this.fert.clear();
    const cells = e.cellsOf('foret');
    const keep = new Set(cells);
    for (const idx of [...this.stock.keys()]) {
      if (!keep.has(idx)) { this.stock.delete(idx); this.cap.delete(idx); this.cleared.delete(idx); }
    }
    for (const idx of cells) {
      if (this.stock.has(idx)) continue;
      const k = Math.max(this.tuning.foretMin, Math.min(1, ctx.terrain.forestAt?.(e.centerX(idx), e.centerZ(idx)) ?? 1));
      this.stock.set(idx, k);
      this.cap.set(idx, k);
    }
    if (!this.active && SPECIAL.some((z) => e.cellsOf(z).length > 0)) { this.active = true; this.statsDirty = true; }
    return e;
  }

  /** Cases d'une zone dans un disque (x, z, r). */
  private cellsAround(e: ZonageEtat, zone: ZoneType, x: number, z: number, r: number, out: number[]): number[] {
    out.length = 0;
    const c = e.cell, n = Math.ceil(r / c);
    for (let dj = -n; dj <= n; dj++) {
      for (let di = -n; di <= n; di++) {
        if ((di * di + dj * dj) * c * c > r * r) continue;
        const idx = e.index(x + di * c, z + dj * c);
        if (idx >= 0 && e.zoneAt(idx) === zone) out.push(idx);
      }
    }
    return out;
  }

  /** Une journée : repousse, coupe, récoltes, consommation, exportations et recette. */
  day(ctx: PluginContext): void {
    if (!ctx.inGame) return;
    const e = this.sync(ctx);
    if (!e || !this.active) return;
    const t = this.tuning;
    const b = ctx.buildings, st = b.store;
    // 1. Repousse.
    for (const [idx, s] of this.stock) this.stock.set(idx, regrow(s, this.cap.get(idx) ?? 0, t));
    // 2. Coupe par les exploitations forestières.
    let cut = 0;
    const around: number[] = [];
    const forestIds = e.buildingsOf('foret');
    for (const id of forestIds) {
      const i = b.indexOf(id);
      if (i < 0 || !st.roadAccess[i]) continue;
      let want = st.workers[i]! * t.coupeParEmploye;
      if (want <= 0) continue;
      const cand = this.cellsAround(e, 'foret', st.x[i]!, st.z[i]!, t.rayonCoupe, around).filter((k) => this.stock.has(k));
      cand.sort((p, q) => this.stock.get(q)! - this.stock.get(p)! || p - q);
      for (const k of cand) {
        if (want <= 1e-9) break;
        const s = this.stock.get(k)!, cap = this.cap.get(k)!;
        const take = Math.min(want, s, t.coupeMaxCase * cap);
        if (take <= 0) continue;
        this.stock.set(k, s - take);
        want -= take;
        cut += take;
      }
    }
    // 3. Déboisement / repousse visibles.
    for (const [idx, s] of this.stock) {
      const k = this.cap.get(idx)!;
      if (!this.cleared.has(idx) && s < t.seuilDeboise * k) {
        this.cleared.add(idx);
        this.pendingCleared.push(round3(e.centerX(idx)), round3(e.centerZ(idx)));
      } else if (this.cleared.has(idx) && s > t.seuilRepousse * k) {
        this.cleared.delete(idx);
        this.regrownTotal++;
        this.pendingRegrown.push(round3(e.centerX(idx)), round3(e.centerZ(idx)));
      }
    }
    const woodProd = cut * t.boisParCase;
    // 4. Récoltes.
    const season = seasonYield(ctx.clock.season);
    let food = 0;
    const farmIds = e.buildingsOf('agricole');
    for (const id of farmIds) {
      const i = b.indexOf(id);
      if (i < 0 || !st.roadAccess[i]) continue;
      const w = st.workers[i]!;
      if (w <= 0) continue;
      const fields = this.cellsAround(e, 'agricole', st.x[i]!, st.z[i]!, t.rayonChamps, around);
      const own = st.tilesX[i]! * st.tilesZ[i]!;
      const free = Math.max(0, fields.length - own);
      food += w * t.nourritureParEmploye * this.meanFertility(ctx, e, fields) * Math.min(1, free / t.champsPleins) * season;
    }
    // 5. Consommation de la ville.
    const special = new Set<number>([...forestIds, ...farmIds]);
    let industryWorkers = 0;
    const cat = ctx.catalog;
    for (let i = 0; i < b.count; i++) {
      const a = cat?.assets[st.assetIndex[i]!];
      if (!a || a.category !== 'industrial' || special.has(st.id[i]!)) continue;
      industryWorkers += st.workers[i]!;
    }
    const pop = ctx.demography?.population ?? 0;
    this.flow(this.bois, woodProd, industryWorkers * t.boisParEmploiIndustriel + pop * t.boisParHabitant);
    this.flow(this.nourriture, food, pop * t.nourritureParHabitant);
    // 6. Recette : part fiscale des exportations.
    const value = this.bois.exported * t.prixBois + this.nourriture.exported * t.prixNourriture;
    const revenue = Math.round(value * Math.max(0, ctx.economy.taxRates.industrial) * t.partFiscale);
    if (revenue > 0) { ctx.economy.applyService(revenue); this.recetteMois += revenue; }
    this.collectTints(ctx, e);
    this.statsDirty = true;
  }

  private flow(f: ResourceFlow, production: number, consumption: number): void {
    f.production = round3(production);
    f.consumption = round3(consumption);
    f.exported = round3(Math.max(0, production - consumption));
    f.imported = round3(Math.max(0, consumption - production));
    f.totalProduced = round3(f.totalProduced + production);
  }

  private meanFertility(ctx: PluginContext, e: ZonageEtat, cells: readonly number[]): number {
    if (cells.length === 0) return 0;
    let sum = 0;
    for (const idx of cells) {
      let v = this.fert.get(idx);
      if (v === undefined) { v = ctx.terrain.fertilityAt?.(e.centerX(idx), e.centerZ(idx)) ?? 1; this.fert.set(idx, v); }
      sum += v;
    }
    return sum / cells.length;
  }

  month(): void {
    if (!this.active) return;
    this.recetteMoisPrecedent = this.recetteMois;
    this.recetteMois = 0;
    this.statsDirty = true;
  }

  /** Nouveaux bâtiments des zones spécialisées à teinter ; oublie les bâtiments démolis. */
  private collectTints(ctx: PluginContext, e: ZonageEtat): void {
    const seen = new Set<number>();
    for (const z of SPECIAL) {
      const code = codeOf(z);
      for (const id of e.buildingsOf(z)) {
        seen.add(id);
        if (this.tinted.get(id) === code) continue;
        this.tinted.set(id, code);
        this.pendingTints.push(id, code);
      }
    }
    for (const id of [...this.tinted.keys()]) if (!seen.has(id) || ctx.buildings.indexOf(id) < 0) this.tinted.delete(id);
  }

  stats(ctx: PluginContext): RessourcesStats {
    const e = this.etat(ctx);
    let sum = 0, capSum = 0;
    for (const [idx, s] of this.stock) { sum += s; capSum += this.cap.get(idx) ?? 0; }
    const b = ctx.buildings, st = b.store;
    let logements = 0, emplois = 0, mixtes = 0;
    for (const id of e?.buildingsOf('mixte') ?? []) {
      const i = b.indexOf(id);
      if (i < 0) continue;
      mixtes++;
      logements += st.residents[i]!;
      emplois += st.workers[i]!;
    }
    const fields = e?.cellsOf('agricole') ?? [];
    let fert = 0;
    if (e && fields.length > 0) fert = this.meanFertility(ctx, e, fields);
    return {
      bois: { ...this.bois }, nourriture: { ...this.nourriture },
      foret: {
        cells: this.stock.size, stock: capSum > 0 ? round3(sum / capSum) : 0, deboisees: this.cleared.size, repoussees: this.regrownTotal,
        exploitations: e?.buildingsOf('foret').length ?? 0,
      },
      agricole: { fermes: e?.buildingsOf('agricole').length ?? 0, champs: fields.length, fertilite: round3(fert) },
      mixte: { batiments: mixtes, logements, emplois },
      recetteMois: this.recetteMois, recetteMoisPrecedent: this.recetteMoisPrecedent,
    };
  }

  takeDelta(ctx: PluginContext): RessourcesDelta | undefined {
    if (!this.active) {
      // Activation dès la première peinture d'une zone spécialisée (même en pause).
      this.sync(ctx);
      if (!this.active) return undefined;
    }
    const d: RessourcesDelta = {};
    if (this.statsDirty) { d.stats = this.lastStats = this.stats(ctx); this.statsDirty = false; }
    if (this.pendingTints.length) { d.tints = this.pendingTints; this.pendingTints = []; }
    if (this.pendingCleared.length) { d.cleared = this.pendingCleared; this.pendingCleared = []; }
    if (this.pendingRegrown.length) { d.regrown = this.pendingRegrown; this.pendingRegrown = []; }
    return Object.keys(d).length > 0 ? d : undefined;
  }

  full(ctx: PluginContext): RessourcesSnapshot {
    const e = this.sync(ctx);
    this.pendingTints = []; this.pendingCleared = []; this.pendingRegrown = [];
    if (e) this.collectTints(ctx, e);
    const tints: number[] = [];
    for (const [id, code] of this.tinted) tints.push(id, code);
    this.pendingTints = [];
    const cleared: number[] = [];
    if (e) for (const idx of this.cleared) cleared.push(round3(e.centerX(idx)), round3(e.centerZ(idx)));
    this.statsDirty = false;
    return { stats: this.lastStats = this.stats(ctx), tints, cleared };
  }

  /* -------------------------------- Sauvegarde -------------------------------- */

  toSave(): RessourcesSave | undefined {
    if (!this.active) return undefined;
    const forest: number[] = [];
    for (const [idx, s] of this.stock) forest.push(idx, Math.round(s * 1000), Math.round((this.cap.get(idx) ?? 0) * 1000));
    return {
      forest, cleared: [...this.cleared], regrown: this.regrownTotal,
      bois: { ...this.bois }, nourriture: { ...this.nourriture },
      recette: [this.recetteMois, this.recetteMoisPrecedent],
    };
  }

  load(s: RessourcesSave): void {
    this.stock.clear(); this.cap.clear(); this.cleared.clear();
    for (let p = 0; p + 2 < s.forest.length; p += 3) {
      this.stock.set(s.forest[p]!, s.forest[p + 1]! / 1000);
      this.cap.set(s.forest[p]!, s.forest[p + 2]! / 1000);
    }
    for (const idx of s.cleared) if (this.stock.has(idx)) this.cleared.add(idx);
    this.regrownTotal = s.regrown;
    this.bois = { ...s.bois };
    this.nourriture = { ...s.nourriture };
    [this.recetteMois, this.recetteMoisPrecedent] = s.recette;
    this.active = true;
    this.zoneVersion = -1;
    this.statsDirty = true;
  }

  /** Cases forestières suivies (tests). */
  get tracked(): number { return this.stock.size; }
}
