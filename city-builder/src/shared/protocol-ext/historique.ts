/**
 * Module « historique » (vague 5, docs/INTERFACE.md) : évolution de la ville pour les graphiques (population,
 * trésorerie, solde mensuel, emplois, chômage, satisfaction) sur 3 mois, 1 an et toute la partie.
 *
 * Stockage compact et borné (sauvegardé dans `save.plugins.historique`) :
 *  - `recent` : un échantillon par jour de jeu, 92 derniers jours (3 mois) ;
 *  - `long` : un échantillon tous les `longStep` jours (4 au départ) ; au-delà de 256 points, un point sur deux est
 *    retiré et le pas double (toute la partie, résolution décroissante) ;
 *  - `months` : solde réalisé de chaque mois clos (480 derniers mois au plus).
 * Un échantillon = 7 entiers : jour, habitants, trésorerie (CHF), emplois offerts, emplois occupés, chômage (‰),
 * satisfaction (×10). −1 = inconnu (ville de moins de 50 habitants : pas de rapport démographique ce jour-là).
 * TypeScript pur : AUCUN import de three ni du DOM ; fonctions pures (testées).
 */

export const HIST_STRIDE = 7;
export const HIST_RECENT_DAYS = 92;
export const HIST_LONG_MAX = 256;
export const HIST_LONG_STEP0 = 4;
export const HIST_MONTHS_MAX = 480;

export interface HistSample { day: number; pop: number; money: number; jobs: number; filled: number; unemp: number; happy: number }

/** État sauvegardé (tableaux plats d'entiers). */
export interface HistoriqueState {
  recent: number[];
  long: number[];
  longStep: number;
  /** [mois (index depuis le début), solde] × n. */
  months: number[];
}

export const emptyHistorique = (): HistoriqueState => ({ recent: [], long: [], longStep: HIST_LONG_STEP0, months: [] });

const toRow = (s: HistSample): number[] => [Math.round(s.day), Math.round(s.pop), Math.round(s.money), Math.round(s.jobs), Math.round(s.filled), Math.round(s.unemp), Math.round(s.happy)];

export function rowsOf(flat: readonly number[]): HistSample[] {
  const out: HistSample[] = [];
  for (let k = 0; k + HIST_STRIDE <= flat.length; k += HIST_STRIDE) {
    out.push({ day: flat[k]!, pop: flat[k + 1]!, money: flat[k + 2]!, jobs: flat[k + 3]!, filled: flat[k + 4]!, unemp: flat[k + 5]!, happy: flat[k + 6]! });
  }
  return out;
}

/** Ajoute l'échantillon d'un jour (remplace celui du même jour). Mutation en place, taille bornée. */
export function pushSample(h: HistoriqueState, s: HistSample): void {
  const row = toRow(s);
  // Jour déjà présent (rechargement dans la journée) : remplacé ; jour antérieur (incohérence) : historique récent repart.
  const lastRecent = h.recent.length >= HIST_STRIDE ? h.recent[h.recent.length - HIST_STRIDE]! : -Infinity;
  if (row[0]! === lastRecent) h.recent.splice(h.recent.length - HIST_STRIDE, HIST_STRIDE);
  else if (row[0]! < lastRecent) h.recent.length = 0;
  h.recent.push(...row);
  const over = h.recent.length / HIST_STRIDE - HIST_RECENT_DAYS;
  if (over > 0) h.recent.splice(0, over * HIST_STRIDE);
  // Série longue : un point tous les `longStep` jours.
  const lastLong = h.long.length >= HIST_STRIDE ? h.long[h.long.length - HIST_STRIDE]! : -Infinity;
  if (row[0]! < lastLong) h.long.length = 0;
  const prev = h.long.length ? h.long[h.long.length - HIST_STRIDE]! : -Infinity;
  if (row[0]! - prev >= h.longStep) {
    h.long.push(...row);
    if (h.long.length / HIST_STRIDE > HIST_LONG_MAX) compactLong(h);
  }
}

