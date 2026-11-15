/**
 * Onglet « Économie » du tableau de bord Population : loyers, ménages en difficulté, chômage par quartier,
 * éducation et emplois, entreprises (en difficulté, fermées, raisons). Lecture TOLÉRANTE du champ facultatif
 * `demography.living` du rapport : absent ou incomplet, la section l'indique sans inventer de chiffre.
 * Présentation volontairement sobre (lignes et barres existantes), lisible sur iPhone.
 */
import type { SimReport } from '../sim/sim-protocol';
import { MONTHS_SHORT } from './charts';
import { el, fmt, money, pct } from './dom';

type Bar = (label: string, value: number, max: number, text: string) => HTMLElement;

interface Reason { label: string; count: number }
interface Living {
  pressure: number; rentAverage: number; rentBurden: number; householdIncomeAverage: number;
  householdsInDistress: number; distressShare: number; landValueAverage: number; businessRentAverage: number;
  companiesActive: number; companiesInDifficulty: number; companiesClosed: number;
  closureReasons: Reason[]; difficultyReasons: Reason[];
  recentClosures: { name: string; sector: string; reason: string; day: number }[];
  jobsVacant: number; vacancyRate: number;
  districts: { name: string; population: number; laborForce: number; unemployed: number; rate: number; rent: number }[];
  education: { tiers: string[]; adults: number[]; jobs: number[]; workers: number[]; underqualified: number; overqualified: number; mismatchShare: number };
  month: { relocations: number; departuresRent: number; closures: number; reopenings: number; graduates: number };
  lastMonth: { relocations: number; departuresRent: number; closures: number; reopenings: number; graduates: number };
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? v as T[] : []);

/** Champ `living` du rapport (null s'il est absent : simulation plus ancienne ou premier jour pas encore passé). */
export function livingOf(r: SimReport | null): Living | null {
  const v = (r?.demography as { living?: unknown } | undefined)?.living;
  return v && typeof v === 'object' ? v as Living : null;
}

const rows = (list: [string, string, string?][]): HTMLElement => el('dl', { cls: 'rows' },
  ...list.flatMap(([k, v, cls]) => [el('dt', { text: k }), el('dd', { text: v, ...(cls ? { cls } : {}) })]));

/** Lignes ajoutées à l'aperçu de la population (loyer moyen, ménages en difficulté) ; vide si absent. */
export function livingOverviewRows(r: SimReport | null): [string, string][] {
  const L = livingOf(r);
  if (!L) return [];
  return [
    ['Loyer moyen', `${money(num(L.rentAverage))} / mois (${pct(num(L.rentBurden))} des ressources)`],
    ['Ménages en difficulté (loyer)', `${fmt(num(L.householdsInDistress))} (${pct(num(L.distressShare), 1)})`],
  ];
}

