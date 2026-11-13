/**
 * Rendu du module « Circulation (véhicules, feux) » — propriété de la branche p2a-circulation.
 * Seule cette branche modifie ce fichier. Gabarit : voir ./types.ts (init, applySnapshotExt, applyDeltaExt,
 * frame, dispose) ; charges utiles typées par `snapshotExt(ext, 'circulation')` / `deltaExt(ext, 'circulation')`
 * (src/shared/protocol-ext). Plugin VIDE pour l'instant : aucun effet sur le rendu.
 */
import type { RenderPlugin } from './types';

export const circulationRenderPlugin: RenderPlugin = { id: 'circulation' };
