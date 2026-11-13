/**
 * Panneaux « ville » à onglets branchés sur le RAPPORT de la simulation (≈ 1 fois/s, joint aux deltas) :
 *  - Finances municipales : Aperçu (recettes / dépenses ventilées, solde, graphique des 12 derniers mois
 *    clos), Impôts (setTaxRate), Budget (postes de dépense, projection 12 mois, trésorerie journalière),
 *    Dette (loanOffer / takeLoan / repayLoan) ;
 *  - Population : Aperçu, Demande (+ éducation), Activités, Âges.
 * Toutes les valeurs affichées viennent de la simulation (aucun chiffre inventé côté interface).
 * Propriétaire : agent construction/caméra/UI.
 */
import type { SimReport } from '../sim/sim-protocol';
import type { ExtCommandArgs, ExtCommandName, ExtCommandResult } from '../sim/sim-protocol';
import type { SimStats } from '../shared/contracts';
import { drawChart, MONTHS_SHORT } from './charts';
import { $, el, fmt, money, moneyShort, pct, signedMoney } from './dom';
import { FinanceChart, type FinanceHistory } from './finance';
import { iconEl } from './icons';

export interface ExtPort {
  sendExt<K extends ExtCommandName>(name: K, args: ExtCommandArgs<K>): Promise<ExtCommandResult<K>>;
}

type Sector = 'residential' | 'commercial' | 'industrial' | 'office';
const SECTORS: readonly Sector[] = ['residential', 'commercial', 'industrial', 'office'];
const SECTOR_FR: Record<Sector, string> = { residential: 'Résidentiel', commercial: 'Commerces', industrial: 'Industrie', office: 'Bureaux' };
const INCOME_FR: Record<Sector, string> = { residential: 'Impôts résidentiels', commercial: 'Impôts commerciaux', industrial: 'Impôts industriels', office: 'Impôts des bureaux' };
const INCOME_ICON: Record<Sector, string> = { residential: 'house', commercial: 'shop', industrial: 'factory', office: 'office' };
const EXPENSES: readonly { key: 'buildings' | 'roads' | 'salaries' | 'loanInterest' | 'loanPrincipal'; label: string; icon: string }[] = [
  { key: 'buildings', label: 'Entretien des bâtiments', icon: 'building' },
  { key: 'roads', label: 'Entretien des routes', icon: 'road' },
  { key: 'salaries', label: 'Salaires des services', icon: 'services' },
  { key: 'loanInterest', label: 'Intérêts des emprunts', icon: 'finance' },
  { key: 'loanPrincipal', label: 'Remboursement du capital', icon: 'cash' },
];

const errMsg = (e: unknown): string => (e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e));

export function barRow(label: string, value: number, max: number, text: string, mode: 'plain' | 'signed' = 'plain'): HTMLElement {
  const track = el('div', { cls: `track${mode === 'signed' ? ' center' : ''}` });
  const fill = el('div', { cls: 'fill' });
  if (mode === 'signed') {
    const v = Math.max(-1, Math.min(1, value));
    fill.classList.add(v < 0 ? 'neg' : 'pos');
    fill.style.left = `${v < 0 ? 50 + v * 50 : 50}%`;
    fill.style.width = `${Math.abs(v) * 50}%`;
  } else {
    fill.style.left = '0';
    fill.style.width = `${max > 0 ? Math.min(100, (value / max) * 100) : 0}%`;
  }
  track.append(fill);
  return el('div', { cls: 'bar-row' }, el('span', { cls: 'k', text: label }), track, el('span', { cls: 'v', text }));
}

/** Onglets d'un panneau : boutons `[data-<attr>]` et pages `[data-<page>]`. */
export function wireTabs(panel: HTMLElement, attr: string, page: string, onChange: (id: string) => void): (id: string) => void {
  const btns = Array.from(panel.querySelectorAll<HTMLButtonElement>(`[data-${attr}]`));
  const pages = Array.from(panel.querySelectorAll<HTMLElement>(`[data-${page}]`));
  const select = (id: string): void => {
    for (const b of btns) {
      const on = b.getAttribute(`data-${attr}`) === id;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
      if (b.hasAttribute('aria-expanded')) b.setAttribute('aria-expanded', String(on));
    }
    for (const p of pages) p.classList.toggle('hidden', p.getAttribute(`data-${page}`) !== id);
    onChange(id);
  };
  for (const b of btns) b.addEventListener('click', () => select(b.getAttribute(`data-${attr}`) ?? ''));
  return select;
}

