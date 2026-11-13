/**
 * Système « déchets » (phase 2B.6) branché sur le contrat municipal :
 *  - production horaire par bâtiment (habitants, emplois, catégorie) dans des bacs locaux qui se remplissent ;
 *    au-delà de la capacité des bacs, les déchets débordent (non collectés) ;
 *  - tournées de camions-bennes planifiées les jours de collecte : départ du dépôt, arrêts choisis par temps de
 *    trajet sur le graphe routier (Dijkstra), vidage au centre de tri (part triée) puis à l'incinérateur ou à la
 *    décharge (part résiduelle), retour au dépôt ; les camions avancent avec l'horloge de jeu ;
 *  - filières : tri (reprise des matériaux, recettes), incinération (énergie, pollution de l'air), décharge
 *    (remplissage, pollution du sol et de l'eau ; pleine -> débordement) ;
 *  - non-collecte : pollution du sol et nuisances (grilles municipales), satisfaction et valeur foncière en baisse
 *    (décalage réversible proportionnel aux nuisances) ;
 *  - budget : exploitation des camions (financement réglable -> nombre de camions en service), recettes, lignes
 *    budgétaires municipales ; registre d'effets (réglages du joueur, décharge pleine, non-collecte).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import {
  COLLECTION_DAYS, DEFAULT_FACILITY_CAPACITY, DEFAULT_WASTE_SETTINGS, WASTE_FACILITY_FR, WASTE_PARAMS as P, clampSetting,
  facilityKindOfTags, tagNumber, type WasteDayStats, type WasteFacilityInfo, type WasteFacilityKind, type WasteSettings,
  type WasteSummary, type WasteTotals,
} from '../../shared/waste/types';
import { weekdayOf } from '../clock';
import { rotAngle } from '../../shared/footprint';
import type { Municipal } from '../municipal/municipal';
import type { IndicatorGrid } from '../municipal/grid';
import type { PluginContext } from '../plugins/types';
import { ATTACH_RADIUS, TruckGraph, type AttachRequest } from './graph';
import { ROAD_KINDS } from '../roads/types';

export const NUISANCE_ID = 'dechets:nuisance' as const;
const MIN_PER_DAY = 1440;

/** Bacs d'un bâtiment : part triée (rec) et résiduelle (res), kg. */
export interface Bin { rec: number; res: number; cap: number; /** Débordement du jour (kg). */ over: number }

/** Installation suivie. */
export interface Facility {
  id: number;
  kind: WasteFacilityKind;
  x: number;
  z: number;
  rot: number;
  capacity: number;
  /** Décharge : masse enfouie ; tri / incinérateur : file d'attente (kg). */
  stock: number;
  /** Masse reçue aujourd'hui (kg). */
  inToday: number;
  /** Masse traitée la veille (kg). */
  processed: number;
  /** Débordement du jour autour de l'installation (kg). */
  overToday: number;
  connected: boolean;
}

export type TruckEventKind = 'pickup' | 'unload' | 'end';
export interface TruckEvent { t: number; kind: TruckEventKind; ref: number }

/** Tournée en cours (temps relatifs au départ, min). */
export interface TruckRun {
  truck: number;
  depot: number;
  depart: number;
  /** Polyligne x, z. */
  pts: number[];
  /** Temps cumulé (min) à chaque point. */
  times: number[];
  events: TruckEvent[];
  next: number;
  rec: number;
  res: number;
  stops: number;
}

const emptyDay = (day: number): WasteDayStats => ({
  day, producedKg: 0, collectedKg: 0, uncollectedKg: 0, sortedKg: 0, recycledKg: 0, burnedKg: 0, landfilledKg: 0,
  overflowKg: 0, energyMWh: 0, tours: 0, stops: 0,
});
const emptyTotals = (): WasteTotals => ({
  producedKg: 0, collectedKg: 0, uncollectedKg: 0, recycledKg: 0, burnedKg: 0, landfilledKg: 0, overflowKg: 0, energyMWh: 0,
  tours: 0, incomeRecycling: 0, incomeEnergy: 0, expenseTrucks: 0,
});

/** Montant mensuel du service (¢) pour une flotte et un financement. */
export function monthlyTruckBudget(fleet: number, funding: number): number {
  return Math.round(fleet * P.truckCostPerMonth * funding);
}

/** Camions en service selon le financement (part de la flotte, arrondi inférieur). */
export function activeTrucksFor(fleet: number, funding: number): number {
  return Math.max(0, Math.min(fleet, Math.floor(fleet * funding + 1e-9)));
}