/** Contenu de l'onglet Économie. */
export function renderLivingEconomy(r: SimReport | null, bar: Bar): HTMLElement {
  const box = el('div', { cls: 'eco-vivante' });
  const L = livingOf(r);
  if (!L) {
    box.append(el('p', { cls: 'muted small', text: 'Les loyers, l’emploi par quartier et les comptes des entreprises apparaissent après le premier jour de jeu.' }));
    return box;
  }
  const d = r!.demography;
  const pressure = num(L.pressure);
  if (pressure < 1) {
    box.append(el('p', { cls: 'muted small', text: pressure <= 0
      ? 'Début de partie : les loyers et les pertes des entreprises ne pèsent pas encore (période de grâce).'
      : `Pression économique en montée : ${pct(pressure)} de son plein effet.` }));
  }

  // Logement.
  box.append(el('div', { cls: 'sec-title', text: 'Logement' }));
  box.append(rows([
    ['Loyer moyen d’un ménage', `${money(num(L.rentAverage))} / mois`],
    ['Ressources moyennes d’un ménage', `${money(num(L.householdIncomeAverage))} / mois`],
    ['Part des ressources pour le loyer', pct(num(L.rentBurden))],
    ['Ménages en difficulté', `${fmt(num(L.householdsInDistress))} (${pct(num(L.distressShare), 1)})`, num(L.distressShare) > 0.1 ? 'neg' : ''],
    ['Valeur foncière moyenne', `${fmt(num(L.landValueAverage))} (100 = référence)`],
    ['Ce mois : déménagements · départs (loyer)', `${fmt(num(L.month?.relocations))} · ${fmt(num(L.month?.departuresRent))}`],
    ['Mois dernier : déménagements · départs (loyer)', `${fmt(num(L.lastMonth?.relocations))} · ${fmt(num(L.lastMonth?.departuresRent))}`],
  ]));

  // Emploi.
  box.append(el('div', { cls: 'sec-title', text: 'Emploi' }));
  box.append(rows([
    ['Chômage (ville)', `${fmt(num(d.unemployed))} (${pct(num(d.unemploymentRate), 1)})`, num(d.unemploymentRate) > 0.12 ? 'neg' : ''],
    ['Postes vacants (entreprises)', `${fmt(num(L.jobsVacant))} (${pct(num(L.vacancyRate))} de la capacité)`],
  ]));
  const districts = arr<Living['districts'][number]>(L.districts);
  if (districts.length) {
    box.append(el('div', { cls: 'muted small', text: 'Chômage par quartier (secteurs, sinon îlots de 500 m)' }));
    box.append(rows(districts.map((q) => [q.name, `${pct(num(q.rate), 1)} · ${fmt(num(q.population))} hab. · loyer ${money(num(q.rent))}`, num(q.rate) > 0.12 ? 'neg' : ''] as [string, string, string])));
  }

  // Éducation.
  const ed = L.education;
  if (ed && Array.isArray(ed.tiers)) {
    box.append(el('div', { cls: 'sec-title', text: 'Éducation et emplois' }));
    const adults = arr<number>(ed.adults), jobs = arr<number>(ed.jobs);
    const max = Math.max(1, ...adults, ...jobs);
    ed.tiers.forEach((t, i) => {
      box.append(bar(`${t} : adultes`, num(adults[i]), max, fmt(num(adults[i]))));
      box.append(bar(`${t} : emplois exigeant ce niveau`, num(jobs[i]), max, fmt(num(jobs[i]))));
    });
    box.append(rows([
      ['Employés sous-qualifiés', fmt(num(ed.underqualified)), num(ed.underqualified) > 0 ? 'neg' : ''],
      ['Employés surqualifiés', fmt(num(ed.overqualified))],
      ['Diplômés ce mois · mois dernier', `${fmt(num(L.month?.graduates))} · ${fmt(num(L.lastMonth?.graduates))}`],
    ]));
  }

  // Entreprises.
  box.append(el('div', { cls: 'sec-title', text: 'Entreprises' }));
  box.append(rows([
    ['En activité', fmt(num(L.companiesActive))],
    ['En difficulté (pertes)', fmt(num(L.companiesInDifficulty)), num(L.companiesInDifficulty) > 0 ? 'neg' : ''],
    ['Fermées (locaux vacants)', fmt(num(L.companiesClosed)), num(L.companiesClosed) > 0 ? 'neg' : ''],
    ['Loyer moyen d’un local', `${money(num(L.businessRentAverage))} / mois`],
    ['Ce mois : fermetures · reprises', `${fmt(num(L.month?.closures))} · ${fmt(num(L.month?.reopenings))}`],
  ]));
  const why = (title: string, list: Reason[]): void => {
    const xs = arr<Reason>(list).filter((x) => num(x.count) > 0);
    if (!xs.length) return;
    box.append(el('div', { cls: 'muted small', text: title }));
    box.append(rows(xs.map((x) => [String(x.label), fmt(num(x.count))] as [string, string])));
  };
  why('Raisons des difficultés', L.difficultyReasons);
  why('Raisons des fermetures (locaux vacants)', L.closureReasons);
  const recent = arr<Living['recentClosures'][number]>(L.recentClosures);
  if (recent.length) {
    box.append(el('div', { cls: 'muted small', text: 'Dernières fermetures' }));
    // Jour de jeu (calendrier de 12 mois de 30 jours) -> « 12 avr. an 1 ».
    const date = (day: number): string => `${(day % 30) + 1} ${MONTHS_SHORT[Math.floor((day % 360) / 30)] ?? ''} an ${Math.floor(day / 360) + 1}`;
    box.append(rows(recent.map((c) => [`${c.name} (${c.sector})`, `${date(num(c.day))} : ${c.reason}`] as [string, string])));
  }
  return box;
}
