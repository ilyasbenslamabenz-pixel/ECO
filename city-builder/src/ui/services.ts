/**
 * Onglet « Services » du tableau de bord Population : criminalité, incendies, santé, équipements (capacité,
 * couverture, entretien) et où ça manque. Lecture TOLÉRANTE du champ facultatif `demography.cityServices` du rapport :
 * absent, l'onglet l'indique sans inventer de chiffre. Lignes et barres existantes, lisible sur iPhone (390 px).
 */
import type { SimReport } from '../sim/sim-protocol';
import { MONTHS_SHORT } from './charts';
import { el, fmt, money, pct } from './dom';

type Bar = (label: string, value: number, max: number, text: string) => HTMLElement;
interface Counters { fires: number; firesOut: number; destroyed: number; damaged: number; incidents: number; sickCases: number; sickDeaths: number; rebuilt: number }
interface Services {
  pressure: number;
  crime: { average: number; high: number; incidentsToday: number; hotspots: { name: string; crime: number; buildings: number }[] };
  fire: { burning: number; damaged: number; ruins: number; riskAverage: number; uncovered: number; occupied: number };
  health: { average: number; sick: number; sickShare: number; uncoveredResidents: number; residents: number };
  coverage: { police: number; fire: number; health: number };
  stations: { service: 'police' | 'pompiers' | 'sante'; count: number; units: number; capacity: number; upkeep: number }[];
  month: Counters; lastMonth: Counters;
  recent: { kind: string; day: number; text: string }[];
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? v as T[] : []);
const rows = (list: [string, string, string?][]): HTMLElement => el('dl', { cls: 'rows' },
  ...list.flatMap(([k, v, cls]) => [el('dt', { text: k }), el('dd', { text: v, ...(cls ? { cls } : {}) })]));
const date = (day: number): string => `${(day % 30) + 1} ${MONTHS_SHORT[Math.floor((day % 360) / 30)] ?? ''}`;

/** Champ `cityServices` du rapport (null s'il est absent). */
export function servicesOf(r: SimReport | null): Services | null {
  const v = (r?.demography as { cityServices?: unknown } | undefined)?.cityServices;
  return v && typeof v === 'object' ? v as Services : null;
}

const STATION_FR: Record<string, { name: string; unit: string; build: string }> = {
  police: { name: 'Police', unit: 'patrouilles', build: 'un commissariat' },
  pompiers: { name: 'Pompiers', unit: 'engins', build: 'une caserne de pompiers' },
  sante: { name: 'Santé', unit: 'lits', build: 'un centre de santé (ou un hôpital)' },
};

/** Lignes ajoutées à l'aperçu de la population (criminalité, incendies, malades) ; vide si absent. */
export function servicesOverviewRows(r: SimReport | null): [string, string][] {
  const S = servicesOf(r);
  if (!S) return [];
  return [
    ['Criminalité moyenne', `${fmt(num(S.crime?.average))} / 100`],
    ['Malades', `${fmt(num(S.health?.sick))} (${pct(num(S.health?.sickShare), 1)})`],
    ...(num(S.fire?.burning) + num(S.fire?.ruins) > 0 ? [['Incendies en cours · ruines', `${fmt(num(S.fire.burning))} · ${fmt(num(S.fire.ruins))}`] as [string, string]] : []),
  ];
}