export interface CityPanelsDeps {
  toast: (t: string, k?: 'info' | 'error' | 'ok') => void;
  stats: () => SimStats | null;
  counts: () => { buildings: number; roadM: number } | null;
  history: FinanceHistory;
  /** Un panneau s'ouvre : les autres panneaux de droite se ferment. */
  opened: (id: string) => void;
}

export class CityPanels {
  report: SimReport | null = null;
  private port: ExtPort | null = null;
  readonly finPanel = $('finance-panel');
  readonly popPanel = $('pop-panel');
  private readonly taxInputs = new Map<Sector, { input: HTMLInputElement; rate: HTMLElement; inc: HTMLElement }>();
  private offerSeq = 0;
  private dragging = false;
  private finTab = 'overview';
  private popTab = 'overview';
  readonly selectFinTab: (id: string) => void;
  readonly selectPopTab: (id: string) => void;
  private readonly daily: FinanceChart;

  constructor(private readonly d: CityPanelsDeps) {
    this.daily = new FinanceChart($<HTMLCanvasElement>('fin-chart'), $('fin-tip'), d.history);
    // Impôts : un curseur par secteur.
    const body = $('fin-tax-body');
    for (const s of SECTORS) {
      const input = el('input', { attrs: { type: 'range', min: '0', max: '25', step: '0.5', value: '9', 'aria-label': `Taux ${SECTOR_FR[s]}` } }) as HTMLInputElement;
      const rate = el('span', { cls: 'rate', text: '9 %' });
      const inc = el('span', { cls: 'inc', text: '' });
      input.addEventListener('input', () => { this.dragging = true; rate.textContent = pct(Number(input.value) / 100, 1); });
      input.addEventListener('change', () => { this.dragging = false; void this.setTax(s, Number(input.value) / 100); });
      body.append(el('span', { cls: 'sec', text: SECTOR_FR[s] }), input, rate, inc);
      this.taxInputs.set(s, { input, rate, inc });
    }
    this.selectFinTab = wireTabs(this.finPanel, 'ftab', 'fpage', (id) => { this.finTab = id; if (id === 'debt') void this.refreshOffer(); this.renderFinance(); });
    this.selectPopTab = wireTabs(this.popPanel, 'ptab', 'ppage', (id) => { this.popTab = id; this.renderPop(); });
    // Emprunts.
    const amount = $<HTMLInputElement>('loan-amount');
    const months = $<HTMLSelectElement>('loan-months');
    amount.addEventListener('input', () => void this.refreshOffer());
    months.addEventListener('change', () => void this.refreshOffer());
    $<HTMLFormElement>('form-loan').addEventListener('submit', (e) => { e.preventDefault(); void this.takeLoan(); });
    $('finance-close').addEventListener('click', () => this.finPanel.classList.add('hidden'));
    $('finance-fold').addEventListener('click', () => this.finPanel.classList.toggle('folded'));
    $('pop-close').addEventListener('click', () => this.popPanel.classList.add('hidden'));
    $('pop-fold').addEventListener('click', () => this.popPanel.classList.toggle('folded'));
    window.addEventListener('resize', () => this.render());
  }

  setPort(p: ExtPort | null): void { this.port = p; }

  get financeOpen(): boolean { return !this.finPanel.classList.contains('hidden'); }
  get popOpen(): boolean { return !this.popPanel.classList.contains('hidden'); }

  openFinance(tab?: string): void {
    this.d.opened('finance');
    this.finPanel.classList.remove('hidden', 'folded');
    if (tab) this.selectFinTab(tab); else this.renderFinance();
  }
  toggleFinance(): void { if (this.financeOpen) this.finPanel.classList.add('hidden'); else this.openFinance(); }
  openPop(tab?: string): void {
    this.d.opened('population');
    this.popPanel.classList.remove('hidden', 'folded');
    if (tab) this.selectPopTab(tab); else this.renderPop();
  }
  togglePop(): void { if (this.popOpen) this.popPanel.classList.add('hidden'); else this.openPop(); }

  /** Appelé à chaque rapport de la simulation. */
  update(r: SimReport): void {
    this.report = r;
    this.render();
  }

  reset(): void { this.report = null; }

  render(): void {
    if (this.financeOpen) this.renderFinance();
    if (this.popOpen) this.renderPop();
  }

  /* ------------------------------ Finances ------------------------------ */

