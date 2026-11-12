/**
 * Économie municipale : budget, coûts de construction, entretien mensuel (bâtiments, routes),
 * impôts par secteur (taux réglables), salaires des services publics, emprunts (taux,
 * mensualités, remboursement anticipé), faillite, prévisions et historique mensuel.
 *
 * Les ASSIETTES fiscales (revenus des ménages, bénéfices des entreprises) et l'effectif des
 * services sont fournis chaque mois par la démographie : aucune recette n'est inventée,
 * une ville sans habitants ne perçoit rien.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { ROAD_TYPES, type RoadTypeId } from '../shared/contracts';

export const DEMOLISH_REFUND_RATE = 0.25;

export const TAX_SECTORS = ['residential', 'commercial', 'industrial', 'office'] as const;
export type TaxSector = (typeof TAX_SECTORS)[number];
export const TAX_SECTOR_NAMES_FR: Record<TaxSector, string> = {
  residential: 'Résidentiel', commercial: 'Commerces', industrial: 'Industrie', office: 'Bureaux',
};
export const DEFAULT_TAX_RATE = 0.09;
export const MIN_TAX_RATE = 0;
export const MAX_TAX_RATE = 0.25;

/** Salaire mensuel moyen d'un agent public (crédits) et part prise en charge par la commune. */
export const SERVICE_WAGE = 2300;
export const MUNICIPAL_WAGE_SHARE = 0.06;

/** Emprunts. */
export const LOAN_MIN_AMOUNT = 10_000;
export const LOAN_MIN_MONTHS = 12;
export const LOAN_MAX_MONTHS = 240;
export const LOAN_BASE_RATE = 0.035;
export const LOAN_RATE_PER_ACTIVE_LOAN = 0.015;
export const LOAN_DEFICIT_PREMIUM = 0.02;
export const LOAN_BASE_CAPACITY = 1_000_000;
/** Mois de recettes fiscales moyennes ajoutés à la capacité d'emprunt. */
export const LOAN_CAPACITY_MONTHS_OF_INCOME = 36;
/** Nombre de bilans mensuels négatifs consécutifs (trésorerie < 0) avant la faillite. */
export const BANKRUPTCY_MONTHS = 3;
/** Taille maximale de l'historique conservé (mois). */
export const HISTORY_MAX_MONTHS = 240;

export interface Loan {
  id: number;
  principal: number;
  annualRate: number;
  months: number;
  monthsLeft: number;
  /** Capital restant dû. */
  remaining: number;
  monthlyPayment: number;
  takenAtMinute: number;
}

export interface ExpenseBreakdown {
  buildings: number;
  roads: number;
  salaries: number;
  loanInterest: number;
  loanPrincipal: number;
}

export interface MonthRecord {
  /** Index absolu du mois écoulé (0 = premier mois). */
  monthIndex: number;
  year: number;
  month: number;
  income: Record<TaxSector, number>;
  expenses: ExpenseBreakdown;
  /** Dépenses d'investissement du mois (constructions) et remboursements de démolition. */
  construction: number;
  refunds: number;
  loansTaken: number;
  /** Solde de fonctionnement : recettes - dépenses courantes (hors investissement). */
  balance: number;
  moneyEnd: number;
  population: number;
  jobs: number;
  unemploymentRate: number;
  happiness: number;
}

export interface Forecast {
  income: Record<TaxSector, number>;
  totalIncome: number;
  expenses: ExpenseBreakdown;
  totalExpenses: number;
  balance: number;
  /** Trésorerie projetée en fin de chacun des 12 prochains mois (état actuel inchangé). */
  projection: number[];
  /** Mois avant trésorerie négative selon la projection (-1 si jamais sur 12 mois). */
  monthsUntilNegative: number;
}

export interface LoanOffer {
  amount: number;
  months: number;
  annualRate: number;
  monthlyPayment: number;
  totalCost: number;
  capacityLeft: number;
}

/** Contexte démographique fourni à la clôture du mois. */
export interface MonthContext {
  monthIndex: number;
  population: number;
  jobs: number;
  unemploymentRate: number;
  happiness: number;
}

export interface EconomyJSON {
  money: number;
  taxRates: Record<TaxSector, number>;
  loans: Loan[];
  nextLoanId: number;
  history: MonthRecord[];
  monthsInDeficit: number;
  bankrupt: boolean;
  month: { construction: number; refunds: number; loansTaken: number };
}

