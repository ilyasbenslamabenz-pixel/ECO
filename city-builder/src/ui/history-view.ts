/**
 * Graphiques d'évolution (vague 5, tableau de bord Statistiques) : population, trésorerie et solde mensuel, emplois et
 * chômage, satisfaction, sur 3 mois, 1 an ou toute la partie. Données : module « historique » de la simulation
 * (commande `etat`, relue au plus toutes les 2 s quand le panneau est ouvert), complétées par le dernier relevé
 * (statistiques de la trame) pour la journée en cours. Aucun chiffre inventé ; une série inconnue (−1) est un trou.
 * Coût : un dessin de canevas à l'ouverture et à chaque nouveau relevé (≈ 400 points au plus).
 */
import type { SimStats } from '../shared/contracts';
import { HIST_RANGE_DAYS, monthsFor, samplesFor, type HistoriqueState, type HistRange, type HistSample } from '../shared/protocol-ext/historique';
import { drawTimeChart, type TimeBars, type TimeLine } from './charts';
import { el, fmt, money, moneyShort } from './dom';

export type HistTab = 'pop' | 'money' | 'happy' | 'jobs';
export const HIST_RANGES: readonly { id: HistRange; label: string }[] = [{ id: '3m', label: '3 mois' }, { id: '1a', label: '1 an' }, { id: 'tout', label: 'Toute la partie' }];

const COLORS = { pop: '#7cc4ff', money: '#3ddc84', balance: '#56b6f7', neg: '#ff6b6b', jobs: '#c9a0ff', filled: '#7cc4ff', unemp: '#ff8f6b', happy: '#ffd166' };

/** Séries d'un onglet sur une période (pur, testable). */
export function seriesFor(tab: HistTab, samples: HistSample[], months: { month: number; balance: number }[]): { lines: TimeLine[]; bars: TimeBars[]; leftUnit: string; rightUnit?: string; leftRange?: [number, number]; legend: { name: string; color: string; bar?: boolean }[] } {
  const pts = (f: (s: HistSample) => number, ok: (s: HistSample) => boolean = () => true): [number, number][] => samples.filter(ok).map((s) => [s.day, f(s)]);
  switch (tab) {
    case 'pop': return { lines: [{ kind: 'line', points: pts((s) => s.pop), color: COLORS.pop, axis: 'left', name: 'Habitants', area: true }], bars: [], leftUnit: 'hab.', legend: [{ name: 'Habitants', color: COLORS.pop }] };
    case 'money': return {
      lines: [{ kind: 'line', points: pts((s) => s.money), color: COLORS.money, axis: 'left', name: 'Trésorerie' }],
      bars: [{ kind: 'bar', bars: months.map((m) => [m.month * 30, (m.month + 1) * 30, m.balance]), color: COLORS.balance, negColor: COLORS.neg, axis: 'right', name: 'Solde du mois' }],
      leftUnit: 'trésorerie CHF', rightUnit: 'solde / mois', legend: [{ name: 'Trésorerie', color: COLORS.money }, { name: 'Solde mensuel (barres, rouge si négatif)', color: COLORS.balance, bar: true }],
    };
    case 'jobs': return {
      lines: [
        { kind: 'line', points: pts((s) => s.jobs, (s) => s.jobs >= 0), color: COLORS.jobs, axis: 'left', name: 'Emplois offerts' },
        { kind: 'line', points: pts((s) => s.filled, (s) => s.filled >= 0), color: COLORS.filled, axis: 'left', name: 'Emplois occupés' },
        { kind: 'line', points: pts((s) => s.unemp / 10, (s) => s.unemp >= 0), color: COLORS.unemp, axis: 'right', name: 'Chômage' },
      ],
      bars: [], leftUnit: 'emplois', rightUnit: 'chômage %', legend: [{ name: 'Emplois offerts', color: COLORS.jobs }, { name: 'Emplois occupés', color: COLORS.filled }, { name: 'Chômage (%)', color: COLORS.unemp }],
    };
    case 'happy': return { lines: [{ kind: 'line', points: pts((s) => s.happy / 10, (s) => s.happy >= 0), color: COLORS.happy, axis: 'left', name: 'Satisfaction', area: true }], bars: [], leftUnit: '/100', leftRange: [0, 100], legend: [{ name: 'Satisfaction moyenne', color: COLORS.happy }] };
  }
}

export class HistoryView {
  state: HistoriqueState | null = null;
  today = 0;
  range: HistRange = '1a';
  private fetchedAt = 0;
  private pending = false;

  constructor(private readonly fetch: () => Promise<{ today: number; state: HistoriqueState } | null>, private readonly redraw: () => void) {}

  /** Relit l'historique de la simulation si la dernière lecture date de plus de 2 s (ou `force`). */
  refresh(force = false): void {
    if (this.pending || (!force && performance.now() - this.fetchedAt < 2000)) return;
    this.pending = true;
    void this.fetch().then((r) => {
      this.pending = false;
      this.fetchedAt = performance.now();
      if (!r || !r.state) return;
      const changed = !this.state || r.today !== this.today || r.state.recent.length !== this.state.recent.length || r.state.months.length !== this.state.months.length;
      this.state = r.state; this.today = r.today;
      if (changed) this.redraw();
    }).catch(() => { this.pending = false; this.fetchedAt = performance.now(); });
  }

