/**
 * Rendu du module « Bâtiments & quartiers » — propriété de la branche p2a-batiments.
 * Seule cette branche modifie ce fichier. Gabarit : voir ./types.ts (init, applySnapshotExt, applyDeltaExt,
 * frame, dispose) ; charges utiles typées par `snapshotExt(ext, 'batiments')` / `deltaExt(ext, 'batiments')`
 * (src/shared/protocol-ext). Plugin VIDE pour l'instant : aucun effet sur le rendu.
 */
import type { RenderPlugin } from './types';

export const batimentsRenderPlugin: RenderPlugin = { id: 'batiments' };
