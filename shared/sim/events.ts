// Événements et crises : tirage déterministe (graine + mois), probabilités dépendant de l'état, conséquences chiffrées,
// décisions proposées au joueur (2 à 3 options avec coût et effets réels), option par défaut appliquée à l'échéance.
// Les coûts passent par des crédits exceptionnels ajoutés aux lignes budgétaires pendant le mois : ils sont donc
// comptabilisés dans les dépenses publiques (identité trésorerie = solde + emprunts préservée).
import { hashString, mulberry32 } from '../noise';
import { SECTOR_INDEX, type BudgetLine, type CategoryId, type SectorId } from './data';
import { clamp } from './economy';
import { bumpGroup, bumpParty, groupSupport } from './politics';
import type { GameState } from './types';

export type EventKind = 'crise' | 'climat' | 'economie' | 'social' | 'opportunite' | 'international';

/** Effet temporaire multiplicatif : clé « demand », « energy », « worldPrice », « prod:<secteur> », « prod:all » ou « risk:<événement> ». */
export interface Modifier { key: string; value: number; decay: number; source: number; label: string }
/** Crédit exceptionnel : montant annualisé ajouté à une ligne budgétaire pendant `months` mois. */
export interface ExtraBudget { line: BudgetLine; annual: number; months: number; label: string; applied?: number }

export interface GameEvent {
  uid: number;
  id: string;
  title: string;
  icon: string;
  kind: EventKind;
  month: number;
  deadline: number; // mois auquel l'option par défaut s'applique
  text: string; // conséquences chiffrées immédiates
  status: 'en_attente' | 'resolu';
  options: { id: string; label: string; text: string; cost: number }[]; // coût total estimé (€)
  defaultOption: string;
  choice?: string;
  auto?: boolean;
  resolvedMonth?: number;
  outcome?: string;
  data?: Record<string, number>;
}

export interface EventsState {
  active: GameEvent[]; // en attente de décision
  history: GameEvent[]; // derniers événements résolus
  seq: number;
  lastEventMonth: number;
  lastByType: Record<string, number>;
  modifiers: Modifier[];
  extraBudget: ExtraBudget[];
  enabled: boolean;
}

export const EVENT_GRACE_MONTHS = 6; // aucun événement pendant les 6 premiers mois
export const EVENT_GAP_MONTHS = 3; // au moins 3 mois entre deux événements
export const EVENT_DEADLINE = 3; // délai de décision (mois)
export const MAX_PENDING = 2;

interface OptionDef {
  id: string;
  label: string;
  text: string;
  /** crédits exceptionnels (part du PIB annualisée × durée) */
  budget?: { line: BudgetLine; gdpShare: number; months: number }[];
  apply: (S: GameState, ev: GameEvent) => string;
}

interface EventDef {
  id: string;
  title: string;
  icon: string;
  kind: EventKind;
  cooldown: number;
  prob: (S: GameState) => number;
  start: (S: GameState, ev: GameEvent, rnd: () => number) => string;
  options: OptionDef[];
  defaultOption: string;
}

// ---------- Outils d'effets ----------
const pctf = (v: number, d = 0) => `${(v * 100).toFixed(d).replace('.', ',')} %`;
const md = (v: number) => `${(v / 1e9).toFixed(1).replace('.', ',')} Md€`;
const WORKERS: CategoryId[] = ['ouvriers', 'employes'];
const MODEST: CategoryId[] = ['ouvriers', 'employes', 'chomeurs', 'retraites', 'inactifs'];

export function addModifier(S: GameState, key: string, value: number, decay: number, source: number, label: string) {
  S.events?.modifiers.push({ key, value, decay, source, label });
}
export function scaleModifiers(S: GameState, source: number, k: number) {
  for (const m of S.events?.modifiers ?? []) if (m.source === source) m.value *= k;
}
export function modifierSum(S: GameState, key: string) {
  return (S.events?.modifiers ?? []).filter((m) => m.key === key).reduce((s, m) => s + m.value, 0);
}
export function addExtraBudget(S: GameState, line: BudgetLine, annual: number, months: number, label: string) {
  if (S.events && annual > 0 && months > 0) S.events.extraBudget.push({ line, annual, months, label });
}
function bumpCats(S: GameState, cats: CategoryId[], d: number) {
  for (const c of cats) if (S.satisfaction.byCategory[c] !== undefined) S.satisfaction.byCategory[c] = clamp(S.satisfaction.byCategory[c] + d, 0, 100);
}
function bumpTrust(S: GameState, d: number) {
  S.satisfaction.trust = clamp(S.satisfaction.trust + d, 0, 100);
}
function sector(S: GameState, id: SectorId) {
  return S.sectors[SECTOR_INDEX[id]];
}
const gdp = (S: GameState) => Math.max(1, S.accounts.gdp);
// --- plan climat --- : le risque climatique dépend des émissions cumulées depuis 2030 (climate.ts, indice abstrait) ;
// il coïncide avec l'ancien terme temporel mois/480 (≈ +25 % tous les 10 ans) si les émissions restent au niveau de 2030.
const warming = (S: GameState) => S.climate?.riskIndex ?? S.month / 480;
/** Gravité des aléas climatiques : les dégâts immédiats croissent avec l'indice de réchauffement local (×1 à ×2,5). */
const severity = (S: GameState) => clamp(1 + 0.5 * warming(S), 1, 2.5);
const sevTxt = (S: GameState) => (severity(S) > 1.05 ? ` Gravité accrue par le réchauffement local (×${severity(S).toFixed(2).replace('.', ',')}).` : '');
const season = (S: GameState) => S.month % 12; // 0 = janvier
const summer = (S: GameState) => season(S) >= 5 && season(S) <= 7;
const winter = (S: GameState) => season(S) >= 10 || season(S) <= 2;
const autumnWinter = (S: GameState) => season(S) >= 9 || season(S) <= 2;
const unemployment = (S: GameState) => S.demography.unemployed / Math.max(1, S.demography.labourForce);

