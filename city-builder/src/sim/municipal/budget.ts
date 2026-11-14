/**
 * Lignes budgétaires : recettes et dépenses par poste, par service et par quartier, clôturées chaque mois.
 *
 * Deux origines, jamais confondues :
 *  - le MIROIR de l'économie existante (`mirrorEconomyMonth`) : recopie du bilan mensuel de `Economy.onMonth`
 *    (src/sim/economy.ts) en lignes, montants inchangés — la trésorerie a déjà été mise à jour par le cœur ;
 *  - les lignes PROPRES aux modules (`post`) : ex. vente d'électricité, entretien des canalisations. Elles sont
 *    comptées dans `moduleBalance` et NE sont PAS appliquées à la trésorerie tant que le cœur n'expose pas le
 *    branchement demandé dans docs/requests/municipal.md (`Economy.applyExternal`).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { BudgetKey, BudgetLine, BudgetMonth, BudgetSide } from '../../shared/municipal/types';

/** Sous-ensemble du bilan mensuel de l'économie (`MonthRecord`, src/sim/economy.ts) lu par le miroir. */
export interface EconomyMonthLike {
  monthIndex: number;
  income: Record<string, number>;
  expenses: { buildings: number; roads: number; salaries: number; loanInterest: number; loanPrincipal: number };
  balance: number;
}

/** Noms des postes recopiés de l'économie de base (identifiants stables). */
export const MIRROR_CATEGORIES = {
  tax: (sector: string) => `impots:${sector}`,
  buildings: 'entretien:batiments',
  roads: 'entretien:routes',
  salaries: 'salaires:services',
  loanInterest: 'dette:interets',
  loanPrincipal: 'dette:capital',
} as const;

/** Service attribué aux lignes recopiées (le cœur ne ventile pas par service). */
export const MIRROR_SERVICE = 'economie';
export const HISTORY_MONTHS = 120;

const keyOf = (k: BudgetKey): string => `${k.side}|${k.category}|${k.service}|${k.district}`;
const r2 = (v: number): number => Math.round(v * 100) / 100;

/**
 * Répartit `amount` selon des poids positifs en centimes exacts (méthode du plus fort reste) : la somme des
 * parts vaut exactement `amount` arrondi au centime. Poids nuls / négatifs ignorés ; aucun poids → {}.
 */
export function allocateByWeight(amount: number, weights: Record<string, number>): Record<string, number> {
  const keys = Object.keys(weights).filter((k) => weights[k]! > 0).sort();
  if (!keys.length) return {};
  const total = keys.reduce((s, k) => s + weights[k]!, 0);
  const cents = Math.round(amount * 100);
  const raw = keys.map((k) => (cents * weights[k]!) / total);
  const floor = raw.map((v) => Math.floor(v));
  let left = cents - floor.reduce((s, v) => s + v, 0);
  const order = keys.map((_, i) => i).sort((a, b) => (raw[b]! - floor[b]!) - (raw[a]! - floor[a]!) || a - b);
  for (const i of order) { if (left <= 0) break; floor[i]!++; left--; }
  const out: Record<string, number> = {};
  keys.forEach((k, i) => { out[k] = floor[i]! / 100; });
  return out;
}

export class BudgetLedger {
  /** Lignes du mois en cours : propres aux modules. */
  private current = new Map<string, BudgetLine>();
  /** Lignes du mois en cours : miroir de l'économie (une seule recopie par mois). */
  private mirrored = new Map<string, BudgetLine>();
  history: BudgetMonth[] = [];
  /** Incrémenté à chaque écriture (deltas). */
  version = 0;

  /**
   * Enregistre un montant du mois en cours (cumulé par clé). `amount` > 0 ; pour une correction, poster sur
   * l'autre sens. Renvoie le cumul de la ligne.
   */
  /** Appelé à chaque ligne de module postée (+ recette, − dépense) : application à la trésorerie (Municipal). */
  onPost: ((signed: number) => void) | null = null;

  post(side: BudgetSide, category: string, amount: number, service = '', district = ''): number {
    if (side !== 'income' && side !== 'expense') throw new Error(`budget : sens ${String(side)} inconnu`);
    if (!category) throw new Error('budget : poste vide');
    if (!Number.isFinite(amount) || amount < 0) throw new Error(`budget : montant ${amount} invalide (≥ 0 attendu)`);
    const r = this.put(this.current, { side, category, service, district, amount });
    if (amount > 0) this.onPost?.(side === 'income' ? amount : -amount);
    return r;
  }

  /** Ventile un montant par quartier selon des poids (centimes exacts), une ligne par quartier. */
  postByDistrict(side: BudgetSide, category: string, amount: number, weights: Record<string, number>, service = ''): void {
    const parts = allocateByWeight(amount, weights);
    const keys = Object.keys(parts);
    if (!keys.length) { this.post(side, category, amount, service, ''); return; }
    for (const d of keys) this.post(side, category, parts[d]!, service, d);
  }