export class WasteSystem {
  settings: WasteSettings = { ...DEFAULT_WASTE_SETTINGS };
  bins = new Map<number, Bin>();
  facilities = new Map<number, Facility>();
  runs: TruckRun[] = [];
  today: WasteDayStats = emptyDay(0);
  lastDay: WasteDayStats | null = null;
  totals: WasteTotals = emptyTotals();
  /** Cumuls du mois en cours (¢) avant écriture des lignes budgétaires. */
  month = { recycling: 0, energy: 0 };
  /** Décalages appliqués aux grilles satisfaction / valeur foncière (réversibles). */
  appliedSat: Float32Array | null = null;
  appliedLand: Float32Array | null = null;
  /** Causes ouvertes dans le registre d'effets (-1 = aucune). */
  causes = { settings: -1, uncollected: -1, landfillFull: -1 };
  blocked: string | null = null;
  /** Version de contenu (deltas). */
  version = 0;
  /** Production courante (kg/j) et nombre de producteurs, recalculés chaque heure. */
  productionPerDay = 0;
  producers = 0;
  private notified = new Set<string>();

  constructor(private readonly muni: () => Municipal | undefined) {}

  reset(): void {
    this.settings = { ...DEFAULT_WASTE_SETTINGS };
    this.bins.clear();
    this.facilities.clear();
    this.runs = [];
    this.today = emptyDay(0);
    this.lastDay = null;
    this.totals = emptyTotals();
    this.month = { recycling: 0, energy: 0 };
    this.appliedSat = null;
    this.appliedLand = null;
    this.causes = { settings: -1, uncollected: -1, landfillFull: -1 };
    this.blocked = null;
    this.productionPerDay = 0;
    this.producers = 0;
    this.notified.clear();
    this.version++;
  }

  /* ------------------------------------------------------------------ */
  /* Grilles municipales                                                 */
  /* ------------------------------------------------------------------ */

  /** Crée (si besoin) les grilles utilisées par le module. */
  ensureGrids(): void {
    const m = this.muni();
    if (!m) return;
    m.grids.ensure('pollution_air');
    m.grids.ensure('pollution_sol');
    m.grids.ensure('pollution_eau');
    m.grids.ensure('satisfaction');
    m.grids.ensure('valeur_fonciere');
    m.grids.ensure(NUISANCE_ID, {
      nameFr: 'Nuisances (déchets)', unit: 'indice', base: 0, min: 0, max: 100,
      diffusion: { rate: 0.05, decay: 0.12, steps: 1, every: 'day', boundary: 'open' },
    });
  }

  private grid(id: 'pollution_air' | 'pollution_sol' | 'pollution_eau' | 'satisfaction' | 'valeur_fonciere' | typeof NUISANCE_ID): IndicatorGrid | undefined {
    return this.muni()?.grids.get(id);
  }

  /* ------------------------------------------------------------------ */
  /* Installations                                                       */
  /* ------------------------------------------------------------------ */

  /** Synchronise la liste des installations avec les bâtiments posés (ajouts / démolitions). */
  syncFacilities(ctx: PluginContext): void {
    const st = ctx.buildings.store, n = ctx.buildings.count;
    const seen = new Set<number>();
    for (let i = 0; i < n; i++) {
      const id = st.id[i]!;
      const a = ctx.buildings.assetOf(id);
      const kind = facilityKindOfTags(a?.tags);
      if (!kind) continue;
      seen.add(id);
      let f = this.facilities.get(id);
      if (!f) {
        const cap = kind === 'depot' ? tagNumber(a?.tags, 'camions') : kind === 'decharge' ? tagNumber(a?.tags, 'capacite_totale') : tagNumber(a?.tags, 'capacite_jour');
        f = { id, kind, x: st.x[i]!, z: st.z[i]!, rot: rotAngle(st.rot[i]!), capacity: cap ?? DEFAULT_FACILITY_CAPACITY[kind], stock: 0, inToday: 0, processed: 0, overToday: 0, connected: false };
        this.facilities.set(id, f);
        this.version++;
      }
      f.x = st.x[i]!; f.z = st.z[i]!; f.rot = rotAngle(st.rot[i]!);
      const c = !!ctx.roads.segmentNear(f.x, f.z, ATTACH_RADIUS, (sid) => !ROAD_KINDS[ctx.roads.kindOf(sid)].vehicles);
      if (c !== f.connected) { f.connected = c; this.version++; }
    }
    for (const id of [...this.facilities.keys()]) if (!seen.has(id)) { this.facilities.delete(id); this.version++; }
  }

  fleet(): number {
    let n = 0;
    for (const f of this.facilities.values()) if (f.kind === 'depot') n += f.capacity;
    return n;
  }

  connectedFleet(): number {
    let n = 0;
    for (const f of this.facilities.values()) if (f.kind === 'depot' && f.connected) n += f.capacity;
    return n;
  }

  /* ------------------------------------------------------------------ */
  /* Production (chaque heure)                                           */
  /* ------------------------------------------------------------------ */

