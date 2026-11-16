/**
 * Entrées de catalogue DÉRIVÉES pour les transports en commun (aucun fichier de assets/ n'est modifié) :
 *  - `depot_tram` : dépôt de tram, copie du dépôt de bus (lui-même le modèle du dépôt de camions-bennes) avec une livrée
 *    verte, une emprise et des chiffres propres (coût, entretien, emplois, 10 rames).
 * Appliqué au chargement du catalogue côté client (`fetchCatalog`) : la simulation reçoit le même catalogue par la
 * commande `init`. Idempotent (rien n'est ajouté si l'entrée existe déjà ou si le modèle source manque).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { AssetCatalog, CatalogAsset } from './catalog';
import { TRAM_DEPOT_ASSET, TRAM_DEPOT_TAG } from './protocol-ext/bus';

export function tramDepotFrom(bus: CatalogAsset): CatalogAsset {
  const tags = bus.tags.filter((t) => t !== 'depot_bus' && !t.startsWith('bus:') && !t.startsWith('reutilise:'));
  return {
    ...bus,
    id: TRAM_DEPOT_ASSET,
    nameFr: 'Dépôt de tram',
    cost: 480_000,
    upkeepPerMonth: 2_200,
    capacity: { residents: 0, jobs: 45 },
    variants: [
      { id: 'vert', nameFr: 'Bardage gris, bandeau vert (réseau de tram)', materialOverrides: { facade: { color: '#bfc4c0' }, facade_b: { color: '#2e8b57' } } },
      ...bus.variants.filter((v) => v.id !== 'bleu'),
    ],
    license: { ...bus.license, source: `${bus.license.source} ; entrée dérivée src/shared/transit-assets.ts (dépôt de tram)` },
    tags: [...tags, TRAM_DEPOT_TAG, 'tram:10', 'reutilise:depot_bus'],
  };
}

/** Catalogue complété des entrées dérivées (même objet si rien n'est à ajouter). */
export function withTransitAssets(cat: AssetCatalog): AssetCatalog {
  if (cat.assets.some((a) => a.id === TRAM_DEPOT_ASSET)) return cat;
  const bus = cat.assets.find((a) => a.id === 'depot_bus');
  if (!bus) return cat;
  return { ...cat, assets: [...cat.assets, tramDepotFrom(bus)] };
}

/** Prix ET entretien mensuel des logements posés à la main divisés par ce facteur (choix du joueur, étude docs/EQUILIBRE_ECONOMIE.md R2) ; le zonage reste gratuit. */
export const RESIDENTIAL_PRICE_DIVISOR = 4;

/**
 * Prix des bâtiments résidentiels (au moins un logement) divisé par `RESIDENTIAL_PRICE_DIVISOR`, arrondi à la centaine.
 * Appliqué au chargement du catalogue (aucun fichier de assets/ modifié) ; idempotent grâce au marqueur `prix:logement`.
 */
export function withResidentialPricing(cat: AssetCatalog): AssetCatalog {
  if (cat.assets.some((a) => a.tags?.includes('prix:logement'))) return cat;
  return {
    ...cat,
    assets: cat.assets.map((a) => (a.capacity?.residents > 0 && a.cost > 0
      ? { ...a, cost: Math.max(100, Math.round(a.cost / RESIDENTIAL_PRICE_DIVISOR / 100) * 100), upkeepPerMonth: Math.round((a.upkeepPerMonth ?? 0) / RESIDENTIAL_PRICE_DIVISOR), tags: [...(a.tags ?? []), 'prix:logement'] }
      : a)),
  };
}
