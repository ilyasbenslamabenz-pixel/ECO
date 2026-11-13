/**
 * Module de simulation « Bâtiments & quartiers » — propriété de la branche p2a-batiments.
 * Seule cette branche modifie ce fichier (générateur architectural, quartiers (src/sim/districts/**)).
 *
 * Gabarit : remplir les crochets utiles de SimPlugin (voir ./types.ts). Données échangées :
 *  - deltas / instantané : types `BatimentsDelta` / `BatimentsSnapshot` de src/shared/protocol-ext/batiments.ts ;
 *  - commandes : `BatimentsCommands` (même fichier), reçues par `command(ctx, name, payload)` ;
 *  - sauvegarde : section versionnée de src/sim/save-sections/batiments.ts (`saveVersion` + `migrate`).
 * Exemple :
 *   export const batimentsPlugin: SimPlugin = {
 *     id: 'batiments',
 *     saveVersion: BATIMENTS_SAVE_VERSION,
 *     onNewGame(ctx) { state = emptyBatimentsSave(); },
 *     onTick(ctx, minutes) { ... },
 *     takeDelta() { return changed ? { ... } satisfies BatimentsDelta : undefined; },
 *     save() { return state; },
 *     load(ctx, data, version) { state = migrateBatiments(data, version); },
 *   };
 * Plugin VIDE pour l'instant : aucun effet sur la simulation.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { SimPlugin } from './types';

export const batimentsPlugin: SimPlugin = { id: 'batiments' };
