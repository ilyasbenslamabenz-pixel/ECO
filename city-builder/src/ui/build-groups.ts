/**
 * Sous-catégories du menu de construction : à l'intérieur d'un onglet, les cartes sont rangées en groupes titrés
 * (ex. Industrie › Usines, Entrepôts et stockage, Ateliers). Les groupes se lisent sur les étiquettes du catalogue ;
 * un modèle sans étiquette reconnue va dans le dernier groupe de la règle. Un onglet sans règle (ou dont tous les
 * modèles tombent dans le même groupe) reste une simple rangée.
 */
import type { CatalogAsset } from '../shared/catalog';

interface GroupRule { label: string; match: (a: CatalogAsset) => boolean }
export interface CardGroup { label: string; assets: CatalogAsset[] }

const tag = (...keys: string[]) => (a: CatalogAsset): boolean => keys.some((k) => a.tags.includes(k));
const cat = (...cats: string[]) => (a: CatalogAsset): boolean => cats.includes(a.category);
const any = (): boolean => true;

/** Règles par identifiant d'onglet (src/ui/buildbar.ts › DRAWER_TABS) ; l'ordre des groupes est celui de la liste. */
const RULES: Record<string, GroupRule[]> = {
  house: [
    { label: 'Traditionnelles', match: (a) => !tag('contemporain', 'verre', 'piscine', 'toit-terrasse')(a) },
    { label: 'Contemporaines', match: any },
  ],
  apartment: [
    { label: 'Petits immeubles', match: cat('apartment_low') },
    { label: 'Immeubles moyens', match: any },
  ],
  high: [
    { label: 'Barres et résidences', match: (a) => !tag('tour')(a) },
    { label: 'Tours', match: any },
  ],
  commercial: [
    { label: 'Proximité', match: (a) => tag('commerce_de_proximite', 'boutiques', 'cafe', 'restaurant', 'carburant')(a) },
    { label: 'Grandes surfaces et halles', match: tag('grande_surface', 'galerie_marchande', 'grand_magasin', 'halle') },
    { label: 'Hôtels', match: tag('hotel') },
    { label: 'Bureaux', match: any },
  ],
  industrial: [
    { label: 'Usines', match: tag('usine', 'manufacture') },
    { label: 'Ateliers', match: tag('atelier', 'artisanat') },
    // Installations électriques : aussi dans leur tiroir Énergie ; regroupées à part ici.
    { label: 'Énergie', match: tag('electricite') },
    { label: 'Entrepôts et stockage', match: any },
  ],
  education: [
    { label: 'Petite enfance', match: tag('service:petite_enfance') },
    { label: 'Écoles', match: any },
  ],
  securite: [
    { label: 'Police', match: tag('service:police') },
    { label: 'Pompiers', match: any },
  ],
  eau: [
    { label: 'Eau potable', match: tag('service:eau') },
    { label: 'Égouts et épuration', match: any },
  ],
  energie: [
    { label: 'Renouvelables', match: tag('renouvelable') },
    { label: 'Thermique', match: tag('elec:centrale:thermique') },
    { label: 'Réseau et stockage', match: any },
  ],
  loisirs: [
    { label: 'Culture', match: tag('service:culture') },
    { label: 'Sport', match: tag('service:sport') },
    { label: 'Loisirs', match: any },
  ],
  autres: [
    { label: 'Administration', match: tag('service:administration') },
    { label: 'Culte et patrimoine', match: any },
  ],
  station: [
    { label: 'Gares', match: tag('gare') },
    { label: 'Dépôts', match: any },
  ],
};
RULES['power'] = RULES['energie']!;

/** Groupes non vides d'un onglet, dans l'ordre de la règle ; l'ordre des modèles (coût croissant) est conservé. */
export function groupAssets(tabId: string, assets: CatalogAsset[]): CardGroup[] {
  const rules = RULES[tabId];
  if (!rules) return [{ label: '', assets }];
  const groups: CardGroup[] = rules.map((r) => ({ label: r.label, assets: [] }));
  for (const a of assets) {
    const i = rules.findIndex((r) => r.match(a));
    groups[i < 0 ? rules.length - 1 : i]!.assets.push(a);
  }
  const used = groups.filter((g) => g.assets.length > 0);
  return used.length > 1 ? used : [{ label: '', assets }];
}
