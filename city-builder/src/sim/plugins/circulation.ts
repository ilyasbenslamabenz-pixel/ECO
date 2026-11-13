/**
 * Module de simulation « Circulation » — propriété de la branche p2a-circulation.
 * Seule cette branche modifie ce fichier (voies multiples, carrefours, feux à phases, congestion ; publie l'API des feux (service « feux »)).
 *
 * Gabarit : remplir les crochets utiles de SimPlugin (voir ./types.ts). Données échangées :
 *  - deltas / instantané : types `CirculationDelta` / `CirculationSnapshot` de src/shared/protocol-ext/circulation.ts ;
 *  - commandes : `CirculationCommands` (même fichier), reçues par `command(ctx, name, payload)` ;
 *  - sauvegarde : section versionnée de src/sim/save-sections/circulation.ts (`saveVersion` + `migrate`).
 * Exemple :
 *   export const circulationPlugin: SimPlugin = {
 *     id: 'circulation',
 *     saveVersion: CIRCULATION_SAVE_VERSION,
 *     onNewGame(ctx) { state = emptyCirculationSave(); },
 *     onTick(ctx, minutes) { ... },
 *     takeDelta() { return changed ? { ... } satisfies CirculationDelta : undefined; },
 *     save() { return state; },
 *     load(ctx, data, version) { state = migrateCirculation(data, version); },
 *   };
 * Plugin VIDE pour l'instant : aucun effet sur la simulation.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { SimPlugin } from './types';

export const circulationPlugin: SimPlugin = { id: 'circulation' };
