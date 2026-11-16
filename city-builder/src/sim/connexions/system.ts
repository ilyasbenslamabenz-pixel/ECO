/**
 * Connexions extérieures (module « connexions », docs/CONNEXIONS.md).
 *
 *  - Détection : une impasse du réseau (nœud d'un seul tronçon ouvert aux véhicules) à moins de 60 m du bord de la carte
 *    est un point d'entrée ; autoroute ou route selon le tronçon. Recalculée à chaque version du réseau. Une connexion
 *    est « reliée » si son réseau (composante connexe) dessert au moins un bâtiment.
 *  - Trafic : les connexions reliées sont données au trafic (`TrafficSystem.setGates`) ; une part des trajets générés
 *    entre ou sort par elles (navetteurs, visiteurs, poids lourds d'import / export), sans augmenter le nombre total de
 *    voitures visé.
 *  - Marchandises (une fois par jour) : production (industrie, bureaux) et consommation (habitants, commerces) des
 *    bâtiments reliés ; les échanges locaux d'abord, puis export du surplus et import du manque dans la limite de la
 *    capacité des connexions ; droits perçus par la ville (`applyService`), balance commerciale affichée.
 *  - Migrants : chaque ménage arrivé est acheminé par une connexion (compté, camion de déménagement dans le trafic) et
 *    les arrivées sont un peu plus nombreuses quand la ville est reliée (`externalImmigrationFactor`).
 * Sans connexion reliée : aucun effet (le trafic, la démographie et le budget sont inchangés).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import {
  CONNEXION_EDGE_M, CONNEXIONS_EXT_VERSION, DEFAULT_CONNEXIONS_TUNING,
  type ConnexionKind, type ConnexionsDelta, type ConnexionsState, type ConnexionsSummary, type ConnexionsTuning, type ConnexionView,
} from '../../shared/protocol-ext/connexions';
import { ROAD_KINDS } from '../roads/types';
import type { DemographySystem } from '../demography';
import type { TrafficGate, TrafficSystem } from '../traffic/system';
import type { PluginContext } from '../plugins/types';

export interface ConnexionsCore { demography: DemographySystem | null; traffic: TrafficSystem | null }

interface Conn {
  nodeId: number;
  segId: number;
  atA: boolean;
  kind: ConnexionKind;
  x: number; y: number; z: number;
  dirX: number; dirZ: number;
  side: ConnexionView['side'];
  /** Composante connexe du réseau. */
  comp: number;
  linked: boolean;
  inDay: number; outDay: number; importT: number; exportT: number; migrantsDay: number;
  migrantsAcc: number;
}

export interface ConnexionsSave {
  share: number;
  freight: number;
  immigration: number;
  day: Omit<ConnexionsSummary, 'connexions' | 'linked' | 'migrantsMonth' | 'dutiesMonth' | 'migrantsLastMonth' | 'dutiesLastMonth' | 'tripShare' | 'immigrationBonus'>;
  month: { migrants: number; duties: number };
  lastMonth: { migrants: number; duties: number };
}

const SIDE_NAME: Record<ConnexionView['side'], string> = { nord: 'nord', sud: 'sud', est: 'est', ouest: 'ouest' };
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const emptyDay = (): ConnexionsSave['day'] => ({
  productionT: 0, consumptionT: 0, localT: 0, exportT: 0, importT: 0, unsoldT: 0, shortageT: 0, dutiesDay: 0, tradeBalanceDay: 0,
  vehiclesInDay: 0, vehiclesOutDay: 0, trucksDay: 0,
});

export class ConnexionsSystem {
  readonly tuning: ConnexionsTuning = { ...DEFAULT_CONNEXIONS_TUNING };
  private core: ConnexionsCore = { demography: null, traffic: null };
  private list: Conn[] = [];
  private netVersion = -1;
  private bldCount = -1;
  /** Composante de chaque tronçon (identifiant -> composante) et composantes qui desservent un bâtiment. */
  private compOfSeg = new Map<number, number>();
  private servedComps = new Set<number>();
  private structVersion = 0;
  private sentVersion = -1;
  private day: ConnexionsSave['day'] = emptyDay();
  private month = { migrants: 0, duties: 0 };
  private lastMonth = { migrants: 0, duties: 0 };
  private share = 0;
  private freight = 0;
  private immigration = 1;
  private lastIn = 0;
  private lastOut = 0;
  private lastFreight = 0;
  private ctx: PluginContext | null = null;

