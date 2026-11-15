/**
 * Graphiques canvas 2D de l'interface : barres et courbes sur un ou deux axes verticaux GRADUÉS
 * (pas « ronds » 1-2-5, zéro toujours inclus pour les barres, libellés d'axe distincts), axe des
 * abscisses étiqueté (mois). Aucune donnée inventée : un graphique sans valeur affiche un message.
 * Propriétaire : agent UI (refonte).
 */
import { axisLabel, niceStep } from './finance';

/** Couleurs du thème courant (clair ou sombre) pour les dessins au canevas. */
export const cssVar = (name: string, fallback: string): string => (typeof document !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue(name).trim() : '') || fallback;
export const ink = (a: number): string => `rgba(${cssVar('--ink', '255, 255, 255')}, ${a})`;


export interface ChartSeries {
  kind: 'bar' | 'line';
  values: number[];
  color: string;
  /** Couleur des barres négatives (barres seulement). */
  negColor?: string;
  axis: 'left' | 'right';
  name: string;
}

export interface ChartSpec {
  labels: string[];
  series: ChartSeries[];
  /** Unité ajoutée au titre de l'axe (ex. « CHF »). */
  leftUnit?: string;
  rightUnit?: string;
  empty?: string;
}

interface Axis { lo: number; hi: number; step: number }

function axisFor(series: ChartSeries[], includeZero: boolean): Axis | null {
  if (!series.length) return null;
  let lo = Infinity; let hi = -Infinity;
  for (const s of series) for (const v of s.values) { if (!Number.isFinite(v)) continue; if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!Number.isFinite(lo)) return null;
  if (includeZero) { lo = Math.min(0, lo); hi = Math.max(0, hi); }
  if (hi - lo < 1) { hi += 1000; if (!includeZero || lo < 0) lo -= 1000; }
  const step = niceStep(hi - lo, 4);
  return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step };
}

/** Prépare le canvas (densité de pixels) et renvoie son contexte et ses dimensions CSS. */
export function prepCanvas(c: HTMLCanvasElement): { g: CanvasRenderingContext2D; w: number; h: number } | null {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = c.clientWidth || 300;
  const h = c.clientHeight || 150;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const g = c.getContext('2d');
  if (!g) return null;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  return { g, w, h };
}

export const CHART_FONT = '11px Inter, system-ui, -apple-system, "Segoe UI", sans-serif';

