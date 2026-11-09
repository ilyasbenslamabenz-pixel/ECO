// Moteur fiscal : barème progressif, distributions de revenus, TVA, cotisations.
import { BRANCHES, VAT_CATS, type VatCategory } from './data';
import type { Bracket, Policy } from './types';

/** Impôt dû sur un revenu imposable annuel selon un barème progressif par tranches. */
export function progressiveTax(taxable: number, brackets: Bracket[]): number {
  if (taxable <= 0) return 0;
  let tax = 0;
  let lower = 0;
  for (const b of brackets) {
    const upper = b.upTo ?? Infinity;
    if (taxable > lower) tax += (Math.min(taxable, upper) - lower) * b.rate;
    if (taxable <= upper) break;
    lower = upper;
  }
  return tax;
}

export function marginalRate(taxable: number, brackets: Bracket[]): number {
  let lower = 0;
  for (const b of brackets) {
    const upper = b.upTo ?? Infinity;
    if (taxable <= upper && taxable > lower) return b.rate;
    lower = upper;
  }
  return brackets[brackets.length - 1]?.rate ?? 0;
}

/** Vérifie et normalise un barème (tranches croissantes, dernière tranche ouverte, taux dans [0, 0.9]). */
export function sanitizeBrackets(input: Bracket[]): Bracket[] {
  const out: Bracket[] = [];
  let last = 0;
  for (const b of input.slice(0, 10)) {
    const rate = Math.max(0, Math.min(0.9, Number(b.rate) || 0));
    if (b.upTo === null) {
      out.push({ upTo: null, rate });
      break;
    }
    const upTo = Math.round(Number(b.upTo));
    if (!Number.isFinite(upTo) || upTo <= last) continue;
    out.push({ upTo, rate });
    last = upTo;
  }
  if (!out.length || out[out.length - 1].upTo !== null) out.push({ upTo: null, rate: out[out.length - 1]?.rate ?? 0.4 });
  return out;
}

// Points de quantiles de la loi normale centrée réduite (milieux de 20 intervalles égaux).
const NQ = 20;
export const Z_QUANTILES: number[] = Array.from({ length: NQ }, (_, i) => inverseNormal((i + 0.5) / NQ));

