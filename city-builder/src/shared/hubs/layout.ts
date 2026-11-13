/**
 * Gabarits des pôles de transport : pièces (modèles du catalogue `transport`) en coordonnées LOCALES,
 * postes à quai et postes avions, géométrie de la piste, servitudes aéronautiques et champ de bruit.
 *
 * Repère local (identique à src/shared/footprint.ts) : X le long du quai / de la piste, Z en profondeur ;
 * port : mer côté +Z (front de quai en z = +hz) ; aéroport : piste parallèle à X en z = RUNWAY_Z.
 * Monde = (cx + lx·c + lz·s, cz − lx·s + lz·c) avec c = cos θ, s = sin θ, θ = rot·π/2 (rotation.y en three).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { TILE_SIZE } from '../constants';
import { makeObb, obbToLocal, obbToWorld, type Obb } from '../footprint';
import { HUB_SPECS, type HubRecord, type HubType } from './types';

/** Pièce d'un pôle : modèle, position locale, cap local (radians, rotation autour de Y), rôle animé éventuel. */
export interface HubPiece {
  asset: string;
  x: number;
  z: number;
  /** Décalage vertical par rapport au sol fini du pôle (m). */
  y?: number;
  rotY: number;
  anim?: 'grue_portique' | 'grue_mobile' | 'radar' | 'rampe' | 'passerelle';
  /** Poste desservi (grues : poste à quai ; passerelles : poste avion). */
  slot?: number;
  /** Pièce posée au sol du terrain (aéroport) plutôt qu'au niveau fini commun. */
  ground?: boolean;
}

export interface Berth { x: number; z: number; length: number; role: 'cargo' | 'ferry' }
export interface Stand { x: number; z: number; role: 'passagers' | 'fret' }

export interface HubLayout {
  type: HubType;
  hx: number;
  hz: number;
  pieces: HubPiece[];
  berths: Berth[];
  stands: Stand[];
}

/* ------------------------------------------------------------------ Port */

/** Profondeur d'un module de quai (m) : front à z = +hz, mur jusqu'à −3 m sous le dessus. */
export const QUAY_DEPTH = 24.75;
/** Écart entre le front de quai et l'axe d'un navire à quai (demi-largeur 15 m + défenses). */
export const BERTH_OFFSET = 18.5;
/** Profondeur du bassin à contrôler devant le quai (m). */
export const BASIN_DEPTH = 64;
/** Longueur du chenal d'approche contrôlé de part et d'autre du quai (m). */
export const CHANNEL_REACH = 240;

const Q = Math.PI / 2;

function portLayout(type: 'port_commerce' | 'port_passagers'): HubLayout {
  const spec = HUB_SPECS[type];
  const hx = (spec.tilesX * TILE_SIZE) / 2, hz = (spec.tilesZ * TILE_SIZE) / 2;
  const pieces: HubPiece[] = [];
  const quayZ = hz - QUAY_DEPTH / 2;
  const x0 = -hx;
  // Partie commerce : 7 modules de quai (224 m) à partir de l'extrémité −X.
  for (let k = 0; k < 7; k++) pieces.push({ asset: 'port_quai_droit', x: x0 + 16 + 32 * k, z: quayZ, rotY: 0 });
  const cargoX = x0 + 112;
  pieces.push({ asset: 'port_grue_portique', x: cargoX - 40, z: quayZ, rotY: 0, anim: 'grue_portique', slot: 0 });
  pieces.push({ asset: 'port_grue_portique', x: cargoX + 16, z: quayZ, rotY: 0, anim: 'grue_portique', slot: 0 });
  pieces.push({ asset: 'port_grue_mobile', x: cargoX + 70, z: quayZ - 2, rotY: Q, anim: 'grue_mobile', slot: 0 });
  // Parc à conteneurs (piles) et conteneurs isolés.
  for (const [dx, dz] of [[-74, 4], [-34, 4], [6, 4], [-74, -18], [-34, -18]] as const) pieces.push({ asset: 'port_pile_conteneurs', x: cargoX + dx, z: dz, rotY: 0 });
  const singles: [string, number, number, number][] = [
    ['port_conteneur_40', 38, 8, 0], ['port_conteneur_40hc', 38, 11, 0], ['port_conteneur_frigo', 38, 14, 0],
    ['port_conteneur_20', 52, 8, Q], ['port_conteneur_40', 24, -6, 0.15], ['port_conteneur_20', 22, -12, 0],
  ];
  for (const [a, dx, dz, r] of singles) pieces.push({ asset: a, x: cargoX + dx, z: dz, rotY: r });
  pieces.push({ asset: 'port_entrepot', x: cargoX + 60, z: -hz + 22, rotY: 0 });
  pieces.push({ asset: 'port_capitainerie', x: x0 + 16, z: -hz + 10, rotY: 0, anim: 'radar' });
  const berths: Berth[] = [{ x: cargoX, z: hz + BERTH_OFFSET, length: 200, role: 'cargo' }];
  if (type === 'port_passagers') {
    // Extension passagers (160 m) : 4 modules de quai, rampe roulière en bout, gare maritime.
    for (let k = 0; k < 4; k++) pieces.push({ asset: 'port_quai_droit', x: x0 + 224 + 16 + 32 * k, z: quayZ, rotY: 0 });
    pieces.push({ asset: 'port_quai_rampe', x: x0 + 352 + 12.05, z: hz - 18.7, rotY: 0, anim: 'rampe', slot: 1 });
    pieces.push({ asset: 'port_gare_maritime', x: x0 + 224 + 72, z: -hz + 30, rotY: 0 });
    berths.push({ x: x0 + 224 + 80, z: hz + BERTH_OFFSET - 2, length: 160, role: 'ferry' });
  }
  return { type, hx, hz, pieces, berths, stands: [] };
}

