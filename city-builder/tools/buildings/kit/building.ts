/**
 * Kit bâtiments — définition d'un bâtiment et export multi-LOD (GLB + entrée de catalogue).
 *
 * Un bâtiment = une fonction `build(ctx)` déterministe (même graine pour les trois LOD) qui pose des
 * composants du kit, une palette de matériaux par rôle, des variantes (surcharges de matériaux, hauteur)
 * et des métadonnées de jeu (empreinte, coût, entretien, habitants, emplois, densité, façade côté rue).
 */
import { join } from 'node:path';
import type { AssetVariant, BuildingCategory, CatalogAsset, FrontagePoint, TextureSet } from '../../../src/shared/catalog';
import { TILE_SIZE } from '../../../src/shared/constants';
import type { Ctx } from './facade';
import { writeGlb } from './glb';
import type { Palette } from './materials';
import { hashSeed, MeshBuilder, rng, type UvMode } from './mesh';

export type Density = 'faible' | 'moyenne' | 'forte' | 'tres_forte';

export interface BuildingDef {
  id: string;
  nameFr: string;
  category: BuildingCategory;
  footprint: { tilesX: number; tilesZ: number };
  cost: number;
  upkeepPerMonth: number;
  residents: number;
  jobs: number;
  density: Density;
  /** Style architectural (étiquette libre, ex. « pavillon », « haussmannien »). */
  style: string;
  tags?: string[];
  palette: Palette;
  /** Variantes (au moins une) : surcharges de matériaux par rôle, échelle verticale. */
  variants: AssetVariant[];
  /** Distances maximales LOD0 / LOD1 (m). */
  lodDistances?: [number, number];
  /** Mode économe des LOD (voir `Ctx.eco`). */
  eco?: boolean;
  /** Accès supplémentaires (coordonnées de build(), recentrées à l'export) ; l'entrée piétonne au milieu de la façade +Z est toujours ajoutée. */
  frontage?: FrontagePoint[];
  /** Fichier + fonction générateurs (licence / traçabilité), ex. « tools/buildings/residential/houses.ts#pavillon ». */
  source: string;
  build(ctx: Ctx): void;
}

export interface ExportResult {
  asset: CatalogAsset;
  triangles: number[];
  bytes: number[];
}

/** Modes d'UV et matériaux vitrés d'une palette. */
function paletteModes(p: Palette): { uv: Record<string, UvMode>; glass: Set<string> } {
  const uv: Record<string, UvMode> = {};
  const glass = new Set<string>();
  for (const [k, m] of Object.entries(p)) {
    uv[k] = m.uv ?? 'meters';
    if (m.kind === 'glass' || !m.set) glass.add(k);
  }
  return { uv, glass };
}

/** Construit les trois LOD d'un bâtiment (en mémoire), recentrés. */
export function buildLods(def: BuildingDef): MeshBuilder[] {
  return buildLodsWithOffset(def).lods;
}

/** Idem, et renvoie la translation de recentrage appliquée (à reporter sur les points d'accès). */
export function buildLodsWithOffset(def: BuildingDef): { lods: MeshBuilder[]; offset: [number, number, number] } {
  const { uv, glass } = paletteModes(def.palette);
  const out: MeshBuilder[] = [];
  for (const lod of [0, 1, 2] as const) {
    const mb = new MeshBuilder(uv, glass);
    def.build({ mb, lod, r: rng(hashSeed(def.id)), ...(def.eco ? { eco: true } : {}) });
    out.push(mb);
  }
  // recentrage commun : centre de l'emprise du LOD0 en (0, 0), base à y = 0
  const b = out[0]!.bounds();
  const dx = -(b.min[0] + b.max[0]) / 2;
  const dz = -(b.min[2] + b.max[2]) / 2;
  const dy = -b.min[1];
  for (const mb of out) mb.translateAll(dx, dy, dz);
  return { lods: out, offset: [dx, dy, dz] };
}

/**
 * Exporte les GLB LOD0/1/2 dans assets/<relDir>/ et renvoie l'entrée de catalogue.
 * Échoue si le modèle dépasse son empreinte ou si les LOD ne sont pas strictement décroissants.
 */
export function exportBuilding(def: BuildingDef, assetsDir: string, relDir: string, sets: Map<string, TextureSet>): ExportResult {
  const { lods, offset } = buildLodsWithOffset(def);
  const b = lods[0]!.bounds();
  const w = b.max[0] - b.min[0];
  const d = b.max[2] - b.min[2];
  const h = b.max[1] - b.min[1];
  const lim = (n: number): number => n * TILE_SIZE + 0.5;
  if (w > lim(def.footprint.tilesX) || d > lim(def.footprint.tilesZ)) {
    throw new Error(`${def.id} : ${w.toFixed(2)}×${d.toFixed(2)} m dépasse l'empreinte ${def.footprint.tilesX}×${def.footprint.tilesZ} cases`);
  }
  const triangles: number[] = [];
  const bytes: number[] = [];
  const dist = def.lodDistances ?? [150, 600];
  const lodEntries = lods.map((mb, i) => {
    const file = `${relDir}/${def.id}_lod${i}.glb`;
    const st = writeGlb(mb, def.palette, sets, join(assetsDir, file), assetsDir, def.eco === true);
    triangles.push(st.triangles);
    bytes.push(st.bytes);
    return { file, maxDistance: i === 0 ? dist[0] : i === 1 ? dist[1] : 1e9, triangles: st.triangles };
  });
  for (let i = 1; i < triangles.length; i++) {
    if (!(triangles[i]! < triangles[i - 1]!)) throw new Error(`${def.id} : LOD${i} (${triangles[i]}) pas moins détaillé que LOD${i - 1} (${triangles[i - 1]})`);
  }
  // jeux de textures utilisés (matériaux présents + variantes)
  const used = new Set<string>();
  for (const role of lods[0]!.prims.keys()) { const s = def.palette[role]?.set; if (s) used.add(s); }
  for (const v of def.variants) for (const o of Object.values(v.materialOverrides ?? {})) if (o.textureSet) used.add(o.textureSet);
  for (const s of used) if (!sets.has(s)) throw new Error(`${def.id} : jeu de textures inconnu ${s}`);
  const r2f = (x: number): number => Math.round(x * 100) / 100;
  const frontage: FrontagePoint[] = [
    { x: 0, z: r2f(d / 2), nx: 0, nz: 1, kind: 'pedestrian' },
    ...(def.frontage ?? []).map((f) => ({ ...f, x: r2f(f.x + offset[0]), z: r2f(f.z + offset[2]) })),
  ];
  const r2 = (x: number): number => Math.round(x * 100) / 100;
  const asset: CatalogAsset = {
    id: def.id,
    nameFr: def.nameFr,
    category: def.category,
    lods: lodEntries,
    dimensions: { width: r2(w), depth: r2(d), height: r2(h) },
    footprint: { ...def.footprint },
    cost: def.cost,
    upkeepPerMonth: def.upkeepPerMonth,
    capacity: { residents: def.residents, jobs: def.jobs },
    frontage,
    variants: def.variants,
    textureSets: [...used].sort(),
    license: { spdx: 'CC0-1.0', source: def.source, author: 'Projet Aube Urbaine (kit bâtiments procédural)' },
    tags: [...new Set([...(def.tags ?? []), `style:${def.style}`, `densite:${def.density}`, 'genere'])],
  };
  return { asset, triangles, bytes };
}