  /** Production de `minutes` minutes de jeu : remplit les bacs, compte les débordements. */
  produce(ctx: PluginContext, minutes: number): void {
    this.syncFacilities(ctx);
    const st = ctx.buildings.store, n = ctx.buildings.count;
    const share = this.settings.sortShare;
    let perDay = 0, producers = 0;
    const live = new Set<number>();
    for (let i = 0; i < n; i++) {
      const id = st.id[i]!;
      live.add(id);
      const a = ctx.buildings.assetOf(id);
      const jobs = st.workers[i]!, res = st.residents[i]!;
      if (jobs <= 0 && res <= 0) continue;
      const kgDay = res * P.kgPerResident + jobs * (P.kgPerJob[a?.category ?? ''] ?? P.kgPerJobDefault);
      if (kgDay <= 0) continue;
      producers++;
      perDay += kgDay;
      let b = this.bins.get(id);
      if (!b) this.bins.set(id, (b = { rec: 0, res: 0, cap: 0, over: 0 }));
      b.cap = Math.max(P.storageMinKg, kgDay * P.storageDays);
      const kg = (kgDay * minutes) / MIN_PER_DAY;
      b.rec += kg * share;
      b.res += kg * (1 - share);
      this.today.producedKg += kg;
      this.totals.producedKg += kg;
      const excess = b.rec + b.res - b.cap;
      if (excess > 0) {
        const f = excess / (b.rec + b.res);
        b.rec -= b.rec * f; b.res -= b.res * f;
        b.over += excess;
        this.today.uncollectedKg += excess;
        this.totals.uncollectedKg += excess;
      }
    }
    // Bâtiments démolis : leurs bacs disparaissent avec eux.
    if (this.bins.size > live.size) for (const id of [...this.bins.keys()]) if (!live.has(id)) this.bins.delete(id);
    this.productionPerDay = perDay;
    this.producers = producers;
    this.version++;
  }

  /* ------------------------------------------------------------------ */
  /* Planification des tournées                                          */
  /* ------------------------------------------------------------------ */

  isCollectionDay(dayIndex: number): boolean {
    const wd = weekdayOf(dayIndex * MIN_PER_DAY);
    return (COLLECTION_DAYS[this.settings.collectsPerWeek] ?? COLLECTION_DAYS[3]!).includes(wd);
  }

  nextCollectionDay(fromDay: number): number {
    for (let d = fromDay; d < fromDay + 8; d++) if (this.isCollectionDay(d)) return d;
    return fromDay;
  }

