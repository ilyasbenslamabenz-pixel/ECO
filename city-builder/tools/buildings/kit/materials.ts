/**
 * Kit bâtiments — matériaux par RÔLE.
 *
 * Chaque bâtiment déclare une palette { rôle -> KitMaterial }. Le nom du matériau glTF est le rôle
 * (« facade », « toiture », « volet »…) : les variantes du catalogue (`materialOverrides`) ciblent ces noms
 * pour changer de jeu de textures et/ou de teinte sans regénérer de géométrie.
 *
 * Tous les matériaux opaques sont texturés PBR (albedo + normale + ARM) ; seuls les verres n'ont pas de texture.
 */
import type { UvMode } from './mesh';

export interface KitMaterial {
  /** Jeu de textures du catalogue (assets/catalog.json ou kit). Absent = verre. */
  set?: string;
  /** Teinte multiplicative #rrggbb (baseColorFactor). */
  color?: string;
  /** Facteurs multiplicatifs glTF appliqués à l'ARM (défaut 1). */
  roughness?: number;
  metalness?: number;
  uv?: UvMode;
  /** 'glass' : verre sans texture, attribut _LIT (allumage nocturne). */
  kind?: 'opaque' | 'glass';
  doubleSided?: boolean;
}

export type Palette = Record<string, KitMaterial>;

/** Rôles standards (une palette peut en ajouter). */
export const ROLES = [
  'facade',        // mur principal
  'facade_b',      // second parement (bardage, brique d'attique…)
  'soubassement',  // socle, assises de pierre
  'encadrement',   // encadrements de baies, bandeaux, corniches, chaînages
  'toiture',       // couverture
  'rive',          // planches de rive, sous-faces de débords, chevrons
  'menuiserie',    // dormants et ouvrants des fenêtres, petits bois
  'volet',         // volets battants
  'porte',         // portes d'entrée (bois peint)
  'porte_garage',  // portes de garage (UV 0..1)
  'garde_corps',   // métal : garde-corps, ferronneries, consoles
  'dalle',         // dalles de balcon, auvents béton
  'zinc',          // gouttières, descentes, solins, couvertines
  'cheminee',      // souches de cheminée
  'poterie',       // mitrons, faîtières terre cuite
  'store',         // volets roulants / rideaux métalliques
  'terrasse',      // toitures-terrasses (gravillons)
  'equipement',    // équipements techniques de toiture
  'bois',          // charpente apparente, balcons de chalet, lames
  'enseigne',      // bandeaux d'enseigne, stores bannes
  'verre',         // vitrages (allumés la nuit)
  'verre_gc',      // garde-corps vitrés (jamais allumés)
] as const;

/** Palette de base : à surcharger par bâtiment. */
export function basePalette(over: Partial<Palette> = {}): Palette {
  const p: Palette = {
    facade: { set: 'enduit_blanc', color: '#f2ede2' },
    facade_b: { set: 'bardage_bois' },
    soubassement: { set: 'pierre_taille', color: '#b9b3a7' },
    encadrement: { set: 'pierre_taille', color: '#f1ece2' },
    toiture: { set: 'toit_tuiles' },
    rive: { set: 'bardage_blanc', color: '#e9e6df' },
    menuiserie: { set: 'bardage_blanc', color: '#f4f3ef', roughness: 0.7 },
    volet: { set: 'bardage_blanc', color: '#9ab0b8' },
    porte: { set: 'bardage_blanc', color: '#4b5a52' },
    porte_garage: { set: 'porte_garage', uv: 'unit' },
    garde_corps: { set: 'metal_larme', color: '#3a3d40', metalness: 1, roughness: 0.6 },
    dalle: { set: 'beton_facade', color: '#d8d4cc' },
    zinc: { set: 'toit_tole_ondulee', color: '#a9adb0', metalness: 1, roughness: 0.55 },
    cheminee: { set: 'brique_rouge' },
    poterie: { set: 'toit_tuiles', color: '#c77a52' },
    store: { set: 'metal_rideau', color: '#c9c9c4' },
    terrasse: { set: 'terrain_gravier', color: '#b8b2a8' },
    equipement: { set: 'metal_conteneur', color: '#9da3a6' },
    bois: { set: 'bardage_bois', color: '#f0e0cc' },
    enseigne: { set: 'enduit_blanc', color: '#3d5a6c' },
    verre: { kind: 'glass', color: '#5f7480' },
    verre_gc: { kind: 'glass', color: '#8fa6ae' },
  };
  for (const [k, v] of Object.entries(over)) if (v) p[k] = v;
  return p;
}

/** Couleurs de menuiseries / volets courantes (variantes). */
export const COLORS = {
  blanc: '#f4f3ef',
  creme: '#ece3cf',
  grisAnthracite: '#3b3f43',
  grisVert: '#8fa39a',
  bleuCharron: '#5d7f96',
  bleuPastel: '#9ab0b8',
  vertBasque: '#3f6b4a',
  rougeBasque: '#8a2f2a',
  bordeaux: '#6d2f33',
  lavande: '#a3a1c2',
  ocreJaune: '#e2c58e',
  ocreRouge: '#d29a74',
  rose: '#e8c2b0',
  sable: '#e6d9bf',
  boisNaturel: '#c79a6a',
  noir: '#2a2c2e',
} as const;
