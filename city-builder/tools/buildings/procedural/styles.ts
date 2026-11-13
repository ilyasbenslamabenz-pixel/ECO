/**
 * STYLES ARCHITECTURAUX ORIGINAUX (européens) du générateur procédural.
 *
 * Chaque style fixe : une palette de matériaux par rôle (jeux de textures du catalogue), les habitudes de percement
 * (proportion des baies, volets, encadrements, petits bois, frontons, allèges), la toiture (forme, pente, matériau,
 * lucarnes, souches), la modénature (bandeaux, corniche, refends, chaînages) et des teintes de menuiserie.
 * Les styles sont INVENTÉS pour le jeu (noms de fantaisie) mais composés d'éléments d'architecture européenne
 * courants ; ils ne reproduisent aucun bâtiment existant.
 *
 * Les familles de bâtiments (maisons, immeubles, tertiaire, commerces, activités, équipements, grands ensembles)
 * lisent ce descripteur : un même plan produit des bâtiments très différents selon le style.
 */
import { basePalette, COLORS, type Palette, type RailStyle, type WindowOpts } from '../kit/index';
import type { AssetVariant } from '../../../src/shared/catalog';
import type { PedimentKind } from './grammar';

export type StyleId =
  | 'pierre_claire'      // ville haute : pierre de taille, refends, balcons filants, toiture d'ardoise à brisis
  | 'brique_pignon'      // nord : brique, pignons à gradins / chantournés, ancres de fer, menuiseries blanches
  | 'colombage'          // vieille ville : encorbellements, pans de bois, torchis clair, tuiles brunes
  | 'enduit_volets'      // faubourg du sud : enduit ocré, volets battants, génoise, tuiles canal
  | 'reconstruction'     // années 1950 : trame régulière, enduit gris-beige, allèges, toiture basse en zinc
  | 'brique_industrielle'// faubourg d'ateliers : brique sombre, baies d'atelier en fer, sheds, verrières
  | 'beton_moderne'      // grands ensembles : voiles de béton, loggias, pignons aveugles, acrotères
  | 'verre_contemporain';// quartier d'affaires : mur-rideau, épines, socle en pierre, couronnement technique

export const STYLE_IDS: readonly StyleId[] = [
  'pierre_claire', 'brique_pignon', 'colombage', 'enduit_volets', 'reconstruction', 'brique_industrielle', 'beton_moderne', 'verre_contemporain',
];

export const STYLE_NAME_FR: Record<StyleId, string> = {
  pierre_claire: 'Ville haute (pierre claire)',
  brique_pignon: 'Pignons de brique',
  colombage: 'Pans de bois',
  enduit_volets: 'Faubourg à volets',
  reconstruction: 'Reconstruction',
  brique_industrielle: 'Brique d’ateliers',
  beton_moderne: 'Béton moderne',
  verre_contemporain: 'Verre contemporain',
};

export type RoofKind = 'mansarde' | 'deux_pans' | 'quatre_pans' | 'terrasse' | 'shed';

export interface StyleSpec {
  id: StyleId;
  nameFr: string;
  /** Palette complète (rôles du kit + rôles propres : `colombage`, `allege`, `facade_c`). */
  palette(v?: number): Palette;
  /** Variantes de teinte / matériau proposées au catalogue (appliquées par `materialOverrides`). */
  colorways: { id: string; nameFr: string; overrides: Record<string, { textureSet?: string; color?: string }> }[];
  /** Hauteur d'étage courante et du rez-de-chaussée. */
  floorH: number;
  groundH: number;
  /** Proportions de baie : largeur et hauteur par défaut, hauteur d'allège. */
  bay: { w: number; h: number; sill: number };
  /** Options de fenêtre du style. */
  win: WindowOpts;
  /** Fronton par défaut au-dessus des baies de l'étage noble (null = aucun). */
  pediment: PedimentKind | null;
  /** Baies cintrées au rez-de-chaussée / partout. */
  arches: 'non' | 'rdc' | 'tout';
  /** Garde-corps. */
  rail: RailStyle;
  /** Toiture préférée et pente. */
  roof: RoofKind;
  pitch: number;
  /** Lucarnes sur le versant (si toiture en pente). */
  dormers: boolean;
  /** Modénature. */
  cornice: [number, number][];
  bandCourse: boolean;
  quoins: boolean;
  refends: 'non' | 'rdc' | 'tout';
  /** Cheminées. */
  chimneys: boolean;
  /** Matériau du mur courant et du soubassement. */
  wall: string;
  base: string;
}

