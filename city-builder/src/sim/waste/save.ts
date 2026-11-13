/**
 * Format de sauvegarde versionné du module `dechets` (section `save.plugins.dechets`).
 * Placé ici (et non dans src/sim/save-sections) car le garde-fou d'architecture interdit les imports `../save*`
 * depuis src/sim/plugins ; src/sim/save-sections/dechets.ts le déclare comme section.
 * Évolution : incrémenter DECHETS_SAVE_VERSION, ajouter STEPS[v] (v -> v+1) et un test dans tests/dechets/.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { DEFAULT_WASTE_SETTINGS, WASTE_FACILITY_KINDS, clampSetting, type WasteDayStats, type WasteFacilityKind, type WasteSettings, type WasteTotals } from '../../shared/waste/types';
import { decodeFloat32, encodeFloat32 } from '../municipal/codec';
import type { Facility, TruckRun, WasteSystem } from './system';

export const DECHETS_SAVE_VERSION = 1;

export interface DechetsSaveV1 {
  settings: WasteSettings;
  /** Bacs : [id, rec, res, cap, débordement du jour] (kg). */
  bins: [number, number, number, number, number][];
  facilities: { id: number; kind: WasteFacilityKind; x: number; z: number; rot: number; capacity: number; stock: number; inToday: number; processed: number; overToday: number; connected: boolean }[];
  runs: TruckRun[];
  today: WasteDayStats | null;
  lastDay: WasteDayStats | null;
  totals: WasteTotals | null;
  month: { recycling: number; energy: number };
  /** Décalages appliqués aux grilles (Float32 en base64, exact) ; null si aucun. */
  appliedSat: { n: number; data: string } | null;
  appliedLand: { n: number; data: string } | null;
  causes: { settings: number; uncollected: number; landfillFull: number };
  blocked: string | null;
}
export type DechetsSave = DechetsSaveV1;

export function emptyDechetsSave(): DechetsSave {
  return {
    settings: { ...DEFAULT_WASTE_SETTINGS }, bins: [], facilities: [], runs: [], today: null, lastDay: null, totals: null,
    month: { recycling: 0, energy: 0 }, appliedSat: null, appliedLand: null, causes: { settings: -1, uncollected: -1, landfillFull: -1 }, blocked: null,
  };
}

const STEPS: Record<number, (d: Record<string, unknown>) => Record<string, unknown>> = {};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Même contrat que `runMigrations` (src/sim/save-sections/types.ts), réécrit ici : le garde-fou d'architecture
 * interdit les imports `../save*` depuis src/sim.
 */
function runMigrations(data: unknown, fromVersion: number, current: number, steps: typeof STEPS, what: string): Record<string, unknown> {
  if (!isObj(data)) throw new Error(`section ${what} : objet attendu`);
  if (!Number.isInteger(fromVersion) || fromVersion < 1) throw new Error(`section ${what} : version ${fromVersion} invalide`);
  if (fromVersion > current) throw new Error(`section ${what} : version ${fromVersion} plus récente que ${current}`);
  let d = data;
  for (let v = fromVersion; v < current; v++) {
    const step = steps[v];
    if (!step) throw new Error(`section ${what} : aucune migration depuis la version ${v}`);
    d = step(d);
  }
  return d;
}
const fin = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Migre et valide (lève si inutilisable). */
export function migrateDechets(data: unknown, fromVersion: number): DechetsSave {
  const d = runMigrations(data, fromVersion, DECHETS_SAVE_VERSION, STEPS, 'dechets');
  const e = emptyDechetsSave();
  if (d.settings !== undefined && !isObj(d.settings)) throw new Error('section dechets : réglages illisibles');
  if (d.bins !== undefined && !Array.isArray(d.bins)) throw new Error('section dechets : bacs illisibles');
  if (d.facilities !== undefined && !Array.isArray(d.facilities)) throw new Error('section dechets : installations illisibles');
  if (d.runs !== undefined && !Array.isArray(d.runs)) throw new Error('section dechets : tournées illisibles');
  return { ...e, ...(d as Partial<DechetsSave>) };
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const r1 = (v: number): number => Math.round(v * 10) / 10;

export function saveWaste(w: WasteSystem): DechetsSave {
  return {
    settings: { ...w.settings },
    bins: [...w.bins].map(([id, b]) => [id, r3(b.rec), r3(b.res), r3(b.cap), r3(b.over)]),
    facilities: [...w.facilities.values()].map((f) => ({ ...f })),
    runs: w.runs.map((r) => ({ ...r, pts: r.pts.map(r1), times: r.times.map(r3), events: r.events.map((e) => ({ ...e })) })),
    today: { ...w.today },
    lastDay: w.lastDay ? { ...w.lastDay } : null,
    totals: { ...w.totals },
    month: { ...w.month },
    appliedSat: w.appliedSat ? { n: w.appliedSat.length, data: encodeFloat32(w.appliedSat) } : null,
    appliedLand: w.appliedLand ? { n: w.appliedLand.length, data: encodeFloat32(w.appliedLand) } : null,
    causes: { ...w.causes },
    blocked: w.blocked,
  };
}

export function loadWaste(w: WasteSystem, s: DechetsSave): void {
  w.reset();
  for (const k of ['collectsPerWeek', 'sortShare', 'funding'] as const) w.settings[k] = clampSetting(k, fin(s.settings?.[k], DEFAULT_WASTE_SETTINGS[k]));
  for (const b of s.bins) if (Array.isArray(b) && b.length >= 4) w.bins.set(fin(b[0]), { rec: fin(b[1]), res: fin(b[2]), cap: fin(b[3]), over: fin(b[4]) });
  for (const f of s.facilities) {
    if (!isObj(f) || !WASTE_FACILITY_KINDS.includes(f.kind)) continue;
    const fac: Facility = { id: fin(f.id), kind: f.kind, x: fin(f.x), z: fin(f.z), rot: fin(f.rot), capacity: fin(f.capacity), stock: fin(f.stock), inToday: fin(f.inToday), processed: fin(f.processed), overToday: fin(f.overToday), connected: !!f.connected };
    w.facilities.set(fac.id, fac);
  }
  w.runs = s.runs.filter((r) => isObj(r) && Array.isArray(r.pts) && Array.isArray(r.times) && Array.isArray(r.events)).map((r) => ({ ...r }));
  if (s.today) w.today = { ...w.today, ...s.today };
  w.lastDay = s.lastDay ? { ...s.lastDay } : null;
  if (s.totals) w.totals = { ...w.totals, ...s.totals };
  w.month = { recycling: fin(s.month?.recycling), energy: fin(s.month?.energy) };
  const dec = (v: { n: number; data: string } | null): Float32Array | null => (isObj(v) && typeof v.data === 'string' ? decodeFloat32(v.data, fin(v.n)) : null);
  w.appliedSat = dec(s.appliedSat);
  w.appliedLand = dec(s.appliedLand);
  w.causes = { settings: fin(s.causes?.settings, -1), uncollected: fin(s.causes?.uncollected, -1), landfillFull: fin(s.causes?.landfillFull, -1) };
  w.blocked = typeof s.blocked === 'string' ? s.blocked : null;
  w.version++;
}