const zeroSectors = (): Record<TaxSector, number> => ({ residential: 0, commercial: 0, industrial: 0, office: 0 });
const r2 = (v: number): number => Math.round(v * 100) / 100;

/** Mensualité constante d'un prêt amortissable. */
export function annuity(principal: number, annualRate: number, months: number): number {
  const r = annualRate / 12;
  if (r <= 0) return principal / months;
  return (principal * r) / (1 - Math.pow(1 + r, -months));
}

export class Economy {
  money = 0;
  buildingUpkeep = 0;
  roadUpkeep = 0;
  readonly taxRates: Record<TaxSector, number> = { residential: DEFAULT_TAX_RATE, commercial: DEFAULT_TAX_RATE, industrial: DEFAULT_TAX_RATE, office: DEFAULT_TAX_RATE };
  /** Assiettes fiscales mensuelles courantes (fournies par la démographie). */
  readonly taxBase: Record<TaxSector, number> = zeroSectors();
  /** Agents publics effectivement employés (fournis par la démographie). */
  serviceWorkers = 0;
  loans: Loan[] = [];
  nextLoanId = 1;
  history: MonthRecord[] = [];
  monthsInDeficit = 0;
  bankrupt = false;
  /** Cumuls du mois en cours. */
  private monthConstruction = 0;
  private monthRefunds = 0;
  private monthLoans = 0;

  reset(money: number): void {
    this.money = money;
    this.buildingUpkeep = 0;
    this.roadUpkeep = 0;
    for (const s of TAX_SECTORS) { this.taxRates[s] = DEFAULT_TAX_RATE; this.taxBase[s] = 0; }
    this.serviceWorkers = 0;
    this.loans = [];
    this.nextLoanId = 1;
    this.history = [];
    this.monthsInDeficit = 0;
    this.bankrupt = false;
    this.monthConstruction = 0;
    this.monthRefunds = 0;
    this.monthLoans = 0;
  }

  /** Entretien mensuel courant (bâtiments + routes). */
  get monthlyUpkeep(): number { return this.buildingUpkeep + this.roadUpkeep; }
  set monthlyUpkeep(v: number) { this.buildingUpkeep = v; this.roadUpkeep = 0; }

  /** Recettes fiscales prévues ce mois-ci. */
  get monthlyIncome(): number {
    let s = 0;
    for (const k of TAX_SECTORS) s += this.taxIncome(k);
    return s;
  }

  get monthlyBalance(): number { return this.forecastBalance(); }

  canAfford(cost: number): boolean { return !this.bankrupt && this.money >= cost; }
  spend(cost: number): void { this.money -= cost; this.monthConstruction += cost; }
  refund(amount: number): void { this.money += amount; this.monthRefunds += amount; }

  addUpkeep(v: number, kind: 'buildings' | 'roads' = 'buildings'): void {
    if (kind === 'roads') this.roadUpkeep += v; else this.buildingUpkeep += v;
  }
  removeUpkeep(v: number, kind: 'buildings' | 'roads' = 'buildings'): void {
    if (kind === 'roads') this.roadUpkeep = Math.max(0, this.roadUpkeep - v);
    else this.buildingUpkeep = Math.max(0, this.buildingUpkeep - v);
    if (this.roadUpkeep < 1e-6) this.roadUpkeep = 0;
    if (this.buildingUpkeep < 1e-6) this.buildingUpkeep = 0;
  }

  setTaxRate(sector: TaxSector, rate: number): number {
    const r = Math.min(MAX_TAX_RATE, Math.max(MIN_TAX_RATE, rate));
    this.taxRates[sector] = Math.round(r * 1000) / 1000;
    return this.taxRates[sector];
  }

  taxIncome(sector: TaxSector): number { return this.taxBase[sector] * this.taxRates[sector]; }

  salaries(): number { return this.serviceWorkers * SERVICE_WAGE * MUNICIPAL_WAGE_SHARE; }

  /** Intérêts et capital à payer ce mois-ci pour l'ensemble des emprunts. */
  loanDue(): { interest: number; principal: number } {
    let interest = 0, principal = 0;
    for (const l of this.loans) {
      const i = l.remaining * (l.annualRate / 12);
      const pay = Math.min(l.monthlyPayment, l.remaining + i);
      interest += i;
      principal += pay - i;
    }
    return { interest, principal };
  }

  private expenses(): ExpenseBreakdown {
    const due = this.loanDue();
    return { buildings: this.buildingUpkeep, roads: this.roadUpkeep, salaries: this.salaries(), loanInterest: due.interest, loanPrincipal: due.principal };
  }

