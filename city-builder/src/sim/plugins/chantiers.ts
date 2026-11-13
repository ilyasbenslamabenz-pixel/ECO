/**
 * Module de simulation « Chantiers » — propriété de la branche p2a-chantiers.
 * Seule cette branche modifie ce fichier (état de chantier sauvegardé, phases, démolition).
 *
 * Gabarit : remplir les crochets utiles de SimPlugin (voir ./types.ts). Données échangées :
 *  - deltas / instantané : types `ChantiersDelta` / `ChantiersSnapshot` de src/shared/protocol-ext/chantiers.ts ;
 *  - commandes : `ChantiersCommands` (même fichier), reçues par `command(ctx, name, payload)` ;
 *  - sauvegarde : section versionnée de src/sim/save-sections/chantiers.ts (`saveVersion` + `migrate`).
 * Exemple :
 *   export const chantiersPlugin: SimPlugin = {
 *     id: 'chantiers',
 *     saveVersion: CHANTIERS_SAVE_VERSION,
 *     onNewGame(ctx) { state = emptyChantiersSave(); },
 *     onTick(ctx, minutes) { ... },
 *     takeDelta() { return changed ? { ... } satisfies ChantiersDelta : undefined; },
 *     save() { return state; },
 *     load(ctx, data, version) { state = migrateChantiers(data, version); },
 *   };
 * Plugin VIDE pour l'instant : aucun effet sur la simulation.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { SimPlugin } from './types';

export const chantiersPlugin: SimPlugin = { id: 'chantiers' };
