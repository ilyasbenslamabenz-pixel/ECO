// Recherche et arbre technologique : technologies (coût, durée, prérequis, effets), rythme de recherche
// fonction du budget « recherche », effets exposés sous forme de multiplicateurs lisibles par les autres moteurs.
import { SECTORS, SECTOR_INDEX, type SectorId } from './data';
import { clamp } from './economy';
import type { GameState } from './types';
import { priceRel } from './workforce';

export type TechDomain = 'energie' | 'industrie' | 'agriculture' | 'transport' | 'sante' | 'education' | 'urbanisme' | 'securite';

export interface TechDef {
  id: string;
  name: string;
  icon: string;
  domain: TechDomain;
  cost: number; // effort de recherche total (€, prix de base)
  months: number; // durée minimale (mois) : l'effort mensuel est plafonné à cost / months
  requires: string[];
  description: string;
  effects: Partial<TechEffects> & { productivity?: Partial<Record<SectorId, number>>; emissions?: Partial<Record<SectorId, number>> };
}

/**
 * Multiplicateurs cumulés des technologies débloquées (1 = aucun effet). Lus par :
 * - le moteur énergie : `energy.*` (rendements solaire et éolien, stockage, pertes réseau, coût du nucléaire, pompes à chaleur, hydrogène) ;
 * - le moteur des secteurs : `productivity` et `emissions` (appliqués par défaut ici, voir `researchStep`) ;
 * - les moteurs santé, éducation, logement, sécurité, déchets.
 */
export interface TechEffects {
  productivity: Partial<Record<SectorId, number>>; // multiplicateur de productivité sectorielle
  emissions: Partial<Record<SectorId, number>>; // multiplicateur d'intensité d'émission sectorielle
  energy: { solarYield: number; windYield: number; storage: number; gridLosses: number; nuclearCost: number; heatPumps: number; hydrogen: number };
  health: { doctorProductivity: number; qualityBonus: number; access: number };
  education: { teacherProductivity: number; dropout: number; humanCapital: number };
  housing: { energy: number; buildCost: number };
  security: { response: number };
  waste: number; // multiplicateur des déchets produits
}

