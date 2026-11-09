// Orchestrateur de la simulation : création et calibrage d'une partie, pas mensuel, décisions, historique.
import { AGE_BANDS, BRANCHES, BUDGET_DEFS, BUDGET_LINES, CATEGORY_IDS, INITIAL_AGE_PROFILE, SECTORS, VAT_CATS, type BudgetLine, type CategoryId } from './data';
import { DEFAULT_CONFIG, generateCountry, initialPopShares } from './country';
import { ageGroups, demographyStep, lifeExpectancy, mortalityMultiplier } from './demography';
import { INVEST_TARGET, clamp, economyStep, participationRate } from './economy';
import { averageConsumptionTax, sanitizeBrackets } from './fiscal';
import { airQuality, categoryIncome, citiesStep, satisfactionStep, servicesStep } from './social';
import type { Accounts, CountryConfig, Demography, GameState, Notice, Policy, Services } from './types';
// --- modules politique/international/événements/victoire ---
import { applyPoliticalAction, initPolitics, legislativeStep, politicsStep, splitReform, submitBills, type Bill, type PoliticalAction } from './politics';
import { applyDiplomaticAction, initInternational, internationalStep, type DiplomaticAction } from './international';
import { applyExtraBudget, eventsStep, initEvents, removeExtraBudget, resolveEvent } from './events';
import { continueAfterDefeat, initVictory, victoryStep } from './victory';
import { ensureMissions, missionsPre, missionsStep } from './missions'; // --- missions et progression du joueur ---
import { climateStep, ensureClimate, playClimateCard, setTrajectoryMode } from './climate'; // --- plan climat ---
// --- module énergie ---
import { DEFAULT_ENERGY_POLICY } from './energyData';
import { applyEnergyAction, energyHistory, energyStep, initEnergy, isEnergyAction, sanitizeEnergyPolicy, type EnergyAction } from './energy';
import { applyEnvAction, environmentHistory, environmentStep, initEnvironment, isEnvAction, type EnvAction } from './environment';
import { applySectorAction, defaultSectorPolicies, initSectors, recordSectorHistory, sanitizeSectorPolicies, sectorsStep, SECTOR_HISTORY_KEYS, type SectorAction } from './sectorModules';
// --- modules services publics/recherche/construction ---
import { applyServicesAction, defaultServicesPolicy, ensureServicesModules, initServicesModules, recordServicesHistory, sanitizeServicesPolicy, servicesModulesStep, servicesPostStep, type ServicesAction } from './services';
export type { ServicesAction };

export const SIM_VERSION = 1;
export const START_YEAR = 2030;
export const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

export function dateLabel(month: number, startYear = START_YEAR) {
  return `${MONTHS_FR[month % 12]} ${startYear + Math.floor(month / 12)}`;
}

export function defaultPolicy(gdp: number): Policy {
  const budget = {} as Record<BudgetLine, number>;
  for (const b of BUDGET_DEFS) budget[b.id] = Math.round(b.gdpShare * gdp);
  const classes = {} as Policy['vat']['classes'];
  for (const c of VAT_CATS) classes[c.id] = c.defaultClass;
  return {
    incomeTax: {
      brackets: [
        { upTo: 11300, rate: 0 }, { upTo: 28800, rate: 0.11 }, { upTo: 82300, rate: 0.3 }, { upTo: 177100, rate: 0.41 }, { upTo: null, rate: 0.45 },
      ],
      deductionRate: 0.1, deductionCap: 14000, childDeduction: 1700, taxCredit: 0, activityCredit: 1600, capitalRate: 0.3,
    },
    corporate: { rate: 0.25, smeRate: 0.15, investCredit: 0.04, greenCredit: 0.05, pollutingSurtax: 0 },
    vat: { normal: 0.2, reduit: 0.055, special: 0.1, classes },
    wealth: { rate: 0, threshold: 1_300_000 },
    property: { landRate: 0.0035, transferRate: 0.058, vacancyRate: 0.005, localTax: 400 },
    eco: { carbon: 45, fuel: 0.35, industrial: 30, waste: 25, vehicle: 60, energyIntensive: 0.002 },
    contributions: {
      maladie: { employer: 0.07, employee: 0.035 },
      chomage: { employer: 0.04, employee: 0 },
      retraite: { employer: 0.1, employee: 0.11 },
      accidents: { employer: 0.02, employee: 0 },
      famille: { employer: 0.035, employee: 0 },
    },
    labour: { minWage: 1800, hours: 35, hiringAid: 1500, benefitRate: 0.57, benefitMonths: 24, retirementAge: 64, pensionRate: 0.52, familyAllowance: 140 },
    budget,
    finance: { indexBudgets: true, autoBorrow: true, minCash: Math.round(gdp * 0.015) },
    trade: { tariff: 0 },
    energy: { ...DEFAULT_ENERGY_POLICY },
    ...defaultSectorPolicies(),
    ...defaultServicesPolicy(), // --- modules services publics/recherche/construction ---
  };
}

const num = (v: unknown, a: number, b: number, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? clamp(n, a, b) : d;
};