  private forecastBalance(): number {
    const e = this.expenses();
    return this.monthlyIncome - (e.buildings + e.roads + e.salaries + e.loanInterest + e.loanPrincipal);
  }

  forecast(): Forecast {
    const income = zeroSectors();
    let totalIncome = 0;
    for (const s of TAX_SECTORS) { income[s] = r2(this.taxIncome(s)); totalIncome += this.taxIncome(s); }
    const e = this.expenses();
    const totalExpenses = e.buildings + e.roads + e.salaries + e.loanInterest + e.loanPrincipal;
    // Projection sur 12 mois avec amortissement réel des emprunts (copie locale).
    const loans = this.loans.map((l) => ({ ...l }));
    let money = this.money;
    const projection: number[] = [];
    let monthsUntilNegative = -1;
    for (let m = 0; m < 12; m++) {
      let loanPay = 0;
      for (const l of loans) {
        if (l.remaining <= 0) continue;
        const i = l.remaining * (l.annualRate / 12);
        const pay = Math.min(l.monthlyPayment, l.remaining + i);
        l.remaining -= pay - i;
        loanPay += pay;
      }
      money += totalIncome - (e.buildings + e.roads + e.salaries) - loanPay;
      projection.push(Math.round(money));
      if (money < 0 && monthsUntilNegative < 0) monthsUntilNegative = m + 1;
    }
    return {
      income, totalIncome: r2(totalIncome),
      expenses: { buildings: r2(e.buildings), roads: r2(e.roads), salaries: r2(e.salaries), loanInterest: r2(e.loanInterest), loanPrincipal: r2(e.loanPrincipal) },
      totalExpenses: r2(totalExpenses), balance: r2(totalIncome - totalExpenses), projection, monthsUntilNegative,
    };
  }

  /* ------------------------------ Emprunts ------------------------------ */

  debt(): number { let d = 0; for (const l of this.loans) d += l.remaining; return d; }

  /** Recettes fiscales moyennes des 3 derniers mois clos. */
  private averageIncome(): number {
    const last = this.history.slice(-3);
    if (!last.length) return 0;
    let s = 0;
    for (const h of last) for (const k of TAX_SECTORS) s += h.income[k];
    return s / last.length;
  }

  loanCapacity(): number {
    return Math.max(0, LOAN_BASE_CAPACITY + LOAN_CAPACITY_MONTHS_OF_INCOME * this.averageIncome() - this.debt());
  }

  currentLoanRate(): number {
    return LOAN_BASE_RATE + LOAN_RATE_PER_ACTIVE_LOAN * this.loans.length + (this.monthsInDeficit > 0 ? LOAN_DEFICIT_PREMIUM : 0);
  }

  loanOffer(amount: number, months: number): LoanOffer | { error: string } {
    if (this.bankrupt) return { error: 'Ville en faillite : aucune banque ne prête' };
    if (!Number.isFinite(amount) || amount < LOAN_MIN_AMOUNT) return { error: `Montant minimal : ${LOAN_MIN_AMOUNT} crédits` };
    if (!Number.isInteger(months) || months < LOAN_MIN_MONTHS || months > LOAN_MAX_MONTHS) return { error: `Durée entre ${LOAN_MIN_MONTHS} et ${LOAN_MAX_MONTHS} mois` };
    const cap = this.loanCapacity();
    if (amount > cap) return { error: `Capacité d'emprunt dépassée (${Math.floor(cap)} crédits disponibles)` };
    const annualRate = Math.round(this.currentLoanRate() * 10000) / 10000;
    const monthlyPayment = r2(annuity(amount, annualRate, months));
    return { amount, months, annualRate, monthlyPayment, totalCost: r2(monthlyPayment * months - amount), capacityLeft: Math.floor(cap - amount) };
  }

  takeLoan(amount: number, months: number, nowMinute: number): Loan | { error: string } {
    const o = this.loanOffer(amount, months);
    if ('error' in o) return o;
    const loan: Loan = {
      id: this.nextLoanId++, principal: amount, annualRate: o.annualRate, months, monthsLeft: months,
      remaining: amount, monthlyPayment: o.monthlyPayment, takenAtMinute: nowMinute,
    };
    this.loans.push(loan);
    this.money += amount;
    this.monthLoans += amount;
    return loan;
  }

