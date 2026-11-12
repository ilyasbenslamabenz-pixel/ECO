/**
 * Démographie — PHASE 2 (non implémentée).
 * Contrat prévu : emménagements selon capacité résidentielle, accès route et emplois ;
 * la population reste à 0 tant que ce module n'est pas réalisé (aucune valeur inventée).
 * TypeScript pur.
 */
import type { BuildingStore } from './ecs';

export interface DemographyResult {
  population: number;
  jobs: number;
}

export function updateDemography(_b: BuildingStore, out: DemographyResult): DemographyResult {
  out.population = 0;
  out.jobs = 0;
  return out;
}
