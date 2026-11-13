/**
 * Fabrique commune des définitions de bâtiments procéduraux : métadonnées de jeu, palette et variantes du style,
 * tags lus par le générateur de quartiers (`src/sim/districts`).
 */
import type { BuildingCategory, FrontagePoint } from '../../../../src/shared/catalog';
import type { BuildingDef, Ctx, Density } from '../../kit/index';
import { STYLES, styleVariants, type StyleId } from '../styles';
import { mergeRoles } from '../merge';

/** Types de quartier (identiques à `DistrictType` de src/sim/districts/types.ts). */
export type QuartierTag = 'centre_historique' | 'faubourg' | 'pavillonnaire' | 'affaires' | 'activites' | 'grands_ensembles';

export interface Meta {
  id: string;
  nameFr: string;
  category: BuildingCategory;
  /** Empreinte en cases de 8 m. */
  tiles: [number, number];
  cost: number;
  upkeep: number;
  residents?: number;
  jobs?: number;
  density: Density;
  style: StyleId;
  quartiers: QuartierTag[];
  /** Murs latéraux aveugles : pose bord à bord possible. */
  mitoyen?: boolean;
  tags?: string[];
  lodDistances?: [number, number];
  frontage?: FrontagePoint[];
  /** Hauteurs des variantes d'échelle (défaut [0,94 ; 1,06]). */
  heights?: number[];
  /** Fichier source (traçabilité). */
  src: string;
}

export function makeDef(m: Meta, build: (ctx: Ctx) => void): BuildingDef {
  const s = STYLES[m.style];
  const palette = s.palette();
  // rôles communs à tous les styles procéduraux (ajoutés ici pour ne pas les répéter dans chaque style)
  palette['dome'] ??= { set: 'toit_ardoise', color: '#8d969b', roughness: 0.75 };
  palette['verriere'] ??= { kind: 'glass', color: '#8ea7ad' };
  const def: BuildingDef = {
    id: m.id,
    nameFr: m.nameFr,
    category: m.category,
    footprint: { tilesX: m.tiles[0], tilesZ: m.tiles[1] },
    cost: m.cost,
    upkeepPerMonth: m.upkeep,
    residents: m.residents ?? 0,
    jobs: m.jobs ?? 0,
    density: m.density,
    style: m.style,
    tags: ['procedural', ...m.quartiers.map((q) => `quartier:${q}`), ...(m.mitoyen ? ['mitoyen'] : []), ...(m.tags ?? [])],
    palette,
    variants: styleVariants(s, m.heights ?? [0.94, 1.06]),
    source: `${m.src}#${m.id}`,
    build: (ctx) => { build(ctx); mergeRoles(ctx.mb, palette, ctx.lod); },
    eco: true,
  };
  if (m.lodDistances) def.lodDistances = m.lodDistances;
  if (m.frontage) def.frontage = m.frontage;
  return def;
}

/** Coût / entretien indicatifs à partir du volume bâti (cohérents avec les bâtiments existants). */
export function budget(tilesX: number, tilesZ: number, floors: number, perM2 = 420): { cost: number; upkeep: number } {
  const m2 = tilesX * 8 * tilesZ * 8 * 0.62 * (floors + 1);
  const cost = Math.round((m2 * perM2) / 1000) * 1000;
  return { cost, upkeep: Math.round((cost * 0.0016) / 10) * 10 };
}