/** Valide et borne une politique proposée par le client (valeurs absurdes ou malveillantes neutralisées). */
export function sanitizePolicy(input: Policy, current: Policy): Policy {
  const i = input ?? current;
  const c = current;
  const it = i.incomeTax ?? c.incomeTax;
  const budget = {} as Record<BudgetLine, number>;
  for (const k of BUDGET_LINES) budget[k] = num(i.budget?.[k], 0, c.budget[k] * 5 + 1e10, c.budget[k]);
  const contributions = {} as Policy['contributions'];
  for (const b of BRANCHES) contributions[b] = { employer: num(i.contributions?.[b]?.employer, 0, 0.3, c.contributions[b].employer), employee: num(i.contributions?.[b]?.employee, 0, 0.3, c.contributions[b].employee) };
  const classes = {} as Policy['vat']['classes'];
  for (const v of VAT_CATS) {
    const cls = i.vat?.classes?.[v.id];
    classes[v.id] = cls === 'normal' || cls === 'reduit' || cls === 'special' || cls === 'exonere' ? cls : c.vat.classes[v.id];
  }
  return {
    incomeTax: {
      brackets: sanitizeBrackets(Array.isArray(it.brackets) ? it.brackets : c.incomeTax.brackets),
      deductionRate: num(it.deductionRate, 0, 0.3, c.incomeTax.deductionRate),
      deductionCap: num(it.deductionCap, 0, 100000, c.incomeTax.deductionCap),
      childDeduction: num(it.childDeduction, 0, 20000, c.incomeTax.childDeduction),
      taxCredit: num(it.taxCredit, 0, 10000, c.incomeTax.taxCredit),
      activityCredit: num(it.activityCredit, 0, 8000, c.incomeTax.activityCredit),
      capitalRate: num(it.capitalRate, 0, 0.7, c.incomeTax.capitalRate),
    },
    corporate: {
      rate: num(i.corporate?.rate, 0, 0.6, c.corporate.rate),
      smeRate: num(i.corporate?.smeRate, 0, 0.6, c.corporate.smeRate),
      investCredit: num(i.corporate?.investCredit, 0, 0.3, c.corporate.investCredit),
      greenCredit: num(i.corporate?.greenCredit, 0, 0.5, c.corporate.greenCredit),
      pollutingSurtax: num(i.corporate?.pollutingSurtax, 0, 0.2, c.corporate.pollutingSurtax),
    },
    vat: { normal: num(i.vat?.normal, 0, 0.35, c.vat.normal), reduit: num(i.vat?.reduit, 0, 0.35, c.vat.reduit), special: num(i.vat?.special, 0, 0.35, c.vat.special), classes },
    wealth: { rate: num(i.wealth?.rate, 0, 0.05, c.wealth.rate), threshold: num(i.wealth?.threshold, 100000, 1e8, c.wealth.threshold) },
    property: {
      landRate: num(i.property?.landRate, 0, 0.03, c.property.landRate),
      transferRate: num(i.property?.transferRate, 0, 0.2, c.property.transferRate),
      vacancyRate: num(i.property?.vacancyRate, 0, 0.1, c.property.vacancyRate),
      localTax: num(i.property?.localTax, 0, 5000, c.property.localTax),
    },
    eco: {
      carbon: num(i.eco?.carbon, 0, 500, c.eco.carbon), fuel: num(i.eco?.fuel, 0, 1.5, c.eco.fuel), industrial: num(i.eco?.industrial, 0, 500, c.eco.industrial),
      waste: num(i.eco?.waste, 0, 400, c.eco.waste), vehicle: num(i.eco?.vehicle, 0, 3000, c.eco.vehicle), energyIntensive: num(i.eco?.energyIntensive, 0, 0.1, c.eco.energyIntensive),
    },
    contributions,
    labour: {
      minWage: num(i.labour?.minWage, 0, 10000, c.labour.minWage),
      hours: num(i.labour?.hours, 28, 48, c.labour.hours),
      hiringAid: num(i.labour?.hiringAid, 0, 15000, c.labour.hiringAid),
      benefitRate: num(i.labour?.benefitRate, 0, 0.9, c.labour.benefitRate),
      benefitMonths: num(i.labour?.benefitMonths, 0, 48, c.labour.benefitMonths),
      retirementAge: num(i.labour?.retirementAge, 55, 72, c.labour.retirementAge),
      pensionRate: num(i.labour?.pensionRate, 0.2, 0.9, c.labour.pensionRate),
      familyAllowance: num(i.labour?.familyAllowance, 0, 1000, c.labour.familyAllowance),
    },
    budget,
    finance: { indexBudgets: i.finance?.indexBudgets ?? c.finance.indexBudgets, autoBorrow: i.finance?.autoBorrow ?? c.finance.autoBorrow, minCash: num(i.finance?.minCash, 0, 1e12, c.finance.minCash) },
    trade: { tariff: num(i.trade?.tariff, 0, 0.5, c.trade?.tariff ?? 0) },
    energy: sanitizeEnergyPolicy(i.energy, c.energy), // --- module énergie ---
    ...sanitizeSectorPolicies(i, c),
    ...sanitizeServicesPolicy(i, c), // --- modules services publics/recherche/construction ---
  };
}

