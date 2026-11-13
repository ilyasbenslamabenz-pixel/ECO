/**
 * Module de simulation « Piétons » — propriété de la branche p2a-pietons.
 * Seule cette branche modifie ce fichier (graphe trottoirs/passages, emplois du temps, respect des feux via le service « feux »).
 *
 * Gabarit : remplir les crochets utiles de SimPlugin (voir ./types.ts). Données échangées :
 *  - deltas / instantané : types `PietonsDelta` / `PietonsSnapshot` de src/shared/protocol-ext/pietons.ts ;
 *  - commandes : `PietonsCommands` (même fichier), reçues par `command(ctx, name, payload)` ;
 *  - sauvegarde : section versionnée de src/sim/save-sections/pietons.ts (`saveVersion` + `migrate`).
 * Exemple :
 *   export const pietonsPlugin: SimPlugin = {
 *     id: 'pietons',
 *     saveVersion: PIETONS_SAVE_VERSION,
 *     onNewGame(ctx) { state = emptyPietonsSave(); },
 *     onTick(ctx, minutes) { ... },
 *     takeDelta() { return changed ? { ... } satisfies PietonsDelta : undefined; },
 *     save() { return state; },
 *     load(ctx, data, version) { state = migratePietons(data, version); },
 *   };
 * Plugin VIDE pour l'instant : aucun effet sur la simulation.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { SimPlugin } from './types';

export const pietonsPlugin: SimPlugin = { id: 'pietons' };
