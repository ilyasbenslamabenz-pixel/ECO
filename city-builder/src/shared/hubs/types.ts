/**
 * Pôles de transport (phase 2C, ROADMAP §7) : port de commerce, port de commerce et de passagers, aéroport.
 * Types et constantes partagés par la simulation (src/sim/hubs), le rendu (src/render/hubs) et l'interface
 * (src/ui/panels/transports.ts). Propriété de la branche p2c-port-aeroport.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */

export type HubKind = 'port' | 'aeroport';
/** Type de pôle = entrée du catalogue de construction. */
export type HubType = 'port_commerce' | 'port_passagers' | 'aeroport';

export interface HubSpec {
  type: HubType;
  kind: HubKind;
  nameFr: string;
  /** Entrée du catalogue de construction (catégorie `transport`, tag `hub`). */
  assetId: string;
  /** Emprise au sol (cases de 8 m) : X le long du quai / de la piste, Z en profondeur (mer côté +Z pour le port). */
  tilesX: number;
  tilesZ: number;
  /** Coût de construction et entretien mensuel (crédits). */
  cost: number;
  upkeepPerMonth: number;
  /** Emplois directs à pleine activité. */
  jobs: number;
  /** Capacités mensuelles : fret (t) à l'export et à l'import, passagers. */
  exportT: number;
  importT: number;
  paxPerMonth: number;
  /** Coût de transit facturé aux exportateurs (crédits / t) et délai d'acheminement (jours de jeu). */
  costPerT: number;
  delayDays: number;
}

export const HUB_SPECS: Readonly<Record<HubType, Readonly<HubSpec>>> = {
  port_commerce: {
    type: 'port_commerce', kind: 'port', nameFr: 'Port de commerce', assetId: 'hub_port',
    tilesX: 28, tilesZ: 12, cost: 18_500_000, upkeepPerMonth: 85_000, jobs: 380,
    exportT: 90_000, importT: 90_000, paxPerMonth: 0, costPerT: 12, delayDays: 6,
  },
  port_passagers: {
    type: 'port_passagers', kind: 'port', nameFr: 'Port de commerce et de passagers', assetId: 'hub_port_passagers',
    tilesX: 48, tilesZ: 12, cost: 29_000_000, upkeepPerMonth: 120_000, jobs: 520,
    exportT: 90_000, importT: 90_000, paxPerMonth: 40_000, costPerT: 12, delayDays: 6,
  },
  aeroport: {
    type: 'aeroport', kind: 'aeroport', nameFr: 'Aéroport', assetId: 'hub_aeroport',
    tilesX: 120, tilesZ: 40, cost: 64_000_000, upkeepPerMonth: 240_000, jobs: 650,
    exportT: 900, importT: 900, paxPerMonth: 80_000, costPerT: 380, delayDays: 1,
  },
};

export const HUB_TYPES = Object.keys(HUB_SPECS) as HubType[];

/** Type de pôle d'une entrée de catalogue (undefined si l'asset n'est pas un pôle). */
export function hubTypeOfAsset(assetId: string): HubType | undefined {
  for (const t of HUB_TYPES) if (HUB_SPECS[t].assetId === assetId) return t;
  return undefined;
}

/** Pôle construit (état sérialisable, identique côté simulation, protocole et sauvegarde). */
export interface HubRecord {
  id: number;
  type: HubType;
  /** Centre de l'emprise (m) et rotation (quarts de tour décimaux, convention de src/shared/footprint.ts). */
  x: number;
  z: number;
  rot: number;
  /** Altitude du sol fini : dessus des quais (port) ou altitude moyenne du terrain (aéroport). */
  y: number;
  /** Altitude de la surface de l'eau au droit des postes à quai (port) ; NaN pour l'aéroport. */
  waterY: number;
  /** Minute de jeu de la mise en service. */
  builtAt: number;
}