/* -------------------------------------------------------------- Aéroport */

/** Axe de la piste (z local), longueur et largeur de la bande (m). */
export const RUNWAY_Z = -90;
export const RUNWAY_LENGTH = 900;
export const RUNWAY_STRIP_HALF = 75;
export const TAXIWAY_Z = -20;
export const APRON_Z = 25;

function airportLayout(): HubLayout {
  const spec = HUB_SPECS.aeroport;
  const hx = (spec.tilesX * TILE_SIZE) / 2, hz = (spec.tilesZ * TILE_SIZE) / 2;
  const pieces: HubPiece[] = [];
  const g = (asset: string, x: number, z: number, rotY = 0, extra: Partial<HubPiece> = {}): void => { pieces.push({ asset, x, z, rotY, ground: true, ...extra }); };
  // Piste : 15 modules de 60 m (seuils aux extrémités, zones de toucher, sections courantes).
  for (let k = 0; k < 15; k++) {
    const x = -RUNWAY_LENGTH / 2 + 30 + 60 * k;
    if (k === 0) g('aero_piste_seuil', x, RUNWAY_Z, 0);
    else if (k === 14) g('aero_piste_seuil', x, RUNWAY_Z, Math.PI);
    else if (k === 1) g('aero_piste_toucher', x, RUNWAY_Z, 0);
    else if (k === 13) g('aero_piste_toucher', x, RUNWAY_Z, Math.PI);
    else g('aero_piste_section', x, RUNWAY_Z, 0);
  }
  // Voie de circulation parallèle et bretelles (fin de piste et milieu).
  for (let x = -390; x <= 390; x += 30) g('aero_taxiway_droit', x, TAXIWAY_Z, 0);
  for (const x of [-390, 0, 390]) g('aero_taxiway_droit', x, -50, Q);
  // Aire de stationnement (4 modules), aérogare (hall + deux jetées), passerelles.
  for (const x of [-90, -30, 30, 90]) g('aero_aire_stationnement', x, APRON_Z, 0);
  g('aero_aire_stationnement', 270, APRON_Z, 0);
  g('aero_aire_stationnement', 330, APRON_Z, 0);
  g('aero_aerogare_hall', 0, 118, Math.PI);
  g('aero_aerogare_jetee', -70, 86, Math.PI);
  g('aero_aerogare_jetee', 70, 86, Math.PI);
  const stands: Stand[] = [
    { x: -105, z: APRON_Z, role: 'passagers' }, { x: -35, z: APRON_Z, role: 'passagers' },
    { x: 35, z: APRON_Z, role: 'passagers' }, { x: 105, z: APRON_Z, role: 'passagers' },
    { x: 300, z: APRON_Z, role: 'fret' },
  ];
  // Passerelle : accrochée au front de jetée (z ≈ 75), tournée vers l'avion (cap −Z local).
  for (let i = 0; i < 4; i++) g('aero_passerelle', stands[i]!.x + (i < 2 ? 14 : -14), 62, Math.PI, { anim: 'passerelle', slot: i });
  g('aero_tour_controle', -200, 70, Math.PI);
  g('aero_hangar', 300, 100, Math.PI);
  // Véhicules de piste stationnés.
  g('aero_bus_piste', -150, 60, Q);
  g('aero_avitailleur', 160, 60, Q);
  g('aero_tracteur_pushback', -60, 52, 0);
  g('aero_train_bagages', 60, 52, 0);
  return { type: 'aeroport', hx, hz, pieces, berths: [], stands };
}

const LAYOUTS = new Map<HubType, HubLayout>();

/** Gabarit (mis en cache, ne pas modifier). */
export function hubLayout(type: HubType): HubLayout {
  let l = LAYOUTS.get(type);
  if (!l) { l = type === 'aeroport' ? airportLayout() : portLayout(type); LAYOUTS.set(type, l); }
  return l;
}