const C = COLORS;

/** Corniche standard (profil [hauteur, saillie] de bas en haut). */
const CORN_RICHE: [number, number][] = [[0.12, 0.08], [0.16, 0.22], [0.1, 0.3], [0.08, 0.26]];
const CORN_SIMPLE: [number, number][] = [[0.1, 0.07], [0.12, 0.18]];
const CORN_PLATE: [number, number][] = [[0.14, 0.12]];

export const STYLES: Record<StyleId, StyleSpec> = {
  pierre_claire: {
    id: 'pierre_claire', nameFr: STYLE_NAME_FR.pierre_claire,
    palette: () => basePalette({
      facade: { set: 'pierre_taille', color: '#e9e0cd' },
      facade_b: { set: 'pierre_taille', color: '#ded4c0' },
      soubassement: { set: 'pierre_rustique', color: '#9b948a' },
      encadrement: { set: 'pierre_taille', color: '#f3ecdd' },
      toiture: { set: 'toit_ardoise', color: '#5a6066' },
      zinc: { set: 'toit_tole_ondulee', color: '#9aa0a4', metalness: 1, roughness: 0.5 },
      menuiserie: { set: 'bardage_blanc', color: C.blanc },
      volet: { set: 'bois_volet', color: '#d9d2c2' },
      porte: { set: 'bardage_blanc', color: '#2f4a44' },
      garde_corps: { set: 'metal_larme', color: '#2c2f32', metalness: 1, roughness: 0.55 },
      cheminee: { set: 'brique_rouge', color: '#c9ac94' },
      allege: { set: 'pierre_taille', color: '#ddd3bf' },
      colombage: { set: 'bardage_bois', color: '#6b5134' },
    }),
    colorways: [
      { id: 'origine', nameFr: 'Pierre blonde', overrides: {} },
      { id: 'grise', nameFr: 'Pierre grise, ardoise bleue', overrides: { facade: { color: '#d9d9d4' }, encadrement: { color: '#e8e8e2' }, toiture: { color: '#4e5a67' } } },
      { id: 'ocre', nameFr: 'Pierre dorée, toiture brune', overrides: { facade: { color: '#e3cfa4' }, toiture: { textureSet: 'toit_tuiles_grises', color: '#9c8a7a' }, porte: { color: C.bordeaux } } },
      { id: 'enduit', nameFr: 'Enduit clair sur pierre', overrides: { facade: { textureSet: 'enduit_creme', color: '#f1e8d6' }, volet: { color: '#8aa3a8' } } },
    ],
    floorH: 3.05, groundH: 4.2,
    bay: { w: 1.25, h: 2.2, sill: 0.85 },
    win: { leaves: 2, bars: 1, shutters: 'none', surround: 0.14, transom: 0.0, reveal: 0.22 },
    pediment: 'seg', arches: 'rdc', rail: 'fer',
    roof: 'mansarde', pitch: 72, dormers: true,
    cornice: CORN_RICHE, bandCourse: true, quoins: false, refends: 'rdc', chimneys: true,
    wall: 'facade', base: 'soubassement',
  },

  brique_pignon: {
    id: 'brique_pignon', nameFr: STYLE_NAME_FR.brique_pignon,
    palette: () => basePalette({
      facade: { set: 'brique_rouge', color: '#c98a6e' },
      facade_b: { set: 'brique_orange', color: '#dcb292' },
      soubassement: { set: 'pierre_rustique', color: '#8d8880' },
      encadrement: { set: 'pierre_taille', color: '#f0ead9' },
      toiture: { set: 'toit_ardoise', color: '#4f565c' },
      menuiserie: { set: 'bardage_blanc', color: C.blanc },
      volet: { set: 'bois_volet', color: '#2f4f45' },
      porte: { set: 'bardage_blanc', color: '#243b53' },
      cheminee: { set: 'brique_rouge', color: '#c08167' },
      allege: { set: 'brique_rouge', color: '#b87d63' },
      colombage: { set: 'bardage_bois', color: '#5a4530' },
    }),
    colorways: [
      { id: 'origine', nameFr: 'Brique rouge, pierre blanche', overrides: {} },
      { id: 'sombre', nameFr: 'Brique brune, menuiseries vertes', overrides: { facade: { textureSet: 'brique_parement', color: '#9c7360' }, menuiserie: { color: '#2d3a33' }, porte: { color: '#2f4f45' } } },
      { id: 'claire', nameFr: 'Brique sable', overrides: { facade: { textureSet: 'brique_orange', color: '#e3c5a3' }, toiture: { textureSet: 'toit_tuiles', color: '#b46a4a' } } },
      { id: 'peinte', nameFr: 'Brique peinte en blanc', overrides: { facade: { textureSet: 'brique_rouge', color: '#efeae1' }, encadrement: { color: '#cfc7b6' }, porte: { color: C.noir } } },
    ],
    floorH: 2.95, groundH: 3.6,
    bay: { w: 1.15, h: 1.95, sill: 0.95 },
    win: { leaves: 2, bars: 2, shutters: 'none', lintel: true, reveal: 0.25 },
    pediment: null, arches: 'rdc', rail: 'fer',
    roof: 'deux_pans', pitch: 55, dormers: true,
    cornice: CORN_SIMPLE, bandCourse: true, quoins: false, refends: 'non', chimneys: true,
    wall: 'facade', base: 'soubassement',
  },

  colombage: {
    id: 'colombage', nameFr: STYLE_NAME_FR.colombage,
    palette: () => basePalette({
      facade: { set: 'enduit_creme', color: '#efe4cc' },
      facade_b: { set: 'enduit_peint', color: '#e2c9a6' },
      colombage: { set: 'bardage_bois', color: '#4a3524' },
      soubassement: { set: 'pierre_moellons', color: '#8e877c' },
      encadrement: { set: 'pierre_taille', color: '#e7ddc8' },
      toiture: { set: 'toit_tuiles', color: '#9a5f44' },
      menuiserie: { set: 'bardage_blanc', color: '#f0ece2' },
      volet: { set: 'bois_volet', color: '#7a3c33' },
      porte: { set: 'bardage_bois', color: '#6e4328' },
      cheminee: { set: 'brique_rouge', color: '#b8785c' },
      poterie: { set: 'toit_tuiles', color: '#a4603f' },
      allege: { set: 'enduit_creme', color: '#e7dcc4' },
    }),
    colorways: [
      { id: 'origine', nameFr: 'Torchis crème, bois brun', overrides: {} },
      { id: 'rouge', nameFr: 'Bois rouge, torchis blanc', overrides: { colombage: { color: '#7d3a2c' }, facade: { color: '#f4efe4' } } },
      { id: 'bleu', nameFr: 'Bois bleu-gris, torchis ocre', overrides: { colombage: { color: '#4b5a63' }, facade: { textureSet: 'enduit_peint', color: '#e8cf9e' }, volet: { color: '#3f5a52' } } },
      { id: 'noir', nameFr: 'Bois noirci, torchis gris', overrides: { colombage: { color: '#30281f' }, facade: { color: '#e2ddd2' }, toiture: { textureSet: 'toit_tuiles_grises', color: '#8d8378' } } },
    ],
    floorH: 2.7, groundH: 3.2,
    bay: { w: 1.0, h: 1.4, sill: 0.95 },
    win: { leaves: 2, bars: 2, shutters: 'battants', reveal: 0.16, frameW: 0.07 },
    pediment: null, arches: 'non', rail: 'bois',
    roof: 'deux_pans', pitch: 52, dormers: true,
    cornice: CORN_PLATE, bandCourse: false, quoins: false, refends: 'non', chimneys: true,
    wall: 'facade', base: 'soubassement',
  },

  enduit_volets: {
    id: 'enduit_volets', nameFr: STYLE_NAME_FR.enduit_volets,
    palette: () => basePalette({
      facade: { set: 'enduit_peint', color: '#f0dcb4' },
      facade_b: { set: 'enduit_creme', color: '#efe6d2' },
      soubassement: { set: 'pierre_rustique', color: '#a39b8d' },
      encadrement: { set: 'enduit_blanc', color: '#f6f1e4' },
      toiture: { set: 'toit_tuiles', color: '#c47c4f' },
      poterie: { set: 'toit_tuiles', color: '#c0734a' },
      menuiserie: { set: 'bardage_blanc', color: '#f3f0e8' },
      volet: { set: 'bois_volet', color: '#6f8f7d' },
      porte: { set: 'bois_volet', color: '#4e6b5e' },
      cheminee: { set: 'enduit_peint', color: '#e8d2a8' },
      allege: { set: 'enduit_peint', color: '#ecd6ab' },
      colombage: { set: 'bardage_bois', color: '#6b5134' },
    }),
    colorways: [
      { id: 'origine', nameFr: 'Ocre jaune, volets verts', overrides: {} },
      { id: 'rose', nameFr: 'Rose ancien, volets bleus', overrides: { facade: { color: '#e9bda6' }, volet: { color: '#6f8ba4' }, porte: { color: '#4a6480' } } },
      { id: 'blanc', nameFr: 'Blanc cassé, volets bordeaux', overrides: { facade: { textureSet: 'enduit_blanc', color: '#f4efe2' }, volet: { color: C.bordeaux }, porte: { color: C.bordeaux } } },
      { id: 'terre', nameFr: 'Terre de Sienne, volets lavande', overrides: { facade: { color: '#d99a6c' }, volet: { color: C.lavande }, toiture: { color: '#b4683f' } } },
    ],
    floorH: 2.85, groundH: 3.3,
    bay: { w: 1.0, h: 1.6, sill: 0.95 },
    win: { leaves: 2, bars: 1, shutters: 'battants', surround: 0.1, reveal: 0.2 },
    pediment: null, arches: 'rdc', rail: 'fer',
    roof: 'quatre_pans', pitch: 22, dormers: false,
    cornice: CORN_SIMPLE, bandCourse: false, quoins: true, refends: 'non', chimneys: true,
    wall: 'facade', base: 'soubassement',
  },

  reconstruction: {
    id: 'reconstruction', nameFr: STYLE_NAME_FR.reconstruction,
    palette: () => basePalette({
      facade: { set: 'beton_facade', color: '#ddd6c6' },
      facade_b: { set: 'brique_parement', color: '#c9a98f' },
      soubassement: { set: 'sol_beton_brut', color: '#9d9890' },
      encadrement: { set: 'beton_facade', color: '#e8e2d4' },
      toiture: { set: 'toit_ardoise', color: '#5d646a' },
      menuiserie: { set: 'bardage_blanc', color: '#edeae1' },
      volet: { set: 'bardage_blanc', color: '#b9bfc0' },
      porte: { set: 'bardage_blanc', color: '#3b4a52' },
      store: { set: 'metal_rideau', color: '#cfcec8' },
      allege: { set: 'carreaux_facade', color: '#cfd6d2' },
      colombage: { set: 'bardage_bois', color: '#6b5134' },
      cheminee: { set: 'beton_facade', color: '#d2cbbc' },
    }),
    colorways: [
      { id: 'origine', nameFr: 'Béton beige, allèges vertes', overrides: {} },
      { id: 'brique', nameFr: 'Parement de brique', overrides: { facade: { textureSet: 'brique_parement', color: '#c5a083' }, allege: { textureSet: 'beton_facade', color: '#ddd7c8' } } },
      { id: 'gris', nameFr: 'Béton gris, allèges bleues', overrides: { facade: { color: '#cdcdc8' }, allege: { color: '#9fb4c4' }, menuiserie: { color: '#4a5158' } } },
      { id: 'creme', nameFr: 'Enduit crème', overrides: { facade: { textureSet: 'enduit_creme', color: '#f0e7d4' }, allege: { textureSet: 'enduit_peint', color: '#d8c6a4' } } },
    ],
    floorH: 2.8, groundH: 3.9,
    bay: { w: 1.5, h: 1.5, sill: 1.0 },
    win: { leaves: 2, shutters: 'roulant', reveal: 0.17 },
    pediment: null, arches: 'non', rail: 'barreaux',
    roof: 'deux_pans', pitch: 32, dormers: false,
    cornice: CORN_PLATE, bandCourse: true, quoins: false, refends: 'non', chimneys: false,
    wall: 'facade', base: 'soubassement',
  },

  brique_industrielle: {
    id: 'brique_industrielle', nameFr: STYLE_NAME_FR.brique_industrielle,
    palette: () => basePalette({
      facade: { set: 'brique_rouge', color: '#a8705a' },
      facade_b: { set: 'brique_parement', color: '#8e6e5e' },
      soubassement: { set: 'sol_beton_brut', color: '#8b8781' },
      encadrement: { set: 'beton_facade', color: '#cfc8bb' },
      toiture: { set: 'toit_bac_acier', color: '#8d9396' },
      menuiserie: { set: 'metal_larme', color: '#3a4044', metalness: 1, roughness: 0.6 },
      garde_corps: { set: 'metal_larme', color: '#33383c', metalness: 1, roughness: 0.6 },
      porte: { set: 'metal_larme', color: '#39434a', metalness: 1, roughness: 0.6 },
      store: { set: 'metal_rideau', color: '#b9b8b2' },
      cheminee: { set: 'brique_rouge', color: '#a06a55' },
      allege: { set: 'brique_rouge', color: '#9b6552' },
      colombage: { set: 'bardage_bois', color: '#54412e' },
      equipement: { set: 'metal_conteneur', color: '#9aa0a3' },
    }),
    colorways: [
      { id: 'origine', nameFr: 'Brique rouge, acier sombre', overrides: {} },
      { id: 'jaune', nameFr: 'Brique jaune', overrides: { facade: { textureSet: 'brique_orange', color: '#d8bd90' }, encadrement: { color: '#e0d9ca' } } },
      { id: 'noire', nameFr: 'Brique noircie', overrides: { facade: { color: '#6d5b53' }, toiture: { textureSet: 'toit_tole_ondulee', color: '#7d8386' } } },
      { id: 'beton', nameFr: 'Béton et verre', overrides: { facade: { textureSet: 'beton_facade', color: '#c8c3b8' }, allege: { textureSet: 'beton_facade', color: '#bdb8ad' } } },
    ],
    floorH: 3.6, groundH: 4.4,
    bay: { w: 2.1, h: 2.6, sill: 0.95 },
    win: { leaves: 3, bars: 3, shutters: 'none', lintel: true, reveal: 0.3, frameMat: 'menuiserie' },
    pediment: null, arches: 'tout', rail: 'barreaux',
    roof: 'shed', pitch: 18, dormers: false,
    cornice: CORN_SIMPLE, bandCourse: true, quoins: false, refends: 'non', chimneys: false,
    wall: 'facade', base: 'soubassement',
  },

  beton_moderne: {
    id: 'beton_moderne', nameFr: STYLE_NAME_FR.beton_moderne,
    palette: () => basePalette({
      facade: { set: 'beton_facade', color: '#d6d2c8' },
      facade_b: { set: 'panneaux_facade_sombres', color: '#8d9396' },
      soubassement: { set: 'sol_beton_brut', color: '#93908a' },
      encadrement: { set: 'beton_facade', color: '#dedad0' },
      toiture: { set: 'terrain_gravier', color: '#b0aaa0' },
      menuiserie: { set: 'bardage_blanc', color: '#e9e6dd' },
      volet: { set: 'bardage_blanc', color: '#c5cac8' },
      porte: { set: 'bardage_blanc', color: '#44525a' },
      dalle: { set: 'beton_facade', color: '#cfcac0' },
      allege: { set: 'carreaux_facade', color: '#b9c3c4' },
      colombage: { set: 'bardage_bois', color: '#6b5134' },
      store: { set: 'metal_rideau', color: '#c7c6c0' },
    }),
    colorways: [
      { id: 'origine', nameFr: 'Béton clair, allèges grises', overrides: {} },
      { id: 'couleur', nameFr: 'Panneaux colorés', overrides: { allege: { textureSet: 'carreaux_facade', color: '#d2894f' }, facade_b: { color: '#6d7c84' } } },
      { id: 'sombre', nameFr: 'Béton gris sombre', overrides: { facade: { color: '#aeaba4' }, allege: { color: '#8e989a' }, menuiserie: { color: '#3e4448' } } },
      { id: 'blanc', nameFr: 'Béton blanc, bois', overrides: { facade: { color: '#e8e5dc' }, facade_b: { textureSet: 'bardage_bois', color: '#d9b98c' } } },
    ],
    floorH: 2.75, groundH: 3.2,
    bay: { w: 1.7, h: 1.45, sill: 1.0 },
    win: { leaves: 2, shutters: 'roulant', reveal: 0.14 },
    pediment: null, arches: 'non', rail: 'barreaux',
    roof: 'terrasse', pitch: 0, dormers: false,
    cornice: CORN_PLATE, bandCourse: false, quoins: false, refends: 'non', chimneys: false,
    wall: 'facade', base: 'soubassement',
  },

  verre_contemporain: {
    id: 'verre_contemporain', nameFr: STYLE_NAME_FR.verre_contemporain,
    palette: () => basePalette({
      facade: { set: 'panneaux_facade_sombres', color: '#7f868b' },
      facade_b: { set: 'beton_facade', color: '#d7d4cd' },
      soubassement: { set: 'pierre_taille', color: '#cfc9bc' },
      encadrement: { set: 'metal_larme', color: '#aab0b4', metalness: 1, roughness: 0.5 },
      menuiserie: { set: 'metal_larme', color: '#8e9499', metalness: 1, roughness: 0.45 },
      garde_corps: { set: 'metal_larme', color: '#9ba1a5', metalness: 1, roughness: 0.5 },
      toiture: { set: 'terrain_gravier', color: '#aaa49a' },
      dalle: { set: 'beton_facade', color: '#d2cec5' },
      allege: { set: 'panneaux_facade_sombres', color: '#6f767b' },
      verre: { kind: 'glass', color: '#6d8794' },
      colombage: { set: 'bardage_bois', color: '#6b5134' },
      equipement: { set: 'metal_conteneur', color: '#9fa5a8' },
    }),
    colorways: [
      { id: 'origine', nameFr: 'Verre bleuté, métal gris', overrides: {} },
      { id: 'bronze', nameFr: 'Verre bronze', overrides: { verre: { color: '#8a7656' }, menuiserie: { color: '#6b6153' }, allege: { color: '#7a6f5e' } } },
      { id: 'blanc', nameFr: 'Métal blanc, verre clair', overrides: { menuiserie: { color: '#d9dcde' }, encadrement: { color: '#d9dcde' }, verre: { color: '#8fa7b2' }, allege: { textureSet: 'beton_facade', color: '#dcd9d1' } } },
      { id: 'vert', nameFr: 'Verre vert, bardage bois', overrides: { verre: { color: '#6f8c7e' }, facade: { textureSet: 'bardage_bois', color: '#c9a173' } } },
    ],
    floorH: 3.5, groundH: 4.6,
    bay: { w: 2.4, h: 2.4, sill: 0.0 },
    win: { leaves: 2, shutters: 'none', reveal: 0.12 },
    pediment: null, arches: 'non', rail: 'verre',
    roof: 'terrasse', pitch: 0, dormers: false,
    cornice: CORN_PLATE, bandCourse: false, quoins: false, refends: 'non', chimneys: false,
    wall: 'facade', base: 'soubassement',
  },
};

/** Variantes de catalogue d'un style (au moins 3) : teintes + une variante de hauteur. */
export function styleVariants(s: StyleSpec, heights: number[] = [0.94, 1.06]): AssetVariant[] {
  const out: AssetVariant[] = s.colorways.map((c) => (c.id === 'origine'
    ? { id: c.id, nameFr: c.nameFr }
    : { id: c.id, nameFr: c.nameFr, materialOverrides: c.overrides }));
  heights.forEach((h, i) => {
    const base = s.colorways[(i + 1) % s.colorways.length]!;
    out.push({ id: `h${Math.round(h * 100)}`, nameFr: `${base.nameFr}, hauteur ×${h.toFixed(2).replace('.', ',')}`, materialOverrides: base.overrides, heightScale: h });
  });
  return out;
}