export function drawChart(canvas: HTMLCanvasElement, spec: ChartSpec): void {
  const p = prepCanvas(canvas);
  if (!p) return;
  const { g, w, h } = p;
  const muted = cssVar('--muted', 'rgba(200,212,224,0.62)');
  g.font = CHART_FONT;
  const n = spec.labels.length;
  if (n === 0 || spec.series.every((s) => s.values.length === 0)) {
    g.fillStyle = muted; g.textAlign = 'center'; g.textBaseline = 'middle';
    // Message replié sur plusieurs lignes (jamais coupé par le bord du graphique).
    const words = (spec.empty ?? 'Aucune donnée').split(' ');
    const lines: string[] = [];
    let cur = '';
    for (const wd of words) { const t = cur ? `${cur} ${wd}` : wd; if (g.measureText(t).width > w - 24 && cur) { lines.push(cur); cur = wd; } else cur = t; }
    if (cur) lines.push(cur);
    lines.forEach((l, i) => g.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * 15));
    return;
  }
  const left = spec.series.filter((s) => s.axis === 'left');
  const right = spec.series.filter((s) => s.axis === 'right');
  const la = axisFor(left, left.some((s) => s.kind === 'bar'));
  const ra = axisFor(right, right.some((s) => s.kind === 'bar'));
  const labelsOf = (a: Axis | null): string[] => {
    if (!a) return [];
    const out: string[] = [];
    for (let v = a.lo; v <= a.hi + a.step / 2; v += a.step) out.push(axisLabel(v, a.step));
    return out;
  };
  const ll = labelsOf(la); const rl = labelsOf(ra);
  const lw = Math.max(0, ...ll.map((t) => g.measureText(t).width));
  const rw = Math.max(0, ...rl.map((t) => g.measureText(t).width));
  const L = la ? Math.ceil(lw) + 10 : 8;
  const R = w - (ra ? Math.ceil(rw) + 10 : 8);
  const T = 22; const B = h - 20;
  const slot = (R - L) / n;
  const X = (i: number): number => L + slot * (i + 0.5);
  const Y = (a: Axis, v: number): number => B - ((B - T) * (v - a.lo)) / (a.hi - a.lo);
  // Unités en tête d'axe.
  g.fillStyle = muted; g.textBaseline = 'alphabetic';
  if (la && spec.leftUnit) { g.textAlign = 'left'; g.fillText(spec.leftUnit, 2, 9); }
  if (ra && spec.rightUnit) { g.textAlign = 'right'; g.fillText(spec.rightUnit, w - 2, 9); }
  // Grille (axe principal) + graduations des deux axes.
  const main = la ?? ra!;
  g.lineWidth = 1; g.textBaseline = 'middle';
  for (let v = main.lo, k = 0; v <= main.hi + main.step / 2; v += main.step, k++) {
    const y = Math.round(Y(main, v)) + 0.5;
    g.strokeStyle = Math.abs(v) < main.step / 2 && main.lo < 0 ? ink(0.22) : ink(0.07);
    g.beginPath(); g.moveTo(L, y); g.lineTo(R, y); g.stroke();
    if (la) { g.fillStyle = muted; g.textAlign = 'right'; g.fillText(ll[k] ?? '', L - 6, y); }
  }
  if (ra) {
    g.textAlign = 'left';
    for (let v = ra.lo, k = 0; v <= ra.hi + ra.step / 2; v += ra.step, k++) {
      const y = Y(ra, v);
      g.fillStyle = muted; g.fillText(rl[k] ?? '', R + 6, y);
      g.strokeStyle = ink(0.18); g.beginPath(); g.moveTo(R, Math.round(y) + 0.5); g.lineTo(R + 3, Math.round(y) + 0.5); g.stroke();
    }
  }
  // Axes.
  g.strokeStyle = ink(0.2);
  g.beginPath(); g.moveTo(L + 0.5, T - 4); g.lineTo(L + 0.5, B); g.lineTo(R, B); if (ra) g.lineTo(R + 0.5, T - 4); g.stroke();
  // Abscisses : un libellé par mois si la place le permet, sinon un sur deux (dernier toujours affiché).
  g.fillStyle = muted; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  const maxW = Math.max(...spec.labels.map((t) => g.measureText(t).width));
  const every = Math.max(1, Math.ceil((maxW + 6) / slot));
  spec.labels.forEach((t, i) => { if ((n - 1 - i) % every === 0) g.fillText(t, X(i), h - 5); });
  // Barres.
  const bars = spec.series.filter((s) => s.kind === 'bar');
  const bw = Math.max(2, Math.min(22, (slot * 0.66) / Math.max(1, bars.length)));
  bars.forEach((s, j) => {
    const a = s.axis === 'left' ? la! : ra!;
    const y0 = Y(a, Math.max(a.lo, Math.min(a.hi, 0)));
    s.values.forEach((v, i) => {
      if (!Number.isFinite(v)) return;
      const x = X(i) - (bw * bars.length) / 2 + j * bw;
      const y = Y(a, v);
      const top = Math.min(y, y0); const hh = Math.max(1, Math.abs(y - y0));
      const grad = g.createLinearGradient(0, top, 0, top + hh);
      const col = v < 0 && s.negColor ? s.negColor : s.color;
      grad.addColorStop(0, col); grad.addColorStop(1, `${col}99`);
      g.fillStyle = grad;
      roundRect(g, x + 1, top, bw - 2, hh, Math.min(3, bw / 3));
      g.fill();
    });
  });
  // Courbes.
  for (const s of spec.series.filter((x) => x.kind === 'line')) {
    const a = s.axis === 'left' ? la! : ra!;
    g.strokeStyle = s.color; g.lineWidth = 2; g.lineJoin = 'round';
    g.beginPath();
    s.values.forEach((v, i) => (i ? g.lineTo(X(i), Y(a, v)) : g.moveTo(X(i), Y(a, v))));
    g.stroke();
    g.fillStyle = cssVar('--panel-solid', '#0f1419'); g.lineWidth = 1.6;
    s.values.forEach((v, i) => { g.beginPath(); g.arc(X(i), Y(a, v), n > 16 ? 1.8 : 2.6, 0, Math.PI * 2); g.fill(); g.stroke(); });
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + rr, y); g.lineTo(x + w - rr, y); g.quadraticCurveTo(x + w, y, x + w, y + rr);
  g.lineTo(x + w, y + h); g.lineTo(x, y + h); g.lineTo(x, y + rr); g.quadraticCurveTo(x, y, x + rr, y);
  g.closePath();
}

export const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/* ------------------------------------------------------------------ */
/* Graphique temporel (vague 5) : abscisse en jours de jeu, courbes et  */
/* barres (périodes) sur deux axes, trous (valeur inconnue) respectés.  */
/* ------------------------------------------------------------------ */

