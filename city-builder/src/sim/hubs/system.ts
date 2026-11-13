/**
 * Système des pôles de transport (port, aéroport) dans le worker de simulation.
 *
 *  - Pose validée par la simulation (./validate.ts), retrait, servitudes aéronautiques.
 *  - Activité économique : capacité mensuelle d'export / import et de passagers, réservations par l'API
 *    `provide('port' | 'aeroport')`, camions par jour, recettes et entretien (lignes du budget municipal),
 *    emplois directs.
 *  - Mouvements visibles (navires qui arrivent / accostent / repartent, avions qui atterrissent / roulent /
 *    décollent) : échantillon représentatif horodaté en temps physique (0,1 s par minute de jeu, comme le
 *    trafic routier), trajectoires pures de src/shared/hubs/paths.ts.
 *  - Nuisances sur les grilles du contrat municipal : bruit (plancher horaire après propagation), pollution de
 *    l'air et de l'eau (émissions horaires), satisfaction et valeur foncière (contribution réversible, appliquée
 *    par différence), attractivité des bureaux (indicateur propre `hubs:attractivite_bureaux`).
 *
 * Déterministe : PRNG propre au module (ctx.rng), aucune horloge murale. TypeScript pur : AUCUN import de three ni du DOM.
 */
import { decodeFloat32, encodeFloat32 } from '../municipal/codec';
import { geometryFor } from '../municipal/grid';
import { BUILTIN_TASK_ORDER, DEFAULT_CELL_SIZE, Municipal, MUNICIPAL_SERVICE } from '../municipal/municipal';
import type { IndicatorGrid } from '../municipal/grid';
import type { PluginContext } from '../plugins/types';
import { obbToWorld } from '../../shared/footprint';
import { BERTH_OFFSET, hubLayout, hubNoise, hubObb } from '../../shared/hubs/layout';
import { movementActive, movementDuration, movementPose, runwayWindows } from '../../shared/hubs/paths';
import {
  HUB_SPECS, emptyActivity, hubTypeOfAsset,
  type HubActivity, type HubEasementApi, type HubFreightApi, type HubKind, type HubMovement, type HubNuisance, type HubRecord, type HubSummary, type HubType,
} from '../../shared/hubs/types';
import type { HubsDelta, HubsSnapshot } from '../../shared/protocol-ext/hubs';
import { assetHeight, checkBuildingEasement, checkHubPlacement, easementViolations, type PlaceCheck } from './validate';
import { easementLimit } from '../../shared/hubs/layout';

/** Temps physique par minute de jeu (s) : identique au trafic routier (world.ts : traffic.step(0.1)). */
export const PHYS_PER_MINUTE = 0.1;
/** Indicateur propre : attractivité des bureaux apportée par l'aéroport (0..100). */
export const OFFICE_INDICATOR = 'hubs:attractivite_bureaux' as const;
/** Seuil de contribution sonore à partir duquel une cellule est « exposée ». */
export const NOISE_EXPOSED = 20;
/** Effets réversibles du bruit des pôles : satisfaction (indice) et valeur foncière (¢/m²) par point au-dessus de 10. */
export const SAT_PER_NOISE = 0.45;
export const LAND_PER_NOISE = 0.6;
const NOISE_FREE = 10;
/** Ordre des tâches horaires/journalières : après la propagation intégrée du contrat municipal. */
const AFTER_PROPAGATION = BUILTIN_TASK_ORDER + 5;

/** Paramètres de demande (par habitant et par mois) — documentés dans docs/HUBS.md. */
export const DEMAND = {
  importTPerHab: 0.12,
  exportTPerIndustrialJob: 1.5,
  ferryPaxPerHab: 0.02, ferryTourists: 3000,
  airPaxPerHab: 0.05, airTourists: 6000,
  airFreightTPerHab: 0.004,
  truckT: 18,
  portFeePerT: 4, ferryFeePerPax: 6, airFeePerPax: 9, airFreightFeePerT: 120,
};

interface HubRuntime {
  rec: HubRecord;
  month: HubActivity;
  lastMonth: HubActivity | null;
  /** Prochaine apparition visible par poste (temps physique). */
  nextAt: number[];
  nuisance: HubNuisance;
  cause: number;
}

/** Contribution appliquée à une grille sans propagation (satisfaction, valeur foncière) : suivie cellule par cellule. */
interface Applied { id: string; geomKey: string; values: Float32Array }

