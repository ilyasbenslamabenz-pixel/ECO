/**
 * Extension du protocole propre au module « Électricité » (phase 2B, sous-étape 4) — propriété de la branche
 * p2b-electricite. Données dans `delta.ext.electricite`, `snapshot.ext.electricite` et la commande générique
 * `pluginCommand { plugin: 'electricite', name, payload }`. Les types sont définis dans src/shared/power/types.ts.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
export type {
  ElectriciteCommands, ElectriciteDelta, ElectriciteSnapshot, ElectriciteSummary, ElectriciteSettings, ElectriciteBudget,
  ElectriciteCoverage, ElectriciteEvent, ElectriciteService, FacilityView, LineView, SourceBalance, ClassBalance,
} from '../power/types';
