/**
 * Fusion des assets transport dans le catalogue du jeu (assets/catalog.json), sans relancer tout le pipeline
 * (qui télécharge Poly Haven) :
 *  1. entrées de `assets/catalog.transport.json` (35 modèles, catégorie `transport`) et leurs jeux de textures ;
 *  2. entrées du catalogue de construction des pôles (`hub_port`, `hub_port_passagers`, `hub_aeroport`,
 *     tag `hub`) : emprise, coût, entretien et emplois = HUB_SPECS (src/shared/hubs/types.ts) ; modèle
 *     représentatif (vignette, fantôme de l'outil de pose) = un modèle du complexe ;
 *  3. assets/LICENSES.md régénéré.
 *   npx tsx tools/transport/catalog.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateCatalog, type AssetCatalog, type CatalogAsset, type TextureSet } from '../../src/shared/catalog';
import { HUB_SPECS, type HubType } from '../../src/shared/hubs/types';
import { writeLicenses } from '../assets/licenses';

const AUTHOR = 'Projet Aube Urbaine (générateur procédural, œuvre originale CC0)';

/** Modèle représentatif de chaque pôle. */
const REPRESENTATIVE: Record<HubType, string> = { port_commerce: 'port_grue_portique', port_passagers: 'port_gare_maritime', aeroport: 'aero_tour_controle' };

export function hubEntries(transport: CatalogAsset[]): CatalogAsset[] {
  return (Object.keys(HUB_SPECS) as HubType[]).map((type) => {
    const s = HUB_SPECS[type];
    const rep = transport.find((a) => a.id === REPRESENTATIVE[type]);
    if (!rep) throw new Error(`modèle représentatif absent : ${REPRESENTATIVE[type]}`);
    const what = type === 'aeroport'
      ? 'piste orientable de 900 m, aérogare, tour, hangar ; terrain plat ; servitudes de hauteur dans l\'axe'
      : type === 'port_passagers' ? 'quais, grues, conteneurs, entrepôt, gare maritime et rampe roulière ; sur le littoral ou un cours d\'eau navigable'
        : 'quais, grues portiques animées, parc à conteneurs, entrepôt ; sur le littoral ou un cours d\'eau navigable';
    return {
      id: s.assetId,
      nameFr: s.nameFr,
      category: 'transport',
      lods: rep.lods.map((l) => ({ ...l })),
      dimensions: { ...rep.dimensions },
      footprint: { tilesX: s.tilesX, tilesZ: s.tilesZ },
      cost: s.cost,
      upkeepPerMonth: s.upkeepPerMonth,
      capacity: { residents: 0, jobs: s.jobs },
      frontage: [],
      variants: [{ id: 'origine', nameFr: 'Teintes d’origine' }],
      textureSets: [...rep.textureSets],
      license: { spdx: 'CC0-1.0', source: `tools/transport/catalog.ts#${s.assetId}`, author: AUTHOR },
      tags: ['transport', 'categorie:transport', 'hub', `hub:${type}`, `groupe:${s.kind}`, `modele:${rep.id}`, `description:${what}`],
    } satisfies CatalogAsset;
  });
}

export function mergeTransport(cat: AssetCatalog, frag: { assets: CatalogAsset[]; textureSets: TextureSet[] }): AssetCatalog {
  const upsert = <T extends { id: string }>(list: T[], items: T[]): void => {
    for (const it of items) {
      const i = list.findIndex((x) => x.id === it.id);
      if (i >= 0) list[i] = it; else list.push(it);
    }
  };
  upsert(cat.assets, frag.assets);
  upsert(cat.textureSets, frag.textureSets);
  upsert(cat.assets, hubEntries(frag.assets));
  return cat;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const assetsDir = join(import.meta.dirname, '..', '..', 'assets');
  const catPath = join(assetsDir, 'catalog.json');
  const cat = JSON.parse(readFileSync(catPath, 'utf8')) as AssetCatalog;
  const frag = JSON.parse(readFileSync(join(assetsDir, 'catalog.transport.json'), 'utf8')) as { assets: CatalogAsset[]; textureSets: TextureSet[] };
  mergeTransport(cat, frag);
  const issues = validateCatalog(cat);
  if (issues.length) { console.error(issues.map((i) => `${i.assetId} : ${i.message}`).join('\n')); process.exit(1); }
  cat.generatedAt = new Date().toISOString();
  writeFileSync(catPath, `${JSON.stringify(cat, null, 2)}\n`);
  writeLicenses(cat, assetsDir);
  console.log(`Catalogue : ${cat.assets.length} assets (${cat.assets.filter((a) => a.category === 'transport').length} transport), ${cat.textureSets.length} jeux de textures.`);
}