  attach(core: ConnexionsCore): void {
    this.core = core;
    if (core.demography) core.demography.onImmigrantHousehold = (homeId, persons) => this.onImmigrants(homeId, persons);
    this.applySettings();
  }

  reset(): void {
    this.list = []; this.netVersion = -1; this.bldCount = -1;
    this.compOfSeg.clear(); this.servedComps.clear();
    this.structVersion++; this.sentVersion = -1; this.shown = false;

    this.day = emptyDay();
    this.month = { migrants: 0, duties: 0 }; this.lastMonth = { migrants: 0, duties: 0 };
    this.share = 0; this.freight = 0; this.immigration = 1;
    this.syncCounters();
    this.applySettings();
  }

  get count(): number { return this.list.length; }
  get linkedCount(): number { let n = 0; for (const c of this.list) if (c.linked) n++; return n; }

  private syncCounters(): void {
    const tr = this.core.traffic;
    this.lastIn = tr?.externalIn ?? 0; this.lastOut = tr?.externalOut ?? 0; this.lastFreight = tr?.externalFreight ?? 0;
  }

  /** Réglages appliqués au trafic et à la démographie (connexions reliées seulement ; neutres sinon). */
  private applySettings(): void {
    const linked = this.list.filter((c) => c.linked);
    const tr = this.core.traffic, demo = this.core.demography;
    if (tr) {
      tr.setGates(linked.map((c): TrafficGate => ({ segId: c.segId, atA: c.atA, x: c.x, z: c.z })));
      tr.externalShare = linked.length ? this.share : 0;
      tr.externalFreightShare = linked.length ? this.freight : 0;
    }
    if (demo) demo.externalImmigrationFactor = linked.length ? this.immigration : 1;
  }

  /* ------------------------------ Détection ------------------------------ */

  /** Connexions et liaisons à jour (contrôle en O(1) quand ni le réseau ni les bâtiments n'ont changé). */
  refresh(ctx: PluginContext): void {
    this.ctx = ctx;
    const roads = ctx.roads;
    if (roads.version !== this.netVersion) { this.detect(ctx); this.bldCount = -1; }
    if (this.list.length && ctx.buildings.count !== this.bldCount) this.computeLinks(ctx);
  }

  private detect(ctx: PluginContext): void {
    this.netVersion = ctx.roads.version;
    const roads = ctx.roads, bd = ctx.terrain.bounds();
    const prev = this.list;
    this.list = [];
    if (!bd) { this.touch(); return; }
    for (const node of roads.nodeIds()) {
      const inc = roads.incident(node);
      if (inc.length !== 1) continue;
      const seg = inc[0]!;
      const kind = ROAD_KINDS[roads.kindOf(seg)];
      if (!kind.vehicles) continue;
      const p = roads.nodePos(node);
      const d = { ouest: p.x - bd.minX, est: bd.maxX - p.x, nord: p.z - bd.minZ, sud: bd.maxZ - p.z };
      let side: Conn['side'] = 'ouest';
      for (const k of ['est', 'nord', 'sud'] as const) if (d[k] < d[side]) side = k;
      if (d[side] > CONNEXION_EDGE_M) continue;
      const [a] = roads.endpoints(seg);
      const dir = side === 'ouest' ? [-1, 0] : side === 'est' ? [1, 0] : side === 'nord' ? [0, -1] : [0, 1];
      const old = prev.find((c) => c.nodeId === node && c.segId === seg);
      this.list.push({
        nodeId: node, segId: seg, atA: a === node, kind: roads.kindOf(seg) === 'highway' ? 'autoroute' : 'route',
        x: p.x, y: p.y, z: p.z, dirX: dir[0]!, dirZ: dir[1]!, side, comp: -1, linked: false,
        inDay: old?.inDay ?? 0, outDay: old?.outDay ?? 0, importT: old?.importT ?? 0, exportT: old?.exportT ?? 0, migrantsDay: old?.migrantsDay ?? 0, migrantsAcc: old?.migrantsAcc ?? 0,
      });
    }
    // Ordre stable : par côté puis le long du bord.
    const order = { nord: 0, est: 1, sud: 2, ouest: 3 };
    this.list.sort((u, v) => order[u.side] - order[v.side] || (u.side === 'nord' || u.side === 'sud' ? u.x - v.x : u.z - v.z) || u.nodeId - v.nodeId);
    this.compOfSeg.clear();
    if (this.list.length) this.components(ctx);
    for (const c of this.list) c.comp = this.compOfSeg.get(c.segId) ?? -1;
    if (!this.list.length) { this.servedComps.clear(); this.applySettings(); }
    this.touch();
  }

