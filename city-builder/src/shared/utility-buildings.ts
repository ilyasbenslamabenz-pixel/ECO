/**
 * Ouvrages techniques sans occupants (éoliennes, fermes solaires, postes électriques, batteries, stations de
 * pompage, châteaux d'eau, émissaires, décharges…) : pas d'habitants et au plus quelques agents d'entretien. Ils ne
 * produisent pas de déchets (module `dechets`) et n'ont pas besoin d'eau (module `alertes`).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { CatalogAsset } from './catalog';

/** Étiquettes des services techniques (énergie, déchets, eau, assainissement). */
export const TECH_SERVICE_TAGS: readonly string[] = ['service:electricite', 'service:dechets', 'service:eau', 'service:assainissement'];
/** Effectif au-delà duquel un ouvrage technique est considéré comme occupé (sanitaires, process, cantine). */
export const TECH_STAFF_MAX = 10;

const cache = new WeakMap<object, boolean>();

/** Vrai pour un ouvrage technique sans occupants (ou un bâtiment sans aucune capacité d'accueil). */
export function isUnstaffedUtility(a: Pick<CatalogAsset, 'tags' | 'capacity'> | undefined): boolean {
  if (!a) return false;
  const hit = cache.get(a);
  if (hit !== undefined) return hit;
  const res = a.capacity?.residents ?? 0, jobs = a.capacity?.jobs ?? 0;
  const v = (res <= 0 && jobs <= 0) || (res <= 0 && jobs <= TECH_STAFF_MAX && a.tags.some((t) => TECH_SERVICE_TAGS.includes(t)));
  cache.set(a, v);
  return v;
}