  renderFinance(): void {
    if (!this.financeOpen) return;
    const s = this.d.stats();
    if (s) {
      $('fin-money').textContent = moneyShort(s.money);
      $('fin-money').classList.toggle('neg', s.money < 0);
    }
    const r = this.report;
    const bal = $('fin-balance');
    const balance = r ? r.economy.forecast.balance : s?.monthlyBalance;
    if (balance !== undefined) { bal.textContent = signedMoney(balance); bal.className = balance < 0 ? 'neg' : 'pos'; }
    if (this.finTab === 'overview') this.renderOverview();
    else if (this.finTab === 'tax') this.renderTax();
    else if (this.finTab === 'budget') this.renderBudget();
    else this.renderLoans();
  }

  private ledgerRow(icon: string, label: string, value: string, cls: string): HTMLElement[] {
    return [el('dt', {}, iconEl(icon), el('span', { text: label })), el('dd', { cls, text: value })];
  }

  private renderOverview(): void {
    const r = this.report;
    if (!r) return;
    const f = r.economy.forecast;
    $('fin-income').textContent = `+${money(f.totalIncome)}`;
    $('fin-inc-rows').replaceChildren(...SECTORS.flatMap((s) => this.ledgerRow(INCOME_ICON[s], INCOME_FR[s], money(f.income[s] ?? 0), '')));
    $('fin-expense').textContent = f.totalExpenses > 0 ? `−${money(f.totalExpenses)}` : money(0);
    $('fin-exp-rows').replaceChildren(...EXPENSES.flatMap((x) => this.ledgerRow(x.icon, x.label, f.expenses[x.key] > 0 ? `−${money(f.expenses[x.key])}` : money(0), '')));
    const net = $('fin-net');
    net.textContent = signedMoney(f.balance);
    net.parentElement?.classList.toggle('neg', f.balance < 0);
    const hist = r.economy.history.slice(-12);
    $('fin-mrange').textContent = hist.length ? `${MONTHS_SHORT[hist[0]!.month - 1]} an ${hist[0]!.year} → ${MONTHS_SHORT[hist[hist.length - 1]!.month - 1]} an ${hist[hist.length - 1]!.year}` : '';
    drawChart($<HTMLCanvasElement>('fin-month-chart'), {
      labels: hist.map((m) => MONTHS_SHORT[m.month - 1] ?? ''),
      series: [
        { kind: 'bar', axis: 'left', name: 'Solde', values: hist.map((m) => m.balance), color: '#3ddc84', negColor: '#ff6b6b' },
        { kind: 'line', axis: 'right', name: 'Trésorerie', values: hist.map((m) => m.moneyEnd), color: '#7cc4ff' },
      ],
      leftUnit: 'CHF', rightUnit: 'CHF',
      empty: 'Premier mois en cours : le graphique se remplit à chaque clôture de mois.',
    });
  }

  private renderTax(): void {
    const r = this.report;
    if (!r) return;
    const e = r.economy; const f = e.forecast;
    $('fin-income').textContent = `+${money(f.totalIncome)}`;
    for (const s of SECTORS) {
      const t = this.taxInputs.get(s)!;
      const rate = e.taxRates[s] ?? 0;
      if (!this.dragging && document.activeElement !== t.input) {
        t.input.value = String(Math.round(rate * 1000) / 10);
        t.rate.textContent = pct(rate, 1);
      }
      t.inc.textContent = `recettes prévues : +${money(f.income[s] ?? 0)} / mois`;
    }
  }

