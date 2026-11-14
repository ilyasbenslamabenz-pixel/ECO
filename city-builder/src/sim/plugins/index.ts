/**
 * Registre des modules de simulation de phase 2 — UNE ligne par module, dans l'ordre d'appel des crochets.
 * Fichier COMMUN (superviseur) : chaque branche ne modifie que `./<module>.ts`.
 * Un module vide (id seul) est sans effet : la simulation est identique tick à tick.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { batimentsPlugin } from './batiments';
import { circulationPlugin } from './circulation';
import { createPietonsPlugin, pietonsPlugin } from './pietons';
import { chantiersPlugin } from './chantiers';
import { weatherPlugin } from './weather';
import { createWeatherPlugin } from '../weather/plugin';
import { createMunicipalPlugin, municipalPlugin } from '../municipal/plugin';
import { createElectricitePlugin, electricitePlugin } from './electricite';
import { createDechetsPlugin, dechetsPlugin } from './dechets';
import { createHubsPlugin, hubsPlugin } from './hubs';
import { createEauPlugin, eauPlugin } from './eau';
import { createZonagePlugin, zonagePlugin } from './zonage';
import { createPolitiquesPlugin, politiquesPlugin } from './politiques';
import { createRecherchePlugin, recherchePlugin } from './recherche';
import type { SimPlugin } from './types';

export type { PluginCommandResult, PluginContext, PluginSaveField, PluginSaveSection, SimPlugin } from './types';
export { PluginHost } from './host';

export const SIM_PLUGINS: readonly SimPlugin[] = [
  batimentsPlugin,
  circulationPlugin,
  pietonsPlugin,
  chantiersPlugin,
  weatherPlugin,
  municipalPlugin,
  electricitePlugin,
  dechetsPlugin,
  hubsPlugin,
  eauPlugin,
  zonagePlugin,
  politiquesPlugin,
  recherchePlugin,
];

/**
 * Modules NEUFS pour une simulation (même ordre que SIM_PLUGINS) : chaque `Simulation` a ses propres états de
 * modules (budget, réseaux, grilles). Les instances de SIM_PLUGINS étaient partagées entre deux simulations d'un
 * même processus (tests : partie et partie rechargée), ce qui faussait la comparaison dès que la démographie lit
 * les grilles des modules.
 */
export function createSimPlugins(): SimPlugin[] {
  return [
    batimentsPlugin, circulationPlugin, createPietonsPlugin(), chantiersPlugin, createWeatherPlugin(),
    createMunicipalPlugin(), createElectricitePlugin(), createDechetsPlugin(), createHubsPlugin(), createEauPlugin(),
    createZonagePlugin(), createPolitiquesPlugin(), createRecherchePlugin(),
  ];
}