/** Dépendance aux importations d'énergie (0..1). Champ optionnel fourni par le module énergie s'il existe. */
export function energyImportDependence(S: GameState): number {
  const fromEnergy = (S.accounts as { energyImportDependence?: number }).energyImportDependence;
  if (typeof fromEnergy === 'number' && Number.isFinite(fromEnergy)) return clamp(fromEnergy, 0, 1);
  const agr = S.international?.neighbors.filter((n) => n.agreements.includes('energie')).length ?? 0;
  return clamp(0.8 * (1 - 0.15 * agr), 0.1, 1); // cité-État : énergie presque entièrement importée
}

// ---------- Catalogue ----------
export const EVENT_DEFS: EventDef[] = [
  {
    id: 'crise_energetique', title: 'Crise énergétique', icon: '⚡', kind: 'crise', cooldown: 24,
    prob: (S) => 0.001 + 0.01 * energyImportDependence(S),
    start: (S, ev) => {
      addModifier(S, 'energy', 0.35, 0.93, ev.uid, 'Crise énergétique');
      bumpTrust(S, -1);
      return `Les prix mondiaux du gaz et de l'électricité s'envolent : indice du prix de l'énergie +35 % (résorption d'environ 7 % par mois). Coûts des entreprises et inflation en hausse. Dépendance aux importations : ${pctf(energyImportDependence(S))}.`;
    },
    options: [
      { id: 'bouclier', label: 'Bouclier tarifaire', text: 'Plafonner les prix pour tous : le choc est divisé par deux. Coût : 0,5 % du PIB par an pendant 6 mois (subventions).', budget: [{ line: 'subventions', gdpShare: 0.005, months: 6 }],
        apply: (S, ev) => { scaleModifiers(S, ev.uid, 0.5); bumpTrust(S, 2); return 'Bouclier tarifaire : hausse des prix de l\'énergie réduite de moitié.'; } },
      { id: 'cheque', label: 'Chèque énergie ciblé', text: 'Aide aux ménages modestes : +3 de satisfaction pour les catégories modestes, choc atténué de 15 %. Coût : 0,2 % du PIB par an pendant 6 mois.', budget: [{ line: 'logement', gdpShare: 0.002, months: 6 }],
        apply: (S, ev) => { scaleModifiers(S, ev.uid, 0.85); bumpCats(S, MODEST, 3); bumpTrust(S, 1); return 'Chèque énergie versé aux ménages modestes.'; } },
      { id: 'marche', label: 'Laisser jouer le marché', text: 'Aucun coût budgétaire, mais confiance −3 et satisfaction des ouvriers et employés −2.',
        apply: (S) => { bumpTrust(S, -3); bumpCats(S, WORKERS, -2); return 'Le gouvernement laisse les prix s\'ajuster.'; } },
    ],
    defaultOption: 'marche',
  },
  {
    id: 'greve_nationale', title: 'Grève nationale', icon: '✊', kind: 'social', cooldown: 18,
    prob: (S) => (0.0005 + 0.12 * Math.max(0, S.satisfaction.strikeRisk - 0.2)) * (1 + Math.max(0, 40 - groupSupport(S, 'cgt')) / 20),
    start: (S, ev) => {
      addModifier(S, 'prod:all', -0.02, 0.5, ev.uid, 'Grève nationale');
      bumpTrust(S, -2);
      return `Les syndicats appellent à la grève générale : production −2 % ce mois-ci (effet divisé par deux chaque mois). Risque de grève : ${pctf(S.satisfaction.strikeRisk)}.`;
    },
    options: [
      { id: 'negocier', label: 'Ouvrir des négociations', text: 'Hausse des salaires de 1 %, satisfaction des ouvriers et employés +4, fin rapide du mouvement. Coût : 0,1 % du PIB par an pendant 3 mois (administration).', budget: [{ line: 'administration', gdpShare: 0.001, months: 3 }],
        apply: (S, ev) => { for (const s of S.sectors) s.wage *= 1.01; scaleModifiers(S, ev.uid, 0.3); bumpCats(S, WORKERS, 4); bumpGroup(S, 'cgt', 0.2); bumpGroup(S, 'reformistes', 0.2); return 'Accord salarial : +1 % sur les salaires.'; } },
      { id: 'ceder', label: 'Céder aux revendications', text: 'Salaires +2,5 %, satisfaction des travailleurs +6, mais le patronat est hostile.',
        apply: (S, ev) => { for (const s of S.sectors) s.wage *= 1.025; scaleModifiers(S, ev.uid, 0); bumpCats(S, WORKERS, 6); bumpGroup(S, 'cgt', 0.4); bumpGroup(S, 'patronat', -0.3); return 'Le gouvernement cède : +2,5 % sur les salaires.'; } },
      { id: 'fermete', label: 'Rester ferme', text: 'Aucun coût, mais le mouvement se durcit : production −1,5 % supplémentaire, travailleurs −4, confiance −2.',
        apply: (S, ev) => { addModifier(S, 'prod:all', -0.015, 0.7, ev.uid, 'Grève prolongée'); bumpCats(S, WORKERS, -4); bumpGroup(S, 'cgt', -0.3); bumpTrust(S, -2); return 'Le mouvement se prolonge.'; } },
    ],
    defaultOption: 'fermete',
  },
  {
    id: 'crise_logement', title: 'Crise du logement', icon: '🏚️', kind: 'social', cooldown: 30,
    prob: (S) => 0.001 + 0.05 * Math.max(0, 0.75 - S.services.logement) + 0.002 * Math.max(0, S.demography.migration / Math.max(1, S.demography.households) * 100),
    start: (S) => {
      S.services.logement = clamp(S.services.logement - 0.03, 0, 1);
      bumpCats(S, ['etudiants', 'employes', 'chomeurs'], -3);
      return `Pénurie de logements abordables : qualité du logement −3 points, satisfaction des étudiants, employés et chômeurs −3.`;
    },
    options: [
      { id: 'programme', label: 'Programme national de logements abordables', text: 'Crédits budgétaires aux bailleurs sociaux et aux collectivités : +5 points de qualité du logement, soutien au BTP. Coût : 0,3 % du PIB par an pendant 12 mois (infrastructures).', budget: [{ line: 'infrastructures', gdpShare: 0.003, months: 12 }],
        apply: (S) => { S.services.logement = clamp(S.services.logement + 0.05, 0, 1); bumpGroup(S, 'locataires', 0.2); return 'Programme national de logements financé.'; } },
      { id: 'encadrement', label: 'Encadrement des loyers', text: 'Sans coût : locataires satisfaits (+3), mais investissement immobilier freiné (productivité de la construction −2 %).',
        apply: (S, ev) => { bumpCats(S, ['etudiants', 'employes', 'chomeurs'], 3); bumpCats(S, ['entrepreneurs', 'independants'], -3); addModifier(S, 'prod:construction', -0.02, 0.97, ev.uid, 'Encadrement des loyers'); bumpGroup(S, 'locataires', 0.3); bumpGroup(S, 'patronat', -0.1); return 'Les loyers sont encadrés.'; } },
      { id: 'attendre', label: 'Attendre', text: 'Aucun coût, la crise s\'aggrave : satisfaction −2 supplémentaire.',
        apply: (S) => { bumpCats(S, ['etudiants', 'employes', 'chomeurs'], -2); bumpGroup(S, 'locataires', -0.2); return 'Aucune mesure.'; } },
    ],
    defaultOption: 'attendre',
  },
  {
    id: 'penurie_medecins', title: 'Pénurie de médecins', icon: '🩺', kind: 'crise', cooldown: 30,
    prob: (S) => 0.0005 + 0.06 * Math.max(0, 0.74 - S.services.sante) + 0.05 * Math.max(0, 0.95 - S.policy.budget.sante / (0.07 * gdp(S))),
    start: (S) => {
      S.services.sante = clamp(S.services.sante - 0.03, 0, 1);
      bumpCats(S, ['retraites'], -3);
      return `Déserts médicaux et urgences saturées : qualité des soins −3 points, satisfaction des retraités −3. Budget santé : ${pctf(S.policy.budget.sante / gdp(S), 1)} du PIB.`;
    },
    options: [
      { id: 'recrutement', label: 'Plan de recrutement', text: 'Revalorisation (+3 % de salaire dans la santé), qualité des soins +3 points. Coût : 0,4 % du PIB par an pendant 12 mois.', budget: [{ line: 'sante', gdpShare: 0.004, months: 12 }],
        apply: (S) => { sector(S, 'sante').wage *= 1.03; S.services.sante = clamp(S.services.sante + 0.03, 0, 1); bumpCats(S, ['retraites'], 2); return 'Plan de recrutement de soignants.'; } },
      { id: 'etrangers', label: 'Recruter des médecins étrangers', text: 'Qualité des soins +2 points. Coût : 0,1 % du PIB par an pendant 6 mois. Les conservateurs désapprouvent.', budget: [{ line: 'sante', gdpShare: 0.001, months: 6 }],
        apply: (S) => { S.services.sante = clamp(S.services.sante + 0.02, 0, 1); bumpParty(S, 'conservateurs', 0.08); return 'Recrutement de médecins étrangers.'; } },
      { id: 'rien', label: 'Ne rien faire', text: 'La pénurie s\'aggrave : qualité des soins −2 points supplémentaires, retraités −2.',
        apply: (S) => { S.services.sante = clamp(S.services.sante - 0.02, 0, 1); bumpCats(S, ['retraites'], -2); bumpGroup(S, 'retraites', -0.2); return 'Aucune mesure.'; } },
    ],
    defaultOption: 'rien',
  },
  {
    id: 'inflation', title: 'Flambée des prix', icon: '💸', kind: 'economie', cooldown: 24,
    prob: (S) => 0.001 + 0.08 * Math.max(0, S.macro.inflation - 0.03),
    start: (S) => {
      S.macro.priceLevel *= 1.008;
      S.macro.expectedInflation += 0.01;
      bumpCats(S, MODEST, -2);
      return `Spirale prix-salaires : niveau des prix +0,8 % en un mois, anticipations d'inflation +1 point. Inflation actuelle : ${pctf(S.macro.inflation, 1)}.`;
    },
    options: [
      { id: 'indexation', label: 'Revaloriser les aides', text: 'Catégories modestes +3. Coût : 0,2 % du PIB par an pendant 6 mois (aides au logement).', budget: [{ line: 'logement', gdpShare: 0.002, months: 6 }],
        apply: (S) => { bumpCats(S, MODEST, 3); return 'Aides revalorisées.'; } },
      { id: 'gel', label: 'Gel temporaire des prix', text: 'Prix −0,4 %, anticipations −0,5 point. Coût : 0,3 % du PIB par an pendant 6 mois (subventions).', budget: [{ line: 'subventions', gdpShare: 0.003, months: 6 }],
        apply: (S) => { S.macro.priceLevel /= 1.004; S.macro.expectedInflation -= 0.005; bumpGroup(S, 'patronat', -0.1); return 'Gel des prix de l\'énergie et de l\'alimentation.'; } },
      { id: 'banque', label: 'Laisser agir la banque centrale', text: 'Aucun coût ; la hausse des taux freinera l\'inflation. Confiance −1.',
        apply: (S) => { bumpTrust(S, -1); return 'La banque centrale relève ses taux.'; } },
    ],
    defaultOption: 'banque',
  },
  {
    id: 'recession', title: 'Récession mondiale', icon: '📉', kind: 'economie', cooldown: 36,
    prob: (S) => 0.0025 + 0.1 * Math.max(0, -(S.international?.avgGap ?? 0)),
    start: (S, ev) => {
      addModifier(S, 'demand', -0.05, 0.96, ev.uid, 'Récession mondiale');
      S.macro.confidence = clamp(S.macro.confidence - 0.05, 0.05, 0.95);
      return 'Les États partenaires entrent en récession : demande adressée à la cité-État −5 % (résorption d\'environ 4 % par mois), confiance des entreprises −5 points.';
    },
    options: [
      { id: 'relance', label: 'Plan de relance', text: 'Investissements publics massifs : confiance +5 points, soutien direct à la construction et à l\'industrie. Coût : 0,8 % du PIB par an pendant 12 mois.', budget: [{ line: 'infrastructures', gdpShare: 0.008, months: 12 }],
        apply: (S) => { S.macro.confidence = clamp(S.macro.confidence + 0.05, 0.05, 0.95); return 'Plan de relance voté.'; } },
      { id: 'soutien', label: 'Prêts garantis aux entreprises', text: 'Confiance +3 points, faillites contenues. Coût : 0,4 % du PIB par an pendant 9 mois (subventions).', budget: [{ line: 'subventions', gdpShare: 0.004, months: 9 }],
        apply: (S) => { S.macro.confidence = clamp(S.macro.confidence + 0.03, 0.05, 0.95); bumpGroup(S, 'patronat', 0.2); return 'Prêts garantis aux entreprises.'; } },
      { id: 'rigueur', label: 'Maintenir la rigueur', text: 'Aucun coût ; confiance des entreprises −3 points, confiance politique −1.',
        apply: (S) => { S.macro.confidence = clamp(S.macro.confidence - 0.03, 0.05, 0.95); bumpTrust(S, -1); return 'Le gouvernement maintient sa trajectoire budgétaire.'; } },
    ],
    defaultOption: 'rigueur',
  },
  {
    id: 'penurie_eau', title: 'Pénurie d\'eau', icon: '🚱', kind: 'climat', cooldown: 12,
    prob: (S) => (summer(S) ? 0.012 : 0.0015) * (1 + warming(S)) * (1 + modifierSum(S, 'risk:penurie_eau')),
    start: (S, ev) => {
      const k = severity(S); // --- plan climat ---
      addModifier(S, 'prod:agriculture', -0.12 * k, 0.88, ev.uid, 'Pénurie d\'eau');
      addModifier(S, 'prod:energie', -0.03 * k, 0.85, ev.uid, 'Pénurie d\'eau (refroidissement des centrales)');
      addModifier(S, 'prod:tourisme', -0.02 * k, 0.85, ev.uid, 'Pénurie d\'eau');
      S.macro.priceLevel *= 1 + 0.003 * k;
      bumpParty(S, 'ecologistes', 0.05);
      bumpTrust(S, -1);
      return `Sécheresse régionale : les réservoirs de la cité-État sont au plus bas. Ceintures maraîchères −${pctf(0.12 * k)}, production d'énergie −${pctf(0.03 * k)}, tourisme −${pctf(0.02 * k)}, eau et denrées importées plus chères : niveau des prix +${pctf(0.003 * k, 1)}.${sevTxt(S)}`;
    },
    options: [
      { id: 'urgence', label: 'Programme d\'urgence pour l\'eau potable', text: 'Contrats d\'approvisionnement et unités de dessalement mobiles financés sur le budget : pertes réduites de 60 %, risque futur −30 %. Coût : 0,15 % du PIB par an pendant 12 mois (environnement).', budget: [{ line: 'environnement', gdpShare: 0.0015, months: 12 }],
        apply: (S, ev) => { scaleModifiers(S, ev.uid, 0.4); addModifier(S, 'risk:penurie_eau', -0.3, 0.995, ev.uid, 'Sécurisation de l\'eau'); bumpTrust(S, 1); return 'Programme d\'urgence pour l\'eau potable financé.'; } },
      { id: 'sobriete', label: 'Restrictions d\'eau et tarification progressive', text: 'Sans coût : pertes réduites de 20 %, confiance −1.',
        apply: (S, ev) => { scaleModifiers(S, ev.uid, 0.8); bumpTrust(S, -1); bumpGroup(S, 'climat', 0.1); return 'Restrictions d\'usage et tarif progressif de l\'eau.'; } },
      { id: 'rien', label: 'Ne rien faire', text: 'Aucun coût ; maraîchers et hôteliers hostiles, confiance −1.',
        apply: (S) => { bumpGroup(S, 'agriculteurs', -0.3); bumpTrust(S, -1); return 'Aucune mesure.'; } },
    ],
    defaultOption: 'rien',
  },
  {
    id: 'inondations', title: 'Inondation littorale', icon: '🌊', kind: 'climat', cooldown: 12,
    prob: (S) => (autumnWinter(S) ? 0.006 : 0.002) * (1 + warming(S)) * (1 + modifierSum(S, 'risk:inondations')),
    start: (S) => {
      const k = severity(S); // --- plan climat ---
      S.services.infrastructures = clamp(S.services.infrastructures - 0.04 * k, 0, 1);
      bumpTrust(S, -1);
      return `Grande marée et crue de l'estuaire : quais, tunnels, stations de métro et réseaux des quartiers bas submergés (qualité des infrastructures −${(4 * k).toFixed(1).replace('.', ',')} points). Dégâts estimés : ${md(0.004 * k * gdp(S))}.${sevTxt(S)}`;
    },
    options: [
      { id: 'reconstruction', label: 'Reconstruction rapide', text: 'Infrastructures +3 points, confiance +2. Coût : 0,3 % du PIB par an pendant 6 mois.', budget: [{ line: 'infrastructures', gdpShare: 0.003, months: 6 }],
        apply: (S) => { S.services.infrastructures = clamp(S.services.infrastructures + 0.03, 0, 1); bumpTrust(S, 2); return 'Reconstruction engagée.'; } },
      { id: 'prevention', label: 'Reconstruction et programme de protection littorale', text: 'Comme la reconstruction, plus un programme pluriannuel (digues, bassins de rétention) qui divise par deux le risque de submersion. Coût : 0,3 % du PIB/an sur 6 mois + 0,1 % du PIB/an sur 12 mois (environnement).', budget: [{ line: 'infrastructures', gdpShare: 0.003, months: 6 }, { line: 'environnement', gdpShare: 0.001, months: 12 }],
        apply: (S, ev) => { S.services.infrastructures = clamp(S.services.infrastructures + 0.03, 0, 1); S.services.environnement = clamp(S.services.environnement + 0.02, 0, 1); addModifier(S, 'risk:inondations', -0.5, 0.99, ev.uid, 'Protection littorale'); bumpTrust(S, 2); bumpGroup(S, 'climat', 0.1); return 'Reconstruction et programme de protection littorale.'; } },
      { id: 'minimum', label: 'Aide minimale', text: 'Coût : 0,05 % du PIB par an pendant 6 mois. Confiance −2.', budget: [{ line: 'infrastructures', gdpShare: 0.0005, months: 6 }],
        apply: (S) => { bumpTrust(S, -2); return 'Aide minimale aux sinistrés.'; } },
    ],
    defaultOption: 'minimum',
  },
  {
    id: 'canicule', title: 'Canicule urbaine', icon: '🔥', kind: 'climat', cooldown: 12,
    prob: (S) => (summer(S) ? 0.015 : 0) * (1 + warming(S)) * Math.max(0, 1 + modifierSum(S, 'risk:canicule')), // --- plan climat --- : îlots de fraîcheur
    start: (S, ev) => {
      const k = severity(S); // --- plan climat ---
      S.services.sante = clamp(S.services.sante - 0.015 * k, 0, 1);
      addModifier(S, 'energy', 0.05 * k, 0.8, ev.uid, 'Canicule');
      addModifier(S, 'prod:agriculture', -0.04 * k, 0.85, ev.uid, 'Canicule');
      bumpCats(S, ['retraites'], -3 * k);
      return `Îlots de chaleur : 40 °C dans les quartiers denses, hôpitaux saturés (qualité des soins −${(1.5 * k).toFixed(1).replace('.', ',')} point), pics de climatisation (prix de l'énergie +${pctf(0.05 * k)}), retraités −${(3 * k).toFixed(1).replace('.', ',')}.${sevTxt(S)}`;
    },
    options: [
      { id: 'plan', label: 'Plan canicule', text: 'Cellules de crise par arrondissement, lieux rafraîchis, renfort des hôpitaux : soins +1 point, retraités +3. Coût : 0,05 % du PIB par an pendant 3 mois.', budget: [{ line: 'sante', gdpShare: 0.0005, months: 3 }],
        apply: (S) => { S.services.sante = clamp(S.services.sante + 0.01, 0, 1); bumpCats(S, ['retraites'], 3); return 'Plan canicule déclenché.'; } },
      { id: 'horaires', label: 'Horaires aménagés', text: 'Sans coût : production −0,5 % ce mois-ci, cadres +1.',
        apply: (S, ev) => { addModifier(S, 'prod:all', -0.005, 0.5, ev.uid, 'Horaires aménagés'); bumpCats(S, ['cadres'], 1); return 'Horaires de travail aménagés.'; } },
      { id: 'rien', label: 'Ne rien faire', text: 'Retraités −2, confiance −1.',
        apply: (S) => { bumpCats(S, ['retraites'], -2); bumpTrust(S, -1); return 'Aucune mesure.'; } },
    ],
    defaultOption: 'rien',
  },
  {
    id: 'tempete', title: 'Tempête', icon: '🌪️', kind: 'climat', cooldown: 12,
    prob: (S) => (winter(S) ? 0.008 : 0.001) * (1 + 0.5 * warming(S)) * Math.max(0, 1 + modifierSum(S, 'risk:tempete')), // --- plan climat --- : réseaux résilients
    start: (S, ev) => {
      const k = severity(S); // --- plan climat ---
      S.services.infrastructures = clamp(S.services.infrastructures - 0.02 * k, 0, 1);
      addModifier(S, 'prod:energie', -0.04 * k, 0.7, ev.uid, 'Tempête');
      return `Tempête violente sur la côte : lignes électriques, grues portuaires et toitures endommagées (infrastructures −${(2 * k).toFixed(1).replace('.', ',')} points, production d'énergie −${pctf(0.04 * k)}).${sevTxt(S)}`;
    },
    options: [
      { id: 'reparation', label: 'Réparations d\'urgence', text: 'Infrastructures +2 points. Coût : 0,15 % du PIB par an pendant 4 mois.', budget: [{ line: 'infrastructures', gdpShare: 0.0015, months: 4 }],
        apply: (S, ev) => { S.services.infrastructures = clamp(S.services.infrastructures + 0.02, 0, 1); scaleModifiers(S, ev.uid, 0.5); return 'Réseaux rétablis en urgence.'; } },
      { id: 'rien', label: 'Laisser les opérateurs réparer', text: 'Aucun coût, confiance −1.',
        apply: (S) => { bumpTrust(S, -1); return 'Les opérateurs réparent à leur rythme.'; } },
    ],
    defaultOption: 'rien',
  },
  {
    id: 'panne_metro', title: 'Panne géante du métro', icon: '🚇', kind: 'crise', cooldown: 18,
    prob: (S) => (0.002 + 0.05 * Math.max(0, 0.76 - S.services.transports) + 0.03 * Math.max(0, 0.76 - S.services.infrastructures)) * (1 + modifierSum(S, 'risk:panne_metro')),
    start: (S, ev) => {
      S.services.transports = clamp(S.services.transports - 0.03, 0, 1);
      addModifier(S, 'prod:all', -0.006, 0.5, ev.uid, 'Panne du métro');
      bumpCats(S, ['employes', 'ouvriers', 'etudiants'], -3);
      return `Panne d'alimentation et signalisation hors service : 4 lignes de métro arrêtées plusieurs jours. Production −0,6 % ce mois-ci, qualité des transports −3 points, usagers −3. Qualité du réseau avant la panne : ${Math.round(S.services.transports * 100 + 3)}/100.`;
    },
    options: [
      { id: 'modernisation', label: 'Programme de modernisation du réseau', text: 'Signalisation et alimentation rénovées : transports +4 points, risque de panne −40 %. Coût : 0,25 % du PIB par an pendant 12 mois (transports publics).', budget: [{ line: 'transports', gdpShare: 0.0025, months: 12 }],
        apply: (S, ev) => { S.services.transports = clamp(S.services.transports + 0.04, 0, 1); addModifier(S, 'risk:panne_metro', -0.4, 0.99, ev.uid, 'Réseau modernisé'); bumpCats(S, ['employes', 'ouvriers', 'etudiants'], 2); return 'Programme de modernisation du métro financé.'; } },
      { id: 'bus', label: 'Bus de substitution et gratuité temporaire', text: 'Usagers +3, effet de la panne réduit de moitié. Coût : 0,05 % du PIB par an pendant 3 mois.', budget: [{ line: 'transports', gdpShare: 0.0005, months: 3 }],
        apply: (S, ev) => { scaleModifiers(S, ev.uid, 0.5); bumpCats(S, ['employes', 'ouvriers', 'etudiants'], 3); return 'Bus de substitution et gratuité pendant les travaux.'; } },
      { id: 'rien', label: 'Laisser l\'opérateur gérer', text: 'Aucun coût ; confiance −2.',
        apply: (S) => { bumpTrust(S, -2); return 'L\'opérateur répare à son rythme.'; } },
    ],
    defaultOption: 'rien',
  },
  {
    id: 'crise_portuaire', title: 'Blocage du port', icon: '⚓', kind: 'international', cooldown: 24,
    prob: (S) => 0.002 + 0.006 * Math.max(0, (50 - groupSupport(S, 'cgt')) / 50) + 0.004 * Math.max(0, (50 - (S.international?.avgRelation ?? 60)) / 50),
    start: (S, ev) => {
      addModifier(S, 'demand', -0.03, 0.75, ev.uid, 'Blocage du port');
      addModifier(S, 'prod:transport', -0.05, 0.7, ev.uid, 'Blocage du port');
      S.macro.priceLevel *= 1.002;
      return 'Grève des dockers et engorgement des routes maritimes : le port de la cité-État tourne au ralenti. Exportations −3 % (rétablissement rapide), logistique −5 %, prix des produits importés : niveau des prix +0,2 %.';
    },
    options: [
      { id: 'mediation', label: 'Médiation sociale et prime de reprise', text: 'Fin rapide du blocage (effets réduits de 70 %). Coût : 0,05 % du PIB par an pendant 3 mois (subventions).', budget: [{ line: 'subventions', gdpShare: 0.0005, months: 3 }],
        apply: (S, ev) => { scaleModifiers(S, ev.uid, 0.3); bumpGroup(S, 'cgt', 0.15); return 'Accord avec les dockers.'; } },
      { id: 'requisition', label: 'Réquisition des terminaux', text: 'Sans coût : effets réduits de moitié, mais syndicats hostiles et confiance −1.',
        apply: (S, ev) => { scaleModifiers(S, ev.uid, 0.5); bumpGroup(S, 'cgt', -0.3); bumpGroup(S, 'patronat', 0.1); bumpTrust(S, -1); return 'Terminaux réquisitionnés.'; } },
      { id: 'attendre', label: 'Attendre la fin du conflit', text: 'Aucun coût, aucun effet supplémentaire.',
        apply: () => 'Le conflit s\'éteint de lui-même.' },
    ],
    defaultOption: 'attendre',
  },
  {
    id: 'faillite', title: 'Faillite d\'un grand groupe industriel', icon: '🏭', kind: 'economie', cooldown: 24,
    prob: (S) => {
      const firms = S.sectors.reduce((s, x) => s + x.firms, 0);
      return 0.0015 + 0.15 * Math.max(0, S.accounts.failures / Math.max(1, firms) - 0.075) + 0.05 * Math.max(0, 0.45 - S.macro.confidence);
    },
    start: (S, ev, rnd) => {
      const jobs = sector(S, 'industrie').employees * 0.015;
      sector(S, 'industrie').employees -= jobs;
      S.macro.confidence = clamp(S.macro.confidence - 0.02, 0.05, 0.95);
      bumpCats(S, ['ouvriers'], -3);
      ev.data = { jobs };
      const names = ['Métallurgie Nordique', 'Forges de l\'Est', 'Chantiers Atlantiques', 'Automobiles Ventor', 'Chimie Delmar'];
      return `${names[Math.floor(rnd() * names.length)]} dépose le bilan : ${Math.round(jobs).toLocaleString('fr-FR')} emplois industriels supprimés, confiance des entreprises −2 points.`;
    },
    options: [
      { id: 'nationalisation', label: 'Nationalisation temporaire', text: 'Sauve 80 % des emplois, ouvriers +4, patronat hostile. Coût : 0,25 % du PIB par an pendant 12 mois.', budget: [{ line: 'subventions', gdpShare: 0.0025, months: 12 }],
        apply: (S, ev) => { sector(S, 'industrie').employees += 0.8 * (ev.data?.jobs ?? 0); bumpCats(S, ['ouvriers'], 4); bumpGroup(S, 'patronat', -0.2); bumpGroup(S, 'cgt', 0.2); return 'L\'État reprend l\'entreprise.'; } },
      { id: 'repreneur', label: 'Aider un repreneur', text: 'Sauve 45 % des emplois. Coût : 0,08 % du PIB par an pendant 6 mois.', budget: [{ line: 'subventions', gdpShare: 0.0008, months: 6 }],
        apply: (S, ev) => { sector(S, 'industrie').employees += 0.45 * (ev.data?.jobs ?? 0); bumpCats(S, ['ouvriers'], 1); return 'Un repreneur est trouvé.'; } },
      { id: 'laisser', label: 'Laisser faire', text: 'Aucun coût ; ouvriers −2, confiance des entreprises −1 point.',
        apply: (S) => { bumpCats(S, ['ouvriers'], -2); S.macro.confidence = clamp(S.macro.confidence - 0.01, 0.05, 0.95); bumpGroup(S, 'cgt', -0.2); return 'L\'entreprise est liquidée.'; } },
    ],
    defaultOption: 'laisser',
  },
  {
    id: 'prix_alimentaires', title: 'Hausse des prix alimentaires', icon: '🥖', kind: 'economie', cooldown: 24,
    prob: (S) => 0.0035 + 0.01 * (modifierSum(S, 'prod:agriculture') < -0.03 ? 1 : 0) + 0.005 * (modifierSum(S, 'energy') > 0.1 ? 1 : 0),
    start: (S) => {
      S.macro.priceLevel *= 1.005;
      bumpCats(S, MODEST, -2);
      return 'Mauvaises récoltes chez nos fournisseurs : la cité-État importe l\'essentiel de sa nourriture, les prix alimentaires flambent (niveau général des prix +0,5 %), catégories modestes −2.';
    },
    options: [
      { id: 'cheque', label: 'Chèque alimentaire', text: 'Catégories modestes +3. Coût : 0,15 % du PIB par an pendant 6 mois.', budget: [{ line: 'logement', gdpShare: 0.0015, months: 6 }],
        apply: (S) => { bumpCats(S, MODEST, 3); return 'Chèque alimentaire versé.'; } },
      { id: 'production', label: 'Agriculture urbaine et contrats d\'approvisionnement', text: 'Productivité agricole +3 % (durable), producteurs satisfaits. Coût : 0,1 % du PIB par an pendant 12 mois.', budget: [{ line: 'subventions', gdpShare: 0.001, months: 12 }],
        apply: (S, ev) => { addModifier(S, 'prod:agriculture', 0.03, 0.995, ev.uid, 'Soutien à la production locale'); bumpGroup(S, 'agriculteurs', 0.2); return 'Plan de soutien à l\'agriculture locale.'; } },
      { id: 'rien', label: 'Ne rien faire', text: 'Aucun coût, confiance −1.',
        apply: (S) => { bumpTrust(S, -1); return 'Aucune mesure.'; } },
    ],
    defaultOption: 'rien',
  },
  {
    id: 'innovation', title: 'Percée technologique', icon: '💡', kind: 'opportunite', cooldown: 36,
    prob: (S) => 0.002 + 0.4 * Math.max(0, S.policy.budget.recherche / gdp(S) - 0.008) + 0.02 * Math.max(0, S.services.recherche - 0.75),
    start: (S, ev) => {
      addModifier(S, 'prod:technologie', 0.03, 1, ev.uid, 'Percée technologique');
      S.macro.confidence = clamp(S.macro.confidence + 0.02, 0.05, 0.95);
      return 'Un laboratoire national réalise une percée majeure : productivité du numérique +3 % (durable), confiance des entreprises +2 points.';
    },
    options: [
      { id: 'industrialiser', label: 'Programme d\'industrialisation', text: 'Productivité de l\'industrie et du numérique +2 % supplémentaires (durable). Coût : 0,15 % du PIB par an pendant 12 mois (recherche).', budget: [{ line: 'recherche', gdpShare: 0.0015, months: 12 }],
        apply: (S, ev) => { addModifier(S, 'prod:industrie', 0.02, 1, ev.uid, 'Industrialisation de l\'innovation'); addModifier(S, 'prod:technologie', 0.02, 1, ev.uid, 'Industrialisation de l\'innovation'); return 'Programme d\'industrialisation lancé.'; } },
      { id: 'licences', label: 'Vendre des licences', text: 'Sans coût : demande étrangère +1 % (s\'estompe lentement).',
        apply: (S, ev) => { addModifier(S, 'demand', 0.01, 0.98, ev.uid, 'Licences technologiques'); return 'Licences vendues à l\'étranger.'; } },
      { id: 'prive', label: 'Laisser le privé s\'en saisir', text: 'Aucun coût, aucun effet supplémentaire.',
        apply: () => 'Le secteur privé exploite la découverte.' },
    ],
    defaultOption: 'prive',
  },
  {
    id: 'crise_internationale', title: 'Crise internationale', icon: '🌐', kind: 'international', cooldown: 30,
    prob: (S) => 0.002 + 0.01 * Math.max(0, (45 - (S.international?.avgRelation ?? 60)) / 45),
    start: (S, ev, rnd) => {
      const N = S.international?.neighbors ?? [];
      const k = N.length ? Math.floor(rnd() * N.length) : -1;
      if (k >= 0) N[k].relation = clamp(N[k].relation - 15, 0, 100);
      addModifier(S, 'demand', -0.03, 0.95, ev.uid, 'Crise internationale');
      addModifier(S, 'energy', 0.12, 0.92, ev.uid, 'Crise internationale');
      ev.data = { neighbor: k };
      return `Tensions géopolitiques${k >= 0 ? ` impliquant ${N[k].name}` : ''} : demande mondiale −3 %, prix de l'énergie +12 %${k >= 0 ? `, relations avec ${N[k].name} −15` : ''}.`;
    },
    options: [
      { id: 'mediation', label: 'Médiation diplomatique', text: 'Relations +5 avec tous les voisins, chocs réduits de 40 %. Coût : 0,03 % du PIB par an pendant 6 mois.', budget: [{ line: 'administration', gdpShare: 0.0003, months: 6 }],
        apply: (S, ev) => { for (const n of S.international?.neighbors ?? []) n.relation = clamp(n.relation + 5, 0, 100); scaleModifiers(S, ev.uid, 0.6); return 'Médiation engagée.'; } },
      { id: 'sanctions', label: 'Sanctions et soutien aux alliés', text: 'Relations −15 avec le pays concerné, +5 avec les autres. Coût : 0,15 % du PIB par an pendant 12 mois (défense).', budget: [{ line: 'defense', gdpShare: 0.0015, months: 12 }],
        apply: (S, ev) => { const k = ev.data?.neighbor ?? -1; (S.international?.neighbors ?? []).forEach((n, i) => { n.relation = clamp(n.relation + (i === k ? -15 : 5), 0, 100); }); bumpParty(S, 'conservateurs', 0.05); return 'Sanctions adoptées.'; } },
      { id: 'neutralite', label: 'Neutralité', text: 'Aucun coût, aucun effet supplémentaire.',
        apply: () => 'Le pays reste neutre.' },
    ],
    defaultOption: 'neutralite',
  },
];
const DEF_INDEX = Object.fromEntries(EVENT_DEFS.map((d) => [d.id, d])) as Record<string, EventDef>;

