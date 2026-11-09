// Moteur économique et fiscal : marché du travail, revenus, impôts, consommation, production,
// profits, investissement, commerce extérieur, prix et finances publiques. Un appel = un mois.
import {
  BUDGET_DEFS, OCCUPATIONS, OCC_SIGMA, OCC_WAGE_MULT, SECTORS, SECTOR_INDEX, SUBSIDY_SPLIT, INVEST_SPLIT, VAT_CATS,
  type BudgetLine, type Occupation, type VatCategory,
} from './data';
import { ageGroups } from './demography';
import { contributionRates, groupIncomeTax, inequality, vatRateOf, wealthTaxBase, averageConsumptionTax } from './fiscal';
import type { Accounts, GameState, Policy, RevenueKey, SpendingKey } from './types';

const NS = SECTORS.length;
export const INVEST_TARGET = 0.2; // investissement privé (entreprises et logement) en part du PIB
const HH_ENERGY_INTENSITY = 1500; // tCO2 / M€ de dépenses d'énergie domestique (prix de base)
const FUEL_INTENSITY = 2800; // tCO2 / M€ de carburant
const FUEL_SHARE = 0.35; // part des carburants dans la catégorie transport
const ENERGY_INTENSIVE = new Set(['industrie', 'energie', 'transport', 'agriculture']);
const INDUSTRIAL_EMITTERS = new Set(['industrie', 'energie']);

export interface StepContext {
  calibrate: boolean; // calibrage initial : pas de dynamique (prix, emploi, salaires, trésorerie)
}

export function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

/** Multiplicateurs de salaire par profession normalisés pour que la moyenne du secteur vaille 1. */
export function occMultipliers(sectorIdx: number): number[] {
  const occ = SECTORS[sectorIdx].occupations;
  const raw = OCCUPATIONS.map((o) => OCC_WAGE_MULT[o]);
  const mean = occ.reduce((s, sh, i) => s + sh * raw[i], 0);
  return raw.map((r) => r / mean);
}
const OCC_MULTS = SECTORS.map((_, i) => occMultipliers(i));

export function participationRate(p: Policy) {
  return clamp(0.8 - 0.06 * (p.labour.benefitRate - 0.57) - 0.012 * ((p.labour.benefitMonths - 24) / 12) + 0.01 * ((p.labour.hours - 35) / 5), 0.7, 0.86);
}

export function frictionalUnemployment(p: Policy, trainingQ: number) {
  return clamp(0.034 + 0.012 * (p.labour.benefitMonths / 24 - 1) + 0.02 * (p.labour.benefitRate - 0.57) - 0.02 * (trainingQ - 0.75), 0.02, 0.08);
}

function emptyRevenue(): Record<RevenueKey, number> {
  return {
    impotRevenu: 0, impotCapital: 0, impotSocietes: 0, tva: 0, cotisationsPatronales: 0, cotisationsSalariales: 0,
    patrimoine: 0, foncier: 0, transactions: 0, vacance: 0, taxesLocales: 0, carbone: 0, carburants: 0,
    emissionsIndustrielles: 0, dechets: 0, vehicules: 0, energivores: 0, entreprisesPubliques: 0, infrastructures: 0, divers: 0, douanes: 0,
  };
}

/**
 * Exécute un mois d'économie. Modifie `S` (secteurs, macro, finances, comptes) et renvoie les comptes du mois.
 */