  /**
   * Planifie les tournées du jour (départ à `departAbs`, minute absolue). Renvoie le nombre de tournées lancées.
   * Les arrêts sont répartis équitablement entre les camions en service (charge visée = stock / camions).
   */
  planTours(ctx: PluginContext, departAbs: number): number {
    this.syncFacilities(ctx);
    const st = ctx.buildings.store, n = ctx.buildings.count;
    const reqs: AttachRequest[] = [];
    for (const f of this.facilities.values()) reqs.push({ ref: f.id, x: f.x, z: f.z });
    for (let i = 0; i < n; i++) {
      const id = st.id[i]!;
      const b = this.bins.get(id);
      if (b && b.rec + b.res >= P.minStopKg && !this.facilities.has(id)) reqs.push({ ref: id, x: st.x[i]!, z: st.z[i]! });
    }
    const g = TruckGraph.build(ctx.roads, reqs, P.truckSpeedKmh);
    for (const f of this.facilities.values()) {
      const c = g.attached.has(f.id);
      if (c !== f.connected) { f.connected = c; this.version++; }
    }
    const depots = [...this.facilities.values()].filter((f) => f.kind === 'depot' && f.connected).sort((a, b) => a.id - b.id);
    const tris = [...this.facilities.values()].filter((f) => f.kind === 'tri' && f.connected);
    const incs = [...this.facilities.values()].filter((f) => f.kind === 'incinerateur' && f.connected);
    const lands = [...this.facilities.values()].filter((f) => f.kind === 'decharge' && f.connected);
    const fleet = depots.reduce((s, f) => s + f.capacity, 0);
    const active = activeTrucksFor(fleet, this.settings.funding);
    this.blocked = !this.facilities.size || !depots.length ? 'Aucun dépôt de camions-bennes relié à la route'
      : !incs.length && !lands.length ? 'Aucune filière de traitement (incinérateur ou décharge) reliée à la route'
        : active === 0 ? 'Financement insuffisant : aucun camion en service' : null;
    if (this.blocked) { this.version++; return 0; }

    // Arrêts : bâtiments rattachés au graphe.
    interface Stop { ref: number; node: number; kg: number }
    const stops = new Map<number, Stop>();
    let totalKg = 0;
    for (const r of reqs) {
      if (this.facilities.has(r.ref)) continue;
      const a = g.attached.get(r.ref);
      const b = this.bins.get(r.ref);
      if (!a || !b) continue;
      const kg = b.rec + b.res;
      stops.set(a.node, { ref: r.ref, node: a.node, kg });
      totalKg += kg;
    }
    if (!stops.size) return 0;
    const target = totalKg / active;
    // Admissions prévues aux installations (choix de la filière).
    const planned = new Map<number, number>();
    const pickResidual = (dist: Float64Array): Facility | null => {
      const best = (list: Facility[], ok: (f: Facility) => boolean): Facility | null => {
        let r: Facility | null = null;
        for (const f of list) {
          const node = g.attached.get(f.id)!.node;
          if (!Number.isFinite(dist[node]!) || !ok(f)) continue;
          if (!r || dist[node]! < dist[g.attached.get(r.id)!.node]!) r = f;
        }
        return r;
      };
      return best(incs, (f) => f.inToday + (planned.get(f.id) ?? 0) < f.capacity)
        ?? best(lands, (f) => f.stock + (planned.get(f.id) ?? 0) < f.capacity)
        ?? best(lands, () => true) ?? best(incs, () => true);
    };
    const nearest = (list: Facility[], dist: Float64Array): Facility | null => {
      let r: Facility | null = null, rd = Infinity;
      for (const f of list) { const d = dist[g.attached.get(f.id)!.node]!; if (d < rd) { rd = d; r = f; } }
      return r;
    };

    let launched = 0;
    for (let k = 0; k < active && stops.size; k++) {
      const depot = depots[Math.min(depots.length - 1, this.depotIndexFor(k, depots))]!;
      const depotNode = g.attached.get(depot.id)!.node;
      const run: TruckRun = { truck: k, depot: depot.id, depart: departAbs + k * 3, pts: [], times: [], events: [], next: 0, rec: 0, res: 0, stops: 0 };
      let pos = depotNode, t = 0, load = 0, rec = 0, taken = 0;
      const pushLeg = (dst: number): boolean => {
        const pts: number[] = [];
        const dt = g.pathTo(dst, pts);
        if (dt < 0) return false;
        appendLeg(run, pts, t, dt);
        t += dt;
        pos = dst;
        return true;
      };
      const unload = (): void => {
        if (load <= 0) return;
        let dist = g.shortest(pos);
        const tri = rec > 0 ? nearest(tris, dist) : null;
        if (tri) {
          if (pushLeg(g.attached.get(tri.id)!.node)) {
            t += P.unloadMinutes / 2; hold(run, t);
            run.events.push({ t, kind: 'unload', ref: tri.id });
            planned.set(tri.id, (planned.get(tri.id) ?? 0) + rec);
            load -= rec; rec = 0;
            dist = g.shortest(pos);
          }
        }
        const disp = pickResidual(dist);
        if (disp && pushLeg(g.attached.get(disp.id)!.node)) {
          t += P.unloadMinutes; hold(run, t);
          run.events.push({ t, kind: 'unload', ref: disp.id });
          planned.set(disp.id, (planned.get(disp.id) ?? 0) + load);
        }
        load = 0; rec = 0;
      };
      run.pts.push(g.attached.get(depot.id)!.x, g.attached.get(depot.id)!.z);
      run.times.push(0);
      while (stops.size && taken < target * 1.05 + 1) {
        const dist = g.shortest(pos);
        let best: Stop | null = null;
        for (const s of stops.values()) if (Number.isFinite(dist[s.node]!) && (!best || dist[s.node]! < dist[best.node]! || (dist[s.node] === dist[best.node] && s.ref < best.ref))) best = s;
        if (!best) break;
        if (t + dist[best.node]! + P.serviceMinutesPerStop > P.shiftMinutes) break;
        pushLeg(best.node);
        t += P.serviceMinutesPerStop; hold(run, t);
        run.events.push({ t, kind: 'pickup', ref: best.ref });
        run.stops++;
        const take = Math.min(best.kg, P.truckCapacityKg - load);
        const b = this.bins.get(best.ref)!;
        const recPart = b.rec + b.res > 0 ? (take * b.rec) / (b.rec + b.res) : 0;
        load += take; rec += recPart; taken += take;
        best.kg -= take;
        if (best.kg <= 1) stops.delete(best.node);
        if (load >= P.truckCapacityKg * 0.95) unload();
      }
      if (run.stops === 0) continue;
      unload();
      // Retour au dépôt.
      const dist = g.shortest(pos);
      pushLeg(depotNode);
      run.events.push({ t, kind: 'end', ref: depot.id });
      this.runs.push(run);
      launched++;
      this.today.stops += run.stops;
    }
    this.today.tours += launched;
    this.totals.tours += launched;
    this.version++;
    return launched;
  }

  /** Répartit les camions entre dépôts au prorata de leur flotte. */
  private depotIndexFor(k: number, depots: Facility[]): number {
    let acc = 0;
    for (let i = 0; i < depots.length; i++) { acc += depots[i]!.capacity; if (k < acc) return i; }
    return depots.length - 1;
  }

  /* ------------------------------------------------------------------ */
  /* Avancement des camions (chaque tick)                                */
  /* ------------------------------------------------------------------ */

