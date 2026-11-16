/**
 * Lien de la ville avec l'extérieur, partagé par la vente d'électricité et d'eau aux villes voisines
 * (docs/ELECTRICITE.md, docs/EAU.md) : la ville est « reliée » si le raccordement du service au réseau voisin est
 * actif, OU si au moins une connexion extérieure par route (module `connexions`, docs/CONNEXIONS.md) est reliée
 * (son réseau routier dessert au moins un bâtiment). Sans module `connexions` : seul le raccordement compte.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { PluginContext } from '../plugins/types';

/** Vrai si une connexion extérieure par route est reliée au réseau de la ville. */
export function roadConnexionLinked(ctx: Pick<PluginContext, 'use'>): boolean {
  const api = ctx.use<{ system?: { readonly linkedCount: number } }>('connexions');
  return (api?.system?.linkedCount ?? 0) > 0;
}

/** Règle commune de la vente aux voisins : raccordement du service actif, ou connexion extérieure par route reliée. */
export function linkedToNeighbours(ctx: Pick<PluginContext, 'use'>, raccordement: boolean): boolean {
  return raccordement || roadConnexionLinked(ctx);
}
