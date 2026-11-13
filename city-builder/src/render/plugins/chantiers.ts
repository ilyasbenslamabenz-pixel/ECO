/**
 * Rendu du module « Chantiers (grues, échafaudages, démolition) » — propriété de la branche p2a-chantiers.
 * Seule cette branche modifie ce fichier. Gabarit : voir ./types.ts (init, applySnapshotExt, applyDeltaExt,
 * frame, dispose) ; charges utiles typées par `snapshotExt(ext, 'chantiers')` / `deltaExt(ext, 'chantiers')`
 * (src/shared/protocol-ext). Plugin VIDE pour l'instant : aucun effet sur le rendu.
 */
import type { RenderPlugin } from './types';

export const chantiersRenderPlugin: RenderPlugin = { id: 'chantiers' };
