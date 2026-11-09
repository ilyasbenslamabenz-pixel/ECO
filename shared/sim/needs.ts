// Besoins du pays : diagnostic des manques et des excédents (écoles, soins, logement, énergie, sécurité, emploi,
// transports, environnement) calculé à partir de l'état de la simulation, avec le quartier le plus concerné et
// des actions proposées (programme de construction, démolition d'un équipement sous-utilisé, centrale à construire
// ou à fermer). Fonction pure : appelée par l'interface sur l'instantané reçu du serveur, et par les tests.
import type { GameState, Infra, InfraType } from './types';
import { BUILDINGS, buildCost } from './construction';
import { buildQuote, closeQuote } from './energy';
import type { BuildId } from './energyData';
import { unemploymentRate } from './workforce';
import { HEALTH_ROLES } from './health';
import { SECURITY_ROLES } from './security';

export type NeedLevel = 0 | 1 | 2; // 0 = satisfaisant, 1 = à surveiller, 2 = urgent

export type NeedAction =
  | { kind: 'program'; label: string; building: InfraType; cityId: number; count: number; cost: number }
  | { kind: 'demolish'; label: string; infraId: number; cost: number }
  | { kind: 'energyBuild'; label: string; tech: BuildId; mw: number; cost: number }
  | { kind: 'energyClose'; label: string; tech: BuildId; mw: number; cost: number }
  /** recrutement exceptionnel (effet en quelques mois) ; `cost` est un coût ANNUEL ajouté au budget du ministère */
  | { kind: 'recruit'; label: string; service: 'sante' | 'securite'; role: 'medecins' | 'infirmiers' | 'policiers'; count: number; cost: number }
  | { kind: 'panel'; label: string; panel: string };

export interface Need {
  id: string;
  icon: string;
  title: string;
  level: NeedLevel;
  /** taux de couverture du besoin (1 = couvert), pour la jauge */
  score: number;
  value: string;
  detail: string;
  actions: NeedAction[];
}

const fr = (v: number, d = 0) => v.toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: d });
const pc = (v: number, d = 0) => `${fr(v * 100, d)} %`;
const money = (v: number) => (Math.abs(v) >= 1e9 ? `${fr(v / 1e9, 1)} Md€` : `${fr(v / 1e6, 0)} M€`);

const active = (i: Infra) => !i.status || i.status === 'active';

/** Capacité par quartier pour un ensemble de types, rapportée à la part de population du quartier. */
function perCity(S: GameState, types: readonly string[]) {
  const n = S.country.cities.length;
  const cap = new Array(n).fill(0);
  for (const i of S.country.infra) if (types.includes(i.type) && active(i) && i.cityId !== null && i.cityId < n) cap[i.cityId] += i.capacity;
  const total = cap.reduce((a, b) => a + b, 0);
  return S.country.cities.map((c, k) => {
    const share = S.cities[k]?.popShare ?? 1 / n;
    return { id: k, name: c.name, cap: cap[k], cover: total > 0 ? cap[k] / Math.max(1e-9, total * share) : 0, share };
  });
}
const worst = (rows: ReturnType<typeof perCity>) => rows.reduce((a, b) => (b.cover < a.cover ? b : a));
const best = (rows: ReturnType<typeof perCity>) => rows.reduce((a, b) => (b.cover > a.cover ? b : a));

function program(S: GameState, building: InfraType, cityId: number, missing: number): NeedAction {
  const def = BUILDINGS[building];
  const count = Math.max(1, Math.min(10, Math.ceil(missing / Math.max(1, def.capacity))));
  return { kind: 'program', building, cityId, count, cost: buildCost(S, def) * count, label: `Construire ${count} × ${def.name.toLowerCase()} à ${S.country.cities[cityId].name}` };
}

/** Équipement le moins utile à démolir (plus petit, dans le quartier le mieux doté). */
function demolishCandidate(S: GameState, types: readonly string[], cityId: number): NeedAction | null {
  const list = S.country.infra.filter((i) => types.includes(i.type) && active(i) && i.cityId === cityId).sort((a, b) => a.capacity - b.capacity);
  const inf = list[0];
  if (!inf || list.length < 2) return null;
  const cost = BUILDINGS[inf.type].cost * 0.08 * (S.macro.priceLevel || 1);
  return { kind: 'demolish', infraId: inf.id, cost, label: `Démolir ${inf.name} (économise ${money(inf.maintenance)}/an)` };
}

const level = (bad: boolean, urgent: boolean): NeedLevel => (urgent ? 2 : bad ? 1 : 0);