export interface HubsSaveData {
  hubs: HubRecord[];
  nextId: number;
  movements: HubMovement[];
  nextMovementId: number;
  phys: number;
  runtime: { id: number; month: HubActivity; lastMonth: HubActivity | null; nextAt: number[]; cause: number }[];
  used: Record<HubKind, { exportT: number; importT: number }>;
  applied: { id: string; geomKey: string; values: string; n: number }[];
}

const geomKeyOf = (g: IndicatorGrid): string => `${g.originX},${g.originZ},${g.cellSize},${g.cols},${g.rows}`;

export class HubsSystem {
  private own: Municipal | null = null;
  private shared: Municipal | null = null;
  hubs: HubRuntime[] = [];
  movements: HubMovement[] = [];
  phys = 0;
  private nextId = 1;
  private nextMovementId = 1;
  used: Record<HubKind, { exportT: number; importT: number }> = { port: { exportT: 0, importT: 0 }, aeroport: { exportT: 0, importT: 0 } };
  private applied = new Map<string, Applied>();
  /** Versions : structure (pôles, mouvements) envoyée au rendu ; dernière version envoyée. */
  version = 1;
  private sentVersion = -1;
  private sentPhys = -1;
  private sentSpeed = -1;
  private sentNonEmpty = false;
  private fieldCache = new Map<string, Float32Array>();
  private ctx: PluginContext | null = null;

  /* ------------------------------------------------------------ cycle de vie */

  get muni(): Municipal { return (this.shared ?? this.own)!; }
  get usesSharedMunicipal(): boolean { return this.shared !== null; }

  init(ctx: PluginContext): void {
    this.ctx = ctx;
    this.shared = ctx.use<Municipal>(MUNICIPAL_SERVICE) ?? null;
    this.own = this.shared ? null : new Municipal();
    const s = this.muni.scheduler;
    s.add({ id: 'hubs:nuisances', every: 'hour', order: AFTER_PROPAGATION, run: (info) => this.hourly(info.minutes) });
    s.add({ id: 'hubs:activite', every: 'day', order: AFTER_PROPAGATION, run: () => this.daily() });
    s.add({ id: 'hubs:bilan', every: 'month', order: 0, run: (info) => this.monthly(info.totalMinutes) });
    ctx.provide<HubFreightApi>('port', this.freightApi('port'));
    ctx.provide<HubFreightApi>('aeroport', this.freightApi('aeroport'));
    ctx.provide<HubEasementApi>('servitudes', {
      limitAt: (x, z) => this.hubs.reduce((m, h) => Math.min(m, easementLimit(h.rec, x, z)), Infinity),
      checkBuilding: (assetId, x, z, rot, heightM) => (this.ctx ? checkBuildingEasement(this.ctx, this.records(), assetId, x, z, rot, heightM) : null),
    });
  }

  newGame(ctx: PluginContext): void {
    this.ctx = ctx;
    this.hubs = [];
    this.movements = [];
    this.phys = 0;
    this.nextId = 1;
    this.nextMovementId = 1;
    this.used = { port: { exportT: 0, importT: 0 }, aeroport: { exportT: 0, importT: 0 } };
    this.applied.clear();
    this.fieldCache.clear();
    this.version++;
    this.sentVersion = -1;
    this.sentNonEmpty = false;
    if (this.own) {
      const b = ctx.terrain.bounds() ?? { minX: 0, minZ: 0, maxX: DEFAULT_CELL_SIZE, maxZ: DEFAULT_CELL_SIZE };
      this.own.reset(geometryFor(b, DEFAULT_CELL_SIZE));
    }
  }

  /** Crochets de l'ordonnanceur municipal quand le contrat n'est pas enregistré (repli : instance propre). */
  driveOwnScheduler(event: 'tick' | 'day' | 'month', ctx: PluginContext, minutes = 0): void {
    if (!this.own) return;
    if (event === 'tick') this.own.scheduler.advance(ctx.clock.totalMinutes, minutes);
    else if (event === 'day') this.own.scheduler.day(ctx.clock.dayIndex, ctx.clock.totalMinutes);
    else this.own.scheduler.month(ctx.clock.monthIndex, ctx.clock.totalMinutes);
  }

  records(): HubRecord[] { return this.hubs.map((h) => h.rec); }

  /* ------------------------------------------------------------------ pose */

  check(ctx: PluginContext, type: HubType, x: number, z: number, rot: number): PlaceCheck {
    return checkHubPlacement(ctx, this.records(), type, x, z, rot);
  }

