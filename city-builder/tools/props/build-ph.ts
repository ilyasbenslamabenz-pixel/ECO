/**
 * Construit uniquement le mobilier urbain Poly Haven de la phase 2C (tools/assets/selection.ts,
 * P2C_STREET_FURNITURE_PH) avec le pipeline standard (tools/assets/models.ts) et renvoie les entrées de catalogue.
 * Les mêmes specs figurent dans MODELS : un `npm run assets` complet produit des entrées identiques.
 */
import type { CatalogAsset } from '../../src/shared/catalog';
import { buildModel } from '../assets/models';
import { P2C_STREET_FURNITURE_PH } from '../assets/selection';

export async function buildPhStreetFurniture(assetsDir: string, log = console.log): Promise<{ assets: CatalogAsset[]; warnings: string[] }> {
  const assets: CatalogAsset[] = [];
  const warnings: string[] = [];
  for (const spec of P2C_STREET_FURNITURE_PH) {
    const b = await buildModel(spec, assetsDir);
    log(`  ${spec.id.padEnd(24)} tri ${b.report.lodTriangles.join('/').padEnd(16)} ${b.report.lodBytes.map((x) => `${Math.round(x / 1024)}K`).join('/').padEnd(16)} ${b.asset.dimensions.width}×${b.asset.dimensions.depth}×${b.asset.dimensions.height} m`);
    for (const w of b.report.warnings) warnings.push(`${spec.id} : ${w}`);
    assets.push(b.asset);
  }
  return { assets, warnings };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { join } = await import('node:path');
  const r = await buildPhStreetFurniture(join(import.meta.dirname, '..', '..', 'assets'));
  for (const w of r.warnings) console.warn(`AVERTISSEMENT ${w}`);
}
