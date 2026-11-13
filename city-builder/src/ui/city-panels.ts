/**
 * Panneaux « ville » branchés sur le RAPPORT de la simulation (≈ 1 fois/s, joint aux deltas) :
 *  - Finances : recettes fiscales par secteur, salaires, échéances d'emprunt ; réglage des impôts
 *    (commande setTaxRate) ; emprunts (loanOffer / takeLoan / repayLoan) ;
 *  - Population : habitants, ménages, emploi et chômage, trajets en cours, logements, bonheur,
 *    demande par secteur, activités, pyramide des âges.
 * Toutes les valeurs affichées viennent de la simulation (aucun chiffre inventé côté interface).
 * Propriétaire : agent construction/caméra/UI.
 */
import type { SimReport } from '../sim/sim-protocol';
import type { ExtCommandArgs, ExtCommandName, ExtCommandResult } from '../sim/sim-protocol';
import { $, el, fmt, money } from './dom';

export interface ExtPort {
  sendExt<K extends ExtCommandName>(name: K, args: ExtCommandArgs<K>): Promise<ExtCommandResult<K>>;
}

type Sector = 'residential' | 'commercial' | 'industrial' | 'office';
const SECTORS: readonly Sector[] = ['residential', 'commercial', 'industrial', 'office'];
const SECTOR_FR: Record<Sector, string> = { residential: 'Résidentiel', commercial: 'Commerces', industrial: 'Industrie', office: 'Bureaux' };

const pct = (v: number, d = 0): string => `${(v * 100).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d })} %`;
const errMsg = (e: unknown): string => (e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e));

function barRow(label: string, value: number, max: number, text: string, mode: 'plain' | 'signed' = 'plain'): HTMLElement {
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
  return el('div', { cls: 'bar-row' }, el('span', { text: label }), track, el('span', { cls: 'v', text }));
}

export class CityPanels {
  report: SimReport | null = null;
  private port: ExtPort | null = null;
  private readonly finPanel = $('finance-panel');
  private readonly popPanel = $('pop-panel');
  private readonly taxSec = $('fin-tax-sec');
  private readonly loanSec = $('fin-loan-sec');
  private readonly taxInputs = new Map<Sector, { input: HTMLInputElement; rate: HTMLElement; inc: HTMLElement }>();
  private offerSeq = 0;
  private dragging = false;

  constructor(private readonly toast: (t: string, k?: 'info' | 'error' | 'ok') => void) {
    // Impôts : un curseur par secteur.
    const body = $('fin-tax-body');
    for (const s of SECTORS) {
      const input = el('input', { attrs: { type: 'range', min: '0', max: '25', step: '0.5', value: '9', 'aria-label': `Taux ${SECTOR_FR[s]}` } }) as HTMLInputElement;
      const rate = el('span', { cls: 'rate', text: '9 %' });
      const inc = el('span', { cls: 'inc', text: '' });
      input.addEventListener('input', () => { this.dragging = true; rate.textContent = pct(Number(input.value) / 100, 1); });
      input.addEventListener('change', () => { this.dragging = false; void this.setTax(s, Number(input.value) / 100); });
      body.append(el('span', { text: SECTOR_FR[s] }), input, rate, inc);
      this.taxInputs.set(s, { input, rate, inc });
    }
    const toggle = (btn: HTMLElement, sec: HTMLElement, other: HTMLElement, otherBtn: HTMLElement): void => {
      const open = sec.classList.toggle('hidden') === false;
      btn.setAttribute('aria-expanded', String(open));
      btn.classList.toggle('active', open);
      if (open) { other.classList.add('hidden'); otherBtn.setAttribute('aria-expanded', 'false'); otherBtn.classList.remove('active'); sec.scrollIntoView({ block: 'nearest' }); }
      this.render();
    };
    const bt = $('btn-fin-tax'), bl = $('btn-fin-loan');
    bt.addEventListener('click', () => toggle(bt, this.taxSec, this.loanSec, bl));
    bl.addEventListener('click', () => { toggle(bl, this.loanSec, this.taxSec, bt); void this.refreshOffer(); });
    // Emprunts.
    const amount = $<HTMLInputElement>('loan-amount');
    const months = $<HTMLSelectElement>('loan-months');
    amount.addEventListener('input', () => void this.refreshOffer());
    months.addEventListener('change', () => void this.refreshOffer());
    $<HTMLFormElement>('form-loan').addEventListener('submit', (e) => { e.preventDefault(); void this.takeLoan(); });
    // Population.
    $('hud-pop-btn').addEventListener('click', () => this.togglePop());
    $('pop-close').addEventListener('click', () => this.popPanel.classList.add('hidden'));
    $('pop-fold').addEventListener('click', () => this.popPanel.classList.toggle('folded'));
  }

  setPort(p: ExtPort | null): void { this.port = p; }

