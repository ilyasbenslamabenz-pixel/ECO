/**
 * Arbres de développement (docs/PROGRESSION.md §8) : chaque palier de ville franchi rapporte des POINTS DE
 * DÉVELOPPEMENT, dépensés dans des arbres par domaine (électricité, eau, transports, santé, éducation, police) pour
 * débloquer des améliorations permanentes : bonus d'efficacité (modificateurs combinés avec les politiques et la
 * recherche, rayon / capacité des équipements, criminalité, réussite scolaire) ou bâtiment spécial débloqué avant
 * son palier (déblocages progressifs).
 *
 * Les points se déduisent des paliers atteints (aucun compteur à sauvegarder) : une ancienne sauvegarde qui a déjà
 * franchi des paliers dispose aussitôt de ses points. Mécaniques, noms et valeurs propres au jeu.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { MILESTONES } from './milestones';
import type { ModifierDelta } from './governance';

export type DevDomain = 'electricite' | 'eau' | 'transports' | 'sante' | 'education' | 'police';
export const DEV_DOMAINS: readonly DevDomain[] = ['electricite', 'eau', 'transports', 'sante', 'education', 'police'];
export const DEV_DOMAIN_NAMES_FR: Record<DevDomain, string> = {
  electricite: 'Électricité', eau: 'Eau', transports: 'Transports', sante: 'Santé', education: 'Éducation', police: 'Police',
};

/** Services de couverture dont un nœud peut améliorer le rayon ou la capacité. */
export type DevService = 'education' | 'sante' | 'police';
export const DEV_SERVICES: readonly DevService[] = ['education', 'sante', 'police'];

export interface DevEffect {
  /** Modificateurs combinés avec les politiques, la recherche et les événements (`governanceModifiers`). */
  mods?: ModifierDelta;
  /** Rayon et capacité (×) des équipements d'un service. */
  service?: { svc: DevService; radius?: number; capacity?: number };
  /** Criminalité cible (×). */
  crimeFactor?: number;
  /** Probabilités d'études supérieures et de formation des adultes (×). */
  educationFactor?: number;
  /** Bâtiments débloqués sans attendre leur palier (parties en déblocages progressifs). */
  assets?: readonly string[];
}

export interface DevNodeDef {
  id: string;
  domain: DevDomain;
  nameFr: string;
  descFr: string;
  /** Points de développement à dépenser. */
  cost: number;
  /** Nœuds du même arbre à débloquer avant. */
  requires: readonly string[];
  effect: DevEffect;
}