  /** Remboursement anticipé intégral (capital restant dû, sans pénalité). */
  repayLoan(id: number): { paid: number } | { error: string } {
    const k = this.loans.findIndex((l) => l.id === id);
    if (k < 0) return { error: 'Emprunt introuvable' };
    const l = this.loans[k]!;
    const paid = r2(l.remaining);
    if (this.money < paid) return { error: `Fonds insuffisants pour rembourser (${Math.ceil(paid)} crédits requis)` };
    this.money -= paid;
    this.loans.splice(k, 1);
    return { paid };
  }

  /* --------------------------- Clôture du mois --------------------------- */

  /**
   * Appelé au changement de mois : encaisse les impôts, paie l'entretien, les salaires et
   * les échéances d'emprunt, enregistre le bilan et met à jour l'état de faillite.
   */
  onMonth(ctx?: MonthContext): MonthRecord {
    const income = zeroSectors();
    let totalIncome = 0;
    for (const s of TAX_SECTORS) { income[s] = r2(this.taxIncome(s)); totalIncome += this.taxIncome(s); }
    const salaries = this.salaries();
    let interest = 0, principal = 0;
    for (const l of this.loans) {
      const i = l.remaining * (l.annualRate / 12);
      const pay = Math.min(l.monthlyPayment, l.remaining + i);
      interest += i;
      principal += pay - i;
      l.remaining = Math.max(0, l.remaining - (pay - i));
      l.monthsLeft--;
    }
    this.loans = this.loans.filter((l) => l.remaining > 0.005 && l.monthsLeft > 0);
    const expenses = this.buildingUpkeep + this.roadUpkeep + salaries + interest + principal;
    this.money += totalIncome - expenses;

    if (this.money < 0) {
      this.monthsInDeficit++;
      if (this.monthsInDeficit >= BANKRUPTCY_MONTHS) this.bankrupt = true;
    } else {
      this.monthsInDeficit = 0;
      this.bankrupt = false;
    }
    const mi = ctx?.monthIndex ?? this.history.length;
    const rec: MonthRecord = {
      monthIndex: mi, year: 1 + Math.floor(mi / 12), month: 1 + (mi % 12),
      income,
      expenses: { buildings: r2(this.buildingUpkeep), roads: r2(this.roadUpkeep), salaries: r2(salaries), loanInterest: r2(interest), loanPrincipal: r2(principal) },
      construction: r2(this.monthConstruction), refunds: r2(this.monthRefunds), loansTaken: r2(this.monthLoans),
      balance: r2(totalIncome - expenses), moneyEnd: Math.round(this.money),
      population: ctx?.population ?? 0, jobs: ctx?.jobs ?? 0,
      unemploymentRate: ctx?.unemploymentRate ?? 0, happiness: ctx?.happiness ?? 0,
    };
    this.history.push(rec);
    if (this.history.length > HISTORY_MAX_MONTHS) this.history.splice(0, this.history.length - HISTORY_MAX_MONTHS);
    this.monthConstruction = 0;
    this.monthRefunds = 0;
    this.monthLoans = 0;
    return rec;
  }

  toJSON(): EconomyJSON {
    return {
      money: this.money, taxRates: { ...this.taxRates }, loans: this.loans.map((l) => ({ ...l })), nextLoanId: this.nextLoanId,
      history: this.history.map((h) => ({ ...h, income: { ...h.income }, expenses: { ...h.expenses } })),
      monthsInDeficit: this.monthsInDeficit, bankrupt: this.bankrupt,
      month: { construction: this.monthConstruction, refunds: this.monthRefunds, loansTaken: this.monthLoans },
    };
  }

  /** Restaure l'état financier (l'entretien est recalculé par le monde à partir des bâtiments et routes). */
  fromJSON(j: EconomyJSON): void {
    this.money = j.money;
    for (const s of TAX_SECTORS) this.setTaxRate(s, j.taxRates[s] ?? DEFAULT_TAX_RATE);
    this.loans = j.loans.map((l) => ({ ...l }));
    this.nextLoanId = j.nextLoanId;
    this.history = j.history.map((h) => ({ ...h, income: { ...h.income }, expenses: { ...h.expenses } }));
    this.monthsInDeficit = j.monthsInDeficit;
    this.bankrupt = j.bankrupt;
    this.monthConstruction = j.month.construction;
    this.monthRefunds = j.month.refunds;
    this.monthLoans = j.month.loansTaken;
  }
}

export function roadCost(type: RoadTypeId, length: number): number {
  return Math.round(ROAD_TYPES[type].costPerMeter * length);
}

export function roadUpkeep(type: RoadTypeId, length: number): number {
  return ROAD_TYPES[type].upkeepPerMeterMonth * length;
}
