/**
 * Extension du protocole du module « hubs » (port et aéroport, phase 2C) — propriété de la branche p2c-port-aeroport.
 * Données dans `delta.ext.hubs`, `snapshot.ext.hubs` et `pluginCommand { plugin: 'hubs', name, payload }`.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { HubMovement, HubRecord, HubSummary, HubType } from '../hubs/types';

/** Charge utile de `delta.ext.hubs` : structure quand elle change, temps physique à chaque avance. */
export interface HubsDelta {
  hubs?: HubRecord[];
  movements?: HubMovement[];
  /** Temps physique de la simulation (s) et vitesse courante (le rendu extrapole : phys += dt × speed). */
  phys?: number;
  speed?: number;
}

/** Charge utile de `snapshot.ext.hubs` (absente sans pôle). */
export interface HubsSnapshot {
  hubs: HubRecord[];
  movements: HubMovement[];
  phys: number;
  speed: number;
}

/** Totaux par type de pôle (API d'export). */
export interface HubsCapacityView {
  exportT: number; importT: number; usedExportT: number; usedImportT: number; costPerT: number; delayDays: number; paxPerMonth: number;
}

/** Commandes du module : nom -> { payload, result }. */
export interface HubsCommands {
  /** Pose (ou contrôle avec dryRun) d'un pôle : `assetId` du catalogue (hub_port…) ou type. */
  place: { payload: { assetId?: string; type?: HubType; x: number; z: number; rot: number; dryRun?: boolean }; result: { id: number; cost: number; y: number; type: HubType } };
  remove: { payload: { id: number }; result: { refund: number } };
  /** Servitudes : contrôle d'un bâtiment ordinaire avant pose (erreur EASEMENT si trop haut dans l'axe). */
  checkBuilding: { payload: { assetId: string; x: number; z: number; rot: number; variant?: number }; result: { limit: number } };
  /** Résumé pour le panneau Transports. */
  summary: { payload: undefined; result: { hubs: HubSummary[]; port: HubsCapacityView; aeroport: HubsCapacityView; violations: { id: number; name: string; height: number; limit: number }[]; sharedMunicipal: boolean } };
  /** Emplacements valides (balayage de la carte, `max` premiers). */
  suggest: { payload: { type: HubType; step?: number; max?: number; rots?: number[] }; result: { x: number; z: number; rot: number }[] };
  /** Phases courantes des navires et avions visibles. */
  movements: { payload: undefined; result: { id: number; hub: number; asset: string; role: string; phase: string; u: number; alt: number; x: number; z: number }[] };
  /** Contribution sonore et limite de hauteur en un point (inspection). */
  probe: { payload: { x: number; z: number }; result: { noise: number; limit: number; satisfaction: number; landValue: number; bruit: number } };
}
