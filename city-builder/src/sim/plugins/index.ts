/**
 * Registre des modules de simulation de phase 2 — UNE ligne par module, dans l'ordre d'appel des crochets.
 * Fichier COMMUN (superviseur) : chaque branche ne modifie que `./<module>.ts`.
 * Un module vide (id seul) est sans effet : la simulation est identique tick à tick.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { batimentsPlugin } from './batiments';
import { circulationPlugin } from './circulation';
import { pietonsPlugin } from './pietons';
import { chantiersPlugin } from './chantiers';
import { hubsPlugin } from './hubs';
import type { SimPlugin } from './types';

export type { PluginCommandResult, PluginContext, PluginSaveField, PluginSaveSection, SimPlugin } from './types';
export { PluginHost } from './host';

export const SIM_PLUGINS: readonly SimPlugin[] = [
  batimentsPlugin,
  circulationPlugin,
  pietonsPlugin,
  chantiersPlugin,
  hubsPlugin,
];