export interface TimeLine { kind: 'line'; points: [number, number][]; color: string; axis: 'left' | 'right'; name: string; area?: boolean }
export interface TimeBars { kind: 'bar'; bars: [number, number, number][]; color: string; negColor?: string; axis: 'left' | 'right'; name: string }
export interface TimeChartSpec {
  /** Plage affichée (jours de jeu). */
  from: number;
  to: number;
  series: (TimeLine | TimeBars)[];
  leftUnit?: string;
  rightUnit?: string;
  /** Bornes imposées d'un axe (ex. satisfaction 0..100). */
  leftRange?: [number, number];
  rightRange?: [number, number];
  empty?: string;
}

/** Libellé d'un jour de jeu (30 jours par mois, 12 mois par an), selon le pas des graduations. */
export function dayLabel(day: number, stepDays: number): string {
  const month = Math.floor(day / 30) % 12, year = 1 + Math.floor(day / 360);
  if (stepDays >= 360) return `an ${year}`;
  if (stepDays >= 30) return month === 0 || stepDays >= 90 ? `${MONTHS_SHORT[month]} a${year}` : MONTHS_SHORT[month]!;
  return `${1 + (day % 30)} ${MONTHS_SHORT[month]}`;
}

function axisOf(values: number[], includeZero: boolean, forced?: [number, number]): Axis | null {
  if (forced) { const step = niceStep(forced[1] - forced[0], 4); return { lo: forced[0], hi: forced[1], step }; }
  let lo = Infinity, hi = -Infinity;
  for (const v of values) { if (!Number.isFinite(v)) continue; if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!Number.isFinite(lo)) return null;
  if (includeZero) { lo = Math.min(0, lo); hi = Math.max(0, hi); }
  if (hi - lo < 1e-9) { const pad = Math.max(1, Math.abs(hi) * 0.1); hi += pad; if (!includeZero || lo < 0) lo -= pad; }
  const step = niceStep(hi - lo, 4);
  return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step };
}