const B = 1e9;
export const TECHS: TechDef[] = [
  { id: 'reseaux_intelligents', name: 'Réseaux intelligents', icon: '🔌', domain: 'energie', cost: 1.2 * B, months: 18, requires: [], description: 'Pilotage numérique du réseau électrique : pertes réduites, intégration des renouvelables.', effects: { energy: { gridLosses: 0.8 } as TechEffects['energy'], emissions: { energie: 0.97 } } },
  { id: 'solaire_ng', name: 'Solaire nouvelle génération', icon: '☀️', domain: 'energie', cost: 1.6 * B, months: 24, requires: [], description: 'Cellules tandem pérovskite-silicium : +30 % de production par panneau.', effects: { energy: { solarYield: 1.3 } as TechEffects['energy'], emissions: { energie: 0.96 } } },
  { id: 'eolien_hp', name: 'Éoliennes haute performance', icon: '🌬️', domain: 'energie', cost: 1.8 * B, months: 24, requires: [], description: 'Rotors géants et pales recyclables : +25 % de production par parc.', effects: { energy: { windYield: 1.25 } as TechEffects['energy'], emissions: { energie: 0.96 } } },
  { id: 'batteries_avancees', name: 'Batteries avancées', icon: '🔋', domain: 'energie', cost: 2.4 * B, months: 30, requires: ['reseaux_intelligents'], description: 'Batteries sodium-ion et stockage stationnaire : capacité de stockage doublée.', effects: { energy: { storage: 2 } as TechEffects['energy'], productivity: { transport: 1.02 } } },
  { id: 'pompes_chaleur', name: 'Pompes à chaleur', icon: '♨️', domain: 'urbanisme', cost: 1.0 * B, months: 18, requires: [], description: 'Pompes à chaleur à haut rendement : consommation de chauffage des logements −15 %.', effects: { energy: { heatPumps: 0.85 } as TechEffects['energy'], housing: { energy: 0.9 } as TechEffects['housing'] } },
  { id: 'materiaux_bas_carbone', name: 'Matériaux bas carbone', icon: '🧱', domain: 'industrie', cost: 1.4 * B, months: 24, requires: [], description: 'Ciments et aciers décarbonés, construction bois : émissions du bâtiment −20 %.', effects: { emissions: { construction: 0.8, industrie: 0.95 }, housing: { buildCost: 0.97 } as TechEffects['housing'] } },
  { id: 'capture_carbone', name: 'Capture industrielle du carbone', icon: '🏭', domain: 'industrie', cost: 4 * B, months: 36, requires: ['materiaux_bas_carbone'], description: 'Captage et stockage du CO₂ des cimenteries, aciéries et centrales.', effects: { emissions: { industrie: 0.8, energie: 0.9 } } },
  { id: 'agriculture_precision', name: 'Agriculture de précision', icon: '🚜', domain: 'agriculture', cost: 1.0 * B, months: 18, requires: [], description: 'Capteurs, drones et modulation des intrants : productivité +8 %, émissions −12 %.', effects: { productivity: { agriculture: 1.08 }, emissions: { agriculture: 0.88 } } },
  { id: 'recyclage_avance', name: 'Recyclage avancé', icon: '♻️', domain: 'industrie', cost: 1.2 * B, months: 24, requires: [], description: 'Tri optique et recyclage chimique : déchets −20 %, matières premières secondaires.', effects: { waste: 0.8, emissions: { industrie: 0.96 }, productivity: { industrie: 1.01 } } },
  { id: 'transports_autonomes', name: 'Transports autonomes', icon: '🚗', domain: 'transport', cost: 3.6 * B, months: 36, requires: ['reseaux_intelligents'], description: 'Navettes et camions autonomes : productivité de la logistique +10 %.', effects: { productivity: { transport: 1.1 }, emissions: { transport: 0.92 } } },
  { id: 'nucleaire_avance', name: 'Réacteurs nucléaires avancés', icon: '⚛️', domain: 'energie', cost: 6 * B, months: 48, requires: ['reseaux_intelligents', 'materiaux_bas_carbone'], description: 'Petits réacteurs modulaires : coût du nucléaire −25 %, débloque la construction de SMR.', effects: { energy: { nuclearCost: 0.75 } as TechEffects['energy'], emissions: { energie: 0.95 } } },
  { id: 'hydrogene_vert', name: 'Hydrogène vert', icon: '💧', domain: 'energie', cost: 3 * B, months: 36, requires: ['solaire_ng', 'eolien_hp'], description: 'Électrolyseurs bon marché : décarbonation de l\'industrie lourde.', effects: { energy: { hydrogen: 1.5 } as TechEffects['energy'], emissions: { industrie: 0.85 } } },
  { id: 'telemedecine', name: 'Télémédecine', icon: '📱', domain: 'sante', cost: 0.8 * B, months: 12, requires: [], description: 'Consultations à distance : temps médical +6 %, accès aux soins amélioré dans les zones rurales.', effects: { health: { doctorProductivity: 1.06, access: 1.02 } as TechEffects['health'] } },
  { id: 'diagnostic_ia', name: 'Diagnostic assisté par IA', icon: '🩻', domain: 'sante', cost: 1.8 * B, months: 24, requires: ['telemedecine'], description: 'Imagerie et triage automatisés : temps médical +10 %, attente réduite.', effects: { health: { doctorProductivity: 1.1 } as TechEffects['health'], productivity: { sante: 1.03 } } },
  { id: 'therapies_geniques', name: 'Thérapies géniques', icon: '🧬', domain: 'sante', cost: 5 * B, months: 48, requires: ['diagnostic_ia'], description: 'Traitements des maladies rares et de certains cancers : qualité des soins +3 points.', effects: { health: { qualityBonus: 0.03 } as TechEffects['health'] } },
  { id: 'education_numerique', name: 'Éducation numérique', icon: '💻', domain: 'education', cost: 0.7 * B, months: 12, requires: [], description: 'Plateformes et ressources numériques : efficacité des enseignants +6 %, décrochage −10 %.', effects: { education: { teacherProductivity: 1.06, dropout: 0.9 } as TechEffects['education'] } },
  { id: 'tutorat_adaptatif', name: 'Tutorat adaptatif', icon: '🎓', domain: 'education', cost: 1.6 * B, months: 24, requires: ['education_numerique'], description: 'Parcours personnalisés par IA : réussite accrue, capital humain +4 %.', effects: { education: { humanCapital: 1.04, dropout: 0.9 } as TechEffects['education'], productivity: { education: 1.03 } } },
  { id: 'batiments_passifs', name: 'Bâtiments passifs', icon: '🏡', domain: 'urbanisme', cost: 1.4 * B, months: 24, requires: ['pompes_chaleur', 'materiaux_bas_carbone'], description: 'Logements à énergie positive : consommation des logements −10 %, construction moins chère.', effects: { housing: { energy: 0.9, buildCost: 0.95 } as TechEffects['housing'], emissions: { construction: 0.9 } } },
  { id: 'secours_connectes', name: 'Secours connectés', icon: '🚨', domain: 'securite', cost: 0.6 * B, months: 12, requires: [], description: 'Plateforme unique d\'appels d\'urgence et géolocalisation : délais d\'intervention −15 %.', effects: { security: { response: 0.85 } } },
];
export const TECH_INDEX: Record<string, TechDef> = Object.fromEntries(TECHS.map((t) => [t.id, t]));

