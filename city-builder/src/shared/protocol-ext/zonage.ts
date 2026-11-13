/**
 * Extension du protocole propre au module « Zonage » (phase 2B) : types des zones, charges utiles de
 * `delta.ext.zonage` / `snapshot.ext.zonage`, commandes `pluginCommand { plugin: 'zonage', name, payload }`.
 * Documentation : docs/ZONAGE.md. TypeScript pur : AUCUN import de three ni du DOM.
 */

export const ZONAGE_ID = 'zonage';
/** Identifiants des modules livrés par la branche zonage (registres). */
export const ZONAGE_MODULES = [ZONAGE_ID] as const;

/** Types de zones (0 = non zoné). Codes stables : ils sont écrits dans les sauvegardes. */
export const ZONE_TYPES = ['res_faible', 'res_moyen', 'res_dense', 'commerce', 'bureaux', 'industrie'] as const;
export type ZoneType = (typeof ZONE_TYPES)[number];
/** Code d'une zone dans la grille : 1..6 (index dans ZONE_TYPES + 1) ; 0 = aucune. */
export type ZoneCode = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const ZONE_COUNT = ZONE_TYPES.length;

export const zoneCode = (t: ZoneType): ZoneCode => (ZONE_TYPES.indexOf(t) + 1) as ZoneCode;
export const zoneOf = (code: number): ZoneType | null => (code >= 1 && code <= ZONE_COUNT ? ZONE_TYPES[code - 1]! : null);
export const isZoneType = (v: unknown): v is ZoneType => typeof v === 'string' && (ZONE_TYPES as readonly string[]).includes(v);

/** Secteurs de demande affichés dans la jauge : Résidentiel, Commerces, Bureaux, Industrie. */
export const DEMAND_SECTORS = ['R', 'C', 'B', 'I'] as const;
export type DemandSector = (typeof DEMAND_SECTORS)[number];

export const ZONE_SECTOR: Record<ZoneType, DemandSector> = {
  res_faible: 'R', res_moyen: 'R', res_dense: 'R', commerce: 'C', bureaux: 'B', industrie: 'I',
};

export const ZONE_LABELS_FR: Record<ZoneType, string> = {
  res_faible: 'Résidentiel faible densité', res_moyen: 'Résidentiel densité moyenne', res_dense: 'Résidentiel dense',
  commerce: 'Commerces', bureaux: 'Bureaux', industrie: 'Industrie',
};
export const ZONE_SHORT_FR: Record<ZoneType, string> = {
  res_faible: 'Rés. faible', res_moyen: 'Rés. moyen', res_dense: 'Rés. dense', commerce: 'Commerces', bureaux: 'Bureaux', industrie: 'Industrie',
};
export const SECTOR_LABELS_FR: Record<DemandSector, string> = { R: 'Résidentiel', C: 'Commerces', B: 'Bureaux', I: 'Industrie' };

/** Couleurs de la superposition (sRGB). Trois verts pour le résidentiel, du clair au foncé. */
export const ZONE_COLORS: Record<ZoneType, string> = {
  res_faible: '#8be06f', res_moyen: '#3fbf5a', res_dense: '#13853a', commerce: '#3d9bff', bureaux: '#a77bff', industrie: '#ffc531',
};
export const SECTOR_COLORS: Record<DemandSector, string> = { R: '#3fbf5a', C: '#3d9bff', B: '#a77bff', I: '#ffc531' };

/** Bit « reliée à une route » dans le code d'une case transmis au rendu (bits 0..3 = zone). */
export const CELL_CONNECTED = 16;

/** Profondeur des bandes zonées, en cases de 8 m. */
export const ZONE_DEPTH_MIN = 1;
export const ZONE_DEPTH_MAX = 4;
export const ZONE_DEPTH_DEFAULT = 3;

/** Géométrie de la grille de zonage : cases de `cell` m alignées sur l'origine de la carte. */
export interface ZoneGridInfo {
  originX: number;
  originZ: number;
  cell: number;
  w: number;
  h: number;
}

/** Demande par secteur, -1..1 (positive : le secteur veut grandir). */
export type ZonageDemand = Record<DemandSector, number>;