  /** Composantes connexes du réseau ouvert aux véhicules (parcours en largeur depuis chaque tronçon). */
  private components(ctx: PluginContext): void {
    const roads = ctx.roads;
    let comp = 0;
    for (const start of roads.segmentIds()) {
      if (this.compOfSeg.has(start) || !ROAD_KINDS[roads.kindOf(start)].vehicles) continue;
      const stack = [start];
      this.compOfSeg.set(start, comp);
      while (stack.length) {
        const s = stack.pop()!;
        for (const n of roads.endpoints(s)) {
          for (const t of roads.incident(n)) {
            if (this.compOfSeg.has(t) || !ROAD_KINDS[roads.kindOf(t)].vehicles) continue;
            this.compOfSeg.set(t, comp);
            stack.push(t);
          }
        }
      }
      comp++;
    }
  }

  /** Composantes qui desservent au moins un bâtiment relié à la route ; connexions reliées. */
  private computeLinks(ctx: PluginContext): void {
    this.bldCount = ctx.buildings.count;
    this.servedComps.clear();
    const st = ctx.buildings.store, roads = ctx.roads;
    const want = new Set(this.list.map((c) => c.comp));
    for (let i = 0; i < ctx.buildings.count && this.servedComps.size < want.size; i++) {
      if (!st.roadAccess[i]) continue;
      const hit = roads.segmentNear(st.x[i]!, st.z[i]!, 60, (id) => !ROAD_KINDS[roads.kindOf(id)].vehicles);
      const comp = hit ? this.compOfSeg.get(hit.segId) : undefined;
      if (comp !== undefined && want.has(comp)) this.servedComps.add(comp);
    }
    let changed = false;
    for (const c of this.list) {
      const l = c.comp >= 0 && this.servedComps.has(c.comp);
      if (l !== c.linked) { c.linked = l; changed = true; }
    }
    if (changed) this.touch();
    this.applySettings();
  }

  private touch(): void { this.structVersion++; }

  /* ------------------------------ Journée ------------------------------ */

