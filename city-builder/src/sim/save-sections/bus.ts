/**
 * Section de sauvegarde du module « bus » (lignes de bus) : lignes et arrêts (positions), bus et tarifs, comptes du
 * mois, facteur voiture et vitesse de référence (reprise identique). Absente d'une partie sans ligne : une ancienne
 * sauvegarde se charge sans ligne. Les tracés, la couverture et la demande sont recalculés au chargement.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { DEFAULT_BUS_TUNING } from '../../shared/protocol-ext/bus';
import { readRecord, type BusSave } from '../transit/system';
import { runMigrations, type SaveSectionSpec } from './types';

export const BUS_SAVE_VERSION = 1;

export const emptyBusSave = (): BusSave => ({
  nextLineId: 1, nextStopId: 1, lines: [], carFactor: 1, carKmh: DEFAULT_BUS_TUNING.carFreeKmh,
  month: { revenue: 0, cost: 0, hires: 0 }, lastMonth: { revenue: 0, cost: 0 },
});

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export function migrateBus(data: unknown, from: number): BusSave {
  const o = runMigrations(data, from, BUS_SAVE_VERSION, {}, 'bus') as Record<string, unknown>;
  const lines: BusSave['lines'] = [];
  const seen = new Set<number>();
  for (const raw of Array.isArray(o.lines) ? o.lines : []) {
    const r = readRecord(raw);
    if (!r || seen.has(r.id)) continue;
    seen.add(r.id);
    const m = (raw as { m?: unknown }).m;
    lines.push(Array.isArray(m) && m.length === 4 && m.every((v) => typeof v === 'number' && Number.isFinite(v)) ? { ...r, m: m as [number, number, number, number] } : r);
  }
  const month = (o.month ?? {}) as Record<string, unknown>, last = (o.lastMonth ?? {}) as Record<string, unknown>;
  const maxStop = Math.max(0, ...lines.flatMap((l) => l.stops.map((s) => s.id)));
  const maxLine = Math.max(0, ...lines.map((l) => l.id));
  return {
    nextLineId: Math.max(maxLine + 1, Math.floor(num(o.nextLineId, 1))),
    nextStopId: Math.max(maxStop + 1, Math.floor(num(o.nextStopId, 1))),
    lines,
    carFactor: Math.min(1, Math.max(0.3, num(o.carFactor, 1))),
    carKmh: Math.min(90, Math.max(2, num(o.carKmh, DEFAULT_BUS_TUNING.carFreeKmh))),
    month: { revenue: num(month.revenue, 0), cost: num(month.cost, 0), hires: num(month.hires, 0) },
    lastMonth: { revenue: num(last.revenue, 0), cost: num(last.cost, 0) },
  };
}

export const busSaveSection: SaveSectionSpec<BusSave> = { id: 'bus', version: BUS_SAVE_VERSION, empty: emptyBusSave, migrate: migrateBus };