  place(ctx: PluginContext, assetOrType: string, x: number, z: number, rot: number, dryRun: boolean):
    { ok: true; id: number; cost: number; y: number; type: HubType } | { ok: false; code: string; message: string } {
    const type = (assetOrType in HUB_SPECS ? assetOrType : hubTypeOfAsset(assetOrType)) as HubType | undefined;
    if (!type) return { ok: false, code: 'UNKNOWN_ASSET', message: `Pôle de transport inconnu : ${assetOrType}` };
    const rx = Math.round(x * 100) / 100, rz = Math.round(z * 100) / 100;
    const r = this.check(ctx, type, rx, rz, rot);
    if (!r.ok) return r;
    const spec = HUB_SPECS[type];
    if (dryRun) return { ok: true, id: 0, cost: spec.cost, y: r.y, type };
    const rec: HubRecord = { id: this.nextId++, type, x: rx, z: rz, rot, y: r.y, waterY: r.waterY, builtAt: ctx.clock.totalMinutes };
    const m = this.muni;
    const cause = m.effects.cause({ kind: `construction_${spec.kind}`, label: `Construction : ${spec.nameFr}`, source: 'joueur', at: ctx.clock.totalMinutes, x: rx, z: rz, ref: rec.id });
    const l = hubLayout(type);
    const slots = type === 'aeroport' ? l.stands.length : l.berths.length;
    this.hubs.push({ rec, month: emptyActivity(), lastMonth: null, nextAt: Array.from({ length: slots }, (_, i) => this.phys + 4 + 45 * i), nuisance: emptyNuisance(), cause });
    // Coût de construction : ligne du budget municipal (appliquée à la trésorerie par le cœur, docs/requests/hubs.md).
    m.budget.post('expense', `construction:${spec.kind}`, spec.cost, 'transports');
    this.afterChange(ctx, cause);
    ctx.notify('info', `${spec.nameFr} mis en service`);
    return { ok: true, id: rec.id, cost: spec.cost, y: r.y, type };
  }

  remove(ctx: PluginContext, id: number): { ok: true; refund: number } | { ok: false; code: string; message: string } {
    const i = this.hubs.findIndex((h) => h.rec.id === id);
    if (i < 0) return { ok: false, code: 'NOT_FOUND', message: 'Pôle introuvable' };
    const h = this.hubs[i]!;
    this.hubs.splice(i, 1);
    this.movements = this.movements.filter((m) => m.hub !== id);
    const spec = HUB_SPECS[h.rec.type];
    const refund = Math.round(spec.cost * 0.25);
    this.muni.budget.post('income', `demolition:${spec.kind}`, refund, 'transports');
    const cause = this.muni.effects.cause({ kind: `demolition_${spec.kind}`, label: `Démolition : ${spec.nameFr}`, source: 'joueur', at: ctx.clock.totalMinutes, x: h.rec.x, z: h.rec.z, ref: id });
    this.afterChange(ctx, cause);
    return { ok: true, refund };
  }

  /** Après une pose / un retrait : champs recalculés, contributions réversibles appliquées tout de suite. */
  private afterChange(ctx: PluginContext, cause: number): void {
    this.fieldCache.clear();
    this.version++;
    const sat = this.muni.grids.ensure('satisfaction');
    const before = sat.copyValues();
    this.applyReversible();
    this.applyNoiseFloor(ctx.clock.hourOfDay);
    this.muni.effects.measureGrid(cause, sat, before, ctx.clock.totalMinutes, 'bruit des pôles de transport');
    this.measureNuisances(ctx);
  }

  /* ------------------------------------------------------------ nuisances */