export function initEvents(): EventsState {
  return { active: [], history: [], seq: 1, lastEventMonth: -999, lastByType: {}, modifiers: [], extraBudget: [], enabled: true };
}

function optionCost(S: GameState, o: OptionDef) {
  return (o.budget ?? []).reduce((s, b) => s + b.gdpShare * gdp(S) * (b.months / 12), 0);
}

/** Probabilité mensuelle d'un événement dans l'état courant (0 si en période de grâce ou de délai). */
export function eventProbability(S: GameState, id: string): number {
  const E = S.events;
  const def = DEF_INDEX[id];
  if (!E || !def) return 0;
  const last = E.lastByType[id];
  if (last !== undefined && S.month - last < def.cooldown) return 0;
  return clamp(def.prob(S), 0, 0.25);
}

/** Déclenche un événement donné (utilisé par le tirage et par les tests). */
export function triggerEvent(S: GameState, id: string): GameEvent | null {
  const E = S.events;
  const def = DEF_INDEX[id];
  if (!E || !def) return null;
  const rnd = mulberry32(hashString(`${S.country.seed}|evt|${S.month}|${id}|start`));
  const ev: GameEvent = {
    uid: E.seq++, id, title: def.title, icon: def.icon, kind: def.kind, month: S.month, deadline: S.month + EVENT_DEADLINE, text: '', status: 'en_attente',
    options: def.options.map((o) => ({ id: o.id, label: o.label, text: o.text, cost: optionCost(S, o) })), defaultOption: def.defaultOption,
  };
  ev.text = def.start(S, ev, rnd);
  E.active.push(ev);
  E.lastEventMonth = S.month;
  E.lastByType[id] = S.month;
  S.notices.push({ id: S.noticeSeq++, month: S.month, kind: def.kind === 'opportunite' ? 'good' : 'bad', title: `${def.icon} ${def.title}`, text: `${ev.text} Décision attendue avant ${EVENT_DEADLINE} mois.` });
  if (S.notices.length > 80) S.notices.shift();
  return ev;
}