function emptyAccounts(gdp: number): Accounts {
  return {
    revenue: {} as Accounts['revenue'], spending: {} as Accounts['spending'], revenueTotal: 0, spendingTotal: 0, primaryBalance: 0, balance: 0,
    gdp, gdpReal: gdp, consumption: 0, consumptionNet: 0, investment: 0, publicPurchases: 0, exports: 0, imports: 0, wages: 0,
    employerContrib: 0, employeeContrib: 0, pensions: 0, unemploymentBenefits: 0, familyBenefits: 0, housingAid: 0, activityCredit: 0,
    capitalIncome: 0, disposableIncome: 0, savings: 0, emissions: 0, emissionsBySector: [], emissionsHouseholds: 0, waste: 0,
    taxByCategory: {}, vatByCategory: {} as Accounts['vatByCategory'], gini: 0.3, poverty: 0.14, medianIncome: 0, meanWage: 0, medianWage: 0, failures: 0, creations: 0,
  };
}

/** Met à jour l'effectif des catégories socio-économiques. */
function updateCategories(S: GameState) {
  const P = S.policy;
  const enrollment = clamp(0.5 + 0.25 * (S.services.education - 0.75), 0.3, 0.75);
  const g = ageGroups(S.demography.cohorts, P.labour.retirementAge, enrollment);
  const LF = g.workingAge * participationRate(P);
  const employed = S.sectors.reduce((s, x) => s + x.employees, 0);
  const cat = {} as Record<CategoryId, number>;
  cat.enfants = g.children;
  cat.etudiants = g.students;
  const occ = ['cadres', 'employes', 'ouvriers', 'independants', 'entrepreneurs'] as const;
  occ.forEach((o, k) => (cat[o] = S.sectors.reduce((s, x, i) => s + x.employees * SECTORS[i].occupations[k], 0)));
  cat.retraites = g.retirees;
  cat.chomeurs = Math.max(0, LF - employed);
  cat.inactifs = Math.max(0, g.workingAge - LF);
  S.demography.categories = cat;
  S.demography.labourForce = LF;
  S.demography.employed = employed;
  S.demography.unemployed = Math.max(0, LF - employed);
  S.demography.households = g.total / 2.2;
}

export function createGame(cfgIn: Partial<CountryConfig> = {}, id = 'local', name?: string): GameState {
  const cfg: CountryConfig = { ...DEFAULT_CONFIG, ...cfgIn };
  cfg.metropoles = clamp(Math.round(cfg.metropoles), 1, 8);
  cfg.villes = clamp(Math.round(cfg.villes), 0, 30);
  cfg.communes = clamp(Math.round(cfg.communes), 0, 80);
  cfg.population = clamp(cfg.population, 1e6, 8e7);
  const country = generateCountry(cfg);
  const profileSum = INITIAL_AGE_PROFILE.reduce((s, v) => s + v, 0);
  const cohorts = INITIAL_AGE_PROFILE.map((v) => (v / profileSum) * cfg.population);
  const gdpGuess = cfg.population * 40000;
  const policy = defaultPolicy(gdpGuess);
  const demography: Demography = {
    cohorts, births: 0, deaths: 0, migration: 0, fertility: 1.72, lifeExpectancy: lifeExpectancy(1),
    categories: {} as Demography['categories'], labourForce: 0, employed: 0, unemployed: 0, households: cfg.population / 2.2,
  };
  const services: Services = { sante: 0.8, education: 0.8, securite: 0.8, transports: 0.8, infrastructures: 0.8, environnement: 0.8, administration: 0.8, formation: 0.8, recherche: 0.8, logement: 0.8 };
  const shares = initialPopShares(country);
  const S: GameState = {
    version: SIM_VERSION, id, name: name ?? cfg.name, config: cfg, country, startYear: START_YEAR, month: 0, policy, pending: null,
    sectors: SECTORS.map((d) => ({ employees: 0, productivity: d.productivity, wage: d.wage, firms: 0, baseExport: 0, emissionIntensity: d.emissionIntensity, output: 0, demand: 0, profit: 0, investment: 0, failures: 0, creations: 0, vacancies: 0 })),
    cities: shares.map((sh) => ({ popShare: sh, population: sh * cfg.population, unemployment: 0.075, income: 0, satisfaction: 55, housingUnits: 0, localRevenue: 0 })),
    macro: { priceLevel: 1, inflation: 0.02, expectedInflation: 0.02, policyRate: 0.025, worldPrice: 1, worldDemand: 1, energyPrice: 1, confidence: 0.5, productivityGrowth: 0.009, consTaxRate: 0, outputGap: 0 },
    finance: { cash: 0, reserve: 0, debt: 0, avgRate: 0.022, marketRate: 0.03, bondsIssued: [] },
    services, demography,
    satisfaction: { overall: 55, byCategory: {} as GameState['satisfaction']['byCategory'], factors: {}, trust: 55, protestRisk: 0.1, strikeRisk: 0.1, unrestRisk: 0.02 },
    accounts: emptyAccounts(gdpGuess),
    baseline: { realIncomePerCap: 0, taxRate: 0, gdpReal: 0, emissionsPerCap: 0, ulc: 0, wageCost: [], margin: 0, invBase: 0.165, catTaxRate: {}, catIncome: {}, meanWage: 0 },
    history: {}, notices: [], noticeSeq: 1,
  };
  // Emploi initial : population active × (1 − 7,5 %) répartie selon la structure sectorielle
  const g = ageGroups(cohorts, policy.labour.retirementAge, 0.5);
  const LF = g.workingAge * participationRate(policy);
  const employed = LF * 0.925;
  S.sectors.forEach((s, i) => {
    s.employees = employed * SECTORS[i].employmentShare;
    s.firms = s.employees / SECTORS[i].avgFirmSize;
  });
  // amorce : marges positives plausibles (sélectionne l'équilibre à profits positifs)
  S.sectors.forEach((s, i) => { s.output = s.employees * SECTORS[i].productivity; s.profit = s.output * 0.15; });
  calibrate(S);
  updateCategories(S);
  // --- module énergie --- : parc électrique, bilan énergétique, émissions, environnement (calibrés sur l'état initial)
  initEnergy(S);
  initEnvironment(S);
  initSectors(S, true); // --- modules transports/industrie/agriculture/déchets ---
  initServicesModules(S); // --- modules services publics/recherche/construction ---
  S.services = servicesStep(S, S.policy, true); // qualités initiales lues dans les modules (0,80 par construction)
  S.satisfaction = satisfactionStep(S, S.policy, true);
  citiesStep(S, S.policy, true);
  const pop = cohorts.reduce((s, v) => s + v, 0);
  S.baseline.realIncomePerCap = S.accounts.disposableIncome / pop;
  S.baseline.emissionsPerCap = S.accounts.emissions / pop;
  S.baseline.gdpReal = S.accounts.gdpReal;
  S.baseline.meanWage = S.accounts.meanWage;
  S.baseline.catIncome = categoryIncome(S);
  S.baseline.catTaxRate = { _cons: averageConsumptionTax(S.policy), _cit: S.policy.corporate.rate, _contrib: Object.values(S.policy.contributions).reduce((s, b) => s + b.employer + b.employee, 0) };
  for (const [k, v] of Object.entries(S.accounts.taxByCategory)) S.baseline.catTaxRate[k] = v.effectiveRate;
  S.satisfaction = satisfactionStep(S, S.policy, true);
  citiesStep(S, S.policy, true);
  S.macro.consTaxRate = averageConsumptionTax(S.policy);
  initModules(S);
  recordHistory(S);
  pushNotice(S, 'info', 'Prise de fonctions', `Vous dirigez désormais ${S.name}. Le pays compte ${fmtM(pop)} d'habitants pour un PIB de ${fmtB(S.accounts.gdp)}.`);
  return S;
}

