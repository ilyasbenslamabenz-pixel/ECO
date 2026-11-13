/**
 * Registre des panneaux d'interface des modules de phase 2 — une ligne par module.
 * Fichier COMMUN (superviseur) : chaque branche ne modifie que `./<module>.ts`.
 * Pas de montage pour l'instant (refonte d'interface §1bis).
 * ATTENTION : importer `ui/panels/index` (un fichier `src/ui/panels.ts` existant masque le dossier).
 */
import { batimentsPanel } from './batiments';
import { circulationPanel } from './circulation';
import { pietonsPanel } from './pietons';
import { chantiersPanel } from './chantiers';
import { transportsPanel } from './transports';
import type { UiPanel } from './types';

export type { UiPanel, UiPanelApi } from './types';

export const UI_PANELS: readonly UiPanel[] = [
  batimentsPanel,
  circulationPanel,
  pietonsPanel,
  chantiersPanel,
  transportsPanel,
];