  advanceTrucks(now: number): void {
    if (!this.runs.length) return;
    let changed = false;
    for (const r of this.runs) {
      const el = now - r.depart;
      while (r.next < r.events.length && r.events[r.next]!.t <= el) {
        this.applyEvent(r, r.events[r.next]!);
        r.next++;
        changed = true;
      }
    }
    const before = this.runs.length;
    this.runs = this.runs.filter((r) => r.next < r.events.length);
    if (changed || this.runs.length !== before) this.version++;
  }

  private applyEvent(r: TruckRun, e: TruckEvent): void {
    if (e.kind === 'pickup') {
      const b = this.bins.get(e.ref);
      if (!b) return;
      const room = Math.max(0, P.truckCapacityKg - r.rec - r.res);
      const tot = b.rec + b.res;
      const take = Math.min(tot, room);
      if (take <= 0) return;
      const fr = take / tot;
      r.rec += b.rec * fr; r.res += b.res * fr;
      b.rec -= b.rec * fr; b.res -= b.res * fr;
      this.today.collectedKg += take;
      this.totals.collectedKg += take;
    } else if (e.kind === 'unload') {
      const f = this.facilities.get(e.ref);
      if (!f) { // installation démolie entre-temps : déversement sauvage sur place
        this.today.overflowKg += r.rec + r.res; this.totals.overflowKg += r.rec + r.res;
        r.rec = 0; r.res = 0; return;
      }
      if (f.kind === 'tri') { this.receive(f, r.rec); this.today.sortedKg += r.rec; r.rec = 0; }
      else { this.receive(f, r.rec + r.res); r.rec = 0; r.res = 0; }
    }
  }

  /** Admission dans une installation (décharge : enfouissement immédiat, débordement si pleine). */
  private receive(f: Facility, kg: number): void {
    if (kg <= 0) return;
    f.inToday += kg;
    if (f.kind === 'decharge') {
      const room = Math.max(0, f.capacity - f.stock);
      const ok = Math.min(room, kg);
      f.stock += ok;
      this.today.landfilledKg += ok; this.totals.landfilledKg += ok;
      const over = kg - ok;
      if (over > 0) { f.overToday += over; this.today.overflowKg += over; this.totals.overflowKg += over; }
    } else {
      f.stock += kg;
    }
  }

  /** Envoie des résidus (refus de tri, surplus d'incinérateur) vers une décharge ; sinon débordement sur place. */
  private toLandfill(from: Facility, kg: number): void {
    if (kg <= 0) return;
    let best: Facility | null = null;
    for (const f of this.facilities.values()) {
      if (f.kind !== 'decharge' || !f.connected) continue;
      if (!best || (best.stock >= best.capacity && f.stock < f.capacity) || Math.hypot(f.x - from.x, f.z - from.z) < Math.hypot(best.x - from.x, best.z - from.z)) best = f;
    }
    if (best) this.receive(best, kg);
    else { from.overToday += kg; this.today.overflowKg += kg; this.totals.overflowKg += kg; }
  }

  /* ------------------------------------------------------------------ */
  /* Traitement, pollution, effets (chaque jour)                         */
  /* ------------------------------------------------------------------ */