/** Dessine un graphique temporel ; renvoie la zone de tracé (infobulle). Coût : une passe sur les points. */
export function drawTimeChart(canvas: HTMLCanvasElement, spec: TimeChartSpec): { L: number; R: number; T: number; B: number; X: (d: number) => number } | null {
  const p = prepCanvas(canvas);
  if (!p) return null;
  const { g, w, h } = p;
  const muted = cssVar('--muted', 'rgba(200,212,224,0.62)');
  g.font = CHART_FONT;
  const has = spec.series.some((s) => (s.kind === 'line' ? s.points.length : s.bars.length) > 0);
  if (!has || spec.to <= spec.from) {
    g.fillStyle = muted; g.textAlign = 'center'; g.textBaseline = 'middle';
    const words = (spec.empty ?? 'Aucune donnée').split(' ');
    const lines: string[] = [];
    let cur = '';
    for (const wd of words) { const t = cur ? `${cur} ${wd}` : wd; if (g.measureText(t).width > w - 24 && cur) { lines.push(cur); cur = wd; } else cur = t; }
    if (cur) lines.push(cur);
    lines.forEach((l, i) => g.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * 15));
    return null;
  }
  const vals = (axis: 'left' | 'right'): number[] => spec.series.filter((s) => s.axis === axis).flatMap((s) => (s.kind === 'line' ? s.points.map((q) => q[1]) : s.bars.map((b) => b[2])));
  const hasBars = (axis: 'left' | 'right'): boolean => spec.series.some((s) => s.axis === axis && s.kind === 'bar');
  const la = spec.series.some((s) => s.axis === 'left') ? axisOf(vals('left'), hasBars('left'), spec.leftRange) : null;
  const ra = spec.series.some((s) => s.axis === 'right') ? axisOf(vals('right'), hasBars('right'), spec.rightRange) : null;
  const labels = (a: Axis | null): string[] => { const out: string[] = []; if (a) for (let v = a.lo; v <= a.hi + a.step / 2; v += a.step) out.push(axisLabel(v, a.step)); return out; };
  const ll = labels(la), rl = labels(ra);
  const L = la ? Math.ceil(Math.max(0, ...ll.map((t) => g.measureText(t).width))) + 10 : 8;
  const R = w - (ra ? Math.ceil(Math.max(0, ...rl.map((t) => g.measureText(t).width))) + 10 : 8);
  const T = 22, B = h - 20;
  const span = spec.to - spec.from;
  const X = (d: number): number => L + ((R - L) * (d - spec.from)) / span;
  const Y = (a: Axis, v: number): number => B - ((B - T) * (v - a.lo)) / (a.hi - a.lo);
  g.fillStyle = muted; g.textBaseline = 'alphabetic';
  if (la && spec.leftUnit) { g.textAlign = 'left'; g.fillText(spec.leftUnit, 2, 9); }
  if (ra && spec.rightUnit) { g.textAlign = 'right'; g.fillText(spec.rightUnit, w - 2, 9); }
  const main = la ?? ra!;
  g.lineWidth = 1; g.textBaseline = 'middle';
  for (let v = main.lo, k = 0; v <= main.hi + main.step / 2; v += main.step, k++) {
    const y = Math.round(Y(main, v)) + 0.5;
    g.strokeStyle = Math.abs(v) < main.step / 2 && main.lo < 0 ? ink(0.22) : ink(0.07);
    g.beginPath(); g.moveTo(L, y); g.lineTo(R, y); g.stroke();
    if (la) { g.fillStyle = muted; g.textAlign = 'right'; g.fillText(ll[k] ?? '', L - 6, y); }
  }
  if (ra) {
    g.textAlign = 'left';
    for (let v = ra.lo, k = 0; v <= ra.hi + ra.step / 2; v += ra.step, k++) { g.fillStyle = muted; g.fillText(rl[k] ?? '', R + 6, Y(ra, v)); }
  }
  g.strokeStyle = ink(0.2);
  g.beginPath(); g.moveTo(L + 0.5, T - 4); g.lineTo(L + 0.5, B); g.lineTo(R, B); if (ra) g.lineTo(R + 0.5, T - 4); g.stroke();
  // Graduations du temps : pas « rond » en jours (1 semaine … plusieurs années), libellés sans chevauchement.
  const steps = [5, 10, 15, 30, 60, 90, 180, 360, 720, 1800, 3600];
  const maxTicks = Math.max(2, Math.floor((R - L) / 64));
  const step = steps.find((s) => span / s <= maxTicks) ?? 3600;
  g.fillStyle = muted; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  for (let d = Math.ceil(spec.from / step) * step; d <= spec.to; d += step) {
    const x = X(d);
    if (x < L + 14 || x > R - 14) continue;
    g.strokeStyle = ink(0.12); g.beginPath(); g.moveTo(Math.round(x) + 0.5, B); g.lineTo(Math.round(x) + 0.5, B + 3); g.stroke();
    g.fillText(dayLabel(d, step), x, h - 5);
  }
  // Barres (périodes : mois) puis courbes.
  for (const s of spec.series) {
    if (s.kind !== 'bar') continue;
    const a = s.axis === 'left' ? la! : ra!;
    const y0 = Y(a, Math.max(a.lo, Math.min(a.hi, 0)));
    for (const [d0, d1, v] of s.bars) {
      if (!Number.isFinite(v) || d1 < spec.from || d0 > spec.to) continue;
      const x0 = Math.max(L, X(d0)), x1 = Math.min(R, X(d1));
      const bw = Math.max(1.5, (x1 - x0) * 0.72);
      const xc = (x0 + x1) / 2;
      const y = Y(a, v), top = Math.min(y, y0), hh = Math.max(1, Math.abs(y - y0));
      g.fillStyle = v < 0 && s.negColor ? `${s.negColor}cc` : `${s.color}cc`;
      roundRect(g, xc - bw / 2, top, bw, hh, Math.min(3, bw / 3));
      g.fill();
    }
  }
  for (const s of spec.series) {
    if (s.kind !== 'line') continue;
    const a = s.axis === 'left' ? la! : ra!;
    const pts = s.points.filter((q) => Number.isFinite(q[1]));
    if (!pts.length) continue;
    if (s.area && pts.length > 1) {
      const grad = g.createLinearGradient(0, T, 0, B);
      grad.addColorStop(0, `${s.color}44`); grad.addColorStop(1, `${s.color}00`);
      g.beginPath(); g.moveTo(X(pts[0]![0]), B);
      for (const q of pts) g.lineTo(X(q[0]), Y(a, q[1]));
      g.lineTo(X(pts[pts.length - 1]![0]), B); g.closePath(); g.fillStyle = grad; g.fill();
    }
    g.strokeStyle = s.color; g.lineWidth = 2; g.lineJoin = 'round';
    g.beginPath();
    pts.forEach((q, i) => (i ? g.lineTo(X(q[0]), Y(a, q[1])) : g.moveTo(X(q[0]), Y(a, q[1]))));
    g.stroke();
    if (pts.length === 1) { g.fillStyle = s.color; g.beginPath(); g.arc(X(pts[0]![0]), Y(a, pts[0]![1]), 3, 0, Math.PI * 2); g.fill(); }
  }
  return { L, R, T, B, X };
}