/** Calibrage : ajuste productivités, exportations de référence et budgets pour que l'état initial soit à l'équilibre. */
function calibrate(S: GameState) {
  const P = S.policy;
  const hoursF = Math.pow(P.labour.hours / 35, 0.6);
  for (let iter = 0; iter < 80; iter++) {
    S.services = servicesStep(S, P, true);
    const acc = economyStep(S, P, { calibrate: true });
    S.accounts = acc;
    // si la demande intérieure dépasse l'offre, la productivité du secteur est relevée pour l'absorber
    S.sectors.forEach((s) => {
      const p = s.output / Math.max(1, s.employees * hoursF * S.macro.priceLevel);
      if (p > s.productivity) s.productivity = p;
    });
    for (const b of BUDGET_DEFS) P.budget[b.id] = Math.round(b.gdpShare * acc.gdp);
    const invRatio = acc.investment / Math.max(1, acc.gdp);
    S.baseline.invBase *= INVEST_TARGET / Math.max(0.01, invRatio);
    S.baseline.margin = S.sectors.reduce((s, x) => s + x.profit, 0) / Math.max(1, S.sectors.reduce((s, x) => s + x.output, 0));
  }
  P.finance.minCash = Math.round(S.accounts.gdp * 0.015);
  S.finance.debt = S.accounts.gdp * 0.78;
  S.finance.cash = S.accounts.gdp * 0.03;
  S.finance.avgRate = 0.022;
  S.finance.marketRate = 0.03;
  S.accounts = economyStep(S, P, { calibrate: true });
}