/** Applique l'option choisie (ou l'option par défaut) d'un événement en attente. */
export function resolveEvent(S: GameState, uid: number, optionId?: string, auto = false): { ok: boolean; msg: string } {
  const E = S.events;
  if (!E) return { ok: false, msg: 'Module événements indisponible' };
  const ev = E.active.find((e) => e.uid === uid);
  if (!ev) return { ok: false, msg: 'Événement introuvable ou déjà traité' };
  const def = DEF_INDEX[ev.id];
  const opt = def.options.find((o) => o.id === (optionId ?? ev.defaultOption));
  if (!opt) return { ok: false, msg: 'Option inconnue' };
  for (const b of opt.budget ?? []) addExtraBudget(S, b.line, b.gdpShare * gdp(S), b.months, `${def.title} — ${opt.label}`);
  const outcome = opt.apply(S, ev);
  ev.status = 'resolu';
  ev.choice = opt.id;
  ev.auto = auto;
  ev.resolvedMonth = S.month;
  ev.outcome = outcome;
  E.active = E.active.filter((e) => e.uid !== uid);
  E.history.push(ev);
  if (E.history.length > 30) E.history.shift();
  const cost = optionCost(S, opt);
  S.notices.push({ id: S.noticeSeq++, month: S.month, kind: auto ? 'warn' : 'info', title: `${def.icon} ${def.title} : ${opt.label}`, text: `${auto ? 'Sans décision dans le délai, l\'option par défaut s\'applique. ' : ''}${outcome}${cost > 0 ? ` Coût : ${md(cost)}.` : ''}` });
  if (S.notices.length > 80) S.notices.shift();
  return { ok: true, msg: `${def.title} : ${opt.label}` };
}

