/**
 * Génération des modèles de chantier (npm run construction:build) — propriété p2a-chantiers.
 *
 * Écrit assets/models/construction/<id>_lod{0,1,2}.glb et le manifeste assets/models/construction/manifest.json
 * (identifiants, LOD + distances, dimensions mesurées, triangles, pivots d'animation, licences).
 *
 * Le manifeste est le « catalogue » du module : il n'est PAS fusionné dans assets/catalog.json (propriété
 * partagée, et ces modèles ne sont ni des bâtiments ni des véhicules du jeu). Le rendu du module le charge
 * par `lib.url('models/construction/manifest.json')`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CMesh } from './mesh';
import { MODELS } from './models';
import { ROLE_MATERIALS, writeConstructionGlb } from './glb';

export interface ManifestLod { file: string; maxDistance: number; triangles: number; bytes: number }
export interface ManifestEntry {
  id: string;
  nameFr: string;
  anchor: string;
  lods: ManifestLod[];
  dimensions: { width: number; height: number; depth: number };
  /** Boîte englobante exacte (m) : min/max en x, y, z. */
  bounds: { min: number[]; max: number[] };
  roles: string[];
}
export interface ConstructionManifest {
  version: number;
  generatedAt: string;
  license: { spdx: string; author: string; note: string };
  /** Repères d'assemblage et d'animation (m), voir src/render/construction. */
  pivots: Record<string, number | number[]>;
  models: ManifestEntry[];
}

/** Distances de bascule de LOD (m) : les grues restent détaillées de plus loin. */
const LOD_DISTANCE: Record<string, [number, number]> = {
  grue_tete: [260, 900],
  grue_mat: [260, 900],
  grue_base: [180, 700],
  defaut: [130, 520],
};

/**
 * Repères utilisés par le rendu (cohérents avec tools/construction/models.ts) :
 *  - `matHauteur` : hauteur d'un élément de mât ;
 *  - `teteFleche` : [z de départ, longueur] de la flèche, dans le repère de la tête ;
 *  - `teteRailY` : hauteur des rails du chariot ; `chariotCable` : départ du câble sous le chariot ;
 *  - `pelleteuseTourelleY` : hauteur de la couronne d'orientation de la pelle.
 */
const PIVOTS: Record<string, number | number[]> = {
  matHauteur: 6,
  teteFleche: [1.2, 34],
  teteContreFleche: 9,
  teteRailY: 0.82,
  teteApex: 6.2,
  chariotCable: -0.5,
  crochetHauteur: 1.3,
  pelleteuseTourelleY: 1.0,
  toupieTambour: [0, 2.0, -0.6],
  echafaudageTravee: [2.5, 2.0, 0.9],
  palissadePanneau: [2.4, 2.0],
};

export function buildConstructionModels(assetsDir: string): ConstructionManifest {
  const outDir = join(assetsDir, 'models', 'construction');
  mkdirSync(outDir, { recursive: true });
  const models: ManifestEntry[] = [];
  for (const def of MODELS) {
    const lods: ManifestLod[] = [];
    let dims = { width: 0, height: 0, depth: 0 };
    let bounds = { min: [0, 0, 0], max: [0, 0, 0] };
    let roles: string[] = [];
    for (let lod = 0; lod < 3; lod++) {
      const m = new CMesh(lod);
      def.build(m);
      const file = `models/construction/${def.id}_lod${lod}.glb`;
      const st = writeConstructionGlb(m, join(assetsDir, file), assetsDir, `${def.id}_lod${lod}`);
      const d = LOD_DISTANCE[def.id] ?? LOD_DISTANCE['defaut']!;
      lods.push({ file, maxDistance: lod === 0 ? d[0] : lod === 1 ? d[1] : 1e9, triangles: st.triangles, bytes: st.bytes });
      if (lod === 0) {
        const b = m.bounds();
        bounds = { min: b.min.map((v) => Math.round(v * 1000) / 1000), max: b.max.map((v) => Math.round(v * 1000) / 1000) };
        dims = {
          width: Math.round((b.max[0] - b.min[0]) * 1000) / 1000,
          height: Math.round((b.max[1] - b.min[1]) * 1000) / 1000,
          depth: Math.round((b.max[2] - b.min[2]) * 1000) / 1000,
        };
        roles = st.roles.slice().sort();
      }
    }
    models.push({ id: def.id, nameFr: def.nameFr, anchor: def.anchor, lods, dimensions: dims, bounds, roles });
  }
  const manifest: ConstructionManifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    license: {
      spdx: 'CC0-1.0',
      author: 'Meknes City — générateur de chantiers (tools/construction)',
      note: `Géométrie originale générée par tools/construction ; textures PBR partagées du catalogue (Poly Haven, CC0-1.0) : ${
        [...new Set(Object.values(ROLE_MATERIALS).map((r) => r.textureSet).filter(Boolean))].join(', ')}.`,
    },
    pivots: PIVOTS,
    models,
  };
  writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && process.argv[1].endsWith('build.ts')) {
  const assetsDir = join(import.meta.dirname, '..', '..', 'assets');
  const man = buildConstructionModels(assetsDir);
  let bytes = 0, tris = 0;
  for (const m of man.models) {
    bytes += m.lods.reduce((s, l) => s + l.bytes, 0);
    tris += m.lods[0]!.triangles;
    console.log(`${m.id.padEnd(22)} ${String(m.lods[0]!.triangles).padStart(6)} tri (LOD0) ${String(m.lods[1]!.triangles).padStart(5)} ${String(m.lods[2]!.triangles).padStart(5)}  ${(m.dimensions.width).toFixed(1)}×${m.dimensions.height.toFixed(1)}×${m.dimensions.depth.toFixed(1)} m`);
  }
  console.log(`${man.models.length} modèles, ${tris} triangles (LOD0), ${(bytes / 1024).toFixed(0)} Ko de GLB.`);
}
