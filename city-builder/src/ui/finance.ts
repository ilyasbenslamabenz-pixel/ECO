/**
 * Panneau Finances : trésorerie, bilan mensuel, entretien estimé (catalogue + réseau), et
 * graphique de l'historique de la trésorerie RELEVÉE pendant la partie (un point par jour de jeu,
 * à partir des statistiques envoyées par la simulation). Impôts, emprunts et recettes détaillées : city-panels.ts.
 * Graphique : une seule série (pas de légende, le titre la nomme), ligne de 2 px, aire légère,
 * grille discrète, réticule + infobulle au survol / au doigt.
 * Propriétaire : agent construction/caméra/UI.
 */
import type { SimStats } from '../shared/contracts';
import { MONTHS, money } from './dom';

export interface FinancePoint { minutes: number; money: number; balance: number; year: number; month: number; day: number }

/** Historique échantillonné une fois par jour de jeu (pur, testable). */
export class FinanceHistory {
  readonly points: FinancePoint[] = [];
  private lastDay = -1;
  constructor(private readonly max = 720) {}

  push(s: SimStats): boolean {
    const day = Math.floor(s.date.totalMinutes / 1440);
    if (day === this.lastDay) {
      // Même jour : on met à jour le dernier point (dépenses du jour visibles immédiatement).
      const last = this.points[this.points.length - 1];
      if (last) { last.money = s.money; last.balance = s.monthlyBalance; }
      return false;
    }
    if (day < this.lastDay) this.points.length = 0; // nouvelle partie / chargement
    this.lastDay = day;
    this.points.push({ minutes: s.date.totalMinutes, money: s.money, balance: s.monthlyBalance, year: s.date.year, month: s.date.month, day: s.date.day });
    if (this.points.length > this.max) this.points.splice(0, this.points.length - this.max);
    return true;
  }

  reset(): void { this.points.length = 0; this.lastDay = -1; }
}

export const dateLabel = (p: FinancePoint): string => `${p.day} ${MONTHS[p.month - 1] ?? ''} an ${p.year}`;

/** « Belle » graduation : 1, 2 ou 5 × 10^n. */
export function niceStep(range: number, ticks: number): number {
  const raw = range / Math.max(1, ticks);
  const mag = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}

/** Libellé d'axe compact dont la précision suit le pas de graduation (libellés toujours distincts). */
export function axisLabel(v: number, step: number): string {
  const unit = Math.abs(v) >= 1e6 || step >= 1e6 ? 1e6 : Math.abs(v) >= 1e4 || step >= 1e3 ? 1e3 : 1;
  const x = step / unit;
  let dec = 0;
  while (dec < 3 && Math.abs(Math.round(x * 10 ** dec) - x * 10 ** dec) > 1e-6) dec++;
  const txt = (v / unit).toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  return unit === 1e6 ? `${txt} M` : unit === 1e3 ? `${txt} k` : txt;
}

export class FinanceChart {
  private hoverIdx = -1;
  constructor(private canvas: HTMLCanvasElement, private tip: HTMLElement, private history: FinanceHistory) {
    const move = (e: PointerEvent): void => {
      const r = canvas.getBoundingClientRect();
      const n = this.history.points.length;
      if (n < 1) return;
      const x = e.clientX - r.left;
      const plotL = 56; const plotR = r.width - 8;
      this.hoverIdx = Math.max(0, Math.min(n - 1, Math.round(((x - plotL) / Math.max(1, plotR - plotL)) * (n - 1))));
      this.draw();
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerdown', move);
    canvas.addEventListener('pointerleave', () => { this.hoverIdx = -1; this.tip.classList.add('hidden'); this.draw(); });
  }

  draw(): void {
    const c = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth || 300;
    const h = c.clientHeight || 150;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const pts = this.history.points;
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue('--accent').trim() || '#3ddc84';
    const muted = css.getPropertyValue('--muted').trim() || '#8f9baa';
    g.font = '11px Inter, system-ui, sans-serif';
    if (pts.length < 2) {
      g.fillStyle = muted;
      g.textAlign = 'center';
      g.fillText(pts.length ? 'Historique en cours de relevé (1 point par jour de jeu)…' : 'Aucune donnée', w / 2, h / 2);
      return;
    }
    let lo = Infinity; let hi = -Infinity;
    for (const p of pts) { if (p.money < lo) lo = p.money; if (p.money > hi) hi = p.money; }
    if (hi - lo < 1) { hi += 1000; lo -= 1000; }
    const step = niceStep(hi - lo, 3);
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    const L = 56; const R = w - 8; const T = 8; const B = h - 20;
    const X = (i: number): number => L + ((R - L) * i) / (pts.length - 1);
    const Y = (v: number): number => B - ((B - T) * (v - lo)) / (hi - lo);
    // Grille et axe (discrets).
    g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = 1; g.fillStyle = muted; g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let v = lo; v <= hi + step / 2; v += step) {
      const y = Math.round(Y(v)) + 0.5;
      g.beginPath(); g.moveTo(L, y); g.lineTo(R, y); g.stroke();
      g.fillText(axisLabel(v, step), L - 6, y);
    }
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillText(dateLabel(pts[0]!), L, h - 5);
    g.textAlign = 'right';
    g.fillText(dateLabel(pts[pts.length - 1]!), R, h - 5);
    // Aire puis ligne.
    const grad = g.createLinearGradient(0, T, 0, B);
    grad.addColorStop(0, 'rgba(61,220,132,0.26)'); grad.addColorStop(1, 'rgba(61,220,132,0)');
    g.beginPath(); g.moveTo(X(0), B);
    pts.forEach((p, i) => g.lineTo(X(i), Y(p.money)));
    g.lineTo(X(pts.length - 1), B); g.closePath(); g.fillStyle = grad; g.fill();
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(X(i), Y(p.money)) : g.moveTo(X(i), Y(p.money))));
    g.strokeStyle = accent; g.lineWidth = 2; g.lineJoin = 'round'; g.stroke();
    // Réticule + infobulle.
    const hi_ = this.hoverIdx;
    if (hi_ >= 0 && hi_ < pts.length) {
      const p = pts[hi_]!;
      const x = X(hi_); const y = Y(p.money);
      g.strokeStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.moveTo(x, T); g.lineTo(x, B); g.stroke();
      g.fillStyle = accent; g.strokeStyle = '#141920'; g.lineWidth = 2;
      g.beginPath(); g.arc(x, y, 4.5, 0, Math.PI * 2); g.fill(); g.stroke();
      this.tip.textContent = `${dateLabel(p)} · ${money(p.money)}`;
      this.tip.style.left = `${10 + x}px`;
      this.tip.style.top = `${30 + y}px`;
      this.tip.classList.remove('hidden');
    }
  }
}