// ---------- Pas mensuel ----------
export function tick(S: GameState): void {
  ensureServicesModules(S); // --- modules services publics/recherche/construction --- (anciennes sauvegardes)
  const missionsBefore = missionsPre(S); // --- missions --- : valeurs avant le mois (retours « avant → après »)
  if (S.pending && S.pending.month <= S.month + 1) {
    describePolicyChange(S, S.policy, S.pending.policy);
    S.policy = S.pending.policy;
    S.pending = null;
  }
  const P = S.policy;
  const before = snapshotIndicators(S);
  S.month += 1;
  // --- modules politique/international/événements/victoire ---
  legislativeStep(S); // votes des projets de loi (une loi adoptée s'applique dès ce mois)
  eventsStep(S); // effets temporaires, options par défaut à échéance, tirage d'un événement
  internationalStep(S); // voisins, accords, représailles, facteurs macro (demande, énergie, prix mondiaux)
  applyExtraBudget(S); // crédits exceptionnels du mois (comptabilisés dans les dépenses)
  // 1. Démographie
  S.demography = demographyStep(S.demography, {
    healthQuality: S.services.sante,
    airQuality: airQuality(S),
    satisfaction: S.satisfaction.overall,
    unemployment: S.demography.unemployed / Math.max(1, S.demography.labourForce),
    familyAllowance: P.labour.familyAllowance,
    housingPressure: clamp((0.8 - S.services.logement) * 2, 0, 1),
    priceLevel: S.macro.priceLevel,
  });
  // 2. Économie, fiscalité, finances publiques
  S.accounts = economyStep(S, P, { calibrate: false });
  // --- module énergie --- : production électrique, prix de l'énergie, émissions, environnement, flux budgétaires associés
  energyStep(S, P);
  environmentStep(S, P);
  // --- modules transports/industrie/agriculture/déchets ---
  sectorsStep(S);
  // 3. Inflation mesurée sur 12 mois
  const ph = S.history.priceLevel ?? [];
  const p12 = ph.length >= 12 ? ph[ph.length - 12] : ph[0] ?? 1;
  S.macro.inflation = ph.length >= 12 ? S.macro.priceLevel / p12 - 1 : S.macro.expectedInflation;
  // 4. Catégories, services, satisfaction, villes
  updateCategories(S);
  // --- modules services publics/recherche/construction ---
  servicesModulesStep(S, (kind, title, text) => pushNotice(S, kind, title, text));
  S.services = servicesStep(S, P, false);
  S.satisfaction = satisfactionStep(S, P, false);
  citiesStep(S, P, false);
  // --- modules politique/international/événements/victoire ---
  removeExtraBudget(S);
  politicsStep(S); // popularité, groupes d'intérêt, censure, élections
  victoryStep(S); // victoires et défaites
  servicesPostStep(S); // --- modules services publics/recherche/construction ---
  recordHistory(S);
  climateStep(S); // --- plan climat --- : référence 2030, cumul, risque, jauges de soutien, suivi des cartes, jalons
  missionsStep(S, missionsBefore); // --- missions --- : progression, récompenses, trophées, retours, bilan annuel
  // 5. Indexation automatique
  if (P.finance.indexBudgets) {
    // budgets indexés sur le salaire moyen (services publics intensifs en main-d'œuvre), barème et SMIC sur l'inflation
    const wh = S.history.meanWage ?? [];
    const kw = wh.length >= 2 && wh[wh.length - 2] > 0 ? Math.max(1, wh[wh.length - 1] / wh[wh.length - 2]) : 1;
    for (const b of BUDGET_LINES) P.budget[b] *= kw;
    const k = 1 + Math.max(0, S.macro.inflation) / 12;
    P.labour.minWage *= k;
    P.incomeTax.brackets = P.incomeTax.brackets.map((b) => ({ upTo: b.upTo === null ? null : b.upTo * k, rate: b.rate }));
  }
  checkAlerts(S, before);
}

function snapshotIndicators(S: GameState) {
  return { u: S.demography.unemployed / Math.max(1, S.demography.labourForce), sat: S.satisfaction.overall, deficit: -S.accounts.balance / Math.max(1, S.accounts.gdp), infl: S.macro.inflation, bonds: S.finance.bondsIssued.length, debt: S.finance.debt / Math.max(1, S.accounts.gdp) };
}

export const HISTORY_KEYS = [
  'gdp', 'gdpReal', 'growth', 'inflation', 'priceLevel', 'unemployment', 'population', 'employment', 'debt', 'debtRatio', 'deficitRatio', 'balance',
  'revenue', 'spending', 'cash', 'satisfaction', 'trust', 'emissions', 'meanWage', 'medianWage', 'gini', 'poverty', 'births', 'deaths', 'migration',
  'lifeExpectancy', 'exports', 'imports', 'consumption', 'investment', 'policyRate', 'marketRate', 'firms', 'failures', 'disposablePerCap', 'productivityGrowth',
  // --- modules politique/international/événements/victoire ---
  'govPopularity', 'coalitionSeats', 'tariff', 'retaliation', 'intlDemand', 'intlEnergy',
  // --- module énergie ---
  'elecRenShare', 'finalRenShare', 'elecPrice', 'wholesalePrice', 'energyPrice', 'elecDemand', 'elecProduction', 'elecImports', 'elecExports', 'unserved',
  'shortageRisk', 'capacityMargin', 'finalEnergy', 'emissionsGross', 'emissionsNet', 'absorptions', 'fossilCO2', 'footprint', 'powerCO2', 'carbonIntensityElec', 'evShare',
  'airQuality', 'waterQuality', 'biodiversity', 'envQuality', 'forestShare', 'artifShare', 'protectedShare',
] as const;