/** Recrutement proposé : `share` des effectifs en poste (au plus 15 %, plafond du moteur), arrondi à la centaine. */
function recruitAction(S: GameState, service: 'sante' | 'securite', role: 'medecins' | 'infirmiers' | 'policiers', staff: number, share: number): NeedAction | null {
  const count = Math.round((staff * Math.min(0.15, Math.max(0.02, share))) / 100) * 100;
  if (count < 100) return null;
  const spec = role === 'policiers' ? SECURITY_ROLES.policiers : HEALTH_ROLES[role];
  const cost = count * spec.cost * (S.macro.priceLevel || 1) * 1.15;
  const what = role === 'medecins' ? 'médecins' : role === 'infirmiers' ? 'infirmiers' : 'policiers';
  return { kind: 'recruit', service, role, count, cost, label: `Recruter ${fr(count)} ${what} (en poste dans ${spec.delay} mois, ${money(cost)}/an)` };
}

export function assessNeeds(S: GameState): Need[] {
  const out: Need[] = [];

  // --- Écoles (primaire, collège, lycée) ---
  const Ed = S.education;
  if (Ed) {
    const occ = Ed.occupancySchool;
    const pupils = Ed.pupils.primaire + Ed.pupils.college + Ed.pupils.lycee;
    const rows = perCity(S, ['ecole', 'college', 'lycee']);
    const w = worst(rows);
    const actions: NeedAction[] = [];
    let detail: string;
    if (occ > 1) {
      const missing = pupils * (1 - 1 / occ);
      actions.push(program(S, 'ecole', w.id, missing * 0.5), program(S, 'college', w.id, missing * 0.3), program(S, 'lycee', w.id, missing * 0.2));
      detail = `Il manque environ ${fr(missing)} places : classes surchargées, réussite en baisse. Quartier le moins équipé : ${w.name}.`;
    } else if (occ < 0.75) {
      const b = best(rows);
      const d = demolishCandidate(S, ['ecole', 'college', 'lycee'], b.id);
      if (d) actions.push(d);
      detail = `Écoles remplies à ${pc(occ)} : des bâtiments coûtent de l'entretien pour peu d'élèves (surtout à ${b.name}).`;
    } else {
      detail = `Places suffisantes. Pour aller plus loin : améliorer les écoles existantes ou recruter des enseignants (Éducation).`;
      if (w.cover < 0.7) actions.push(program(S, 'ecole', w.id, 600));
    }
    actions.push({ kind: 'panel', label: 'Ministère de l\'Éducation', panel: 'education' });
    out.push({ id: 'ecoles', icon: '🏫', title: 'Écoles', level: level(occ > 0.98 || occ < 0.75, occ > 1.08), score: Math.min(1, 1 / Math.max(0.01, occ)), value: `occupation ${pc(occ)}`, detail, actions });

    const occU = Ed.occupancyUni;
    if (occU > 1.02) {
      const missing = Ed.students * (1 - 1 / occU);
      out.push({ id: 'universites', icon: '🎓', title: 'Universités', level: level(true, occU > 1.15), score: 1 / occU, value: `occupation ${pc(occU)}`,
        detail: `Il manque environ ${fr(missing)} places d'étudiants : amphithéâtres saturés, accès au supérieur freiné.`,
        actions: [program(S, 'universite', worst(perCity(S, ['universite'])).id, missing), { kind: 'panel', label: 'Ministère de l\'Éducation', panel: 'education' }] });
    }
  }

  // --- Santé ---
  const H = S.health;
  if (H) {
    const ratio = H.ratio;
    const rows = perCity(S, ['hopital', 'clinique']);
    const w = worst(rows);
    const actions: NeedAction[] = [];
    const bad = ratio < 0.97 || H.waitDays > 45;
    if (bad) {
      // le personnel est le levier rapide (lits ouverts et délais) ; les murs viennent ensuite
      const doc = recruitAction(S, 'sante', 'medecins', H.doctors.staff, 0.04 + 2 * Math.max(0, 1 - ratio));
      if (doc) actions.push(doc);
      actions.push(program(S, ratio < 0.9 ? 'hopital' : 'clinique', w.id, (1 - ratio) * H.installedBeds));
    }
    actions.push({ kind: 'panel', label: 'Ministère de la Santé', panel: 'sante' });
    out.push({ id: 'sante', icon: '🏥', title: 'Santé', level: level(bad, ratio < 0.88 || H.waitDays > 70), score: Math.min(1, ratio), value: `${fr(H.waitDays)} j d'attente`,
      detail: bad ? `Capacité de soins à ${pc(ratio)} des besoins (population vieillissante). Quartier le moins doté en lits : ${w.name}.` : `Capacité de soins à ${pc(ratio)} des besoins, délais maîtrisés.`, actions });
  }

  // --- Logement ---
  const L = S.housing;
  if (L) {
    const t = L.tension;
    const n = S.country.cities.length;
    let wId = 0, wv = Infinity;
    for (let k = 0; k < n; k++) { const c = S.cities[k]; if (!c) continue; const v = c.housingUnits / Math.max(1, c.population); if (v < wv) { wv = v; wId = k; } }
    const bad = t > 1.04 || L.socialWaiting > L.households * 0.03;
    const actions: NeedAction[] = [];
    if (bad) {
      const missing = Math.max(400, (t - 1) * L.households);
      actions.push(program(S, 'logements_sociaux', wId, Math.min(missing, 4000)), program(S, 'eco_quartier', wId, missing));
    }
    actions.push({ kind: 'panel', label: 'Ministère du Logement', panel: 'logement' });
    out.push({ id: 'logement', icon: '🏘️', title: 'Logement', level: level(bad, t > 1.12), score: Math.min(1, 1 / Math.max(0.01, t)), value: `${fr(L.socialWaiting)} ménages en attente`,
      detail: bad ? `Marché tendu (${fr(t, 2)} ménage par logement disponible) : loyers en hausse. Quartier le plus saturé : ${S.country.cities[wId]?.name}.` : `Offre et demande de logements à l'équilibre.`, actions });
  }

  // --- Électricité : sécurité d'approvisionnement ---
  const E = S.energy;
  if (E?.balance) {
    const m = E.balance.margin;
    const short = E.balance.unserved > 0 || m < 0.05;
    const actions: NeedAction[] = [];
    if (short) {
      const mw = Math.max(200, Math.round((0.12 - m) * E.balance.peakMW / 50) * 50);
      actions.push({ kind: 'energyBuild', tech: 'batteries', mw, cost: buildQuote(S, 'batteries', mw).cost, label: `Installer ${fr(mw)} MW de batteries` });
      actions.push({ kind: 'energyBuild', tech: 'geothermie', mw: Math.round(mw / 2), cost: buildQuote(S, 'geothermie', Math.round(mw / 2)).cost, label: `Construire ${fr(Math.round(mw / 2))} MW de géothermie (pilotable, sans CO₂)` });
    }
    actions.push({ kind: 'panel', label: 'Ministère de l\'Énergie', panel: 'energie' });
    out.push({ id: 'electricite', icon: '⚡', title: 'Électricité', level: level(short, E.balance.unserved > 0), score: Math.max(0, Math.min(1, 0.5 + m * 3)), value: `marge ${pc(m)}`,
      detail: E.balance.unserved > 0 ? `Délestages : la production ne couvre pas la pointe de consommation.` : short ? `Marge de sécurité trop faible à la pointe : risque de coupures.` : `Production suffisante pour couvrir la pointe avec une marge de ${pc(m)}.`, actions });

    // --- Énergie verte ---
    const ren = E.elecRenShare;
    const coal = E.fleet.charbon?.mw ?? 0;
    const oil = E.fleet.petrole?.mw ?? 0;
    const gas = E.fleet.gaz?.mw ?? 0;
    const green: NeedAction[] = [];
    const mw = 500;
    // l'éolien en mer produit le plus (chantier de 4 ans) ; le solaire est plus rapide (1 an) mais produit moins
    green.push({ kind: 'energyBuild', tech: 'eolienMer', mw, cost: buildQuote(S, 'eolienMer', mw).cost, label: `Construire ${mw} MW d'éolien en mer (chantier de 4 ans)` });
    green.push({ kind: 'energyBuild', tech: 'solaire', mw: 600, cost: buildQuote(S, 'solaire', 600).cost, label: `Construire 600 MW de solaire (toitures, ombrières, en service sous 1 an)` });
    const dirty: [BuildId, number][] = [['charbon', coal], ['petrole', oil], ['gaz', gas]];
    const [tech, cap] = dirty.find(([, v]) => v >= 1) ?? ['charbon', 0];
    if (cap >= 1 && m > 0.15) {
      const close = Math.min(cap, Math.max(100, Math.round(m * E.balance.peakMW * 0.5 / 50) * 50));
      green.push({ kind: 'energyClose', tech, mw: close, cost: closeQuote(S, tech, close).cost, label: `Fermer ${fr(close)} MW de ${tech === 'charbon' ? 'charbon' : tech === 'petrole' ? 'fioul' : 'gaz'} (marge suffisante)` });
    }
    green.push({ kind: 'panel', label: 'Ministère de l\'Énergie', panel: 'energie' });
    out.push({ id: 'verte', icon: '🌱', title: 'Énergie verte', level: level(ren < 0.5, ren < 0.25), score: ren, value: `${pc(ren)} renouvelable`,
      detail: `Part renouvelable de l'électricité : ${pc(ren)}.${coal + oil > 1 ? ` Encore ${fr(coal + oil)} MW au charbon et au fioul.` : ''} Fermer du fossile n'est sûr que si la marge reste positive.`, actions: green });
  }

  // --- Sécurité ---
  const Sec = S.security;
  if (Sec) {
    const feel = Sec.feeling;
    const actions: NeedAction[] = [];
    const rows = perCity(S, ['commissariat']);
    const w = worst(rows);
    const bad = feel < 55 || Sec.policeResponse > 15;
    if (bad) {
      const pol = recruitAction(S, 'securite', 'policiers', Sec.police.staff, 0.06 + 0.004 * Math.max(0, 60 - feel));
      if (pol) actions.push(pol);
      actions.push(program(S, 'commissariat', w.id, 500));
    }
    if (Sec.prisonOccupancy > 1.1) actions.push(program(S, 'prison', w.id, Sec.prisoners - Sec.openPlaces));
    actions.push({ kind: 'panel', label: 'Sécurité et justice', panel: 'securite' });
    out.push({ id: 'securite', icon: '🚓', title: 'Sécurité', level: level(bad || Sec.prisonOccupancy > 1.1, feel < 40), score: feel / 100, value: `sentiment ${fr(feel)}/100`,
      detail: `${fr(Sec.crimeRate, 1)} crimes et délits pour 1 000 hab., police en ${fr(Sec.policeResponse)} min, prisons à ${pc(Sec.prisonOccupancy)}.${bad ? ` Quartier le moins couvert : ${w.name}.` : ''}`, actions });
  }

  // --- Emploi ---
  const u = unemploymentRate(S);
  {
    const n = S.country.cities.length;
    let wId = 0;
    for (let k = 1; k < n; k++) if ((S.cities[k]?.unemployment ?? 0) > (S.cities[wId]?.unemployment ?? 0)) wId = k;
    const bad = u > 0.075;
    const actions: NeedAction[] = [];
    if (bad) actions.push(program(S, 'zone_industrielle', wId, 1), program(S, 'zone_commerciale', wId, 1));
    actions.push({ kind: 'panel', label: 'Travail et emploi', panel: 'travail' });
    out.push({ id: 'emploi', icon: '💼', title: 'Emploi', level: level(bad, u > 0.1), score: Math.max(0, 1 - u * 6), value: `chômage ${pc(u, 1)}`,
      detail: bad ? `Chômage élevé, surtout à ${S.country.cities[wId]?.name} (${pc(S.cities[wId]?.unemployment ?? 0, 1)}). Une zone d'activités crée des emplois sur place.` : `Chômage contenu.`, actions });
  }

  // --- Transports ---
  const T = S.transport;
  if (T) {
    const c = T.congestion;
    const bad = c > 1.08;
    out.push({ id: 'transports', icon: '🚇', title: 'Transports', level: level(bad, c > 1.25), score: Math.min(1, 1 / Math.max(0.01, c)), value: `congestion ${fr(c, 2)}`,
      detail: bad ? `Routes saturées : temps de trajet en hausse. Développer métro, tram ou vélo, ou instaurer un péage urbain.` : `Trafic fluide.`,
      actions: [{ kind: 'panel', label: 'Ministère des Transports', panel: 'transports' }] });
  }

  // --- Environnement ---
  const Env = S.environment;
  if (Env) {
    const a = Env.airQuality;
    out.push({ id: 'air', icon: '🍃', title: 'Qualité de l\'air', level: level(a < 0.6, a < 0.45), score: a, value: `indice ${fr(a * 100)}/100`,
      detail: a < 0.6 ? `Air pollué (trafic, centrales fossiles, industrie) : santé et satisfaction en pâtissent.` : `Air de bonne qualité.`,
      actions: [{ kind: 'panel', label: 'Environnement', panel: 'environnement' }] });
  }

  return out.sort((x, y) => y.level - x.level);
}

export const fmtNeedCost = money;