  /** Clôt la journée écoulée : traitement des files, pollution, nuisances, effets, statistiques. */
  closeDay(ctx: PluginContext, dayIndex: number, at: number): void {
    const m = this.muni();
    this.syncFacilities(ctx);
    const day = this.today;
    // 1. Centres de tri : reprise des matériaux, refus vers incinérateur / décharge.
    for (const f of this.facilities.values()) {
      if (f.kind !== 'tri') continue;
      const p = Math.min(f.stock, f.capacity);
      f.stock -= p; f.processed = p;
      const recovered = p * P.sortRecoveryRate;
      day.recycledKg += recovered; this.totals.recycledKg += recovered;
      const income = (recovered / 1000) * P.recyclePricePerTonne;
      this.month.recycling += income; this.totals.incomeRecycling += income;
      const refuse = p - recovered;
      const inc = [...this.facilities.values()].find((x) => x.kind === 'incinerateur' && x.connected);
      if (inc) this.receive(inc, refuse); else this.toLandfill(f, refuse);
    }
    // 2. Incinérateurs : combustion bornée, énergie, pollution de l'air ; file trop longue -> décharge.
    for (const f of this.facilities.values()) {
      if (f.kind !== 'incinerateur') continue;
      const burn = Math.min(f.stock, f.capacity);
      f.stock -= burn; f.processed = burn;
      day.burnedKg += burn; this.totals.burnedKg += burn;
      const mwh = (burn / 1000) * P.incinerationMWhPerTonne;
      day.energyMWh += mwh; this.totals.energyMWh += mwh;
      const income = mwh * P.energyPricePerMWh;
      this.month.energy += income; this.totals.incomeEnergy += income;
      if (burn > 0) this.grid('pollution_air')?.stamp(f.x, f.z, 320, (burn / 1000) * P.airPerTonneBurned, 'smooth');
      const surplus = f.stock - 2 * f.capacity;
      if (surplus > 0) { f.stock -= surplus; this.toLandfill(f, surplus); }
    }
    // 3. Décharges : pollution du sol et de l'eau selon les apports ; débordement.
    const soil = this.grid('pollution_sol'), water = this.grid('pollution_eau'), nuis = this.grid(NUISANCE_ID);
    let overflowTotal = 0;
    const soilBefore = soil?.copyValues();
    for (const f of this.facilities.values()) {
      if (f.kind === 'decharge') {
        f.processed = f.inToday;
        const t = Math.max(0, f.inToday - f.overToday) / 1000;
        if (t > 0) {
          soil?.stamp(f.x, f.z, 80, t * P.soilPerTonneLandfilled, 'smooth');
          water?.stamp(f.x, f.z, 120, t * P.waterPerTonneLandfilled, 'smooth');
        }
      }
      if (f.overToday > 0) {
        const t = f.overToday / 1000;
        overflowTotal += f.overToday;
        soil?.stamp(f.x, f.z, 140, t * P.soilPerTonneOverflow, 'linear');
        water?.stamp(f.x, f.z, 200, t * P.waterPerTonneOverflow, 'linear');
        nuis?.stamp(f.x, f.z, 160, t * P.nuisancePerTonneOverflow, 'linear');
      }
    }
    const fullLandfills = [...this.facilities.values()].filter((f) => f.kind === 'decharge' && f.stock >= f.capacity - 1);
    if (m && overflowTotal > 0 && soil && soilBefore) {
      if (this.causes.landfillFull < 0 || !m.effects.summary(this.causes.landfillFull)) {
        const f = fullLandfills[0] ?? [...this.facilities.values()].find((x) => x.overToday > 0)!;
        this.causes.landfillFull = m.effects.cause({ kind: 'decharge_pleine', label: fullLandfills.length ? 'Décharge pleine : débordement' : 'Aucune filière disponible : déversement', source: 'dechets', at, x: f.x, z: f.z, ref: f.id });
        this.notifyOnce(ctx, 'decharge_pleine', 'warn', fullLandfills.length ? 'Décharge pleine : les déchets débordent et polluent le sol et l\'eau.' : 'Aucune filière disponible : les déchets sont déversés sur place.');
      }
      m.effects.measureGrid(this.causes.landfillFull, soil, soilBefore, at, 'débordement');
      m.effects.record(this.causes.landfillFull, 'dechets:debordement', overflowTotal, 'kg', at);
    }
    // 4. Bacs qui débordent (non collectés) : pollution du sol et nuisances au pied des bâtiments.
    const st = ctx.buildings.store;
    let uncol = 0;
    const soilBefore2 = soil?.copyValues();
    for (const [id, b] of this.bins) {
      if (b.over <= 0) continue;
      const i = ctx.buildings.indexOf(id);
      if (i >= 0) {
        const t = b.over / 1000;
        soil?.stamp(st.x[i]!, st.z[i]!, 40, t * P.soilPerTonneUncollected, 'linear');
        nuis?.stamp(st.x[i]!, st.z[i]!, 56, t * P.nuisancePerTonneUncollected, 'linear');
      }
      uncol += b.over;
      b.over = 0;
    }
    if (m && uncol > 0 && soil && soilBefore2) {
      if (this.causes.uncollected < 0) {
        this.causes.uncollected = m.effects.cause({ kind: 'dechets_non_collectes', label: 'Déchets non collectés', source: 'dechets', at });
        this.notifyOnce(ctx, 'non_collecte', 'warn', 'Des bacs débordent : déchets non collectés (pollution, nuisances).');
      }
      m.effects.measureGrid(this.causes.uncollected, soil, soilBefore2, at, 'bacs débordants');
      m.effects.record(this.causes.uncollected, 'dechets:non_collecte', uncol, 'kg', at);
    } else if (uncol === 0) {
      this.causes.uncollected = -1; // épisode terminé : le prochain ouvrira une nouvelle cause
    }
    // Effet du dernier réglage du joueur sur la non-collecte et les tournées (traçabilité de la décision).
    if (m && this.causes.settings >= 0) {
      m.effects.record(this.causes.settings, 'dechets:non_collecte_jour', uncol, 'kg', at);
      m.effects.record(this.causes.settings, 'dechets:tournees_jour', day.tours, 'tournées', at);
    }
    // 5. Nuisances -> satisfaction et valeur foncière (décalage réversible).
    this.applyNuisanceOffsets();
    // 6. Statistiques.
    for (const f of this.facilities.values()) { f.inToday = 0; f.overToday = 0; }
    this.lastDay = { ...day, day: dayIndex - 1 };
    this.today = emptyDay(dayIndex);
    this.version++;
  }