function recordHistory(S: GameState) {
  const A = S.accounts;
  const pop = S.demography.cohorts.reduce((s, v) => s + v, 0);
  const H = S.history;
  const push = (k: string, v: number) => { (H[k] ??= []).push(Math.round(v * 1e6) / 1e6); };
  const realHist = H.gdpReal ?? [];
  const g = realHist.length >= 12 ? A.gdpReal / realHist[realHist.length - 12] - 1 : 0.012;
  push('gdp', A.gdp);
  push('gdpReal', A.gdpReal);
  push('growth', g);
  push('inflation', S.macro.inflation);
  push('priceLevel', S.macro.priceLevel);
  push('unemployment', S.demography.unemployed / Math.max(1, S.demography.labourForce));
  push('population', pop);
  push('employment', S.demography.employed);
  push('debt', S.finance.debt);
  push('debtRatio', S.finance.debt / Math.max(1, A.gdp));
  push('deficitRatio', -A.balance / Math.max(1, A.gdp));
  push('balance', A.balance);
  push('revenue', A.revenueTotal);
  push('spending', A.spendingTotal);
  push('cash', S.finance.cash);
  push('satisfaction', S.satisfaction.overall);
  push('trust', S.satisfaction.trust);
  push('emissions', A.emissions);
  push('meanWage', A.meanWage);
  push('medianWage', A.medianWage);
  push('gini', A.gini);
  push('poverty', A.poverty);
  push('births', S.demography.births);
  push('deaths', S.demography.deaths);
  push('migration', S.demography.migration);
  push('lifeExpectancy', S.demography.lifeExpectancy);
  push('exports', A.exports);
  push('imports', A.imports);
  push('consumption', A.consumption);
  push('investment', A.investment);
  push('policyRate', S.macro.policyRate);
  push('marketRate', S.finance.marketRate);
  push('firms', S.sectors.reduce((s, x) => s + x.firms, 0));
  push('failures', A.failures);
  push('disposablePerCap', A.disposableIncome / Math.max(1, pop));
  push('productivityGrowth', S.macro.productivityGrowth);
  // --- modules politique/international/événements/victoire ---
  if (S.politics) {
    const Pol = S.politics;
    push('govPopularity', Pol.parties.filter((p) => Pol.coalition.includes(p.id)).reduce((s, p) => s + p.popularity, 0));
    push('coalitionSeats', Pol.parties.filter((p) => Pol.coalition.includes(p.id)).reduce((s, p) => s + p.seats, 0));
    for (const p of Pol.parties) push('party_' + p.id, p.popularity);
  }
  if (S.international) {
    push('tariff', S.policy.trade?.tariff ?? 0);
    push('retaliation', S.international.retaliation);
    push('intlDemand', S.international.demandFactor);
    push('intlEnergy', S.international.energyFactor);
  }
  recordSectorHistory(S, push);
  for (const [k, v] of Object.entries(A.revenue)) push('rev_' + k, v);
  for (const [k, v] of Object.entries(A.spending)) push('dep_' + k, v);
  // --- module énergie ---
  for (const [k, v] of Object.entries({ ...energyHistory(S), ...environmentHistory(S) })) push(k, v);
  recordServicesHistory(S, push); // --- modules services publics/recherche/construction ---
}

export function pushNotice(S: GameState, kind: Notice['kind'], title: string, text: string) {
  S.notices.push({ id: S.noticeSeq++, month: S.month, kind, title, text });
  if (S.notices.length > 80) S.notices.shift();
}

function checkAlerts(S: GameState, b: ReturnType<typeof snapshotIndicators>) {
  const a = snapshotIndicators(S);
  const cross = (prev: number, cur: number, th: number) => prev < th && cur >= th;
  const down = (prev: number, cur: number, th: number) => prev > th && cur <= th;
  if (cross(b.u, a.u, 0.1)) pushNotice(S, 'bad', 'Chômage de masse', `Le taux de chômage dépasse 10 % (${pct(a.u)}).`);
  if (down(b.u, a.u, 0.05)) pushNotice(S, 'good', 'Plein emploi en vue', `Le chômage passe sous 5 % (${pct(a.u)}). Attention aux tensions salariales.`);
  if (cross(b.infl, a.infl, 0.05)) pushNotice(S, 'warn', 'Poussée inflationniste', `L'inflation sur un an atteint ${pct(a.infl)}.`);
  if (down(b.infl, a.infl, 0)) pushNotice(S, 'warn', 'Déflation', 'Les prix baissent sur un an : risque de spirale déflationniste.');
  if (cross(b.deficit, a.deficit, 0.05)) pushNotice(S, 'warn', 'Déficit élevé', `Le déficit public dépasse 5 % du PIB (${pct(a.deficit)}). Les taux d'emprunt vont monter.`);
  if (down(b.deficit, a.deficit, 0)) pushNotice(S, 'good', 'Budget à l\'équilibre', 'Les recettes couvrent désormais les dépenses publiques.');
  if (cross(b.debt, a.debt, 1)) pushNotice(S, 'bad', 'Dette > 100 % du PIB', 'Les marchés exigent une prime de risque croissante.');
  if (down(b.sat, a.sat, 40)) pushNotice(S, 'bad', 'Colère populaire', `La satisfaction tombe à ${a.sat.toFixed(0)}/100. Risque de manifestations.`);
  if (cross(b.sat, a.sat, 65)) pushNotice(S, 'good', 'Population satisfaite', `La satisfaction atteint ${a.sat.toFixed(0)}/100.`);
  if (a.bonds > b.bonds || (S.finance.bondsIssued.length === 40 && S.finance.bondsIssued[39].month === S.month)) {
    const last = S.finance.bondsIssued[S.finance.bondsIssued.length - 1];
    if (last && last.month === S.month && last.auto) pushNotice(S, 'info', 'Émission obligataire automatique', `Trésorerie insuffisante : ${fmtB(last.amount)} empruntés à ${pct(last.rate)}.`);
  }
  if (S.month % 12 === 0) {
    const A = S.accounts;
    pushNotice(S, 'info', `Bilan de l'année ${S.startYear + S.month / 12 - 1}`, `Croissance ${pct(S.history.growth.at(-1) ?? 0)}, inflation ${pct(S.macro.inflation)}, chômage ${pct(a.u)}, solde public ${pct(A.balance / A.gdp)} du PIB.`);
  }
}