  togglePop(): void {
    const open = this.popPanel.classList.toggle('hidden') === false;
    if (open) { this.finPanel.classList.add('hidden'); this.renderPop(); }
  }

  /** Appelé à chaque rapport de la simulation. */
  update(r: SimReport): void {
    this.report = r;
    this.render();
  }

  reset(): void { this.report = null; }

  render(): void {
    if (!this.finPanel.classList.contains('hidden')) this.renderFinance();
    if (!this.popPanel.classList.contains('hidden')) this.renderPop();
  }

  private renderFinance(): void {
    const r = this.report;
    if (!r) return;
    const e = r.economy;
    const f = e.forecast;
    $('fin-income').textContent = `+${money(f.totalIncome)} / mois`;
    $('fin-salaries').textContent = `−${money(f.expenses.salaries)} / mois`;
    const due = f.expenses.loanInterest + f.expenses.loanPrincipal;
    $('fin-loandue').textContent = due > 0 ? `−${money(due)} / mois` : '—';
    $('fin-pop').textContent = `${fmt(r.demography.population)} · chômage ${pct(r.demography.unemploymentRate, 1)}`;
    if (!this.taxSec.classList.contains('hidden')) {
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
    if (!this.loanSec.classList.contains('hidden')) this.renderLoans();
  }

  private renderLoans(): void {
    const e = this.report!.economy;
    $('fin-loan-cap').textContent = `(capacité restante ${money(e.loanCapacity)} · taux actuel ${pct(e.currentLoanRate, 1)} · dette ${money(e.debt)})`;
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

  private renderPop(): void {
    const r = this.report;
    if (!r) return;
    const d = r.demography;
    $('pop-total').textContent = fmt(d.population);
    $('pop-sub').textContent = `${fmt(d.households)} ménages · ${fmt(d.children)} enfants · ${fmt(d.adults)} adultes · ${fmt(d.seniors)} seniors`;
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
    const dl = $('pop-rows');
    dl.replaceChildren(...rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })]));
    const dem = $('pop-demand');
    dem.replaceChildren(...SECTORS.map((s) => barRow(SECTOR_FR[s], d.demand[s], 1, d.demand[s].toLocaleString('fr-FR', { maximumFractionDigits: 2, signDisplay: 'always' }), 'signed')));
    const acts = Object.entries(d.activities).filter(([k]) => k !== 'Non suivi').sort((a, b) => b[1] - a[1]);
    const total = acts.reduce((s, [, v]) => s + v, 0);
    $('pop-acts').replaceChildren(...(acts.length ? acts.map(([k, v]) => barRow(k, v, total, fmt(v))) : [el('span', { cls: 'muted', text: 'Aucun habitant pour l\'instant : construisez des logements desservis par une route.' })]));
    const maxBand = Math.max(1, ...d.ageBands);
    $('pop-ages').replaceChildren(...d.ageBands.map((v, i) => barRow(i === d.ageBands.length - 1 ? `${i * 10} ans et +` : `${i * 10}-${i * 10 + 9} ans`, v, maxBand, fmt(v))));
  }

  private async setTax(s: Sector, rate: number): Promise<void> {
    if (!this.port) return;
    try {
      const r = await this.port.sendExt('setTaxRate', { sector: s, rate });
      if (this.report) this.report.economy.taxRates[r.sector] = r.rate;
      this.toast(`Impôt ${SECTOR_FR[s].toLowerCase()} : ${pct(r.rate, 1)}`, 'ok');
      // Rafraîchit la prévision immédiatement.
      const rep = await this.port.sendExt('getReport', {});
      this.update(rep);
    } catch (e) { this.toast(`Impôts : ${errMsg(e)}`, 'error'); }
  }

  private loanArgs(): { amount: number; months: number } {
    return { amount: Math.round(Number($<HTMLInputElement>('loan-amount').value) || 0), months: Number($<HTMLSelectElement>('loan-months').value) || 60 };
  }

  private async refreshOffer(): Promise<void> {
    if (!this.port || this.loanSec.classList.contains('hidden')) return;
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
      this.toast(`Emprunt de ${money(r.loan.principal)} accordé (${money(r.loan.monthlyPayment)}/mois)`, 'ok');
      this.update(await this.port.sendExt('getReport', {}));
      void this.refreshOffer();
    } catch (e) { this.toast(`Emprunt refusé : ${errMsg(e)}`, 'error'); }
  }

  private async repay(loanId: number): Promise<void> {
    if (!this.port) return;
    try {
      const r = await this.port.sendExt('repayLoan', { loanId });
      this.toast(`Emprunt remboursé (${money(r.paid)})`, 'ok');
      this.update(await this.port.sendExt('getReport', {}));
    } catch (e) { this.toast(`Remboursement impossible : ${errMsg(e)}`, 'error'); }
  }
}