/** Retire un point sur deux de la série longue (le dernier est gardé) et double le pas. */
export function compactLong(h: HistoriqueState): void {
  const rows = h.long.length / HIST_STRIDE;
  const keep: number[] = [];
  for (let r = 0; r < rows; r++) {
    if ((rows - 1 - r) % 2 !== 0) continue;
    for (let k = 0; k < HIST_STRIDE; k++) keep.push(h.long[r * HIST_STRIDE + k]!);
  }
  h.long = keep;
  h.longStep *= 2;
}

/** Solde réalisé d'un mois clos (remplace le même mois). */
export function pushMonth(h: HistoriqueState, monthIndex: number, balance: number): void {
  const n = h.months.length;
  if (n >= 2 && h.months[n - 2] === monthIndex) { h.months[n - 1] = Math.round(balance); return; }
  if (n >= 2 && h.months[n - 2]! > monthIndex) h.months.length = 0;
  h.months.push(Math.round(monthIndex), Math.round(balance));
  if (h.months.length / 2 > HIST_MONTHS_MAX) h.months.splice(0, h.months.length - HIST_MONTHS_MAX * 2);
}

const ints = (v: unknown, stride: number): number[] => {
  if (!Array.isArray(v)) return [];
  const a = v.filter((x) => typeof x === 'number' && Number.isFinite(x)).map((x) => Math.round(x as number));
  return a.length % stride === 0 ? a : a.slice(0, a.length - (a.length % stride));
};

/** Lecture tolérante d'une section sauvegardée (données mal formées : séries vides). */
export function readHistorique(data: unknown): HistoriqueState {
  const o = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
  const step = typeof o['longStep'] === 'number' && Number.isFinite(o['longStep']) && o['longStep'] >= 1 ? Math.round(o['longStep']) : HIST_LONG_STEP0;
  const h: HistoriqueState = { recent: ints(o['recent'], HIST_STRIDE), long: ints(o['long'], HIST_STRIDE), longStep: step, months: ints(o['months'], 2) };
  if (h.recent.length > HIST_RECENT_DAYS * HIST_STRIDE) h.recent.splice(0, h.recent.length - HIST_RECENT_DAYS * HIST_STRIDE);
  while (h.long.length / HIST_STRIDE > HIST_LONG_MAX) compactLong(h);
  if (h.months.length > HIST_MONTHS_MAX * 2) h.months.splice(0, h.months.length - HIST_MONTHS_MAX * 2);
  return h;
}

export type HistRange = '3m' | '1a' | 'tout';
export const HIST_RANGE_DAYS: Record<HistRange, number> = { '3m': 90, '1a': 360, tout: Infinity };

/**
 * Points d'une période : série longue puis échantillons quotidiens (plus fins) sur leur plage, jour croissant,
 * limités aux `HIST_RANGE_DAYS[range]` derniers jours avant `today`.
 */
export function samplesFor(h: HistoriqueState, range: HistRange, today: number): HistSample[] {
  const from = today - HIST_RANGE_DAYS[range];
  const recent = rowsOf(h.recent);
  const firstRecent = recent.length ? recent[0]!.day : Infinity;
  const pts = rowsOf(h.long).filter((s) => s.day < firstRecent && s.day >= from);
  for (const s of recent) if (s.day >= from) pts.push(s);
  return pts;
}

/** Soldes mensuels d'une période (3 mois, 12 mois, tous). */
export function monthsFor(h: HistoriqueState, range: HistRange): { month: number; balance: number }[] {
  const out: { month: number; balance: number }[] = [];
  for (let k = 0; k + 1 < h.months.length; k += 2) out.push({ month: h.months[k]!, balance: h.months[k + 1]! });
  return range === '3m' ? out.slice(-3) : range === '1a' ? out.slice(-12) : out;
}