  /** satisfaction += k·nuisance, valeur foncière += k'·nuisance : on remplace la contribution précédente. */
  applyNuisanceOffsets(): void {
    const nuis = this.grid(NUISANCE_ID), sat = this.grid('satisfaction'), land = this.grid('valeur_fonciere');
    if (!nuis) return;
    const apply = (g: IndicatorGrid | undefined, k: number, prev: Float32Array | null): Float32Array | null => {
      if (!g || g.size !== nuis.size) return prev;
      const applied = prev && prev.length === g.size ? prev : new Float32Array(g.size);
      for (let c = 0; c < g.size; c++) {
        const target = k * nuis.data[c]!;
        const d = target - applied[c]!;
        if (Math.abs(d) < 1e-4) continue;
        const i = c % g.cols, j = Math.floor(c / g.cols);
        applied[c] = applied[c]! + g.add(i, j, d);
      }
      return applied;
    };
    this.appliedSat = apply(sat, P.satisfactionPerNuisance, this.appliedSat);
    this.appliedLand = apply(land, P.landValuePerNuisance, this.appliedLand);
  }

  /** Lignes budgétaires du mois écoulé (exploitation des camions, recettes). */
  closeMonth(ctx: PluginContext): void {
    const m = this.muni();
    const expense = monthlyTruckBudget(this.connectedFleet() || this.fleet(), this.settings.funding);
    this.totals.expenseTrucks += expense;
    if (m) {
      if (expense > 0) m.budget.post('expense', 'dechets:collecte', expense, 'dechets');
      if (this.month.recycling > 0) m.budget.post('income', 'dechets:recyclage', Math.round(this.month.recycling), 'dechets');
      if (this.month.energy > 0) m.budget.post('income', 'dechets:energie', Math.round(this.month.energy), 'dechets');
    }
    void ctx;
    this.month = { recycling: 0, energy: 0 };
    this.version++;
  }

  /* ------------------------------------------------------------------ */
  /* Réglages                                                            */
  /* ------------------------------------------------------------------ */

  /** Applique des réglages ; ouvre une cause dans le registre d'effets. Renvoie les réglages effectifs. */
  setSettings(p: Partial<WasteSettings>, at: number): WasteSettings {
    const before = { ...this.settings };
    for (const k of ['collectsPerWeek', 'sortShare', 'funding'] as const) {
      const v = p[k];
      if (typeof v === 'number') this.settings[k] = clampSetting(k, v);
    }
    const parts: string[] = [];
    if (before.collectsPerWeek !== this.settings.collectsPerWeek) parts.push(`collecte ${before.collectsPerWeek} → ${this.settings.collectsPerWeek} passages/semaine`);
    if (before.sortShare !== this.settings.sortShare) parts.push(`tri ${Math.round(before.sortShare * 100)} → ${Math.round(this.settings.sortShare * 100)} %`);
    if (before.funding !== this.settings.funding) parts.push(`financement ${Math.round(before.funding * 100)} → ${Math.round(this.settings.funding * 100)} %`);
    const m = this.muni();
    if (parts.length && m) {
      this.causes.settings = m.effects.cause({ kind: 'reglage_dechets', label: `Déchets : ${parts.join(', ')}`, source: 'joueur', at });
      if (before.funding !== this.settings.funding) {
        const f = this.connectedFleet() || this.fleet();
        m.effects.record(this.causes.settings, 'dechets:camions_en_service', activeTrucksFor(f, this.settings.funding) - activeTrucksFor(f, before.funding), 'camions', at);
        m.effects.record(this.causes.settings, 'budget:dechets', monthlyTruckBudget(f, this.settings.funding) - monthlyTruckBudget(f, before.funding), '¢/mois', at);
      }
    }
    this.version++;
    return { ...this.settings };
  }

  private notifyOnce(ctx: PluginContext, key: string, level: 'info' | 'warn', msg: string): void {
    if (this.notified.has(key)) return;
    this.notified.add(key);
    ctx.notify(level, msg);
  }

  /* ------------------------------------------------------------------ */
  /* Lecture                                                             */
  /* ------------------------------------------------------------------ */

  facilityInfos(): WasteFacilityInfo[] {
    return [...this.facilities.values()].sort((a, b) => a.id - b.id).map((f) => ({
      buildingId: f.id, kind: f.kind, x: f.x, z: f.z, rot: f.rot, connected: f.connected, capacity: f.capacity,
      amount: f.kind === 'decharge' ? f.stock : f.processed,
    }));
  }