  /** Contribution sonore maximale des pôles au centre de chaque cellule d'une grille (mise en cache). */
  private noiseField(g: IndicatorGrid): Float32Array {
    const key = geomKeyOf(g);
    let f = this.fieldCache.get(key);
    if (f) return f;
    f = new Float32Array(g.cols * g.rows);
    for (const h of this.hubs) {
      // Boîte englobante de la zone de bruit (piste + 3,5 km d'axe pour l'aéroport, 900 m pour un port).
      const reach = h.rec.type === 'aeroport' ? 4000 : 900;
      const i0 = Math.max(0, g.colOf(h.rec.x - reach)), i1 = Math.min(g.cols - 1, g.colOf(h.rec.x + reach));
      const j0 = Math.max(0, g.rowOf(h.rec.z - reach)), j1 = Math.min(g.rows - 1, g.rowOf(h.rec.z + reach));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const v = hubNoise(h.rec, g.centerX(i), g.centerZ(j));
          const k = j * g.cols + i;
          if (v > f[k]!) f[k] = v;
        }
      }
    }
    this.fieldCache.set(key, f);
    return f;
  }

  /** Contribution sonore des pôles en un point (indice 0..100). */
  noiseAt(x: number, z: number): number {
    let v = 0;
    for (const h of this.hubs) v = Math.max(v, hubNoise(h.rec, x, z));
    return v;
  }

  /** Satisfaction, valeur foncière, attractivité des bureaux : contribution cible − contribution déjà appliquée. */
  private applyReversible(): void {
    const g = this.muni.grids;
    const targets: [string, (noise: number, x: number, z: number) => number][] = [
      ['satisfaction', (n) => -SAT_PER_NOISE * Math.max(0, n - NOISE_FREE)],
      ['valeur_fonciere', (n) => -LAND_PER_NOISE * Math.max(0, n - NOISE_FREE)],
      [OFFICE_INDICATOR, (_n, x, z) => this.officeBonus(x, z)],
    ];
    for (const [id, fn] of targets) {
      const grid = id === OFFICE_INDICATOR
        ? g.ensure(OFFICE_INDICATOR, { nameFr: 'Attractivité des bureaux (aéroport)', unit: 'indice', base: 0, min: 0, max: 100 })
        : g.ensure(id as 'satisfaction');
      const key = geomKeyOf(grid);
      let ap = this.applied.get(id);
      if (!ap || ap.geomKey !== key || ap.values.length !== grid.size) { ap = { id, geomKey: key, values: new Float32Array(grid.size) }; this.applied.set(id, ap); }
      const field = this.noiseField(grid);
      for (let j = 0; j < grid.rows; j++) {
        for (let i = 0; i < grid.cols; i++) {
          const k = j * grid.cols + i;
          const target = fn(field[k]!, grid.centerX(i), grid.centerZ(j));
          const diff = target - ap.values[k]!;
          if (Math.abs(diff) < 1e-6) continue;
          ap.values[k] = ap.values[k]! + grid.add(i, j, diff);
        }
      }
    }
  }

  /** Attractivité des bureaux : +40 près de l'aérogare, décroissance exponentielle sur 2,5 km. */
  private officeBonus(x: number, z: number): number {
    let v = 0;
    for (const h of this.hubs) {
      if (h.rec.type !== 'aeroport') continue;
      const [tx, tz] = obbToWorld(hubObb(h.rec.type, h.rec.x, h.rec.z, h.rec.rot), 0, 100);
      v = Math.max(v, 40 * Math.exp(-Math.hypot(x - tx, z - tz) / 2500));
    }
    return v;
  }

  /** Bruit : plancher horaire (après la propagation intégrée), modulé par l'heure (nuit plus calme). */
  private applyNoiseFloor(hour: number): void {
    if (!this.hubs.length) return;
    const g = this.muni.grids.ensure('bruit');
    const f = this.noiseField(g);
    const night = hour < 6 || hour >= 23;
    const factor = night ? 0.7 : 1;
    for (let k = 0; k < f.length; k++) {
      const v = f[k]! * factor;
      if (v > g.data[k]!) g.set(k % g.cols, Math.floor(k / g.cols), v);
    }
  }

  private hourly(_minutes: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.hubs.length) return;
    this.applyNoiseFloor(ctx.clock.hourOfDay);
    const air = this.muni.grids.ensure('pollution_air');
    const water = this.muni.grids.ensure('pollution_eau');
    for (const h of this.hubs) {
      const spec = HUB_SPECS[h.rec.type];
      const util = this.utilization(h);
      const o = hubObb(h.rec.type, h.rec.x, h.rec.z, h.rec.rot);
      if (spec.kind === 'port') {
        // Air : moteurs des navires à quai, engins de manutention et camions ; eau : rejets du bassin.
        air.stamp(h.rec.x, h.rec.z, 180, 0.6 + 1.6 * util, 'linear');
        const [bx, bz] = obbToWorld(o, 0, hubLayout(h.rec.type).hz + BERTH_OFFSET + 10);
        water.stamp(bx, bz, 160, 0.5 + 1.5 * util, 'linear');
      } else {
        air.stamp(h.rec.x, h.rec.z, 400, 0.4 + 1.2 * util, 'linear');
      }
    }
    this.measureNuisances(ctx);
  }

  /** Relevé des nuisances par pôle (panneau Transports, deltas). */
  private measureNuisances(ctx: PluginContext): void {
    const g = this.muni.grids;
    const bruit = g.ensure('bruit');
    const field = this.noiseField(bruit);
    const sat = this.applied.get('satisfaction');
    const land = this.applied.get('valeur_fonciere');
    for (const h of this.hubs) {
      const n: HubNuisance = emptyNuisance();
      let sumN = 0, sumSat = 0, sumLand = 0;
      const reach = h.rec.type === 'aeroport' ? 4000 : 900;
      bruit.forEachIn(h.rec.x, h.rec.z, reach, (k) => {
        const own = hubNoise(h.rec, bruit.centerX(k % bruit.cols), bruit.centerZ(Math.floor(k / bruit.cols)));
        if (own < NOISE_EXPOSED || field[k]! < NOISE_EXPOSED) return;
        n.noisyCells++;
        sumN += bruit.data[k]!;
        if (sat && sat.values.length === bruit.size) sumSat += sat.values[k]!;
        if (land && land.values.length === bruit.size) sumLand += land.values[k]!;
      });
      if (n.noisyCells) { n.noiseMean = sumN / n.noisyCells; n.satisfactionDelta = sumSat / n.noisyCells; n.landValueDelta = sumLand / n.noisyCells; }
      const s = ctx.buildings.store;
      for (let i = 0; i < ctx.buildings.count; i++) {
        if (!s.residents[i]) continue;
        if (hubNoise(h.rec, s.x[i]!, s.z[i]!) >= NOISE_EXPOSED) n.exposedResidents += s.residents[i]!;
      }
      const o = hubObb(h.rec.type, h.rec.x, h.rec.z, h.rec.rot);
      if (HUB_SPECS[h.rec.type].kind === 'port') {
        const [bx, bz] = obbToWorld(o, 0, hubLayout(h.rec.type).hz + BERTH_OFFSET + 10);
        n.waterPollution = g.read('pollution_eau', bx, bz);
      }
      n.airPollution = g.read('pollution_air', h.rec.x, h.rec.z);
      h.nuisance = n;
    }
  }

  /* --------------------------------------------------------------- activité */

  private utilization(h: HubRuntime): number {
    const spec = HUB_SPECS[h.rec.type];
    const day = this.ctx ? (this.ctx.clock.dayIndex % 30) + 1 : 30;
    const capT = (spec.exportT + spec.importT) * (day / 30);
    const capP = spec.paxPerMonth * (day / 30);
    const ut = capT > 0 ? (h.month.exportT + h.month.importT) / capT : 0;
    const up = capP > 0 ? h.month.pax / capP : 0;
    return Math.max(0, Math.min(1, Math.max(ut, up)));
  }

  /** Emplois de l'industrie (base des exportations hors contrats) et population. */
  private cityDemand(ctx: PluginContext): { pop: number; industrialJobs: number } {
    let industrialJobs = 0;
    const s = ctx.buildings.store;
    for (let i = 0; i < ctx.buildings.count; i++) {
      if (!s.workers[i]) continue;
      if (ctx.buildings.assetOf(s.id[i]!)?.category === 'industrial') industrialJobs += s.workers[i]!;
    }
    return { pop: ctx.demography?.population ?? 0, industrialJobs };
  }

  private daily(): void {
    const ctx = this.ctx;
    if (!ctx || !this.hubs.length) return;
    const { pop, industrialJobs } = this.cityDemand(ctx);
    const ports = this.hubs.filter((h) => HUB_SPECS[h.rec.type].kind === 'port');
    const airports = this.hubs.filter((h) => h.rec.type === 'aeroport');
    const D = DEMAND;
    for (const h of this.hubs) {
      const spec = HUB_SPECS[h.rec.type];
      const share = 1 / (spec.kind === 'port' ? ports.length : airports.length);
      const m = h.month;
      const roomExp = Math.max(0, spec.exportT - m.exportT) , roomImp = Math.max(0, spec.importT - m.importT);
      let impT: number, expT: number, pax = 0, rev: number;
      if (spec.kind === 'port') {
        impT = Math.min(roomImp, ((pop * D.importTPerHab) / 30) * share);
        expT = Math.min(roomExp, ((industrialJobs * D.exportTPerIndustrialJob) / 30) * share);
        if (spec.paxPerMonth > 0) pax = Math.min(Math.max(0, spec.paxPerMonth - m.pax), ((pop * D.ferryPaxPerHab + D.ferryTourists) / 30) * share);
        rev = (impT + expT) * D.portFeePerT + pax * D.ferryFeePerPax;
      } else {
        const fr = ((pop * D.airFreightTPerHab) / 30) * share;
        impT = Math.min(roomImp, fr);
        expT = Math.min(roomExp, fr * 0.6);
        pax = Math.min(Math.max(0, spec.paxPerMonth - m.pax), ((pop * D.airPaxPerHab + D.airTourists) / 30) * share);
        rev = pax * D.airFeePerPax + (impT + expT) * D.airFreightFeePerT;
      }
      m.importT += impT; m.exportT += expT; m.pax += pax; m.revenue += rev;
      this.used[spec.kind].importT += impT;
      this.used[spec.kind].exportT += expT;
      const day = (ctx.clock.dayIndex % 30) + 1;
      m.trucksPerDay = (m.exportT + m.importT) / D.truckT / Math.max(1, day);
      m.jobs = Math.round(spec.jobs * Math.min(1, 0.35 + 0.65 * this.utilization(h)) * Math.min(1, pop / 3000 + 0.2));
    }
    this.applyReversible();
  }

  private monthly(at: number): void {
    const m = this.muni;
    for (const h of this.hubs) {
      const spec = HUB_SPECS[h.rec.type];
      h.month.upkeep = spec.upkeepPerMonth;
      if (h.month.revenue > 0) m.budget.post('income', `droits:${spec.kind}`, Math.round(h.month.revenue), 'transports');
      m.budget.post('expense', `entretien:${spec.kind}`, spec.upkeepPerMonth, 'transports');
      h.lastMonth = h.month;
      h.month = emptyActivity();
    }
    this.used = { port: { exportT: 0, importT: 0 }, aeroport: { exportT: 0, importT: 0 } };
    void at;
  }

  /* -------------------------------------------------------- API d'export */

  private capacityOf(kind: HubKind): { exportT: number; importT: number; paxPerMonth: number; costPerT: number; delayDays: number } {
    const hs = this.hubs.filter((h) => HUB_SPECS[h.rec.type].kind === kind);
    const c = { exportT: 0, importT: 0, paxPerMonth: 0, costPerT: 0, delayDays: 0 };
    for (const h of hs) { const s = HUB_SPECS[h.rec.type]; c.exportT += s.exportT; c.importT += s.importT; c.paxPerMonth += s.paxPerMonth; c.costPerT = s.costPerT; c.delayDays = s.delayDays; }
    return c;
  }

  freightApi(kind: HubKind): HubFreightApi {
    const room = (dir: 'export' | 'import'): number => {
      const c = this.capacityOf(kind);
      return Math.max(0, dir === 'export' ? c.exportT - this.used[kind].exportT : c.importT - this.used[kind].importT);
    };
    return {
      kind,
      available: () => this.hubs.some((h) => HUB_SPECS[h.rec.type].kind === kind),
      capacity: () => {
        const c = this.capacityOf(kind);
        return { exportT: c.exportT, importT: c.importT, usedExportT: this.used[kind].exportT, usedImportT: this.used[kind].importT, costPerT: c.costPerT, delayDays: c.delayDays, paxPerMonth: c.paxPerMonth };
      },
      quote: (volumeT, dir) => {
        const c = this.capacityOf(kind);
        const accepted = Math.max(0, Math.min(volumeT, room(dir)));
        return { accepted, costPerT: c.costPerT, total: Math.round(accepted * c.costPerT), delayDays: c.delayDays };
      },
      book: (volumeT, dir, ref) => {
        const c = this.capacityOf(kind);
        const now = this.ctx?.clock.totalMinutes ?? 0;
        if (!(volumeT > 0)) return { ok: false, accepted: 0, total: 0, delayDays: c.delayDays, arrivalMinutes: now, message: 'Volume invalide' };
        const accepted = Math.min(volumeT, room(dir));
        if (accepted <= 0) return { ok: false, accepted: 0, total: 0, delayDays: c.delayDays, arrivalMinutes: now, message: c.exportT > 0 ? 'Capacité du mois épuisée' : `Aucun ${kind === 'port' ? 'port' : 'aéroport'} en service` };
        this.used[kind][dir === 'export' ? 'exportT' : 'importT'] += accepted;
        // Répartition sur les pôles du type au prorata de leur capacité restante.
        const hs = this.hubs.filter((h) => HUB_SPECS[h.rec.type].kind === kind);
        for (const h of hs) {
          const part = accepted / hs.length;
          if (dir === 'export') { h.month.exportT += part; h.month.bookedExportT += part; } else h.month.importT += part;
          h.month.revenue += part * (kind === 'port' ? DEMAND.portFeePerT : DEMAND.airFreightFeePerT);
        }
        void ref;
        return { ok: true, accepted, total: Math.round(accepted * c.costPerT), delayDays: c.delayDays, arrivalMinutes: now + c.delayDays * 1440 };
      },
    };
  }

  /* -------------------------------------------------- mouvements visibles */

  tick(ctx: PluginContext, minutes: number): void {
    this.ctx = ctx;
    if (!this.hubs.length) return;
    this.phys += minutes * PHYS_PER_MINUTE;
    const before = this.movements.length;
    this.movements = this.movements.filter((mv) => {
      const h = this.hubs.find((x) => x.rec.id === mv.hub);
      if (!h) return false;
      if (movementActive(h.rec.type, mv, this.phys)) return true;
      // Poste libéré : prochaine apparition après un délai aléatoire (PRNG du module).
      const pause = h.rec.type === 'aeroport' ? 30 + ctx.rng.next() * 120 : 60 + ctx.rng.next() * 180;
      h.nextAt[mv.slot] = this.phys + pause;
      return false;
    });
    let changed = this.movements.length !== before;
    for (const h of this.hubs) {
      for (let slot = 0; slot < h.nextAt.length; slot++) {
        if (this.phys < h.nextAt[slot]!) continue;
        if (this.movements.some((m) => m.hub === h.rec.id && m.slot === slot)) { h.nextAt[slot] = Infinity; continue; }
        const mv = this.spawn(ctx, h, slot);
        if (mv) { this.movements.push(mv); h.month.movements++; changed = true; h.nextAt[slot] = Infinity; }
      }
    }
    if (changed) this.version++;
  }

  private spawn(ctx: PluginContext, h: HubRuntime, slot: number): HubMovement | null {
    const l = hubLayout(h.rec.type);
    let asset: string, role: HubMovement['role'];
    if (h.rec.type === 'aeroport') {
      const st = l.stands[slot]!;
      if (st.role === 'fret') { asset = 'aero_avion_cargo'; role = 'fret'; } else { asset = ctx.rng.next() < 0.7 ? 'aero_avion_moyen_courrier' : 'aero_avion_gros_porteur'; role = 'passagers'; }
      const mv: HubMovement = { id: 0, hub: h.rec.id, asset, role, slot, t0: this.phys };
      // Piste libre : pas de chevauchement de l'atterrissage avec un autre atterrissage ou décollage.
      const w = runwayWindows(mv).arrival;
      for (const o of this.movements) {
        if (o.hub !== h.rec.id) continue;
        const ow = runwayWindows(o);
        for (const [a, b] of [ow.arrival, ow.departure]) {
          if (w[0] < b + 5 && a < w[1] + 5) { h.nextAt[slot] = b + 10; return null; }
        }
      }
      mv.id = this.nextMovementId++;
      return mv;
    }
    const b = l.berths[slot]!;
    if (b.role === 'ferry') { asset = 'port_ferry'; role = 'ferry'; } else if (ctx.rng.next() < 0.65) { asset = 'port_porte_conteneurs'; role = 'cargo'; } else { asset = 'port_vraquier'; role = 'vraquier'; }
    return { id: this.nextMovementId++, hub: h.rec.id, asset, role, slot, t0: this.phys };
  }

  /* -------------------------------------------------------- protocole */

  summaries(): HubSummary[] {
    return this.hubs.map((h) => {
      const s = HUB_SPECS[h.rec.type];
      return {
        hub: { ...h.rec }, nameFr: s.nameFr, month: { ...h.month }, lastMonth: h.lastMonth ? { ...h.lastMonth } : null, nuisance: { ...h.nuisance },
        capacity: { exportT: s.exportT, importT: s.importT, paxPerMonth: s.paxPerMonth, costPerT: s.costPerT, delayDays: s.delayDays },
      };
    });
  }

  takeDelta(speed: number): HubsDelta | undefined {
    // Rien à dire au rendu tant qu'aucun pôle n'a jamais été envoyé (module inutilisé : aucun `ext`).
    if (!this.hubs.length && !this.sentNonEmpty) { this.sentVersion = this.version; return undefined; }
    const d: HubsDelta = {};
    let any = false;
    if (this.sentVersion !== this.version) {
      this.sentNonEmpty = this.hubs.length > 0;
      d.hubs = this.records().map((r) => ({ ...r }));
      d.movements = this.movements.map((m) => ({ ...m }));
      this.sentVersion = this.version;
      any = true;
    }
    if (this.hubs.length && (this.phys !== this.sentPhys || speed !== this.sentSpeed)) {
      d.phys = this.phys; d.speed = speed;
      this.sentPhys = this.phys; this.sentSpeed = speed;
      any = true;
    }
    return any ? d : undefined;
  }

  snapshot(speed: number): HubsSnapshot | undefined {
    this.sentVersion = this.version;
    this.sentNonEmpty = this.hubs.length > 0;
    this.sentPhys = this.phys; this.sentSpeed = speed;
    if (!this.hubs.length) return undefined;
    return { hubs: this.records().map((r) => ({ ...r })), movements: this.movements.map((m) => ({ ...m })), phys: this.phys, speed };
  }

  /* ------------------------------------------------------------- sauvegarde */

  save(): HubsSaveData | undefined {
    if (!this.hubs.length && this.nextId === 1) return undefined;
    return {
      hubs: this.records().map((r) => ({ ...r, waterY: Number.isFinite(r.waterY) ? r.waterY : -9999 })),
      nextId: this.nextId,
      movements: this.movements.map((m) => ({ ...m })),
      nextMovementId: this.nextMovementId,
      phys: this.phys,
      runtime: this.hubs.map((h) => ({ id: h.rec.id, month: { ...h.month }, lastMonth: h.lastMonth ? { ...h.lastMonth } : null, nextAt: h.nextAt.map((t) => (Number.isFinite(t) ? t : -1)), cause: h.cause })),
      used: { port: { ...this.used.port }, aeroport: { ...this.used.aeroport } },
      applied: [...this.applied.values()].map((a) => ({ id: a.id, geomKey: a.geomKey, values: encodeFloat32(a.values), n: a.values.length })),
    };
  }

  load(ctx: PluginContext, d: HubsSaveData): void {
    this.ctx = ctx;
    this.hubs = d.hubs.map((rec) => {
      const r = d.runtime.find((x) => x.id === rec.id);
      const l = hubLayout(rec.type);
      const slots = rec.type === 'aeroport' ? l.stands.length : l.berths.length;
      const nextAt = (r?.nextAt ?? []).map((t) => (t < 0 ? Infinity : t));
      while (nextAt.length < slots) nextAt.push(d.phys + 5);
      return {
        rec: { ...rec, waterY: rec.waterY <= -9000 ? NaN : rec.waterY },
        month: r?.month ?? emptyActivity(), lastMonth: r?.lastMonth ?? null, nextAt, nuisance: emptyNuisance(), cause: r?.cause ?? 0,
      };
    });
    this.nextId = d.nextId;
    this.movements = d.movements.map((m) => ({ ...m }));
    this.nextMovementId = d.nextMovementId;
    this.phys = d.phys;
    this.used = { port: { ...d.used.port }, aeroport: { ...d.used.aeroport } };
    this.applied.clear();
    // Contributions déjà présentes dans les grilles du contrat partagé (sauvegardées par lui) ; avec l'instance
    // de repli, les grilles repartent à neuf : on réapplique tout.
    if (this.shared) for (const a of d.applied) this.applied.set(a.id, { id: a.id, geomKey: a.geomKey, values: decodeFloat32(a.values, a.n) });
    this.fieldCache.clear();
    this.version++;
    this.sentVersion = -1;
    this.applyReversible();
    this.measureNuisances(ctx);
  }

  /** Bâtiments existants en infraction avec les servitudes (panneau). */
  violations(ctx: PluginContext): ReturnType<typeof easementViolations> { return easementViolations(ctx, this.records(), -2); }

  /** Contrôle d'un bâtiment ordinaire (commande `checkBuilding`). */
  checkBuilding(ctx: PluginContext, assetId: string, x: number, z: number, rot: number, variant = -1): string | null {
    return checkBuildingEasement(ctx, this.records(), assetId, x, z, rot, assetHeight(ctx, assetId, variant));
  }

  /** Phases courantes des mouvements visibles (diagnostic, captures). */
  movementStates(): { id: number; hub: number; asset: string; role: string; phase: string; u: number; alt: number; x: number; z: number }[] {
    const out: ReturnType<HubsSystem['movementStates']> = [];
    for (const mv of this.movements) {
      const h = this.hubs.find((x) => x.rec.id === mv.hub);
      if (!h) continue;
      const p = movementPose(h.rec.type, mv, this.phys);
      if (!p) continue;
      const [x, z] = obbToWorld(hubObb(h.rec.type, h.rec.x, h.rec.z, h.rec.rot), p.x, p.z);
      out.push({ id: mv.id, hub: mv.hub, asset: mv.asset, role: mv.role, phase: p.phase, u: p.u, alt: p.alt, x, z });
    }
    return out;
  }

  /** Durée d'une rotation visible (diagnostic). */
  movementDuration(mv: HubMovement): number {
    const h = this.hubs.find((x) => x.rec.id === mv.hub);
    return h ? movementDuration(h.rec.type, mv) : 0;
  }
}

function emptyNuisance(): HubNuisance {
  return { noiseMean: 0, noisyCells: 0, exposedResidents: 0, satisfactionDelta: 0, landValueDelta: 0, waterPollution: 0, airPollution: 0 };
}