function describePolicyChange(S: GameState, a: Policy, b: Policy) {
  const changes: string[] = [];
  if (JSON.stringify(a.incomeTax) !== JSON.stringify(b.incomeTax)) changes.push('impôt sur le revenu');
  if (JSON.stringify(a.corporate) !== JSON.stringify(b.corporate)) changes.push('impôt sur les sociétés');
  if (JSON.stringify(a.vat) !== JSON.stringify(b.vat)) changes.push('TVA');
  if (JSON.stringify(a.wealth) !== JSON.stringify(b.wealth)) changes.push('impôt sur le patrimoine');
  if (JSON.stringify(a.property) !== JSON.stringify(b.property)) changes.push('fiscalité immobilière');
  if (JSON.stringify(a.eco) !== JSON.stringify(b.eco)) changes.push('fiscalité écologique');
  if (JSON.stringify(a.contributions) !== JSON.stringify(b.contributions)) changes.push('cotisations sociales');
  if (JSON.stringify(a.labour) !== JSON.stringify(b.labour)) changes.push('droit du travail et protection sociale');
  if (JSON.stringify(a.energy) !== JSON.stringify(b.energy)) changes.push('politique énergétique et environnementale');
  if (JSON.stringify(a.transport) !== JSON.stringify(b.transport)) changes.push('transports');
  if (JSON.stringify(a.industry) !== JSON.stringify(b.industry)) changes.push('politique industrielle');
  if (JSON.stringify(a.agriculture) !== JSON.stringify(b.agriculture)) changes.push('politique agricole');
  if (JSON.stringify(a.waste) !== JSON.stringify(b.waste)) changes.push('gestion des déchets');
  // --- modules services publics/recherche/construction ---
  if (JSON.stringify(a.health) !== JSON.stringify(b.health)) changes.push('politique de santé');
  if (JSON.stringify(a.education) !== JSON.stringify(b.education)) changes.push('politique éducative');
  if (JSON.stringify(a.housing) !== JSON.stringify(b.housing)) changes.push('politique du logement');
  if (JSON.stringify(a.security) !== JSON.stringify(b.security)) changes.push('sécurité et justice');
  if (JSON.stringify(a.research) !== JSON.stringify(b.research)) changes.push('recherche');
  const budgetChanged = BUDGET_LINES.some((k) => Math.abs(a.budget[k] - b.budget[k]) > 1);
  if (budgetChanged) changes.push('budget');
  if ((a.trade?.tariff ?? 0) !== (b.trade?.tariff ?? 0)) changes.push('droits de douane');
  if (changes.length) pushNotice(S, 'info', 'Réformes en vigueur', `Entrée en vigueur : ${changes.join(', ')}.`);
}

/**
 * Programme une nouvelle politique : elle entre en vigueur au début du mois suivant.
 * - Par défaut (procédure directe, utilisée par les tests et les scripts) : toute la politique est appliquée telle quelle.
 * - Avec `{ parliament: true }` (utilisé par le serveur) : les petits ajustements restent des décrets (mois suivant),
 *   les changements majeurs (voir LAW_THRESHOLDS dans politics.ts) deviennent des projets de loi votés au début du mois
 *   suivant ; une loi rejetée n'entre pas en vigueur.
 */
export function schedulePolicy(S: GameState, proposal: Policy, opts: { parliament?: boolean } = {}): { bills: Bill[] } {
  const base = S.pending?.policy ?? S.policy;
  const sanitized = sanitizePolicy(proposal, base);
  if (!opts.parliament || !S.politics) {
    S.pending = { month: S.month + 1, policy: sanitized };
    return { bills: [] };
  }
  const { decree, bills } = splitReform(S, base, sanitized);
  S.pending = { month: S.month + 1, policy: decree };
  submitBills(S, bills);
  return { bills };
}

/** Initialise les modules politique, international, événements et victoire (nouvelle partie ou ancienne sauvegarde). */
export function initModules(S: GameState) {
  if (!S.policy.trade) S.policy.trade = { tariff: 0 };
  if (S.pending && !S.pending.policy.trade) S.pending.policy.trade = { tariff: 0 };
  if (!S.events) S.events = initEvents();
  if (!S.politics) initPolitics(S);
  if (!S.international) S.international = initInternational(S);
  if (!S.victory) initVictory(S);
  // --- missions --- : créées après les autres modules (les missions se fondent sur les besoins réels)
  if (S.energy && S.health) ensureMissions(S);
  if (S.energy) ensureClimate(S); // --- plan climat ---
}

/** Actions de gouvernement hors politique fiscale : décisions d'événements, diplomatie, parlement, poursuite après défaite. */
export type GovAction =
  | { type: 'evenement'; uid: number; option: string }
  | DiplomaticAction
  | PoliticalAction
  | { type: 'continuer' }
  // --- plan climat --- : carte-action (validée par le moteur : déblocage, soutien, mécanisme réel) et choix de trajectoire
  | { type: 'climatCard'; card: string }
  | { type: 'climatTrajectoire'; mode: 'lineaire' | 'exponentielle' };

export function applyGovAction(S: GameState, a: GovAction): { ok: boolean; msg: string } {
  if (!a || typeof a !== 'object') return { ok: false, msg: 'Action invalide' };
  switch (a.type) {
    case 'evenement': return resolveEvent(S, Number(a.uid), String(a.option));
    case 'accord': case 'rompreAccord': case 'diplomatie': return applyDiplomaticAction(S, a);
    case 'confiance': case 'dissolution': case 'coalition': case 'retirerLoi': return applyPoliticalAction(S, a);
    case 'continuer': return continueAfterDefeat(S);
    // --- plan climat --- : les leviers de politique d'une carte passent par la procédure parlementaire (décret ou loi)
    case 'climatCard': return playClimateCard(S, String(a.card), { schedule: (p) => schedulePolicy(S, p, { parliament: true }) });
    case 'climatTrajectoire': return setTrajectoryMode(S, String(a.mode));
    default: return { ok: false, msg: 'Action inconnue' };
  }
}