/** Approximation d'Acklam de la fonction quantile de la loi normale. */
export function inverseNormal(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Revenus de 20 quantiles d'une loi log-normale de moyenne `mean` et de dispersion `sigma` (moyenne exacte conservée). */
export function lognormalPoints(mean: number, sigma: number): number[] {
  const med = mean * Math.exp(-(sigma * sigma) / 2);
  const pts = Z_QUANTILES.map((z) => med * Math.exp(sigma * z));
  const m = pts.reduce((s, v) => s + v, 0) / NQ;
  const k = m > 0 ? mean / m : 0;
  return pts.map((v) => v * k);
}

export interface GroupTaxInput {
  count: number; // nombre de contribuables
  meanGross: number; // revenu brut moyen (€/an)
  sigma: number;
  employeeRate: number; // cotisations salariales (0 pour les pensions et allocations)
  childrenPerTaxpayer: number;
  minWageAnnual: number;
  earned: boolean; // revenu d'activité (ouvre droit au crédit d'activité)
}

export interface GroupTaxResult {
  gross: number; // total brut (€/an)
  contributions: number;
  taxable: number;
  incomeTax: number; // net des crédits non remboursables
  activityCredit: number; // crédit remboursable versé
  net: number; // revenu après cotisations et impôt (€/an, total groupe)
  points: { income: number; weight: number }[]; // revenu net par quantile pour les inégalités
}

/** Applique le barème à un groupe de contribuables représenté par 20 quantiles. */
export function groupIncomeTax(g: GroupTaxInput, it: Policy['incomeTax']): GroupTaxResult {
  const res: GroupTaxResult = { gross: 0, contributions: 0, taxable: 0, incomeTax: 0, activityCredit: 0, net: 0, points: [] };
  if (g.count <= 0 || g.meanGross <= 0) return res;
  const w = g.count / NQ;
  for (const gross of lognormalPoints(g.meanGross, g.sigma)) {
    const contrib = gross * g.employeeRate;
    const base = gross - contrib;
    const deduction = Math.min(base * it.deductionRate, it.deductionCap) + g.childrenPerTaxpayer * it.childDeduction;
    const taxable = Math.max(0, base - deduction);
    const tax = Math.max(0, progressiveTax(taxable, it.brackets) - it.taxCredit);
    const credit = g.earned ? activityCredit(gross, g.minWageAnnual, it.activityCredit) : 0;
    const net = base - tax + credit;
    res.gross += gross * w;
    res.contributions += contrib * w;
    res.taxable += taxable * w;
    res.incomeTax += tax * w;
    res.activityCredit += credit * w;
    res.net += net * w;
    res.points.push({ income: net, weight: w });
  }
  return res;
}

/** Crédit d'activité : plein jusqu'à 1 SMIC annuel, dégressif jusqu'à 1,6 SMIC, nul au-delà. */
export function activityCredit(gross: number, minWageAnnual: number, amount: number): number {
  if (amount <= 0 || gross < minWageAnnual * 0.3) return 0;
  if (gross <= minWageAnnual) return amount;
  const top = minWageAnnual * 1.6;
  if (gross >= top) return 0;
  return amount * (1 - (gross - minWageAnnual) / (top - minWageAnnual));
}

export function vatRateOf(policy: Policy, cat: VatCategory): number {
  const cls = policy.vat.classes[cat];
  return cls === 'exonere' ? 0 : policy.vat[cls];
}

export function contributionRates(policy: Policy) {
  let employer = 0;
  let employee = 0;
  for (const b of BRANCHES) {
    employer += policy.contributions[b].employer;
    employee += policy.contributions[b].employee;
  }
  return { employer, employee };
}

/** Taux moyen pondéré des taxes à la consommation (TVA + accises) — sert à la répercussion sur les prix. */
export function averageConsumptionTax(policy: Policy): number {
  let t = 0;
  for (const c of VAT_CATS) {
    let rate = vatRateOf(policy, c.id);
    if (c.id === 'transport') rate += policy.eco.fuel * 0.35;
    t += c.share * rate;
  }
  return t;
}

/** Patrimoine taxable au-delà d'un seuil pour une distribution de Pareto du haut de la distribution. */
export function wealthTaxBase(totalWealth: number, households: number, threshold: number): number {
  // Les 10 % les plus riches détiennent 55 % du patrimoine ; queue de Pareto d'indice alpha = 1,6.
  const alpha = 1.6;
  const topN = households * 0.1;
  const topWealth = totalWealth * 0.55;
  const xmin = (topWealth / topN) * ((alpha - 1) / alpha);
  if (threshold <= xmin) return Math.max(0, topWealth - topN * threshold);
  const nAbove = topN * Math.pow(xmin / threshold, alpha);
  const wealthAbove = nAbove * threshold * (alpha / (alpha - 1));
  return Math.max(0, wealthAbove - nAbove * threshold);
}

/** Indice de Gini et taux de pauvreté à partir de points (revenu, poids). */
export function inequality(points: { income: number; weight: number }[]) {
  const pts = points.filter((p) => p.weight > 0).sort((a, b) => a.income - b.income);
  const W = pts.reduce((s, p) => s + p.weight, 0);
  if (W <= 0) return { gini: 0, median: 0, poverty: 0 };
  const total = pts.reduce((s, p) => s + p.income * p.weight, 0);
  let cumW = 0;
  let cumY = 0;
  let area = 0;
  let median = 0;
  for (const p of pts) {
    const prevY = cumY;
    cumW += p.weight;
    cumY += p.income * p.weight;
    area += (p.weight / W) * ((prevY + cumY) / 2 / total);
    if (!median && cumW >= W / 2) median = p.income;
  }
  const gini = 1 - 2 * area;
  const line = median * 0.6;
  const poor = pts.filter((p) => p.income < line).reduce((s, p) => s + p.weight, 0);
  return { gini, median, poverty: poor / W };
}