/** Rectangle orienté de l'emprise d'un pôle. */
export function hubObb(type: HubType, x: number, z: number, rot: number, out?: Obb): Obb {
  const l = hubLayout(type);
  return makeObb(x, z, l.hx, l.hz, rot, out);
}

/** Local -> monde pour un pôle posé. */
export function hubToWorld(h: Pick<HubRecord, 'type' | 'x' | 'z' | 'rot'>, lx: number, lz: number): [number, number] {
  return obbToWorld(hubObb(h.type, h.x, h.z, h.rot), lx, lz);
}

export function hubToLocal(h: Pick<HubRecord, 'type' | 'x' | 'z' | 'rot'>, x: number, z: number): [number, number] {
  return obbToLocal(hubObb(h.type, h.x, h.z, h.rot), x, z);
}

/* ---------------------------------------------------- Servitudes (OLS) */

/** Pente de la surface d'approche (2 %), divergence latérale (15 %), longueur (m). */
export const APPROACH_SLOPE = 0.02;
export const APPROACH_DIVERGENCE = 0.15;
export const APPROACH_LENGTH = 3000;
/** Surface de transition : pente 1/7 depuis le bord de la bande jusqu'à 45 m. */
export const TRANSITION_SLOPE = 1 / 7;
export const TRANSITION_TOP = 45;

/**
 * Hauteur maximale autorisée (m au-dessus du sol) en un point exprimé dans le repère local de l'aéroport
 * (surfaces de limitation d'obstacles simplifiées : approche 2 % divergente à 15 % sur 3 km dans l'axe,
 * transition 1/7 le long de la piste). Infinity hors servitude.
 */
export function easementLimitLocal(lx: number, lz: number): number {
  const half = RUNWAY_LENGTH / 2;
  const b = Math.abs(lz - RUNWAY_Z);
  const ax = Math.abs(lx);
  let lim = Infinity;
  if (ax <= half) {
    if (b <= RUNWAY_STRIP_HALF) return 0;
    const t = (b - RUNWAY_STRIP_HALF) * TRANSITION_SLOPE;
    if (t < TRANSITION_TOP) lim = t;
  } else {
    const d = ax - half;
    if (d <= APPROACH_LENGTH && b <= RUNWAY_STRIP_HALF + APPROACH_DIVERGENCE * d) lim = Math.min(lim, APPROACH_SLOPE * d);
    // Transition prolongée autour de l'approche (évite une falaise réglementaire au bord du cône).
    const edge = RUNWAY_STRIP_HALF + APPROACH_DIVERGENCE * d;
    if (d <= APPROACH_LENGTH && b > edge) {
      const t = APPROACH_SLOPE * d + (b - edge) * TRANSITION_SLOPE;
      if (t < TRANSITION_TOP) lim = Math.min(lim, t);
    }
  }
  return lim;
}

/** Hauteur maximale autorisée en (x, z) monde pour un aéroport posé. */
export function easementLimit(h: Pick<HubRecord, 'type' | 'x' | 'z' | 'rot'>, x: number, z: number): number {
  if (h.type !== 'aeroport') return Infinity;
  const [lx, lz] = hubToLocal(h, x, z);
  return easementLimitLocal(lx, lz);
}

/* ------------------------------------------------------------- Bruit */

/** Indice de bruit (0..100) d'un aéroport en un point local : piste, axes d'approche et de décollage. */
export function airportNoiseLocal(lx: number, lz: number): number {
  const half = RUNWAY_LENGTH / 2;
  const b = Math.abs(lz - RUNWAY_Z);
  const ax = Math.abs(lx);
  let L: number;
  if (ax <= half) L = 78 - 20 * Math.log10(1 + Math.max(0, b - 30) / 60);
  else {
    const d = ax - half;
    const axis = 78 - 12 * Math.log10(1 + d / 150);
    L = axis - 20 * Math.log10(1 + b / (60 + 0.12 * d));
  }
  return Math.max(0, Math.min(100, (L - 45) * 2.2));
}

/** Indice de bruit d'un port (grues, navires, camions) en fonction de la distance à l'emprise (m). */
export function portNoiseAtDistance(d: number): number {
  return d <= 0 ? 50 : 50 * Math.exp(-d / 160);
}

/** Bruit d'un pôle posé en (x, z) monde. */
export function hubNoise(h: Pick<HubRecord, 'type' | 'x' | 'z' | 'rot'>, x: number, z: number): number {
  const [lx, lz] = hubToLocal(h, x, z);
  if (h.type === 'aeroport') return airportNoiseLocal(lx, lz);
  const l = hubLayout(h.type);
  const dx = Math.max(0, Math.abs(lx) - l.hx), dz = Math.max(0, Math.abs(lz) - l.hz);
  return portNoiseAtDistance(Math.hypot(dx, dz));
}