export type FinanceAction = { type: 'bonds'; amount: number } | { type: 'repay'; amount: number } | { type: 'toReserve'; amount: number } | { type: 'fromReserve'; amount: number };

/** Toutes les actions ponctuelles du joueur (finances, programmes énergétiques et environnementaux). */
export type GameAction = FinanceAction | EnergyAction | EnvAction;

export function applyAction(S: GameState, a: GameAction): { ok: boolean; msg: string } {
  // --- module énergie ---
  if (isEnergyAction(a)) return applyEnergyAction(S, a);
  if (isEnvAction(a)) return applyEnvAction(S, a);
  const F = S.finance;
  const amount = Math.max(0, Number(a.amount) || 0);
  if (!amount) return { ok: false, msg: 'Montant invalide' };
  if (a.type === 'bonds') {
    if (amount > S.accounts.gdp * 0.2) return { ok: false, msg: 'Émission limitée à 20 % du PIB par opération' };
    const rate = F.marketRate + (amount / S.accounts.gdp) * 0.02; // une émission massive renchérit le coût
    F.avgRate = (F.avgRate * F.debt + rate * amount) / (F.debt + amount);
    F.debt += amount;
    F.cash += amount;
    F.bondsIssued.push({ month: S.month, amount, rate, auto: false });
    if (F.bondsIssued.length > 40) F.bondsIssued.shift();
    pushNotice(S, 'info', 'Émission d\'obligations', `${fmtB(amount)} levés à ${pct(rate)}.`);
    return { ok: true, msg: `Obligations émises : ${fmtB(amount)} à ${pct(rate)}` };
  }
  if (a.type === 'repay') {
    if (amount > F.cash) return { ok: false, msg: 'Trésorerie insuffisante' };
    F.cash -= amount;
    F.debt = Math.max(0, F.debt - amount);
    pushNotice(S, 'good', 'Remboursement anticipé', `${fmtB(amount)} de dette remboursés.`);
    return { ok: true, msg: `Dette remboursée : ${fmtB(amount)}` };
  }
  if (a.type === 'toReserve') {
    if (amount > F.cash) return { ok: false, msg: 'Trésorerie insuffisante' };
    F.cash -= amount;
    F.reserve += amount;
    return { ok: true, msg: `${fmtB(amount)} placés dans le fonds de réserve` };
  }
  if (a.type === 'fromReserve') {
    if (amount > F.reserve) return { ok: false, msg: 'Réserve insuffisante' };
    F.reserve -= amount;
    F.cash += amount;
    return { ok: true, msg: `${fmtB(amount)} retirés du fonds de réserve` };
  }
  return { ok: false, msg: 'Action inconnue' };
}

// --- actions des modules transports/industrie/agriculture/déchets ---
export type { SectorAction };
export { SECTOR_HISTORY_KEYS };

/** Programmes sectoriels (lignes, véhicules, installations, plans) : placés automatiquement, payés pendant les travaux. */
export function applyProgramAction(S: GameState, a: SectorAction): { ok: boolean; msg: string } {
  const r = applySectorAction(S, a);
  if (r.ok) pushNotice(S, 'info', 'Programme engagé', r.msg);
  return r;
}

// --- modules services publics/recherche/construction ---
/** Action d'un ministère (recrutement, programme d'investissement, plan logement, recherche). Voir `services.ts`. */
export function applyServiceAction(S: GameState, a: ServicesAction) {
  return applyServicesAction(S, a, (kind, title, text) => pushNotice(S, kind, title, text));
}

/** Données envoyées au client à chaque mois (sans la géographie ni l'historique complet). */
export function snapshot(S: GameState) {
  const { country: _c, history: _h, ...rest } = S;
  const last: Record<string, number> = {};
  for (const [k, v] of Object.entries(S.history)) last[k] = v[v.length - 1];
  return { ...rest, last, date: dateLabel(S.month, S.startYear) };
}
export type Snapshot = ReturnType<typeof snapshot>;

export function migrate(S: GameState): GameState {
  initModules(S); // anciennes sauvegardes : modules politique/international/événements/victoire
  // --- module énergie --- : sauvegardes antérieures au module
  if (!S.policy.energy) S.policy.energy = { ...DEFAULT_ENERGY_POLICY };
  if (S.pending && !S.pending.policy.energy) S.pending.policy.energy = { ...S.policy.energy };
  if (!S.energy) initEnergy(S);
  if (!S.environment) initEnvironment(S);
  ensureMissions(S); // --- missions --- : anciennes sauvegardes sans missions
  ensureClimate(S); // --- plan climat --- : anciennes sauvegardes (référence et cumul reconstitués depuis l'historique)
  return S; // point d'entrée des futures migrations de sauvegardes
}

const pct = (v: number) => `${(v * 100).toFixed(1).replace('.', ',')} %`;
const fmtB = (v: number) => `${(v / 1e9).toFixed(1).replace('.', ',')} Md€`;
const fmtM = (v: number) => `${(v / 1e6).toFixed(2).replace('.', ',')} millions`;

export { mortalityMultiplier, AGE_BANDS, CATEGORY_IDS };