export interface ResearchPolicy {
  applied: number; // part du budget de recherche affectée aux programmes technologiques (le reste : recherche fondamentale)
}
export const DEFAULT_RESEARCH_POLICY: ResearchPolicy = { applied: 0.4 };

export interface ResearchState {
  active: string | null; // technologie en cours
  queue: string[]; // file d'attente
  progress: Record<string, number>; // effort cumulé par technologie (€, prix de base)
  unlocked: string[]; // technologies débloquées (lisible par les autres moteurs)
  unlockedAt: Record<string, number>; // mois de déblocage
  knowledge: number; // stock de recherche fondamentale (€, prix de base)
  effortMonthly: number; // effort appliqué ce mois-ci (€, prix de base)
  efficiency: number; // efficacité de la recherche (capital humain, laboratoires, savoir accumulé)
  effects: TechEffects;
}

export function neutralEffects(): TechEffects {
  return {
    productivity: {}, emissions: {},
    energy: { solarYield: 1, windYield: 1, storage: 1, gridLosses: 1, nuclearCost: 1, heatPumps: 1, hydrogen: 1 },
    health: { doctorProductivity: 1, qualityBonus: 0, access: 1 },
    education: { teacherProductivity: 1, dropout: 1, humanCapital: 1 },
    housing: { energy: 1, buildCost: 1 },
    security: { response: 1 },
    waste: 1,
  };
}

/** Multiplicateurs cumulés d'un ensemble de technologies (fonction pure). */
export function techEffects(unlocked: string[]): TechEffects {
  const e = neutralEffects();
  for (const id of unlocked) {
    const t = TECH_INDEX[id];
    if (!t) continue;
    const x = t.effects;
    for (const [k, v] of Object.entries(x.productivity ?? {})) e.productivity[k as SectorId] = (e.productivity[k as SectorId] ?? 1) * (v as number);
    for (const [k, v] of Object.entries(x.emissions ?? {})) e.emissions[k as SectorId] = (e.emissions[k as SectorId] ?? 1) * (v as number);
    for (const [k, v] of Object.entries(x.energy ?? {})) (e.energy as Record<string, number>)[k] *= v as number;
    if (x.health) { e.health.doctorProductivity *= x.health.doctorProductivity ?? 1; e.health.access *= x.health.access ?? 1; e.health.qualityBonus += x.health.qualityBonus ?? 0; }
    for (const [k, v] of Object.entries(x.education ?? {})) (e.education as Record<string, number>)[k] *= v as number;
    for (const [k, v] of Object.entries(x.housing ?? {})) (e.housing as Record<string, number>)[k] *= v as number;
    for (const [k, v] of Object.entries(x.security ?? {})) (e.security as Record<string, number>)[k] *= v as number;
    if (x.waste) e.waste *= x.waste;
  }
  return e;
}

export function initResearch(): ResearchState {
  return { active: null, queue: [], progress: {}, unlocked: [], unlockedAt: {}, knowledge: 0, effortMonthly: 0, efficiency: 1, effects: neutralEffects() };
}

export const isUnlocked = (S: GameState, id: string) => !!S.research?.unlocked.includes(id);
export const prereqsMet = (unlocked: string[], t: TechDef) => t.requires.every((r) => unlocked.includes(r));

/** Durée restante estimée (mois) au rythme actuel. */
export function remainingMonths(S: GameState, id: string) {
  const R = S.research;
  const t = TECH_INDEX[id];
  if (!R || !t) return Infinity;
  const left = t.cost - (R.progress[id] ?? 0);
  const rate = Math.min(t.cost / t.months, Math.max(1, R.effortMonthly));
  return Math.max(0, Math.ceil(left / rate));
}

export type ResearchAction =
  | { type: 'rechercher'; tech: string } // lance (ou remplace) la technologie active
  | { type: 'fileRecherche'; techs: string[] } // remplace la file d'attente
  | { type: 'annulerRecherche' }; // suspend la recherche active (l'effort cumulé est conservé)