  private renderBudget(): void {
    const s = this.d.stats();
    const c = this.d.counts();
    if (c) $('fin-counts').textContent = `${fmt(c.buildings)} · ${fmt(c.roadM)} m`;
    else if (s) $('fin-counts').textContent = `${fmt(s.buildings)} · ${fmt(s.roadLengthM)} m`;
    if (s) $('fin-pop').textContent = fmt(s.population);
    $('fin-range').textContent = this.d.history.points.length ? `· ${this.d.history.points.length} jour${this.d.history.points.length > 1 ? 's' : ''} relevé${this.d.history.points.length > 1 ? 's' : ''}` : '';
    this.daily.draw();
    const r = this.report;
    if (!r) return;
    const f = r.economy.forecast;
    const max = Math.max(1, ...EXPENSES.map((x) => f.expenses[x.key]));
    $('fin-budget-bars').replaceChildren(...EXPENSES.map((x) => barRow(x.label, f.expenses[x.key], max, money(f.expenses[x.key]))));
    if (r.demography) $('fin-pop').textContent = `${fmt(r.demography.population)} · chômage ${pct(r.demography.unemploymentRate, 1)}`;
    const last = r.economy.history[r.economy.history.length - 1];
    const lm = $('fin-lastmonth');
    if (last) {
      const inc = SECTORS.reduce((a, k) => a + (last.income[k] ?? 0), 0);
      const exp = last.expenses.buildings + last.expenses.roads + last.expenses.salaries + last.expenses.loanInterest + last.expenses.loanPrincipal;
      lm.replaceChildren(el('div', { cls: 'sec-title', text: `Dernier mois clos : ${MONTHS_SHORT[last.month - 1]} an ${last.year}` }), el('dl', { cls: 'rows' },
        el('dt', { text: 'Recettes' }), el('dd', { cls: 'pos', text: signedMoney(inc) }),
        el('dt', { text: 'Dépenses courantes' }), el('dd', { cls: 'neg', text: signedMoney(-exp) }),
        el('dt', { text: 'Constructions (investissement)' }), el('dd', { text: signedMoney(-last.construction) }),
        el('dt', { text: 'Remboursements de démolition' }), el('dd', { text: signedMoney(last.refunds) }),
        el('dt', { text: 'Emprunts reçus' }), el('dd', { text: signedMoney(last.loansTaken) }),
        el('dt', { text: 'Trésorerie en fin de mois' }), el('dd', { text: money(last.moneyEnd) })));
    } else lm.replaceChildren(el('p', { cls: 'muted small', text: 'Aucun mois clos pour l’instant : le bilan détaillé apparaît le 1er du mois suivant.' }));
    const d = r.date;
    drawChart($<HTMLCanvasElement>('fin-proj-chart'), {
      labels: f.projection.map((_, i) => MONTHS_SHORT[(d.month - 1 + i) % 12] ?? ''),
      series: [{ kind: 'line', axis: 'left', name: 'Projection', values: f.projection, color: '#3ddc84' }],
      leftUnit: 'CHF',
      empty: 'Projection indisponible',
    });
  }

  private renderLoans(): void {
    const r = this.report;
    if (!r) return;
    const e = r.economy;
    $('fin-debt').textContent = moneyShort(e.debt);
    $('fin-capacity').textContent = moneyShort(e.loanCapacity);
    $('fin-loan-cap').textContent = `(taux actuel ${pct(e.currentLoanRate, 1)})`;
    const ul = $('loan-list');
    ul.replaceChildren();
    if (!e.loans.length) { ul.append(el('li', { cls: 'muted', text: 'Aucun emprunt en cours.' })); return; }
    for (const l of e.loans) {
      const btn = el('button', { text: `Rembourser ${money(l.remaining)}` });
      btn.dataset['tip'] = 'Remboursement anticipé du capital restant dû';
      btn.addEventListener('click', () => void this.repay(l.id));
      ul.append(el('li', {}, el('span', { text: `${money(l.principal)} à ${pct(l.annualRate, 1)} · ${money(l.monthlyPayment)}/mois · ${l.monthsLeft} mois restants` }), btn));
    }
  }

  /* ------------------------------ Population ------------------------------ */