  private put(map: Map<string, BudgetLine>, line: BudgetLine): number {
    const k = keyOf(line);
    const cur = map.get(k);
    if (cur) cur.amount += line.amount; else map.set(k, { ...line });
    this.version++;
    return map.get(k)!.amount;
  }

  /**
   * Recopie le bilan mensuel de l'économie existante en lignes (montants inchangés). À appeler une fois par
   * mois, avant `closeMonth`. Renvoie le solde recopié (= `rec.balance` aux arrondis près).
   */
  mirrorEconomyMonth(rec: EconomyMonthLike, districtWeights?: Record<string, number>): number {
    this.mirrored.clear();
    const add = (side: BudgetSide, category: string, amount: number): void => {
      if (!(amount > 0)) return;
      if (districtWeights) {
        const parts = allocateByWeight(amount, districtWeights);
        if (Object.keys(parts).length) {
          for (const [d, v] of Object.entries(parts)) this.put(this.mirrored, { side, category, service: MIRROR_SERVICE, district: d, amount: v });
          return;
        }
      }
      this.put(this.mirrored, { side, category, service: MIRROR_SERVICE, district: '', amount });
    };
    for (const sector of Object.keys(rec.income).sort()) add('income', MIRROR_CATEGORIES.tax(sector), rec.income[sector]!);
    const e = rec.expenses;
    add('expense', MIRROR_CATEGORIES.buildings, e.buildings);
    add('expense', MIRROR_CATEGORIES.roads, e.roads);
    add('expense', MIRROR_CATEGORIES.salaries, e.salaries);
    add('expense', MIRROR_CATEGORIES.loanInterest, e.loanInterest);
    add('expense', MIRROR_CATEGORIES.loanPrincipal, e.loanPrincipal);
    let bal = 0;
    for (const l of this.mirrored.values()) bal += l.side === 'income' ? l.amount : -l.amount;
    return r2(bal);
  }

  /** Solde des lignes propres aux modules du mois en cours (ce qu'un branchement du cœur devrait appliquer). */
  pendingModuleBalance(): number {
    let s = 0;
    for (const l of this.current.values()) s += l.side === 'income' ? l.amount : -l.amount;
    return r2(s);
  }

  /** Lignes du mois en cours (miroir + modules), triées. */
  currentLines(): BudgetLine[] {
    return [...this.mirrored.values(), ...this.current.values()].map((l) => ({ ...l })).sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
  }

  /** Clôture le mois : fige les lignes dans l'historique et repart de zéro. */
  closeMonth(monthIndex: number): BudgetMonth {
    let income = 0, expense = 0, mirroredBalance = 0, moduleBalance = 0;
    for (const l of this.mirrored.values()) { const s = l.side === 'income' ? l.amount : -l.amount; mirroredBalance += s; }
    for (const l of this.current.values()) { const s = l.side === 'income' ? l.amount : -l.amount; moduleBalance += s; }
    const lines = this.currentLines().map((l) => ({ ...l, amount: r2(l.amount) }));
    for (const l of lines) { if (l.side === 'income') income += l.amount; else expense += l.amount; }
    const m: BudgetMonth = {
      monthIndex, lines, income: r2(income), expense: r2(expense), balance: r2(income - expense),
      mirroredBalance: r2(mirroredBalance), moduleBalance: r2(moduleBalance),
    };
    this.history.push(m);
    if (this.history.length > HISTORY_MONTHS) this.history.splice(0, this.history.length - HISTORY_MONTHS);
    this.current.clear();
    this.mirrored.clear();
    this.version++;
    return m;
  }

  get lastMonth(): BudgetMonth | undefined { return this.history[this.history.length - 1]; }

  /** Agrège les `months` derniers mois clos par poste, service ou quartier (solde signé : recettes - dépenses). */
  groupBy(field: 'category' | 'service' | 'district', months = 1): Record<string, number> {
    const out: Record<string, number> = {};
    for (const m of this.history.slice(-Math.max(1, months))) {
      for (const l of m.lines) {
        const k = l[field] || (field === 'district' ? '(ville)' : '(général)');
        out[k] = r2((out[k] ?? 0) + (l.side === 'income' ? l.amount : -l.amount));
      }
    }
    return out;
  }

  get isEmpty(): boolean { return this.history.length === 0 && this.current.size === 0 && this.mirrored.size === 0; }

  toJSON(): { current: BudgetLine[]; mirrored: BudgetLine[]; history: BudgetMonth[] } {
    return {
      current: [...this.current.values()].map((l) => ({ ...l })),
      mirrored: [...this.mirrored.values()].map((l) => ({ ...l })),
      history: this.history.map((m) => ({ ...m, lines: m.lines.map((l) => ({ ...l })) })),
    };
  }

  static fromJSON(j: { current: BudgetLine[]; mirrored: BudgetLine[]; history: BudgetMonth[] }): BudgetLedger {
    const b = new BudgetLedger();
    for (const l of j.current) b.put(b.current, l);
    for (const l of j.mirrored) b.put(b.mirrored, l);
    b.history = j.history.map((m) => ({ ...m, lines: m.lines.map((l) => ({ ...l })) }));
    b.version = 0;
    return b;
  }
}
