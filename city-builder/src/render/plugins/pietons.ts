/**
 * Rendu du module « Piétons » — propriété de la branche p2a-pietons.
 * Seule cette branche modifie ce fichier. Gabarit : voir ./types.ts (init, applySnapshotExt, applyDeltaExt,
 * frame, dispose) ; charges utiles typées par `snapshotExt(ext, 'pietons')` / `deltaExt(ext, 'pietons')`
 * (src/shared/protocol-ext). Plugin VIDE pour l'instant : aucun effet sur le rendu.
 */
import type { RenderPlugin } from './types';

export const pietonsRenderPlugin: RenderPlugin = { id: 'pietons' };