  /** Échantillons de la période, plus la journée en cours (dernière trame : habitants, trésorerie). */
  samples(live: SimStats | null): HistSample[] {
    const h = this.state;
    const today = live ? Math.floor(live.date.totalMinutes / 1440) : this.today;
    const out = h ? samplesFor(h, this.range, today) : [];
    const last = out[out.length - 1];
    if (live && (!last || last.day < today)) out.push({ day: today, pop: live.population, money: live.money, jobs: last?.jobs ?? -1, filled: last?.filled ?? -1, unemp: last?.unemp ?? -1, happy: last?.happy ?? -1 });
    return out;
  }

  /** Contenu de l'onglet (périodes, légende, chiffres clés, canevas). */
  build(tab: HistTab, live: SimStats | null): HTMLElement[] {
    const titles: Record<HistTab, string> = { pop: 'Habitants', money: 'Trésorerie et solde mensuel (CHF)', happy: 'Satisfaction moyenne (0 à 100)', jobs: 'Emplois et chômage' };
    const ranges = el('div', { cls: 'hist-ranges', attrs: { role: 'tablist', 'aria-label': 'Période' } });
    for (const r of HIST_RANGES) {
      const b = el('button', { cls: this.range === r.id ? 'on' : '', text: r.label, attrs: { type: 'button', role: 'tab', 'data-range': r.id, 'aria-selected': String(this.range === r.id) } });
      b.addEventListener('click', () => { this.range = r.id; this.redraw(); });
      ranges.append(b);
    }
    const s = this.samples(live);
    const months = this.state ? monthsFor(this.state, this.range) : [];
    const spec = seriesFor(tab, s, months);
    const legend = el('div', { cls: 'hist-legend' }, ...spec.legend.map((l) => el('span', {}, el('i', { cls: l.bar ? 'bar' : '', attrs: { style: `background:${l.color}` } }), l.name)));
    const first = s.find((x) => (tab === 'happy' ? x.happy >= 0 : tab === 'jobs' ? x.unemp >= 0 : true));
    const last = s[s.length - 1];
    const kpis = el('div', { cls: 'hist-kpis' });
    const kpi = (label: string, value: string, cls = ''): HTMLElement => el('div', { cls: `kpi ${cls}` }, el('span', { cls: 'lbl', text: label }), el('b', { text: value }));
    const signed = (v: number, f: (x: number) => string): string => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${f(Math.abs(v))}`;
    if (last && first) {
      if (tab === 'pop') kpis.append(kpi('Aujourd’hui', fmt(last.pop)), kpi('Sur la période', signed(last.pop - first.pop, fmt), last.pop >= first.pop ? 'pos' : 'neg'));
      if (tab === 'money') {
        const sum = months.reduce((a, m) => a + m.balance, 0);
        kpis.append(kpi('Trésorerie', moneyShort(last.money), last.money < 0 ? 'neg' : ''), kpi('Soldes des mois clos', months.length ? signed(sum, (x) => money(x)) : '—', sum < 0 ? 'neg' : 'pos'));
      }
      if (tab === 'jobs' && last.unemp >= 0) kpis.append(kpi('Chômage', `${(last.unemp / 10).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`, last.unemp > 100 ? 'neg' : ''), kpi('Emplois occupés', `${fmt(Math.max(0, last.filled))} / ${fmt(Math.max(0, last.jobs))}`));
      if (tab === 'happy' && last.happy >= 0) kpis.append(kpi('Satisfaction', `${fmt(last.happy / 10)} / 100`, last.happy >= 600 ? 'pos' : last.happy < 400 ? 'neg' : ''), kpi('Sur la période', signed(Math.round((last.happy - first.happy) / 10), fmt)));
    }
    const span = HIST_RANGE_DAYS[this.range];
    const note = !this.state ? 'Lecture de l’historique…'
      : `${this.range === 'tout' ? 'Toute la partie' : `${span} derniers jours`} · ${s.length} relevé(s)${this.state.longStep > 4 && this.range !== '3m' ? ` (un point tous les ${this.state.longStep} jours au-delà de 3 mois)` : ''}.`;
    return [
      ranges,
      el('div', { cls: 'chart-wrap' }, el('div', { cls: 'chart-title', text: titles[tab] }), el('canvas', { cls: 'chart hist', attrs: { id: 'stats-chart', height: '200', role: 'img', 'aria-label': titles[tab] } })),
      legend, kpis,
      el('p', { cls: 'muted small', text: note }),
    ];
  }

  /** Dessine le graphique de l'onglet dans `#stats-chart`. */
  draw(tab: HistTab, live: SimStats | null): void {
    drawHistory(document.getElementById('stats-chart') as HTMLCanvasElement | null, tab, this, live);
  }
}

export function drawHistory(c: HTMLCanvasElement | null, tab: HistTab, v: HistoryView, live: SimStats | null): void {
  if (!c) return;
  const s = v.samples(live);
  const months = v.state ? monthsFor(v.state, v.range) : [];
  const spec = seriesFor(tab, s, months);
  const today = live ? Math.floor(live.date.totalMinutes / 1440) : v.today;
  const span = HIST_RANGE_DAYS[v.range];
  const firstDay = Math.min(s[0]?.day ?? today, ...(spec.bars[0]?.bars.map((b) => b[0]) ?? []));
  const from = Number.isFinite(span) ? today - span : firstDay;
  drawTimeChart(c, {
    from: Math.min(from, today - 1), to: today + 1, series: [...spec.bars, ...spec.lines], leftUnit: spec.leftUnit, rightUnit: spec.rightUnit,
    ...(spec.leftRange ? { leftRange: spec.leftRange } : {}),
    empty: v.state ? 'Historique en cours de relevé (un point par jour de jeu)' : 'Lecture de l’historique…',
  });
}