/** Pas mensuel (avant l'économie) : décroissance des effets, options par défaut à échéance, tirage d'un nouvel événement. */
export function eventsStep(S: GameState) {
  const E = S.events;
  if (!E) return;
  for (const m of E.modifiers) m.value *= m.decay;
  E.modifiers = E.modifiers.filter((m) => Math.abs(m.value) >= 0.0005);
  for (const ev of [...E.active]) if (S.month >= ev.deadline) resolveEvent(S, ev.uid, undefined, true);
  if (!E.enabled || S.month < EVENT_GRACE_MONTHS || S.month - E.lastEventMonth < EVENT_GAP_MONTHS || E.active.length >= MAX_PENDING) return;
  let best: string | null = null;
  let bestScore = Infinity;
  for (const def of EVENT_DEFS) {
    const p = eventProbability(S, def.id);
    if (p <= 0) continue;
    const r = mulberry32(hashString(`${S.country.seed}|evt|${S.month}|${def.id}`))();
    if (r < p && r / p < bestScore) { bestScore = r / p; best = def.id; }
  }
  if (best) triggerEvent(S, best);
}

/** Ajoute les crédits exceptionnels du mois aux lignes budgétaires (avant l'économie). */
export function applyExtraBudget(S: GameState) {
  const E = S.events;
  if (!E) return;
  for (const x of E.extraBudget) {
    x.applied = x.annual;
    S.policy.budget[x.line] += x.annual;
  }
}

/** Retire les crédits exceptionnels après le calcul du mois (avant l'indexation des budgets). */
export function removeExtraBudget(S: GameState) {
  const E = S.events;
  if (!E) return;
  for (const x of E.extraBudget) {
    if (x.applied) S.policy.budget[x.line] -= x.applied;
    x.applied = 0;
    x.months -= 1;
  }
  E.extraBudget = E.extraBudget.filter((x) => x.months > 0);
}

/** Facteur multiplicatif de productivité d'un secteur dû aux événements (prod:<secteur> et prod:all). */
export function productivityFactor(S: GameState, sectorId: SectorId) {
  return (1 + modifierSum(S, `prod:${sectorId}`)) * (1 + modifierSum(S, 'prod:all'));
}

export const EVENT_IDS = EVENT_DEFS.map((d) => d.id);