/** Contenu de l'onglet Services. */
export function renderCityServices(r: SimReport | null, bar: Bar): HTMLElement {
  const box = el('div', { cls: 'eco-vivante services-tab' });
  const S = servicesOf(r);
  if (!S) {
    box.append(el('p', { cls: 'muted small', text: 'Criminalité, incendies et santé apparaissent après le premier jour de jeu.' }));
    return box;
  }
  const pressure = num(S.pressure);
  if (pressure < 1) {
    box.append(el('p', { cls: 'muted small', text: pressure <= 0
      ? 'Début de partie : ni délits, ni incendies, ni maladies pour l’instant (période de grâce). Préparez police, pompiers et soins.'
      : `Pression en montée : ${pct(pressure)} de son plein effet (délits, incendies et maladies deviennent plus fréquents).` }));
  }
  const m = S.month ?? {} as Counters, lm = S.lastMonth ?? {} as Counters;
  box.append(el('div', { cls: 'kpis' },
    el('div', { cls: 'kpi' }, el('span', { cls: 'lbl', text: 'Criminalité' }), el('b', { text: `${fmt(num(S.crime?.average))}` })),
    el('div', { cls: 'kpi' }, el('span', { cls: 'lbl', text: 'Santé' }), el('b', { text: `${fmt(num(S.health?.average))}` }))));

  // Où ça manque.
  const gaps: string[] = [];
  const st = (k: string) => arr<Services['stations'][number]>(S.stations).find((x) => x.service === k);
  if (num(S.fire?.uncovered) > 0) gaps.push(`${fmt(num(S.fire.uncovered))} bâtiment(s) occupé(s) sur ${fmt(num(S.fire.occupied))} hors de portée des pompiers : construisez ${STATION_FR['pompiers']!.build} à proximité.`);
  if (num(S.health?.uncoveredResidents) > 0) gaps.push(`${fmt(num(S.health.uncoveredResidents))} habitant(s) sans accès aux soins${num(st('sante')?.count) > 0 ? ' (rayon ou capacité des lits dépassés)' : ''} : ${STATION_FR['sante']!.build}.`);
  if (num(S.health?.residents) > 0 && num(S.coverage?.police) < 0.8) gaps.push(`Police : ${pct(num(S.coverage.police))} des habitants couverts — ${STATION_FR['police']!.build} réduirait la délinquance.`);
  if (num(S.fire?.ruins) > 0) gaps.push(`${fmt(num(S.fire.ruins))} ruine(s) à démolir ou reconstruire (fiche du bâtiment).`);
  box.append(el('div', { cls: 'sec-title', text: 'Où ça manque' }));
  box.append(gaps.length ? el('ul', { cls: 'svc-gaps small' }, ...gaps.map((g) => el('li', { text: g }))) : el('p', { cls: 'small pos', text: 'Tous les habitants sont couverts par la police, les pompiers et les soins.' }));
  box.append(el('p', { cls: 'muted small', text: 'Cartes détaillées : bouton Calques › Criminalité, Risque d’incendie, Santé.' }));

  // Sécurité.
  box.append(el('div', { cls: 'sec-title', text: 'Sécurité' }));
  box.append(rows([
    ['Criminalité moyenne (0-100)', fmt(num(S.crime?.average)), num(S.crime?.average) >= 30 ? 'neg' : ''],
    ['Bâtiments à criminalité élevée', fmt(num(S.crime?.high)), num(S.crime?.high) > 0 ? 'neg' : ''],
    ['Délits aujourd’hui', fmt(num(S.crime?.incidentsToday))],
    ['Délits ce mois · mois dernier', `${fmt(num(m.incidents))} · ${fmt(num(lm.incidents))}`],
    ['Habitants couverts par la police', pct(num(S.coverage?.police))],
  ]));
  const hot = arr<Services['crime']['hotspots'][number]>(S.crime?.hotspots);
  if (hot.length) {
    box.append(el('div', { cls: 'muted small', text: 'Secteurs les plus touchés' }));
    for (const h of hot) box.append(bar(h.name, num(h.crime), 100, `${fmt(num(h.crime))} · ${fmt(num(h.buildings))} bât.`));
  }

  // Incendies.
  box.append(el('div', { cls: 'sec-title', text: 'Incendies' }));
  box.append(rows([
    ['Risque moyen (0-100)', fmt(num(S.fire?.riskAverage)), num(S.fire?.riskAverage) >= 50 ? 'neg' : ''],
    ['Bâtiments hors de portée des pompiers', `${fmt(num(S.fire?.uncovered))} / ${fmt(num(S.fire?.occupied))}`, num(S.fire?.uncovered) > 0 ? 'neg' : ''],
    ['En feu · endommagés · ruines', `${fmt(num(S.fire?.burning))} · ${fmt(num(S.fire?.damaged))} · ${fmt(num(S.fire?.ruins))}`, num(S.fire?.burning) + num(S.fire?.ruins) > 0 ? 'neg' : ''],
    ['Ce mois : départs · maîtrisés · détruits', `${fmt(num(m.fires))} · ${fmt(num(m.firesOut))} · ${fmt(num(m.destroyed))}`],
    ['Mois dernier : départs · détruits', `${fmt(num(lm.fires))} · ${fmt(num(lm.destroyed))}`],
  ]));

  // Santé.
  box.append(el('div', { cls: 'sec-title', text: 'Santé' }));
  box.append(rows([
    ['Santé moyenne des habitants (0-100)', fmt(num(S.health?.average)), num(S.health?.average) < 60 ? 'neg' : ''],
    ['Malades (ne travaillent pas)', `${fmt(num(S.health?.sick))} (${pct(num(S.health?.sickShare), 1)})`, num(S.health?.sickShare) > 0.04 ? 'neg' : ''],
    ['Habitants sans accès aux soins', fmt(num(S.health?.uncoveredResidents)), num(S.health?.uncoveredResidents) > 0 ? 'neg' : ''],
    ['Ce mois : cas · décès de malades', `${fmt(num(m.sickCases))} · ${fmt(num(m.sickDeaths))}`],
  ]));

  // Équipements.
  box.append(el('div', { cls: 'sec-title', text: 'Équipements' }));
  const cov: Record<string, number> = { police: num(S.coverage?.police), pompiers: num(S.coverage?.fire), sante: num(S.coverage?.health) };
  for (const s of arr<Services['stations'][number]>(S.stations)) {
    const f = STATION_FR[s.service];
    if (!f) continue;
    box.append(bar(`${f.name} : ${fmt(num(s.count))} équip.`, cov[s.service] ?? 0, 1, pct(cov[s.service] ?? 0)));
    box.append(el('div', { cls: 'muted small svc-line', text: num(s.count) > 0
      ? `${fmt(num(s.units))} ${f.unit} · jusqu’à ${fmt(num(s.capacity))} habitants · entretien ${money(num(s.upkeep))} / mois`
      : `Aucun équipement : ${f.build}.` }));
  }

  // Événements récents.
  const recent = arr<Services['recent'][number]>(S.recent);
  if (recent.length) {
    box.append(el('div', { cls: 'sec-title', text: 'Événements récents' }));
    box.append(el('ul', { cls: 'svc-events small' }, ...recent.slice(0, 8).map((e) => el('li', { text: `${date(num(e.day))} — ${e.text}` }))));
  }
  return box;
}