/** Mouvement visible (navire ou avion) : échantillon représentatif de l'activité, horodaté en temps physique. */
export interface HubMovement {
  id: number;
  hub: number;
  /** Modèle du catalogue (navire ou avion). */
  asset: string;
  role: 'cargo' | 'vraquier' | 'ferry' | 'passagers' | 'fret';
  /** Poste à quai (port) ou poste de stationnement (aéroport). */
  slot: number;
  /** Début du mouvement (secondes de temps physique, comme le trafic routier : 0,1 s par minute de jeu). */
  t0: number;
}

/** Bilan d'activité d'un pôle (mois en cours ou dernier mois clos). */
export interface HubActivity {
  exportT: number;
  importT: number;
  /** Part des exportations réservée par l'API `provide('port'|'aeroport')` (contrats de la 2B). */
  bookedExportT: number;
  pax: number;
  trucksPerDay: number;
  /** Recettes et dépenses du mois (crédits). */
  revenue: number;
  upkeep: number;
  jobs: number;
  /** Escales / mouvements d'avions (échantillon visible). */
  movements: number;
}

/** Nuisances mesurées sur les grilles municipales (relevé horaire). */
export interface HubNuisance {
  /** Bruit moyen (indice 0..100) dans les cellules où la contribution du pôle dépasse 20. */
  noiseMean: number;
  /** Cellules (32 m) sous une contribution sonore ≥ 20. */
  noisyCells: number;
  /** Habitants des bâtiments exposés (contribution ≥ 20). */
  exposedResidents: number;
  /** Variation moyenne de satisfaction et de valeur foncière appliquée sur les cellules exposées. */
  satisfactionDelta: number;
  landValueDelta: number;
  /** Pollution de l'eau et de l'air au droit du pôle (grilles municipales). */
  waterPollution: number;
  airPollution: number;
}

/** Résumé d'un pôle pour le panneau Transports. */
export interface HubSummary {
  hub: HubRecord;
  nameFr: string;
  month: HubActivity;
  lastMonth: HubActivity | null;
  nuisance: HubNuisance;
  capacity: { exportT: number; importT: number; paxPerMonth: number; costPerT: number; delayDays: number };
}

/** API publiée par `ctx.provide('port' | 'aeroport', …)` pour les exportations (phase 2B). */
export interface HubFreightApi {
  readonly kind: HubKind;
  /** Vrai si au moins un pôle de ce type est en service. */
  available(): boolean;
  /** Capacité mensuelle cumulée des pôles de ce type, volume déjà engagé ce mois-ci, coût et délai. */
  capacity(): { exportT: number; importT: number; usedExportT: number; usedImportT: number; costPerT: number; delayDays: number; paxPerMonth: number };
  /** Devis sans engagement (volume accepté = min(volume, reste disponible)). */
  quote(volumeT: number, dir: 'export' | 'import'): { accepted: number; costPerT: number; total: number; delayDays: number };
  /** Réservation ferme sur la capacité du mois ; `arrivalMinutes` = minute de jeu de livraison. */
  book(volumeT: number, dir: 'export' | 'import', ref?: string): { ok: boolean; accepted: number; total: number; delayDays: number; arrivalMinutes: number; message?: string };
}

/** API publiée par `ctx.provide('servitudes', …)` : limitation de hauteur autour des pistes. */
export interface HubEasementApi {
  /** Hauteur maximale autorisée (m) en (x, z) ; Infinity hors servitude. */
  limitAt(x: number, z: number): number;
  /** Contrôle d'un bâtiment : null si autorisé, sinon message de refus. */
  checkBuilding(assetId: string, x: number, z: number, rot: number, heightM?: number): string | null;
}

export const HUBS_SERVICE_PORT = 'port';
export const HUBS_SERVICE_AEROPORT = 'aeroport';
export const HUBS_SERVICE_EASEMENT = 'servitudes';

export function emptyActivity(): HubActivity {
  return { exportT: 0, importT: 0, bookedExportT: 0, pax: 0, trucksPerDay: 0, revenue: 0, upkeep: 0, jobs: 0, movements: 0 };
}
