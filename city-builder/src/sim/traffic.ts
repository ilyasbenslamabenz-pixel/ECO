/**
 * Point d'entrée historique du trafic. La simulation complète est dans `./traffic/` (TrafficSystem :
 * graphe de voies, itinéraires A*, IDM, carrefours à priorités et feux, demande domicile-travail).
 * `updateTraffic` est conservée pour la compatibilité de world.ts tant que l'intégration de
 * TrafficSystem n'est pas faite (voir docs/requests/vehicules-trafic.md) : elle ne simule rien et
 * n'émet aucun véhicule.
 * TypeScript pur.
 */
import type { RoadGraph, VehicleStore } from './ecs';

export * from './traffic/index';

export function updateTraffic(_roads: RoadGraph, vehicles: VehicleStore, _dtMinutes: number): void {
  void vehicles;
}