/** Entrées du modèle de demande (affichées dans le panneau : « pourquoi »). */
export interface ZonageDemandInputs {
  population: number;
  /** Actifs (population en âge de travailler). */
  workforce: number;
  jobs: number;
  jobsBySector: Record<DemandSector | 'public', number>;
  housingCapacity: number;
  housingFree: number;
  /** Source des entrées : modèle interne du zonage, ou service externe (économie, plus tard). */
  source: 'zonage' | 'externe';
}

export interface ZonageStats {
  /** Cases zonées par type. */
  cells: Record<ZoneType, number>;
  /** Cases zonées reliées à une route. */
  connected: number;
  /** Bâtiments nés du zonage, par type. */
  buildings: Record<ZoneType, number>;
  /** Totaux depuis le début de la partie. */
  grown: number;
  densified: number;
  /** Habitants et emplois dans les bâtiments nés du zonage. */
  residents: number;
  jobs: number;
}

export interface ZonageSettings {
  /** Croissance automatique active. */
  growth: boolean;
}

/** Charge utile de `delta.ext.zonage` (champs présents seulement s'ils ont changé). */
export interface ZonageDelta {
  /** Grille complète (instantané) : géométrie + codes encodés en plages [code, longueur, code, longueur, …]. */
  grid?: ZoneGridInfo;
  rle?: number[];
  /** Cases modifiées : [index, code, index, code, …] (code = zone | CELL_CONNECTED). */
  cells?: number[];
  demand?: ZonageDemand;
  inputs?: ZonageDemandInputs;
  stats?: ZonageStats;
  settings?: ZonageSettings;
}

/** Charge utile de `snapshot.ext.zonage` : l'état complet (le rendu repart de zéro). */
export interface ZonageSnapshot extends ZonageDelta {
  grid: ZoneGridInfo;
  rle: number[];
}

/** Commandes du module (`pluginCommand { plugin: 'zonage', name, payload }`). */
export interface ZonageCommands {
  /** Peint (zone) ou efface (zone: null) le long d'un tracé ; renvoie le nombre de cases changées. */
  paint: { payload: { points: number[]; zone: ZoneType | null; depth?: number; radius?: number }; result: { changed: number; cells?: number[] } };
  /** État complet (grille, demande, entrées, statistiques). */
  state: { payload?: undefined; result: ZonageSnapshot };
  /** Zone de la case sous (x, z). */
  cellAt: { payload: { x: number; z: number }; result: { zone: ZoneType | null; connected: boolean; i: number; j: number } };
  setGrowth: { payload: { enabled: boolean }; result: ZonageSettings };
  /** Réglages du modèle (demande, croissance, densification) : lecture, ou fusion partielle. */
  tuning: { payload?: Record<string, number>; result: Record<string, number> };
  /** Tentatives de croissance immédiates (tests, démonstration). */
  grow: { payload?: { attempts?: number; densify?: number }; result: { grown: number; densified: number } };
}

/* -------------------------- Encodage en plages -------------------------- */

/** Encode un tableau d'octets en plages [valeur, longueur, …]. */
export function rleEncode(a: ArrayLike<number>): number[] {
  const out: number[] = [];
  const n = a.length;
  let i = 0;
  while (i < n) {
    const v = a[i]!;
    let j = i + 1;
    while (j < n && a[j] === v) j++;
    out.push(v, j - i);
    i = j;
  }
  return out;
}

/** Décode des plages dans `out` (longueur attendue) ; lève si la longueur ou une valeur ne convient pas. */
export function rleDecode(rle: readonly unknown[], out: Uint8Array, maxValue = 255): Uint8Array {
  if (rle.length % 2 !== 0) throw new Error('plages : nombre impair de valeurs');
  let k = 0;
  for (let p = 0; p < rle.length; p += 2) {
    const v = rle[p], len = rle[p + 1];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > maxValue) throw new Error(`plages : valeur ${String(v)} invalide`);
    if (typeof len !== 'number' || !Number.isInteger(len) || len <= 0 || k + len > out.length) throw new Error('plages : longueur invalide');
    out.fill(v, k, k + len);
    k += len;
  }
  if (k !== out.length) throw new Error(`plages : ${k} cases décodées, ${out.length} attendues`);
  return out;
}