export function economyStep(S: GameState, P: Policy, ctx: StepContext): Accounts {
  const M = S.macro;
  const F = S.finance;
  const prev = S.accounts;
  const Pl = M.priceLevel;
  const enrollment = clamp(0.5 + 0.25 * (S.services.education - 0.75), 0.3, 0.75);
  const groups = ageGroups(S.demography.cohorts, P.labour.retirementAge, enrollment);
  const pop = groups.total;
  const households = pop / 2.2;
  const LF = groups.workingAge * participationRate(P);
  const hoursF = Math.pow(P.labour.hours / 35, 0.6);
  const rates = contributionRates(P);
  const minAnnual = P.labour.minWage * 12;
  const gdpPrev = prev.gdp || 1;

  // ---------- Salaires ----------
  const Eprev = S.sectors.reduce((s, x) => s + x.employees, 0);
  const uPrev = clamp(1 - Eprev / Math.max(1, LF), 0, 0.6);
  if (!ctx.calibrate) {
    const tight = 0.4 * (0.065 - uPrev);
    const g = clamp(M.expectedInflation + M.productivityGrowth + tight, -0.03, 0.14);
    for (const s of S.sectors) s.wage *= 1 + g / 12;
  }
  const occWage: number[][] = []; // salaire moyen par secteur et profession
  const wEff: number[] = [];
  for (let i = 0; i < NS; i++) {
    const def = SECTORS[i];
    const row = OCCUPATIONS.map((o, k) => {
      const w = S.sectors[i].wage * OCC_MULTS[i][k] * hoursF;
      const floor = minAnnual * 1.18; // la moyenne d'un groupe payé au voisinage du SMIC reste au-dessus du minimum
      return o === 'employes' || o === 'ouvriers' ? Math.max(w, floor) : w;
    });
    occWage.push(row);
    wEff.push(row.reduce((s, w, k) => s + w * def.occupations[k], 0));
  }
  const eligible = SECTORS.map((d, i) => {
    const low = (d.occupations[1] + d.occupations[2]);
    const lowWage = (occWage[i][1] + occWage[i][2]) / 2;
    return low * clamp((1.6 * minAnnual - lowWage) / (0.8 * minAnnual) + 0.4, 0, 1);
  });
  const laborCost = SECTORS.map((_, i) => wEff[i] * (1 + rates.employer) - P.labour.hiringAid * eligible[i]);

  // ---------- Revenus des ménages ----------
  const E = S.sectors.map((s) => s.employees);
  const Etot = E.reduce((s, v) => s + v, 0);
  const U = Math.max(0, LF - Etot);
  const occCount = OCCUPATIONS.map((_, k) => E.reduce((s, e, i) => s + e * SECTORS[i].occupations[k], 0));
  const occMean = OCCUPATIONS.map((_, k) => (occCount[k] > 0 ? E.reduce((s, e, i) => s + e * SECTORS[i].occupations[k] * occWage[i][k], 0) / occCount[k] : 0));
  const wages = E.reduce((s, e, i) => s + e * wEff[i], 0);
  const meanWage = Etot > 0 ? wages / Etot : 0;
  const pensionPer = P.labour.pensionRate * meanWage;
  const coverage = Math.min(1, P.labour.benefitMonths / 24) * 0.8;
  const benefitPer = P.labour.benefitRate * meanWage * 0.78;
  const beneficiaries = U * coverage;
  const childrenPerTaxpayer = groups.children / Math.max(1, Etot + groups.retirees);

  const taxByCategory: Accounts['taxByCategory'] = {};
  const points: { income: number; weight: number }[] = [];
  let incomeTax = 0;
  let employeeContrib = 0;
  let activityCreditPaid = 0;
  let netIncome = 0;
  OCCUPATIONS.forEach((o: Occupation, k) => {
    const r = groupIncomeTax({ count: occCount[k], meanGross: occMean[k], sigma: OCC_SIGMA[o], employeeRate: rates.employee, childrenPerTaxpayer, minWageAnnual: minAnnual, earned: true }, P.incomeTax);
    incomeTax += r.incomeTax;
    employeeContrib += r.contributions;
    activityCreditPaid += r.activityCredit;
    netIncome += r.net;
    points.push(...r.points);
    taxByCategory[o] = { people: occCount[k], grossIncome: occMean[k], incomeTax: r.incomeTax / Math.max(1, occCount[k]), contributions: r.contributions / Math.max(1, occCount[k]), effectiveRate: r.gross > 0 ? (r.incomeTax + r.contributions - r.activityCredit) / r.gross : 0 };
  });
  const pensionRate = P.contributions.maladie.employee; // prélèvement maladie sur les pensions
  const rp = groupIncomeTax({ count: groups.retirees, meanGross: pensionPer, sigma: 0.42, employeeRate: pensionRate, childrenPerTaxpayer: 0, minWageAnnual: minAnnual, earned: false }, P.incomeTax);
  const ru = groupIncomeTax({ count: beneficiaries, meanGross: benefitPer, sigma: 0.3, employeeRate: 0, childrenPerTaxpayer, minWageAnnual: minAnnual, earned: false }, P.incomeTax);
  incomeTax += rp.incomeTax + ru.incomeTax;
  employeeContrib += rp.contributions;
  netIncome += rp.net + ru.net;
  points.push(...rp.points, ...ru.points);
  // chômeurs non indemnisés et inactifs : minimum social (financé par les aides au logement et allocations)
  const uncovered = U - beneficiaries;
  points.push({ income: 0.25 * meanWage, weight: uncovered });
  taxByCategory.retraites = { people: groups.retirees, grossIncome: pensionPer, incomeTax: rp.incomeTax / Math.max(1, groups.retirees), contributions: rp.contributions / Math.max(1, groups.retirees), effectiveRate: rp.gross > 0 ? (rp.incomeTax + rp.contributions) / rp.gross : 0 };
  taxByCategory.chomeurs = { people: U, grossIncome: U > 0 ? (beneficiaries * benefitPer) / U : 0, incomeTax: ru.incomeTax / Math.max(1, U), contributions: 0, effectiveRate: ru.gross > 0 ? ru.incomeTax / ru.gross : 0 };

  const pensions = groups.retirees * pensionPer;
  const unemploymentBenefits = beneficiaries * benefitPer;
  const familyBenefits = groups.children * P.labour.familyAllowance * 12;
  const housingAid = P.budget.logement;

  // Patrimoine, capital, immobilier
  const totalWealth = 4.8 * gdpPrev;
  const flight = Math.min(0.5, P.wealth.rate * 12);
  const wealthTax = P.wealth.rate * wealthTaxBase(totalWealth, households, P.wealth.threshold * Pl) * (1 - flight);
  const prevAfterTax = S.sectors.reduce((s, x) => s + x.profit, 0) - (prev.revenue.impotSocietes || 0);
  const capitalIncome = Math.max(0, (0.85 * Math.max(0, prevAfterTax) + 0.5 * (prev.spending.interets || 0)) * (1 - flight * 0.3));
  const capitalTax = capitalIncome * P.incomeTax.capitalRate;
  const housingValue = 2.6 * gdpPrev;
  const commercialValue = 0.8 * gdpPrev;
  const foncierHH = P.property.landRate * housingValue;
  const foncierFirms = P.property.landRate * commercialValue;
  const turnover = 0.045 * housingValue * clamp(1 - 4 * P.property.transferRate, 0.4, 1.2);
  const transactions = P.property.transferRate * turnover;
  const vacantShare = 0.075 * clamp(1 - 3 * P.property.vacancyRate, 0.4, 1);
  const vacancyTax = P.property.vacancyRate * housingValue * vacantShare;
  const localTaxes = P.property.localTax * households * Pl / Math.max(0.5, Pl); // montant nominal fixé par le joueur
  const thermalShare = clamp(0.88 - P.eco.vehicle / 2500 - Math.max(0, S.month) * 0.0004, 0.2, 0.95);
  const vehicles = pop * 0.52 * thermalShare;
  const vehicleTax = P.eco.vehicle * vehicles;
  const wasteFactor = 1 - 0.25 * (1 - Math.exp(-P.eco.waste / 60));
  const wasteHH = pop * 0.5 * wasteFactor;
  const wasteInd = (S.sectors[SECTOR_INDEX.industrie].output / Pl / 1e6) * 6 * wasteFactor;
  const waste = wasteHH + wasteInd;
  const wasteTaxHH = P.eco.waste * wasteHH;
  const wasteTaxFirms = P.eco.waste * wasteInd;
  const carbonHHprev = prev.revenue.carbone ? prev.emissionsHouseholds * P.eco.carbon : 0;

  const disposable = netIncome + familyBenefits + housingAid + capitalIncome - capitalTax - wealthTax
    - foncierHH - transactions - vacancyTax - localTaxes - vehicleTax - wasteTaxHH;

  // ---------- Consommation et TVA ----------
  const realRate = M.policyRate - M.inflation;
  const mpc = clamp(0.885 + 0.08 * (M.confidence - 0.5) - 0.6 * (realRate - 0.005), 0.78, 0.96);
  // les revenus du capital, concentrés en haut de la distribution, sont davantage épargnés
  const capNet = capitalIncome - capitalTax;
  const consumption = Math.max(0, (disposable - capNet) * mpc + capNet * (mpc - 0.2));
  const savings = disposable - consumption;
  const hhIntensity = clamp(1 - 0.4 * (1 - Math.exp(-P.eco.carbon / 120)), 0.4, 1);
  const excise: Record<VatCategory, number> = {} as Record<VatCategory, number>;
  for (const c of VAT_CATS) excise[c.id] = 0;
  excise.energie = (P.eco.carbon * HH_ENERGY_INTENSITY * hhIntensity) / 1e6 / Pl;
  excise.transport = FUEL_SHARE * (P.eco.fuel + (P.eco.carbon * FUEL_INTENSITY * hhIntensity) / 1e6 / Pl);
  // réallocation du panier selon les prix relatifs (élasticités)
  const weights = VAT_CATS.map((c) => c.share * Math.pow(1 + vatRateOf(P, c.id) + excise[c.id], c.elasticity + 1) / Math.pow(1.15, c.elasticity + 1));
  const wsum = weights.reduce((s, v) => s + v, 0);
  const consSector = new Array(NS).fill(0);
  let vat = 0;
  let exciseRev = 0;
  let carbonHH = 0;
  let fuelRev = 0;
  let consumptionNet = 0;
  let hhEmissions = 0;
  const vatByCategory = {} as Record<VatCategory, number>;
  VAT_CATS.forEach((c, k) => {
    const gross = (consumption * weights[k]) / wsum;
    const t = vatRateOf(P, c.id);
    const net = gross / (1 + t + excise[c.id]);
    vat += net * t;
    vatByCategory[c.id] = net * t;
    exciseRev += net * excise[c.id];
    consumptionNet += net;
    for (const [sid, sh] of Object.entries(c.sectors)) consSector[SECTOR_INDEX[sid as keyof typeof SECTOR_INDEX]] += net * (sh as number);
    if (c.id === 'energie') { carbonHH += net * excise.energie; hhEmissions += (net / Pl / 1e6) * HH_ENERGY_INTENSITY * hhIntensity; }
    if (c.id === 'transport') {
      fuelRev += net * FUEL_SHARE * P.eco.fuel;
      carbonHH += net * (excise.transport - FUEL_SHARE * P.eco.fuel);
      hhEmissions += ((net * FUEL_SHARE) / Pl / 1e6) * FUEL_INTENSITY * hhIntensity;
    }
  });
  void carbonHHprev;

  // ---------- Dépense publique ----------
  const govSector = new Array(NS).fill(0);
  const subsidySector = new Array(NS).fill(0);
  let publicPurchases = 0;
  for (const b of BUDGET_DEFS) {
    const amount = Math.max(0, P.budget[b.id]);
    if (b.sectors) {
      publicPurchases += amount;
      for (const [sid, sh] of Object.entries(b.sectors)) govSector[SECTOR_INDEX[sid as keyof typeof SECTOR_INDEX]] += amount * (sh as number);
    } else if (b.transfer === 'entreprises') {
      for (const [sid, sh] of Object.entries(SUBSIDY_SPLIT)) subsidySector[SECTOR_INDEX[sid as keyof typeof SECTOR_INDEX]] += amount * (sh as number);
    }
  }

  // ---------- Investissement privé ----------
  const margin = S.sectors.reduce((s, x) => s + x.profit, 0) / Math.max(1, S.sectors.reduce((s, x) => s + x.output, 0));
  const baseMargin = S.baseline.margin || margin;
  const greenShare = clamp(0.12 + 0.6 * P.corporate.greenCredit + P.eco.carbon / 500 + P.eco.industrial / 600, 0, 0.85);
  const invFactor = (1 + 1.2 * P.corporate.investCredit + 0.4 * P.corporate.greenCredit * greenShare)
    * clamp(1 - 1.5 * (P.corporate.rate - 0.25), 0.5, 1.5)
    * clamp(1 - 4 * (realRate - 0.005), 0.5, 1.4)
    * (0.7 + 0.6 * M.confidence)
    * (1 - 0.4 * flight)
    * clamp(Math.sqrt(Math.max(0.01, margin) / Math.max(0.01, baseMargin)), 0.5, 1.5);
  const invBase = S.baseline.invBase || INVEST_TARGET;
  const investment = invBase * gdpPrev * invFactor;
  const invSector = new Array(NS).fill(0);
  for (const [sid, sh] of Object.entries(INVEST_SPLIT)) invSector[SECTOR_INDEX[sid as keyof typeof SECTOR_INDEX]] += investment * (sh as number);
  const ownInv = S.sectors.map((x) => (investment * Math.max(0, x.profit)) / Math.max(1, S.sectors.reduce((s, y) => s + Math.max(0, y.profit), 0)));

  // ---------- Commerce extérieur ----------
  const avgLC = laborCost.reduce((s, c, i) => s + c * E[i], 0) / Math.max(1, Etot);
  const avgProd = S.sectors.reduce((s, x, i) => s + x.productivity * E[i], 0) / Math.max(1, Etot);
  const ulc = avgLC / Math.max(1, avgProd * Pl * hoursF);
  const compet = ctx.calibrate ? 1 : clamp(Math.pow((S.baseline.ulc || ulc) / ulc, 1.1) * Math.pow(Pl / M.worldPrice, -0.4) * Math.pow(M.energyPrice, -0.15), 0.4, 1.8);
  const impF = ctx.calibrate ? 1 : clamp(Math.pow(Pl / M.worldPrice, 0.8), 0.7, 1.5);
  // politique commerciale (module international) : droits de douane sur les importations, représailles sur les exportations
  const tariff = ctx.calibrate ? 0 : clamp(P.trade?.tariff ?? 0, 0, 0.5);
  const tariffF = clamp(1 - 1.5 * tariff, 0.3, 1); // élasticité des importations aux droits de douane
  const retaliationF = ctx.calibrate ? 1 : clamp(1 - 1.5 * (S.international?.retaliation ?? 0), 0.3, 1);
  let customs = 0;

  // ---------- Production et emploi ----------
  let exportsTot = 0;
  let importsTot = 0;
  let gdp = 0;
  let unmet = 0;
  let demandTot = 0;
  const output = new Array(NS).fill(0);
  const exportsS = new Array(NS).fill(0);
  for (let i = 0; i < NS; i++) {
    const def = SECTORS[i];
    const s = S.sectors[i];
    const domestic = consSector[i] + govSector[i] + invSector[i];
    const ecoCost = ENERGY_INTENSIVE.has(def.id) ? P.eco.energyIntensive + (INDUSTRIAL_EMITTERS.has(def.id) ? (P.eco.industrial * s.emissionIntensity) / 1e6 / Pl : 0) : 0;
    const imp = domestic * def.importShare * impF * tariffF;
    customs += imp * tariff;
    // calibrage : l'offre (emploi × productivité) est donnée, les exportations bouclent l'équilibre
    const supply = s.employees * s.productivity * Pl * hoursF;
    const X = ctx.calibrate
      ? Math.max(def.exportShare * supply, supply - (domestic - imp))
      : s.baseExport * M.worldPrice * M.worldDemand * compet * clamp(1 - 0.8 * ecoCost, 0.5, 1) * retaliationF;
    const D = Math.max(0, domestic - imp + X);
    const empFactor = clamp(Math.pow((laborCost[i] / (s.productivity * Pl * hoursF)) / (S.baseline.wageCost[i] || 1), -0.35), 0.6, 1.4);
    const capacity = (s.employees * s.productivity * Pl * hoursF) / empFactor;
    let Y = ctx.calibrate ? D : Math.min(D, capacity);
    if (Y < 0) Y = 0;
    unmet += D - Y;
    demandTot += D;
    importsTot += imp + (D - Y);
    exportsTot += X;
    exportsS[i] = X;
    output[i] = Y;
    gdp += Y;
    s.demand = D;
    if (!ctx.calibrate) {
      const target = (D / (s.productivity * Pl * hoursF)) * empFactor;
      s.vacancies = Math.max(0, target - s.employees);
      s.employees += (target - s.employees) * 0.07;
    }
  }
  // contrainte de main-d'œuvre : l'emploi total ne peut dépasser la population active hors chômage frictionnel
  if (!ctx.calibrate) {
    const maxE = LF * (1 - frictionalUnemployment(P, S.services.formation));
    const newE = S.sectors.reduce((s, x) => s + x.employees, 0);
    if (newE > maxE) {
      const k = maxE / newE;
      for (const s of S.sectors) s.employees *= k;
    }
  }

  // ---------- Profits, IS, entreprises ----------
  let cit = 0;
  let employerContrib = 0;
  let industrialTax = 0;
  let carbonFirms = 0;
  let energyIntensiveTax = 0;
  let hiringAidPaid = 0;
  let failures = 0;
  let creations = 0;
  const emissionsBySector = new Array(NS).fill(0);
  for (let i = 0; i < NS; i++) {
    const def = SECTORS[i];
    const s = S.sectors[i];
    const Y = output[i];
    const wageBill = s.employees * wEff[i];
    const ec = wageBill * rates.employer;
    employerContrib += ec;
    const aid = P.labour.hiringAid * s.employees * eligible[i];
    hiringAidPaid += aid;
    const emissions = (Y / Pl / 1e6) * s.emissionIntensity;
    emissionsBySector[i] = emissions;
    const carbonPrice = INDUSTRIAL_EMITTERS.has(def.id) ? 0 : P.eco.carbon; // l'énergie et l'industrie relèvent de la taxe sur les émissions industrielles
    const cf = carbonPrice * emissions;
    const it = INDUSTRIAL_EMITTERS.has(def.id) ? P.eco.industrial * emissions : 0;
    const ei = ENERGY_INTENSIVE.has(def.id) ? P.eco.energyIntensive * Y : 0;
    carbonFirms += cf;
    industrialTax += it;
    energyIntensiveTax += ei;
    const energyCost = Y * def.energyShare * M.energyPrice;
    const waste = def.id === 'industrie' ? wasteTaxFirms : 0;
    const foncier = foncierFirms * (Y / Math.max(1, gdp));
    const profit = Y - wageBill - ec + aid + subsidySector[i] - energyCost - 0.16 * Y - 0.06 * Y - cf - it - ei - waste - foncier;
    const rateEff = 0.7 * P.corporate.rate + 0.3 * P.corporate.smeRate + (def.polluting ? P.corporate.pollutingSurtax : 0);
    const inv = ownInv[i];
    const c = Math.max(0, Math.max(0, profit) * rateEff - P.corporate.investCredit * inv - P.corporate.greenCredit * inv * greenShare);
    cit += c;
    if (!ctx.calibrate) {
      const m = profit / Math.max(1, Y);
      const prevY = s.output || Y;
      const drop = Math.max(0, (prevY - Y) / Math.max(1, prevY)) * 12;
      const birthRate = clamp(0.075 + 0.6 * Math.max(0, m - 0.05) + 0.02 * (M.confidence - 0.5), 0.02, 0.2) / 12;
      const deathRate = clamp(0.065 + 1.2 * Math.max(0, 0.02 - m) + 0.5 * drop, 0.02, 0.4) / 12;
      const born = s.firms * birthRate;
      const died = s.firms * deathRate;
      s.firms = Math.max(10, s.firms + born - died);
      s.failures = s.failures * (11 / 12) + died;
      s.creations = s.creations * (11 / 12) + born;
      failures += died * 12;
      creations += born * 12;
      // intensité d'émission : décarbonation induite par le prix du carbone et l'investissement vert
      const price = INDUSTRIAL_EMITTERS.has(def.id) ? P.eco.industrial + 0.3 * P.eco.carbon : P.eco.carbon;
      const target = def.emissionIntensity * (1 - 0.5 * (1 - Math.exp(-price / 110))) * (1 - 0.25 * greenShare);
      s.emissionIntensity += (target - s.emissionIntensity) * 0.012;
    }
    s.output = Y;
    s.profit = profit;
    s.investment = inv;
    if (ctx.calibrate) {
      s.baseExport = exportsS[i];
      S.baseline.wageCost[i] = laborCost[i] / (s.productivity * Pl * hoursF);
    }
  }

  if (ctx.calibrate) S.baseline.ulc = ulc;

  // ---------- Recettes publiques ----------
  const revenue = emptyRevenue();
  revenue.impotRevenu = incomeTax;
  revenue.impotCapital = capitalTax;
  revenue.impotSocietes = cit;
  revenue.tva = vat;
  revenue.cotisationsPatronales = employerContrib;
  revenue.cotisationsSalariales = employeeContrib;
  revenue.patrimoine = wealthTax;
  revenue.foncier = foncierHH + foncierFirms;
  revenue.transactions = transactions;
  revenue.vacance = vacancyTax;
  revenue.taxesLocales = localTaxes;
  revenue.carbone = carbonHH + carbonFirms;
  revenue.carburants = fuelRev;
  revenue.emissionsIndustrielles = industrialTax;
  revenue.dechets = wasteTaxHH + wasteTaxFirms;
  revenue.vehicules = vehicleTax;
  revenue.energivores = energyIntensiveTax;
  const publicProfits = 0.3 * (Math.max(0, S.sectors[SECTOR_INDEX.energie].profit) + Math.max(0, S.sectors[SECTOR_INDEX.transport].profit)) * 0.5;
  revenue.entreprisesPubliques = publicProfits;
  revenue.infrastructures = 0.004 * gdp;
  revenue.divers = 0.006 * gdp;
  revenue.douanes = customs;
  void exciseRev;

  // ---------- Dépenses publiques ----------
  const spending = {} as Record<SpendingKey, number>;
  for (const b of BUDGET_DEFS) spending[b.id as BudgetLine] = Math.max(0, P.budget[b.id]);
  spending.retraites = pensions;
  spending.chomage = unemploymentBenefits;
  spending.allocations = familyBenefits;
  spending.creditActivite = activityCreditPaid + hiringAidPaid;
  spending.interets = F.debt * F.avgRate;

  const revenueTotal = Object.values(revenue).reduce((s, v) => s + v, 0);
  const spendingTotal = Object.values(spending).reduce((s, v) => s + v, 0);
  const balance = revenueTotal - spendingTotal;

  // ---------- Prix, taux, productivité, finances ----------
  const gap = demandTot > 0 ? unmet / demandTot : 0;
  if (!ctx.calibrate) {
    const newCons = averageConsumptionTax(P);
    const passThrough = 0.75 * (newCons - M.consTaxRate) / (1 + M.consTaxRate);
    M.consTaxRate = newCons;
    const wageGrowth = M.expectedInflation + M.productivityGrowth + 0.4 * (0.065 - uPrev);
    const u = clamp(1 - S.sectors.reduce((s, x) => s + x.employees, 0) / LF, 0, 0.6);
    // courbe de Phillips augmentée des anticipations, ancrée sur la cible de 2 % de la banque centrale
    const pi = clamp(0.45 * M.expectedInflation + 0.55 * 0.02 + 2.2 * gap + 0.3 * (wageGrowth - M.expectedInflation - M.productivityGrowth) + 0.04 * (M.energyPrice - 1), -0.05, 0.3);
    M.priceLevel *= (1 + pi / 12) * (1 + passThrough);
    M.expectedInflation = 0.88 * M.expectedInflation + 0.12 * pi;
    M.worldPrice *= 1 + 0.02 / 12;
    M.worldDemand *= 1 + 0.015 / 12;
    M.outputGap = 0.4 * (0.065 - u) / 0.065 + gap * 2;
    M.policyRate = clamp(0.005 + M.inflation + 0.5 * (M.inflation - 0.02) + 0.25 * M.outputGap, 0, 0.12);
    const research = P.budget.recherche / Math.max(1, gdp);
    M.productivityGrowth = clamp(0.006 + 0.1 * (investment / Math.max(1, gdp) - INVEST_TARGET) + 3 * (research - 0.008) + 0.012 * (S.services.education - 0.75) + 0.005 * (S.services.formation - 0.75) + 0.004 * (S.services.infrastructures - 0.75), -0.01, 0.04);
    for (const s of S.sectors) s.productivity *= 1 + M.productivityGrowth / 12;
    const uChange = u - uPrev;
    M.confidence = clamp(M.confidence + 0.02 * (0.5 - M.confidence) - 2 * uChange - 0.3 * Math.max(0, gap - 0.02) + 0.002 * (S.satisfaction.overall - 55) / 10, 0.05, 0.95);
    // Finances publiques
    F.cash += balance / 12 + (F.reserve * M.policyRate) / 12;
    const debtRatio = F.debt / Math.max(1, gdp);
    const deficitRatio = -balance / Math.max(1, gdp);
    F.marketRate = clamp(M.policyRate + 0.004 + 0.03 * Math.max(0, debtRatio - 0.6) + 0.2 * Math.max(0, deficitRatio - 0.03), 0.001, 0.25);
    const minCash = P.finance.minCash;
    let issued = 0;
    if (F.cash < minCash && P.finance.autoBorrow) {
      issued = minCash * 1.5 - F.cash;
    } else if (F.cash < 0) {
      issued = -F.cash + minCash * 0.2; // emprunt d'urgence pour éviter le défaut de paiement
    }
    if (issued > 0) {
      const rate = F.marketRate + (P.finance.autoBorrow ? 0 : 0.01);
      F.avgRate = (F.avgRate * F.debt + rate * issued) / (F.debt + issued);
      F.debt += issued;
      F.cash += issued;
      F.bondsIssued.push({ month: S.month, amount: issued, rate, auto: true });
      if (F.bondsIssued.length > 40) F.bondsIssued.shift();
    }
    // renouvellement de la dette : 1/96 du stock par mois au taux de marché
    F.avgRate += (F.marketRate - F.avgRate) / 96;
  }

  // ---------- Inégalités ----------
  const ineq = inequality(points);
  // salaires médian et moyen
  const wagePts: { income: number; weight: number }[] = [];
  OCCUPATIONS.forEach((o, k) => { wagePts.push({ income: occMean[k] * Math.exp(-(OCC_SIGMA[o] ** 2) / 2), weight: occCount[k] }); });
  const medianWage = inequality(wagePts).median;

  return {
    revenue, spending, revenueTotal, spendingTotal,
    primaryBalance: balance + spending.interets, balance,
    gdp, gdpReal: gdp / M.priceLevel, consumption, consumptionNet, investment, publicPurchases,
    exports: exportsTot, imports: importsTot, wages, employerContrib, employeeContrib, pensions, unemploymentBenefits,
    familyBenefits, housingAid, activityCredit: activityCreditPaid, capitalIncome, disposableIncome: disposable, savings,
    emissions: emissionsBySector.reduce((s, v) => s + v, 0) + hhEmissions, emissionsBySector, emissionsHouseholds: hhEmissions, waste,
    taxByCategory, vatByCategory, gini: ineq.gini, poverty: ineq.poverty, medianIncome: ineq.median, meanWage, medianWage,
    failures, creations,
  };
}