  summary(dayIndex: number): WasteSummary {
    let stored = 0, storage = 0, overflowing = 0;
    for (const b of this.bins.values()) { stored += b.rec + b.res; storage += b.cap; if (b.rec + b.res >= b.cap - 1e-6) overflowing++; }
    const st = (id: 'pollution_air' | 'pollution_sol' | 'pollution_eau' | typeof NUISANCE_ID): { mean: number; max: number } => {
      const g = this.grid(id);
      if (!g) return { mean: 0, max: 0 };
      const s = g.stats();
      return { mean: s.mean, max: s.max };
    };
    const air = st('pollution_air'), soil = st('pollution_sol'), water = st('pollution_eau'), nuis = st(NUISANCE_ID);
    const fleet = this.connectedFleet() || this.fleet();
    return {
      settings: { ...this.settings },
      storedKg: stored, storageKg: storage, overflowingBuildings: overflowing, producers: this.producers,
      productionPerDay: this.productionPerDay,
      fleet, activeTrucks: activeTrucksFor(fleet, this.settings.funding), trucksOnRoad: this.runs.length,
      monthlyBudget: monthlyTruckBudget(fleet, this.settings.funding),
      facilities: this.facilityInfos(),
      lastDay: this.lastDay ? { ...this.lastDay } : null,
      totals: { ...this.totals },
      pollution: { air: air.mean, soil: soil.mean, water: water.mean, nuisance: nuis.mean, airMax: air.max, soilMax: soil.max, nuisanceMax: nuis.max },
      blocked: this.blocked,
      nextCollectionDay: this.nextCollectionDay(dayIndex),
    };
  }

  /** Positions des camions à la minute `now` : [x, z, cap, charge 0..1] par camion. */
  truckPoses(now: number): Float32Array {
    const out = new Float32Array(this.runs.length * 4);
    let k = 0;
    for (const r of this.runs) {
      const el = now - r.depart;
      if (el < 0) continue;
      const { times, pts } = r;
      let lo = 0, hi = times.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (times[mid]! <= el) lo = mid; else hi = mid - 1; }
      const i = lo, j = Math.min(times.length - 1, i + 1);
      const span = times[j]! - times[i]!;
      const f = span > 1e-9 ? Math.min(1, Math.max(0, (el - times[i]!) / span)) : 0;
      const x = pts[2 * i]! + (pts[2 * j]! - pts[2 * i]!) * f, z = pts[2 * i + 1]! + (pts[2 * j + 1]! - pts[2 * i + 1]!) * f;
      // Cap : direction du prochain point distinct (le camion garde son cap à l'arrêt).
      let hx = 0, hz = 0;
      for (let q = i; q + 1 < times.length && hx === 0 && hz === 0; q++) { hx = pts[2 * q + 2]! - pts[2 * q]!; hz = pts[2 * q + 3]! - pts[2 * q + 1]!; }
      for (let q = i; q > 0 && hx === 0 && hz === 0; q--) { hx = pts[2 * q]! - pts[2 * q - 2]!; hz = pts[2 * q + 1]! - pts[2 * q - 1]!; }
      out[k++] = x; out[k++] = z; out[k++] = Math.atan2(hx, hz); out[k++] = Math.min(1, (r.rec + r.res) / P.truckCapacityKg);
    }
    return k === out.length ? out : out.slice(0, k);
  }

  /** Remplissage des bacs par bâtiment (calque) : [x, z, taux 0..1+] pour les bâtiments producteurs. */
  binLayer(ctx: PluginContext): Float32Array {
    const st = ctx.buildings.store;
    const out = new Float32Array(this.bins.size * 3);
    let k = 0;
    for (const [id, b] of this.bins) {
      const i = ctx.buildings.indexOf(id);
      if (i < 0 || b.cap <= 0) continue;
      out[k++] = st.x[i]!; out[k++] = st.z[i]!; out[k++] = (b.rec + b.res) / b.cap;
    }
    return k === out.length ? out : out.slice(0, k);
  }

  /** Libellé français d'une installation (panneau). */
  static facilityName(kind: WasteFacilityKind): string { return WASTE_FACILITY_FR[kind]; }
}

/** Ajoute une polyligne de trajet (temps répartis au prorata des distances). */
function appendLeg(run: TruckRun, pts: number[], t0: number, dt: number): void {
  if (pts.length < 2) return;
  let total = 0;
  for (let i = 2; i < pts.length; i += 2) total += Math.hypot(pts[i]! - pts[i - 2]!, pts[i + 1]! - pts[i - 1]!);
  let acc = 0;
  for (let i = 0; i < pts.length; i += 2) {
    if (i > 0) acc += Math.hypot(pts[i]! - pts[i - 2]!, pts[i + 1]! - pts[i - 1]!);
    run.pts.push(pts[i]!, pts[i + 1]!);
    run.times.push(t0 + (total > 0 ? (dt * acc) / total : (dt * i) / Math.max(1, pts.length - 2)));
  }
}

/** Immobilise le camion jusqu'au temps `t` (arrêt de service / vidage). */
function hold(run: TruckRun, t: number): void {
  const n = run.pts.length;
  if (n < 2) return;
  run.pts.push(run.pts[n - 2]!, run.pts[n - 1]!);
  run.times.push(t);
}