export const DEV_NODES: readonly DevNodeDef[] = [
  // Électricité
  { id: 'elec_reseau', domain: 'electricite', nameFr: 'Réseau intelligent', descFr: 'Pilotage fin de la distribution : demande d’électricité −5 %.', cost: 1, requires: [], effect: { mods: { powerDemandFactor: 0.95 } } },
  { id: 'elec_renouvelable', domain: 'electricite', nameFr: 'Production renouvelable optimisée', descFr: 'Éoliennes et panneaux mieux orientés : production éolienne et solaire +15 %.', cost: 2, requires: ['elec_reseau'], effect: { mods: { renewableFactor: 1.15 } } },
  { id: 'elec_interconnexion', domain: 'electricite', nameFr: 'Interconnexion renforcée', descFr: 'Ligne vers le réseau voisin doublée : capacité du raccordement +30 %.', cost: 2, requires: ['elec_reseau'], effect: { mods: { powerImportFactor: 1.3 } } },
  { id: 'elec_thermique', domain: 'electricite', nameFr: 'Centrale thermique anticipée', descFr: 'Centrale au gaz constructible sans attendre le Bourg ; demande d’électricité −3 %.', cost: 3, requires: ['elec_renouvelable'], effect: { assets: ['elec_centrale_gaz'], mods: { powerDemandFactor: 0.97 } } },
  // Eau
  { id: 'eau_compteurs', domain: 'eau', nameFr: 'Compteurs individuels', descFr: 'Chaque ménage voit sa consommation : demande en eau −8 %.', cost: 1, requires: [], effect: { mods: { waterDemandFactor: 0.92 } } },
  { id: 'eau_fuites', domain: 'eau', nameFr: 'Chasse aux fuites', descFr: 'Canalisations surveillées : demande en eau −10 %.', cost: 2, requires: ['eau_compteurs'], effect: { mods: { waterDemandFactor: 0.9 } } },
  { id: 'eau_qualite', domain: 'eau', nameFr: 'Eau potable contrôlée', descFr: 'Analyses quotidiennes : maladies −10 %, +1 point de bonheur.', cost: 2, requires: ['eau_compteurs'], effect: { mods: { sicknessFactor: 0.9, happiness: 1 } } },
  { id: 'eau_barrage', domain: 'eau', nameFr: 'Maîtrise des retenues', descFr: 'Barrage hydroélectrique constructible sans attendre le palier « Ville ».', cost: 3, requires: ['eau_fuites'], effect: { assets: ['elec_barrage'] } },
  // Transports
  { id: 'trans_entretien', domain: 'transports', nameFr: 'Entretien préventif', descFr: 'Chaussées réparées avant de se dégrader : entretien des routes −10 %.', cost: 1, requires: [], effect: { mods: { roadUpkeepFactor: 0.9 } } },
  { id: 'trans_mobilite', domain: 'transports', nameFr: 'Mobilité douce', descFr: 'Pistes cyclables et trottoirs larges : +1 point de bonheur, demande résidentielle en hausse.', cost: 2, requires: ['trans_entretien'], effect: { mods: { happiness: 1, demand: { R: 0.04 } } } },
  { id: 'trans_logistique', domain: 'transports', nameFr: 'Plateformes logistiques', descFr: 'Livraisons regroupées : demande industrielle et commerciale en hausse.', cost: 2, requires: ['trans_entretien'], effect: { mods: { demand: { I: 0.06, C: 0.04 } } } },
  { id: 'trans_gare', domain: 'transports', nameFr: 'Desserte ferroviaire anticipée', descFr: 'Gare constructible sans attendre la Petite ville ; entretien des routes −5 %.', cost: 3, requires: ['trans_logistique'], effect: { assets: ['public_gare'], mods: { roadUpkeepFactor: 0.95 } } },
  // Santé
  { id: 'sante_prevention', domain: 'sante', nameFr: 'Médecine préventive', descFr: 'Dépistage et vaccination : maladies −10 %.', cost: 1, requires: [], effect: { mods: { sicknessFactor: 0.9 } } },
  { id: 'sante_capacite', domain: 'sante', nameFr: 'Soins ambulatoires', descFr: 'Plus de patients traités sans hospitalisation : capacité des équipements de santé +20 %.', cost: 2, requires: ['sante_prevention'], effect: { service: { svc: 'sante', capacity: 1.2 } } },
  { id: 'sante_ambulances', domain: 'sante', nameFr: 'Ambulances régulées', descFr: 'Interventions plus rapides : rayon d’action des équipements de santé +15 %.', cost: 2, requires: ['sante_prevention'], effect: { service: { svc: 'sante', radius: 1.15 } } },
  { id: 'sante_hopital', domain: 'sante', nameFr: 'Hôpital anticipé', descFr: 'Hôpital constructible sans attendre le Bourg ; maladies −5 %.', cost: 3, requires: ['sante_capacite'], effect: { assets: ['public_hopital'], mods: { sicknessFactor: 0.95 } } },
  // Éducation
  { id: 'edu_pedagogie', domain: 'education', nameFr: 'Pédagogie renouvelée', descFr: 'Accompagnement des élèves : études supérieures et formation des adultes +15 %.', cost: 1, requires: [], effect: { educationFactor: 1.15 } },
  { id: 'edu_classes', domain: 'education', nameFr: 'Classes supplémentaires', descFr: 'Locaux réaménagés : capacité des établissements d’enseignement +20 %.', cost: 2, requires: ['edu_pedagogie'], effect: { service: { svc: 'education', capacity: 1.2 } } },
  { id: 'edu_ramassage', domain: 'education', nameFr: 'Ramassage scolaire', descFr: 'Cars scolaires : rayon de recrutement des écoles +15 %.', cost: 2, requires: ['edu_pedagogie'], effect: { service: { svc: 'education', radius: 1.15 } } },
  { id: 'edu_savoirs', domain: 'education', nameFr: 'Lieux de savoir', descFr: 'Médiathèque, musée et bibliothèque constructibles avant leur palier ; études supérieures +10 %.', cost: 3, requires: ['edu_classes'], effect: { assets: ['proc_mediatheque', 'public_musee_bibliotheque'], educationFactor: 1.1 } },
  // Police
  { id: 'police_proximite', domain: 'police', nameFr: 'Police de proximité', descFr: 'Agents connus des habitants : criminalité −10 %.', cost: 1, requires: [], effect: { crimeFactor: 0.9 } },
  { id: 'police_patrouilles', domain: 'police', nameFr: 'Patrouilles motorisées', descFr: 'Rayon d’action des commissariats +15 %.', cost: 2, requires: ['police_proximite'], effect: { service: { svc: 'police', radius: 1.15 } } },
  { id: 'police_effectifs', domain: 'police', nameFr: 'Effectifs renforcés', descFr: 'Capacité des commissariats +20 %.', cost: 2, requires: ['police_proximite'], effect: { service: { svc: 'police', capacity: 1.2 } } },
  { id: 'police_prevention', domain: 'police', nameFr: 'Prévention de la délinquance', descFr: 'Médiateurs et éclairage : criminalité −15 %, +1 point de bonheur.', cost: 3, requires: ['police_patrouilles', 'police_effectifs'], effect: { crimeFactor: 0.85, mods: { happiness: 1 } } },
];