export function applyResearchAction(S: GameState, a: ResearchAction): { ok: boolean; code?: string; msg: string } {
  const R = S.research;
  if (!R) return { ok: false, code: 'INDISPONIBLE', msg: 'Module de recherche indisponible' };
  if (a.type === 'annulerRecherche') {
    R.active = null;
    return { ok: true, msg: 'Programme de recherche suspendu (les travaux réalisés sont conservés)' };
  }
  if (a.type === 'rechercher') {
    const t = TECH_INDEX[String(a.tech)];
    if (!t) return { ok: false, code: 'TECHNOLOGIE_INCONNUE', msg: 'Technologie inconnue' };
    if (R.unlocked.includes(t.id)) return { ok: false, code: 'DEJA_DEBLOQUEE', msg: `« ${t.name} » est déjà maîtrisée` };
    if (!prereqsMet(R.unlocked, t)) {
      const miss = t.requires.filter((r) => !R.unlocked.includes(r)).map((r) => TECH_INDEX[r]?.name ?? r);
      return { ok: false, code: 'PREREQUIS', msg: `Prérequis manquants : ${miss.join(', ')}` };
    }
    R.active = t.id;
    R.queue = R.queue.filter((q) => q !== t.id);
    return { ok: true, msg: `Programme lancé : ${t.name} (≈ ${remainingMonths(S, t.id)} mois au rythme actuel)` };
  }
  if (a.type === 'fileRecherche') {
    const list = Array.isArray(a.techs) ? a.techs.map(String).slice(0, TECHS.length) : [];
    const known = [...R.unlocked, ...(R.active ? [R.active] : [])];
    const queue: string[] = [];
    for (const id of list) {
      const t = TECH_INDEX[id];
      if (!t) return { ok: false, code: 'TECHNOLOGIE_INCONNUE', msg: `Technologie inconnue : ${id}` };
      if (known.includes(id) || queue.includes(id)) continue;
      if (!t.requires.every((r) => known.includes(r) || queue.includes(r))) return { ok: false, code: 'PREREQUIS', msg: `« ${t.name} » doit être placée après ses prérequis` };
      queue.push(id);
    }
    R.queue = queue;
    return { ok: true, msg: queue.length ? `File de recherche : ${queue.length} programme(s)` : 'File de recherche vidée' };
  }
  return { ok: false, code: 'ACTION_INCONNUE', msg: 'Action inconnue' };
}

/** Coefficient mensuel qui maintient l'intensité d'émission à `mult` × la cible du moteur économique (convergence 1,2 %/mois). */
function emissionPull(mult: number) {
  const a = 0.012;
  return mult / (mult + a * (1 - mult));
}

/**
 * Un mois de recherche. Effort = budget « recherche » × part appliquée × efficacité, plafonné par la durée minimale
 * de la technologie ; l'excédent et la part fondamentale alimentent le savoir (efficacité future).
 * Applique aussi les effets sectoriels : productivité (une fois, au déblocage) et émissions (continûment).
 */
export function researchStep(S: GameState, notify: (kind: 'good' | 'info', title: string, text: string) => void) {
  const R = S.research!;
  const P = S.policy.research ?? DEFAULT_RESEARCH_POLICY;
  const pr = priceRel(S);
  const budget = Math.max(0, S.policy.budget.recherche) / pr / 12; // €/mois, prix de base
  const hc = S.education?.humanCapital ?? 0.8;
  const labs = S.country.infra.filter((i) => i.type === 'laboratoire' && i.status !== 'chantier').reduce((s, i) => s + i.level, 0);
  const lectR = S.education ? S.education.lecturers.staff / Math.max(1, S.education.ref.lecturers) : 1;
  const knowledgeBonus = 0.3 * (1 - Math.exp(-R.knowledge / 2e10));
  R.efficiency = clamp(Math.pow(hc / 0.8, 0.8) * Math.pow(clamp(lectR, 0.3, 2), 0.2) * (1 + 0.04 * labs) * (1 + knowledgeBonus), 0.2, 3);
  let applied = budget * clamp(P.applied, 0, 1) * R.efficiency;
  let fundamental = budget * (1 - clamp(P.applied, 0, 1));
  R.effortMonthly = applied;
  if (!R.active) {
    const next = R.queue.find((id) => TECH_INDEX[id] && !R.unlocked.includes(id) && prereqsMet(R.unlocked, TECH_INDEX[id]));
    if (next) { R.active = next; R.queue = R.queue.filter((q) => q !== next); }
  }
  if (R.active) {
    const t = TECH_INDEX[R.active];
    const spent = Math.min(applied, t.cost / t.months, t.cost - (R.progress[t.id] ?? 0));
    R.progress[t.id] = (R.progress[t.id] ?? 0) + spent;
    applied -= spent;
    if (R.progress[t.id] >= t.cost - 1) {
      R.unlocked.push(t.id);
      R.unlockedAt[t.id] = S.month;
      R.active = null;
      for (const [sid, m] of Object.entries(t.effects.productivity ?? {})) S.sectors[SECTOR_INDEX[sid as SectorId]].productivity *= m as number;
      notify('good', 'Percée technologique', `${t.icon} ${t.name} : ${t.description}`);
    }
  }
  fundamental += applied; // effort non absorbé (aucun programme ou plafond atteint)
  R.knowledge = R.knowledge * (1 - 0.05 / 12) + fundamental;
  R.effects = techEffects(R.unlocked);
  // émissions : intensité maintenue sous la cible du moteur économique
  SECTORS.forEach((d, i) => {
    const m = R.effects.emissions[d.id];
    if (m && m < 1) S.sectors[i].emissionIntensity *= emissionPull(m);
  });
}