  renderPop(): void {
    const r = this.report;
    if (!r || !this.popOpen) return;
    const d = r.demography;
    $('pop-total').textContent = fmt(d.population);
    $('pop-happy').textContent = d.population > 0 ? `${fmt(Math.round(d.happiness))} %` : '—';
    $('pop-sub').textContent = `${fmt(d.households)} ménages · ${fmt(d.children)} enfants · ${fmt(d.adults)} adultes · ${fmt(d.seniors)} seniors`;
    if (this.popTab === 'overview') {
      const commuting = (d.activities['Trajet aller'] ?? 0) + (d.activities['Trajet retour'] ?? 0);
      const rows: [string, string][] = [
        ['Actifs', fmt(d.laborForce)],
        ['En emploi', fmt(d.employed)],
        ['Chômeurs', `${fmt(d.unemployed)} (${pct(d.unemploymentRate, 1)})`],
        ['Emplois pourvus / offerts', `${fmt(d.jobsFilled)} / ${fmt(d.jobsTotal)}`],
        ['Élèves · retraités', `${fmt(d.pupils)} · ${fmt(d.retirees)}`],
        ['En trajet maintenant', fmt(commuting)],
        ['Trajets émis vers le trafic', fmt(d.tripsEmitted)],
        ['Véhicules en circulation', `${fmt(r.traffic.vehicles)} (${fmt(Math.round(r.traffic.meanSpeedKmh))} km/h moy.)`],
        ['Logements libres / capacité', `${fmt(d.housingFree)} / ${fmt(d.housingCapacity)}`],
        ['Bonheur', `${fmt(Math.round(d.happiness))} / 100`],
        ['Attractivité', pct(d.attractiveness)],
        ['Revenu moyen', `${money(d.averageIncome)} / mois`],
        ['Ce mois : arrivées · départs', `${fmt(d.month.immigrants)} · ${fmt(d.month.emigrants)}`],
        ['Ce mois : naissances · décès', `${fmt(d.month.births)} · ${fmt(d.month.deaths)}`],
        ['Entreprises', fmt(d.companies)],
      ];
      $('pop-rows').replaceChildren(...rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })]));
    } else if (this.popTab === 'demand') {
      $('pop-demand').replaceChildren(...SECTORS.map((s) => barRow(SECTOR_FR[s], d.demand[s], 1, d.demand[s].toLocaleString('fr-FR', { maximumFractionDigits: 2, signDisplay: 'always' }), 'signed')));
      const maxE = Math.max(1, ...d.education);
      $('pop-edu').replaceChildren(...d.education.map((v, i) => barRow(d.educationNames[i] ?? `Niveau ${i}`, v, maxE, fmt(v))));
    } else if (this.popTab === 'acts') {
      const acts = Object.entries(d.activities).filter(([k]) => k !== 'Non suivi').sort((a, b) => b[1] - a[1]);
      const total = acts.reduce((s, [, v]) => s + v, 0);
      $('pop-acts').replaceChildren(...(acts.length ? acts.map(([k, v]) => barRow(k, v, total, fmt(v))) : [el('span', { cls: 'muted', text: 'Aucun habitant pour l\'instant : construisez des logements desservis par une route.' })]));
    } else {
      const maxBand = Math.max(1, ...d.ageBands);
      $('pop-ages').replaceChildren(...d.ageBands.map((v, i) => barRow(i === d.ageBands.length - 1 ? `${i * 10} ans et +` : `${i * 10}-${i * 10 + 9} ans`, v, maxBand, fmt(v))));
    }
  }

  /* ------------------------------ Commandes ------------------------------ */

  private async setTax(s: Sector, rate: number): Promise<void> {
    if (!this.port) return;
    try {
      const r = await this.port.sendExt('setTaxRate', { sector: s, rate });
      if (this.report) this.report.economy.taxRates[r.sector] = r.rate;
      this.d.toast(`Impôt ${SECTOR_FR[s].toLowerCase()} : ${pct(r.rate, 1)}`, 'ok');
      // Rafraîchit la prévision immédiatement.
      const rep = await this.port.sendExt('getReport', {});
      this.update(rep);
    } catch (e) { this.d.toast(`Impôts : ${errMsg(e)}`, 'error'); }
  }

  private loanArgs(): { amount: number; months: number } {
    return { amount: Math.round(Number($<HTMLInputElement>('loan-amount').value) || 0), months: Number($<HTMLSelectElement>('loan-months').value) || 60 };
  }

  private async refreshOffer(): Promise<void> {
    if (!this.port || this.finTab !== 'debt') return;
    const seq = ++this.offerSeq;
    const out = $('loan-offer');
    try {
      const o = await this.port.sendExt('loanOffer', this.loanArgs());
      if (seq !== this.offerSeq) return;
      out.textContent = `Taux ${pct(o.annualRate, 2)} · mensualité ${money(o.monthlyPayment)} · coût total ${money(o.totalCost)}`;
      out.classList.remove('neg');
    } catch (e) {
      if (seq !== this.offerSeq) return;
      out.textContent = errMsg(e);
      out.classList.add('neg');
    }
  }

  private async takeLoan(): Promise<void> {
    if (!this.port) return;
    try {
      const r = await this.port.sendExt('takeLoan', this.loanArgs());
      this.d.toast(`Emprunt de ${money(r.loan.principal)} accordé (${money(r.loan.monthlyPayment)}/mois)`, 'ok');
      this.update(await this.port.sendExt('getReport', {}));
      void this.refreshOffer();
    } catch (e) { this.d.toast(`Emprunt refusé : ${errMsg(e)}`, 'error'); }
  }

  private async repay(loanId: number): Promise<void> {
    if (!this.port) return;
    try {
      const r = await this.port.sendExt('repayLoan', { loanId });
      this.d.toast(`Emprunt remboursé (${money(r.paid)})`, 'ok');
      this.update(await this.port.sendExt('getReport', {}));
    } catch (e) { this.d.toast(`Remboursement impossible : ${errMsg(e)}`, 'error'); }
  }
}