export const devNode = (id: string): DevNodeDef | undefined => DEV_NODES.find((n) => n.id === id);

/** Points de développement versés par chaque palier (même ordre que MILESTONES). */
export const DEV_POINTS_BY_MILESTONE: Readonly<Record<string, number>> = {
  hameau: 1, village: 2, bourg: 2, petite_ville: 3, ville: 3, grande_ville: 4, cite: 4, agglomeration: 5, metropole: 5, megapole: 6,
};

/** Points gagnés une fois les `reachedCount` premiers paliers franchis. */
export function devPointsEarned(reachedCount: number): number {
  let n = 0;
  for (let k = 0; k < Math.min(reachedCount, MILESTONES.length); k++) n += DEV_POINTS_BY_MILESTONE[MILESTONES[k]!.id] ?? 0;
  return n;
}

/** Points dépensés pour les nœuds `unlocked`. */
export function devPointsSpent(unlocked: readonly string[]): number {
  let n = 0;
  for (const id of unlocked) n += devNode(id)?.cost ?? 0;
  return n;
}

/** Effets combinés des nœuds débloqués (facteurs multiplicatifs, neutres = 1). */
export interface DevFactors {
  mods: ModifierDelta[];
  radius: Record<DevService, number>;
  capacity: Record<DevService, number>;
  crimeFactor: number;
  educationFactor: number;
  assets: Set<string>;
}

export function devFactors(unlocked: readonly string[]): DevFactors {
  const f: DevFactors = { mods: [], radius: { education: 1, sante: 1, police: 1 }, capacity: { education: 1, sante: 1, police: 1 }, crimeFactor: 1, educationFactor: 1, assets: new Set() };
  for (const id of unlocked) {
    const e = devNode(id)?.effect;
    if (!e) continue;
    if (e.mods) f.mods.push(e.mods);
    if (e.service) { if (e.service.radius) f.radius[e.service.svc] *= e.service.radius; if (e.service.capacity) f.capacity[e.service.svc] *= e.service.capacity; }
    if (e.crimeFactor) f.crimeFactor *= e.crimeFactor;
    if (e.educationFactor) f.educationFactor *= e.educationFactor;
    for (const a of e.assets ?? []) f.assets.add(a);
  }
  return f;
}

/** État du module `developpement` (commande `state`, deltas). */
export interface DevelopmentState {
  earned: number;
  spent: number;
  available: number;
  /** Points du prochain palier et son nom (null au dernier). */
  nextPoints: number;
  nextMilestone: string | null;
  nodes: (DevNodeDef & { unlocked: boolean; available: boolean; affordable: boolean })[];
  domains: { id: DevDomain; nameFr: string; unlocked: number; total: number }[];
}

/** Service `developpement` publié par le module (lu par la simulation et le module `paliers`). */
export interface DevelopmentService {
  /** Modificateurs combinés (compatible `GovernanceService`). */
  modifiers(): ModifierDelta;
  factors(): DevFactors;
  /** Vrai si un nœud débloque ce bâtiment avant son palier. */
  assetUnlocked(assetId: string): boolean;
  /** Change à chaque déblocage (recalcul des couvertures). */
  version(): number;
}
export const DEVELOPMENT_SERVICE = 'developpement';