  /** Échanges du jour, droits, réglages du trafic et de l'immigration. */
  daily(ctx: PluginContext): void {
    this.refresh(ctx);
    const tr = this.core.traffic;
    const linked = this.list.filter((c) => c.linked);
    // Véhicules passés par les connexions depuis hier (répartis au prorata du poids de chaque connexion).
    const vin = (tr?.externalIn ?? 0) - this.lastIn, vout = (tr?.externalOut ?? 0) - this.lastOut, trucks = (tr?.externalFreight ?? 0) - this.lastFreight;
    this.syncCounters();
    const migrants = this.list.reduce((s, c) => s + c.migrantsAcc, 0);
    for (const c of this.list) { c.migrantsDay = c.migrantsAcc; c.migrantsAcc = 0; c.inDay = 0; c.outDay = 0; c.importT = 0; c.exportT = 0; }
    if (!this.list.length || (!linked.length && migrants === 0 && vin === 0 && vout === 0)) {
      const had = this.day.productionT || this.day.vehiclesInDay || this.share;
      this.day = emptyDay();
      this.share = 0; this.freight = 0; this.immigration = 1;
      this.applySettings();
      if (had) this.touch();
      return;
    }
    const t = this.tuning;
    // Production et consommation des bâtiments reliés à une connexion (les autres : invendu / manque).
    const st = ctx.buildings.store, roads = ctx.roads;
    let prod = 0, cons = 0, prodOff = 0, consOff = 0;
    for (let i = 0; i < ctx.buildings.count; i++) {
      const a = ctx.buildings.assetOf(st.id[i]!);
      if (!a) continue;
      const w = st.workers[i]!, r = st.residents[i]!;
      let p = 0, q = r * t.residentTPerDay;
      if (a.category === 'industrial') p += w * t.industryTPerWorkerDay;
      else if (a.category === 'commercial') {
        if (a.tags.includes('bureaux') || a.tags.includes('tertiaire')) p += w * t.officeTPerWorkerDay;
        else q += w * t.shopTPerWorkerDay;
      }
      if (p === 0 && q === 0) continue;
      let ok = false;
      if (linked.length && st.roadAccess[i]) {
        const hit = roads.segmentNear(st.x[i]!, st.z[i]!, 60, (id) => !ROAD_KINDS[roads.kindOf(id)].vehicles);
        const comp = hit ? this.compOfSeg.get(hit.segId) : undefined;
        ok = comp !== undefined && linked.some((c) => c.comp === comp);
      }
      if (ok) { prod += p; cons += q; } else { prodOff += p; consOff += q; }
    }
    const local = Math.min(prod, cons);
    const cap = linked.reduce((s, c) => s + (c.kind === 'autoroute' ? t.highwayCapacityT : t.roadCapacityT), 0);
    const exportT = Math.min(prod - local, cap), importT = Math.min(cons - local, cap);
    const duties = exportT * t.exportDutyChfPerT + importT * t.importDutyChfPerT;
    if (duties > 0) ctx.economy.applyService(duties);
    this.month.duties += duties;
    // Répartition par connexion (capacité), trafic au prorata du poids de trajets.
    const weight = (c: Conn): number => (c.kind === 'autoroute' ? t.highwayTripShare : t.roadTripShare);
    const wSum = linked.reduce((s, c) => s + weight(c), 0) || 1;
    for (const c of linked) {
      const k = (c.kind === 'autoroute' ? t.highwayCapacityT : t.roadCapacityT) / Math.max(1, cap);
      c.exportT = exportT * k; c.importT = importT * k;
      c.inDay = Math.round((vin * weight(c)) / wSum); c.outDay = Math.round((vout * weight(c)) / wSum);
    }
    this.day = {
      productionT: prod + prodOff, consumptionT: cons + consOff, localT: local, exportT, importT,
      unsoldT: prod - local - exportT + prodOff, shortageT: cons - local - importT + consOff,
      dutiesDay: duties, tradeBalanceDay: exportT * t.exportValueChfPerT - importT * t.importValueChfPerT,
      vehiclesInDay: vin, vehiclesOutDay: vout, trucksDay: trucks,
    };
    // Réglages du lendemain : part des trajets, poids lourds (fret / 18 t), immigration.
    const pop = ctx.demography?.population ?? 0;
    this.share = linked.length ? Math.min(t.maxTripShare, wSum) : 0;
    const tripsTrucks = (exportT + importT) / 18;
    this.freight = linked.length ? clamp(tripsTrucks / (tripsTrucks + 20 + pop * 0.01), 0.05, 0.6) : 0;
    this.immigration = 1 + Math.min(t.immigrationBonusMax, linked.reduce((s, c) => s + (c.kind === 'autoroute' ? t.immigrationBonusHighway : t.immigrationBonusRoad), 0));
    this.applySettings();
    this.touch();
  }

  onMonth(): void {
    this.lastMonth = { ...this.month };
    this.month = { migrants: 0, duties: 0 };
    this.touch();
  }

  /** Ménage arrivé (crochet de la démographie) : acheminé par une connexion reliée, camion de déménagement. */
  private onImmigrants(homeId: number, persons: number): void {
    const ctx = this.ctx;
    const linked = this.list.filter((c) => c.linked);
    if (!ctx || !linked.length) return;
    const r = ctx.rng.next();
    const c = linked[Math.min(linked.length - 1, Math.floor(r * linked.length))]!;
    c.migrantsAcc += persons;
    this.month.migrants += persons;
    this.core.traffic?.spawnFromOutside(homeId, r);
  }

