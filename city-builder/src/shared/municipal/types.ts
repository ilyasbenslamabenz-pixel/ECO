/**
 * Contrat municipal (phase 2B, sous-étape 1) — types PARTAGÉS entre la simulation (src/sim/municipal),
 * le protocole (deltas / commandes du module `municipal`) et la sauvegarde (src/sim/save-sections/municipal.ts).
 *
 * Données uniquement (aucune logique, aucun état) : sérialisables en JSON / structured clone.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */

/* ------------------------------------------------------------------ */
/* Fréquences de mise à jour                                           */
/* ------------------------------------------------------------------ */

/** Fréquences de l'ordonnanceur multi-fréquence (au-dessus du planificateur de base). */
export const FREQUENCIES = ['tick', 'hour', 'day', 'month'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

/* ------------------------------------------------------------------ */
/* Grilles d'indicateurs                                               */
/* ------------------------------------------------------------------ */

/** Indicateurs standard (identifiants stables : enregistrés dans les sauvegardes). */
export const STANDARD_INDICATORS = [
  'pollution_air', 'pollution_sol', 'pollution_eau', 'bruit', 'valeur_fonciere', 'couverture_sante',
  'couverture_education', 'couverture_police', 'couverture_incendie', 'criminalite', 'satisfaction',
] as const;
export type StandardIndicatorId = (typeof STANDARD_INDICATORS)[number];
/** Identifiant d'indicateur : standard, ou propre à un module (préfixé par son id, ex. `electricite:tension`). */
export type IndicatorId = StandardIndicatorId | `${string}:${string}`;

/** Propagation d'un indicateur (diffusion explicite à 4 voisins + atténuation), appliquée à sa fréquence. */
export interface DiffusionSpec {
  /** Part échangée avec chaque voisin par pas (0..0,25 ; 0 = pas de diffusion). */
  rate: number;
  /** Part perdue par pas (0..1), vers `base` (retour à la valeur de fond). */
  decay: number;
  /** Nombre de pas de diffusion par échéance (≥ 1). */
  steps: number;
  /** Fréquence d'application. */
  every: Frequency;
  /** Bords : `closed` = flux nul (masse conservée sans atténuation) ; `open` = la valeur de fond s'échappe. */
  boundary: 'closed' | 'open';
  /** Biais directionnel facultatif (vent pour l'air, aval pour l'eau) : part transportée par pas vers +x / +z (-0,25..0,25). */
  advectX?: number;
  advectZ?: number;
}

/** Description d'un indicateur. */
export interface IndicatorSpec {
  id: IndicatorId;
  nameFr: string;
  unit: string;
  /** Valeur de fond (valeur initiale, cible de l'atténuation). */
  base: number;
  min: number;
  max: number;
  diffusion?: DiffusionSpec;
}

/** Géométrie d'une grille (repère monde, mètres) : cellule (i, j) = [originX + i·cellSize, …[ × [originZ + j·cellSize, …[. */
export interface GridGeometry {
  originX: number;
  originZ: number;
  cellSize: number;
  cols: number;
  rows: number;
}

/** Statistiques d'une grille (tableaux de bord). */
export interface GridStats {
  min: number;
  max: number;
  mean: number;
  sum: number;
}

/* ------------------------------------------------------------------ */
/* Réseaux                                                            */
/* ------------------------------------------------------------------ */

/** Familles de réseaux (libres : `electricite`, `eau`, `egouts`, … ; clé de registre). */
export type NetworkKind = string;

/** Rôle d'un nœud : producteur (offre), consommateur (demande) ou simple jonction. */
export type NetworkNodeRole = 'producer' | 'consumer' | 'junction';

export interface NetworkNodeJSON {
  id: number;
  role: NetworkNodeRole;
  /** Position monde (m), pour les cartes et le registre d'effets. */
  x: number;
  z: number;
  /** Producteur : capacité disponible par pas de répartition (unités du réseau). */
  capacity: number;
  /** Consommateur : demande par pas de répartition. */
  demand: number;
  /** Consommateur : priorité (plus grand = servi d'abord ; délestage des plus petits). */
  priority: number;
  /** Producteur : ordre de mérite (plus petit = appelé d'abord, à pertes égales). */
  cost: number;
  /** Consommateur : tout ou rien (coupure franche plutôt que service partiel). */
  allOrNothing: boolean;
  /** Nœud en service (faux = panne / hors service). */
  enabled: boolean;
  /** Référence libre vers l'objet du jeu (identifiant de bâtiment, -1 = aucun). */
  ref: number;
}

export interface NetworkEdgeJSON {
  id: number;
  a: number;
  b: number;
  /** Capacité de transit (unités par pas), partagée entre les deux sens. */
  capacity: number;
  /** Pertes : fraction du flux entrant perdue sur l'arête (0..1). */
  loss: number;
  enabled: boolean;
}

export interface NetworkJSON {
  kind: NetworkKind;
  nextId: number;
  nodes: NetworkNodeJSON[];
  edges: NetworkEdgeJSON[];
}

/** Résultat de répartition d'un consommateur. */
export interface ConsumerAllocation {
  node: number;
  demand: number;
  delivered: number;
  /** delivered / demand (1 si demande nulle). */
  ratio: number;
  priority: number;
  /** Vrai si le consommateur n'est pas entièrement servi (délesté totalement ou en partie). */
  shed: boolean;
}

/** Bilan d'une répartition offre / demande. */
export interface NetworkReport {
  kind: NetworkKind;
  /** Capacité totale des producteurs en service. */
  supply: number;
  /** Demande totale des consommateurs en service. */
  demand: number;
  /** Énergie / volume effectivement livré aux consommateurs. */
  delivered: number;
  /** Produit par les producteurs (= livré + pertes). */
  produced: number;
  losses: number;
  /** demand - delivered. */
  shortfall: number;
  consumers: ConsumerAllocation[];
  /** Production par producteur. */
  producers: { node: number; output: number; capacity: number }[];
  /** Flux par arête (valeur absolue entrante, sens a->b positif) et charge (|flux| / capacité). */
  edges: { edge: number; flow: number; load: number }[];
  /** Nombre de consommateurs délestés par priorité (clé = priorité). */
  shedByPriority: Record<number, number>;
}

/* ------------------------------------------------------------------ */
/* Budget                                                              */
/* ------------------------------------------------------------------ */

export type BudgetSide = 'income' | 'expense';

/** Clé d'une ligne budgétaire : sens, poste (ex. `impots:residentiel`, `entretien:routes`), service, quartier. */
export interface BudgetKey {
  side: BudgetSide;
  /** Poste comptable (identifiant stable). */
  category: string;
  /** Service public / module concerné (`electricite`, `eau`, … ; '' = général). */
  service: string;
  /** Quartier (identifiant libre ; '' = ville entière). */
  district: string;
}

export interface BudgetLine extends BudgetKey {
  /** Montant positif (crédits) : le sens est donné par `side`. */
  amount: number;
}

/** Origine d'un mois clos : miroir de l'économie de base (montants inchangés) ou lignes propres aux modules. */
export interface BudgetMonth {
  monthIndex: number;
  lines: BudgetLine[];
  income: number;
  expense: number;
  balance: number;
  /** Partie des lignes recopiée de l'économie existante (déjà appliquée à la trésorerie par le cœur). */
  mirroredBalance: number;
  /** Partie propre aux modules (NON appliquée à la trésorerie tant que le branchement du cœur n'existe pas). */
  moduleBalance: number;
}

/* ------------------------------------------------------------------ */
/* Registre d'effets                                                   */
/* ------------------------------------------------------------------ */

/** Une décision / cause (action du joueur, événement, politique…). */
export interface EffectCause {
  id: number;
  /** Type stable (ex. `construction`, `taux_impot`, `delestage`). */
  kind: string;
  label: string;
  /** Module à l'origine (id de module ou `joueur`). */
  source: string;
  /** Minute de jeu. */
  at: number;
  x?: number;
  z?: number;
  /** Référence libre (identifiant de bâtiment…). */
  ref?: number;
}

/** Lieu d'un effet : point + rayon (m), quartier, ou ville entière (aucun champ). */
export interface EffectPlace {
  x?: number;
  z?: number;
  radius?: number;
  district?: string;
}

/** Effet mesuré d'une cause sur une cible (indicateur, réseau, budget…). */
export interface EffectRecord extends EffectPlace {
  id: number;
  cause: number;
  /** Cible (ex. `pollution_air`, `electricite:delestage`, `budget:solde`). */
  target: string;
  /** Ampleur signée, dans l'unité `unit`. */
  magnitude: number;
  unit: string;
  at: number;
  note?: string;
}

/** Synthèse par cause (cumulée, conservée même quand les effets détaillés sortent du tampon). */
export interface EffectSummary {
  cause: EffectCause;
  count: number;
  /** Cumul signé par cible. */
  byTarget: Record<string, number>;
}

/* ------------------------------------------------------------------ */
/* Protocole du module `municipal`                                     */
/* ------------------------------------------------------------------ */

/** Delta envoyé au rendu / à l'interface (uniquement quand quelque chose a changé). */
export interface MunicipalDelta {
  /** Grilles définies et leurs statistiques. */
  grids?: { id: IndicatorId; stats: GridStats }[];
  /** Derniers bilans de répartition par réseau. */
  networks?: NetworkReport[];
  /** Effets enregistrés depuis le dernier delta. */
  effects?: EffectRecord[];
  /** Dernier mois clos du budget. */
  budget?: BudgetMonth;
}

export type MunicipalSnapshot = MunicipalDelta;

/** Commandes `pluginCommand { plugin: 'municipal', name, payload }`. */
export interface MunicipalCommands {
  /** Liste des indicateurs définis. */
  indicators: { payload?: undefined; result: { id: IndicatorId; nameFr: string; unit: string; geometry: GridGeometry; stats: GridStats }[] };
  /** Copie d'une grille (tableau neuf, cloné par le message de résultat). */
  grid: { payload: { id: IndicatorId }; result: { geometry: GridGeometry; values: Float32Array } };
  /** Effets filtrés (cause, cible, zone, depuis). */
  effects: { payload?: { cause?: number; target?: string; x?: number; z?: number; radius?: number; since?: number; limit?: number }; result: EffectRecord[] };
  /** Synthèse par cause (les plus fortes ampleurs d'abord). */
  causes: { payload?: { limit?: number }; result: EffectSummary[] };
  /** Historique budgétaire (agrégé par poste, service ou quartier). */
  budget: { payload?: { months?: number; groupBy?: 'category' | 'service' | 'district' }; result: { months: BudgetMonth[]; groups: Record<string, number> } };
  /** Dernier bilan d'un réseau. */
  network: { payload: { kind: NetworkKind }; result: NetworkReport | null };
}