  /* ------------------------------ Vues ------------------------------ */

  private view(c: Conn, i: number): ConnexionView {
    const r = (v: number): number => Math.round(v * 10) / 10;
    return {
      id: i + 1, name: `${c.kind === 'autoroute' ? 'Autoroute' : 'Route'} ${SIDE_NAME[c.side]} ${i + 1}`, kind: c.kind,
      x: r(c.x), y: r(c.y), z: r(c.z), dirX: c.dirX, dirZ: c.dirZ, side: c.side, linked: c.linked,
      inDay: c.inDay, outDay: c.outDay, importT: r(c.importT), exportT: r(c.exportT), migrantsDay: c.migrantsDay,
    };
  }

  summary(): ConnexionsSummary {
    const r = (v: number): number => Math.round(v * 10) / 10;
    const d = this.day;
    return {
      connexions: this.list.length, linked: this.linkedCount,
      productionT: r(d.productionT), consumptionT: r(d.consumptionT), localT: r(d.localT), exportT: r(d.exportT), importT: r(d.importT),
      unsoldT: r(d.unsoldT), shortageT: r(d.shortageT), dutiesDay: Math.round(d.dutiesDay), tradeBalanceDay: Math.round(d.tradeBalanceDay),
      vehiclesInDay: d.vehiclesInDay, vehiclesOutDay: d.vehiclesOutDay, trucksDay: d.trucksDay,
      tripShare: Math.round(this.share * 1000) / 1000, immigrationBonus: Math.round((this.immigration - 1) * 1000) / 1000,
      migrantsMonth: this.month.migrants, dutiesMonth: Math.round(this.month.duties),
      migrantsLastMonth: this.lastMonth.migrants, dutiesLastMonth: Math.round(this.lastMonth.duties),
    };
  }

  state(ctx: PluginContext): ConnexionsState {
    this.refresh(ctx);
    return { summary: this.summary(), connexions: this.list.map((c, i) => this.view(c, i)) };
  }

  /** Le rendu affiche au moins une connexion (une liste vide n'est envoyée qu'une fois, pour l'effacer). */
  private shown = false;

  takeDelta(): ConnexionsDelta | undefined {
    if (this.structVersion === this.sentVersion) return undefined;
    this.sentVersion = this.structVersion;
    if (!this.list.length && !this.shown) return undefined;
    this.shown = this.list.length > 0;
    return { version: CONNEXIONS_EXT_VERSION, connexions: this.list.map((c, i) => this.view(c, i)) };
  }

  snapshot(): ConnexionsDelta | undefined {
    this.sentVersion = this.structVersion;
    this.shown = this.list.length > 0;
    if (!this.list.length) return undefined;
    return { version: CONNEXIONS_EXT_VERSION, connexions: this.list.map((c, i) => this.view(c, i)) };
  }

  /* ------------------------------ Sauvegarde ------------------------------ */

  save(): ConnexionsSave | undefined {
    if (!this.list.length && !this.month.migrants && !this.lastMonth.migrants && !this.month.duties && !this.lastMonth.duties) return undefined;
    return { share: this.share, freight: this.freight, immigration: this.immigration, day: { ...this.day }, month: { ...this.month }, lastMonth: { ...this.lastMonth } };
  }

  load(ctx: PluginContext, s: ConnexionsSave): void {
    this.share = s.share; this.freight = s.freight; this.immigration = s.immigration;
    this.day = { ...s.day }; this.month = { ...s.month }; this.lastMonth = { ...s.lastMonth };
    this.syncCounters();
    if (ctx.inGame) this.refresh(ctx);
    this.applySettings();
  }

  /** Fin d'un chargement (avec ou sans section) : connexions détectées sur le réseau rechargé. */
  afterLoad(ctx: PluginContext): void {
    this.syncCounters();
    this.refresh(ctx);
    this.applySettings();
  }
}

export { emptyDay as emptyConnexionsDay };
