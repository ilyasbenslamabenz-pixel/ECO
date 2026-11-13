/**
 * Générateur de ville (scène de démonstration et ville de test de charge), exécuté DANS la simulation :
 * il n'invente rien, il envoie les mêmes opérations qu'un joueur (buildRoad, placeBuilding) et passe donc
 * par toutes leurs validations (pente, eau, collisions, accès route, coût). Un refus est simplement compté.
 *
 * Plan : site plat et sec près du centre, quadrillage de routes (boulevard central, avenues, rues, une rue
 * piétonne, une rue à sens unique, une route courbe de sortie — pont automatique si elle franchit l'eau),
 * puis bâtiments alignés sur les rues, façade vers la voie, répartis par quartier (centre d'affaires,
 * habitat collectif, pavillonnaire, zone d'activités). Chaque bâtiment du catalogue est posé au moins une fois
 * (variantes en rotation). Un square (fontaine, bancs, arbres) et les arbres du parc sont renvoyés comme
 * décor de présentation (non simulé : le placement des décors par le joueur est prévu en phase 2).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { TILE_SIZE } from '../shared/constants';
import { rotAngle } from '../shared/footprint';
import { isBuildingCategory, type CatalogAsset } from '../shared/catalog';
import type { RoadKindId } from '../shared/contracts';
import { halfWidth } from './roads/types';
import type { Simulation } from './world';

export interface CityPlanOptions {
  preset: 'demo' | 'stress';
  /** Nombre maximal de bâtiments. */
  maxBuildings?: number;
}

export interface DecorItem { assetId: string; x: number; z: number; rot: number }

export interface CityBuildResult {
  center: [number, number];
  buildings: number;
  distinctBuildings: number;
  /** Bâtiments du catalogue qui n'ont trouvé aucun emplacement valide. */
  missing: string[];
  roadsOk: number;
  roadsRefused: { kind: RoadKindId; message: string }[];
  placementsRefused: number;
  /** Décor de présentation (square, arbres du parc) : rendu seulement. */
  decor: DecorItem[];
  /** Points de vue proposés : cible de la vue aérienne, position et cible de la vue rue. */
  views: { aerial: [number, number]; street: { x: number; z: number; lookX: number; lookZ: number } };
  ms: number;
}

type District = 'centre' | 'collectif' | 'pavillons' | 'activites';

const DISTRICT_OF: Record<string, District> = {
  skyscraper: 'centre', commercial: 'centre', apartment_mid: 'centre', public: 'collectif',
  apartment_high: 'collectif', apartment_low: 'collectif', townhouse: 'pavillons', house: 'pavillons', industrial: 'activites',
};
/** Exceptions de quartier (lisibilité urbaine). */
const DISTRICT_OVERRIDE: Record<string, District> = {
  public_hotel_de_ville: 'centre', public_musee_bibliotheque: 'centre', public_commissariat: 'centre',
  commerce_supermarche: 'collectif', commerce_station_service: 'activites', public_gare: 'activites',
  commerce_boulangerie: 'pavillons', public_ecole: 'pavillons', public_eglise: 'pavillons',
};
/** Poids de répétition par catégorie (nombre de copies dans la file du quartier, variantes en rotation). */
const REPEAT: Record<string, number> = {
  house: 6, townhouse: 4, apartment_low: 4, apartment_mid: 4, apartment_high: 2, commercial: 2, skyscraper: 1, industrial: 1, public: 1,
};

function hash(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

interface Frontage { roadZ: number; side: 1 | -1; x0: number; x1: number; kind: RoadKindId; district: (x: number) => District }

export function buildCity(sim: Simulation, opts: CityPlanOptions): CityBuildResult {
  const t0 = Date.now();
  const t = sim.terrain;
  const cat = sim.catalog;
  if (!t || !cat) throw new Error('Aucune partie en cours');
  const stress = opts.preset === 'stress';
  const maxBuildings = opts.maxBuildings ?? (stress ? 500 : 190);

  // Grille : lignes E-O (z) et colonnes N-S (x), relatives au centre choisi.
  const rowStep = 104, colStep = 136;
  const nRows = stress ? 5 : 2; // lignes de part et d'autre du boulevard
  const nCols = stress ? 5 : 2;
  const halfX = nCols * colStep, halfZ = nRows * rowStep;
  const [cx, cz] = pickSite(sim, halfX + 60, halfZ + 60);

  const res: CityBuildResult = {
    center: [cx, cz], buildings: 0, distinctBuildings: 0, missing: [], roadsOk: 0, roadsRefused: [], placementsRefused: 0, decor: [],
    views: { aerial: [cx, cz], street: { x: cx - 40, z: cz + 9, lookX: cx + 120, lookZ: cz + 4 } }, ms: 0,
  };
  const road = (kind: RoadKindId, x0: number, z0: number, x1: number, z1: number, control?: [number, number]): boolean => {
    const args: Parameters<Simulation['buildRoad']>[0] = { type: kind === 'boulevard' || kind === 'avenue' ? kind : 'street', kind, points: [x0, z0, x1, z1] };
    if (control) args.control = control;
    const r = sim.buildRoad(args);
    if (r.ok) res.roadsOk++; else res.roadsRefused.push({ kind, message: r.error.message });
    return r.ok;
  };

  // 1) Routes E-O : boulevard au centre, avenues, rues. Tracées par morceaux entre colonnes (un refus local
  //    — rivière trop large, pente — n'empêche pas le reste du quartier).
  const rowKind = (k: number): RoadKindId => (k === 0 ? 'boulevard' : Math.abs(k) === nRows ? 'street' : (Math.abs(k) % 2 === 1 ? 'avenue' : 'street'));
  const rows: { z: number; kind: RoadKindId }[] = [];
  for (let k = -nRows; k <= nRows; k++) rows.push({ z: cz + k * rowStep, kind: rowKind(k) });
  for (const r of rows) {
    for (let c = -nCols; c < nCols; c++) road(r.kind, cx + c * colStep, r.z, cx + (c + 1) * colStep, r.z);
  }
  // 2) Colonnes N-S : avenue centrale, rues ; une rue piétonne et une rue à sens unique dans le centre.
  for (let c = -nCols; c <= nCols; c++) {
    for (let k = -nRows; k < nRows; k++) {
      let kind: RoadKindId = c === 0 ? 'avenue' : 'street';
      if (c === -1 && k === -1) kind = 'pedestrian';
      if (c === 1 && k === 0) kind = 'oneway';
      road(kind, cx + c * colStep, cz + k * rowStep, cx + c * colStep, cz + (k + 1) * rowStep);
    }
  }
  // 3) Route courbe de sortie (Bézier) vers l'extérieur ; pont automatique si elle franchit l'eau.
  {
    const ex = cx + halfX, ez = cz;
    const tx = ex + 230, tz = cz + rowStep * 1.6;
    if (!road('avenue', ex, ez, tx, tz, [ex + 200, ez])) road('street', ex, ez, ex + 150, ez + 120, [ex + 140, ez]);
    const wx = cx - halfX;
    road('street', wx, cz - rowStep, wx - 210, cz - rowStep * 2.2, [wx - 190, cz - rowStep]);
  }

  // 4) Files de bâtiments par quartier (chaque modèle au moins une fois ; variantes en rotation).
  const buildingsCat = cat.assets.filter((a) => isBuildingCategory(a.category));
  const queues: Record<District, CatalogAsset[]> = { centre: [], collectif: [], pavillons: [], activites: [] };
  for (const a of buildingsCat) {
    const d = DISTRICT_OVERRIDE[a.id] ?? DISTRICT_OF[a.category] ?? 'collectif';
    const n = stress ? (REPEAT[a.category] ?? 1) * 2 : (REPEAT[a.category] ?? 1);
    for (let i = 0; i < n; i++) queues[d].push(a);
  }
  // Mélange déterministe dans chaque quartier, puis les modèles uniques d'abord (garantie « au moins une fois »).
  for (const d of Object.keys(queues) as District[]) {
    const q = queues[d];
    const firsts: CatalogAsset[] = [];
    const seen = new Set<string>();
    const rest: CatalogAsset[] = [];
    q.sort((a, b) => hash(a.id.length * 31 + a.cost) - hash(b.id.length * 31 + b.cost));
    for (const a of q) { if (seen.has(a.id)) rest.push(a); else { seen.add(a.id); firsts.push(a); } }
    // Les très hauts (gratte-ciel) d'abord : ils prennent les meilleures parcelles près du boulevard.
    firsts.sort((a, b) => b.dimensions.height - a.dimensions.height);
    queues[d] = [...firsts, ...rest];
  }
  const qIndex: Record<District, number> = { centre: 0, collectif: 0, pavillons: 0, activites: 0 };
  const variantCounter = new Map<string, number>();
  const placed = new Set<string>();

  const districtAt = (x: number, z: number): District => {
    const dx = Math.abs(x - cx), dz = z - cz;
    if (dx <= colStep && Math.abs(dz) <= rowStep + 1) return 'centre';
    if (x - cx > colStep && dz < -rowStep * 0.5) return 'activites';
    if (Math.abs(dz) > rowStep * (nRows - 0.5) || dx > colStep * (nCols - 0.5)) return 'pavillons';
    return 'collectif';
  };
  const frontages: Frontage[] = [];
  for (const r of rows) {
    for (const side of [1, -1] as const) {
      // Pas de façade vers l'extérieur de la ville sur les rues de bordure.
      if ((r.z >= cz + halfZ - 1 && side > 0) || (r.z <= cz - halfZ + 1 && side < 0)) continue;
      frontages.push({ roadZ: r.z, side, x0: cx - halfX, x1: cx + halfX, kind: r.kind, district: (x) => districtAt(x, r.z + side * 20) });
    }
  }
  // Square du centre : parcelle réservée au nord du boulevard, à l'est de l'avenue centrale.
  const plaza = { x0: cx + 14, x1: cx + 62, side: 1 as const, z: cz };

  // Alignement sur la grille des cases (comme le fait la simulation) : bord avant juste derrière le trottoir.
  const snapUp = (v: number, o: number): number => o + Math.ceil((v - o) / TILE_SIZE - 1e-6) * TILE_SIZE;
  const snapDown = (v: number, o: number): number => o + Math.floor((v - o) / TILE_SIZE + 1e-6) * TILE_SIZE;
  const tryPlace = (a: CatalogAsset, f: Frontage, xStart: number, extraDepth: number): number => {
    const rot = f.side > 0 ? 2 : 0;
    const depth = a.footprint.tilesZ * TILE_SIZE;
    const w = a.footprint.tilesX * TILE_SIZE;
    const edge = f.roadZ + f.side * (halfWidth(f.kind) + 0.4 + extraDepth);
    const z = f.side > 0 ? snapUp(edge, t.originZ) + depth / 2 : snapDown(edge, t.originZ) - depth / 2;
    const xCenter = snapUp(xStart, t.originX) + w / 2;
    const v = variantCounter.get(a.id) ?? 0;
    const variant = a.variants.length ? v % a.variants.length : -1;
    const r = sim.placeBuilding({ assetId: a.id, x: xCenter, z, rot, variant });
    if (!r.ok) return -1;
    const bi = sim.buildings.indexOf(r.data.buildingId);
    if (bi >= 0 && !sim.buildings.roadAccess[bi]) { sim.demolish({ buildingId: r.data.buildingId }); return -1; }
    variantCounter.set(a.id, v + 1);
    placed.add(a.id);
    res.buildings++;
    return r.data.buildingId;
  };

  const fill = (f: Frontage, pickAsset: (d: District) => CatalogAsset | null, onlyMissing: boolean): void => {
    let x = f.x0 + 4;
    let failures = 0;
    let stuck = 0;
    while (x < f.x1 - 8 && res.buildings < maxBuildings) {
      if (f.side === plaza.side && f.roadZ === plaza.z && x + 8 > plaza.x0 && x < plaza.x1) { x = plaza.x1 + 2; continue; }
      const d = f.district(x);
      const a = pickAsset(d);
      if (!a) return;
      const w = a.footprint.tilesX * TILE_SIZE;
      if (f.side === plaza.side && f.roadZ === plaza.z && x + w > plaza.x0 && x < plaza.x1) { x = plaza.x1 + 2; continue; }
      let id = tryPlace(a, f, x, 0);
      if (id < 0) id = tryPlace(a, f, x, TILE_SIZE);
      if (id >= 0) {
        if (!onlyMissing) qIndex[d]++;
        x = snapUp(x, t.originX) + w + (a.category === 'house' || hash(res.buildings) < 0.3 ? TILE_SIZE : 0);
        failures = 0;
        stuck = 0;
      } else {
        res.placementsRefused++;
        failures++;
        // Après deux échecs sur la même parcelle, on avance (croisement, pente, eau) ; le modèle reste en tête de
        // file, sauf s'il bloque depuis trois parcelles (trop grand ici) : on passe au suivant (rattrapage plus loin).
        if (failures >= 2) {
          x += 8; failures = 0; stuck++;
          if (stuck >= 3 && !onlyMissing) { qIndex[d]++; stuck = 0; }
        }
      }
    }
  };
  // Passe A : chaque modèle une fois (les plus grandes emprises d'abord), dans son quartier si possible,
  // à partir d'une position pseudo-aléatoire le long des rues (évite de tout regrouper en bout de rue).
  const placeOnce = (a: CatalogAsset, wantDistrict: District | null): boolean => {
    const w = a.footprint.tilesX * TILE_SIZE;
    const list = frontages.filter((f) => wantDistrict === null || f.district((f.x0 + f.x1) / 2) === wantDistrict || f.district(f.x0 + 10) === wantDistrict || f.district(f.x1 - 10) === wantDistrict);
    const off = Math.floor(hash(a.id.length * 131 + a.cost) * list.length);
    for (let k = 0; k < list.length; k++) {
      const f = list[(k + off) % list.length]!;
      const span = f.x1 - f.x0 - w - 8;
      if (span <= 0) continue;
      const start = Math.floor(hash(a.cost + k) * span / TILE_SIZE) * TILE_SIZE;
      for (let step = 0; step < span; step += TILE_SIZE) {
        const x = f.x0 + 4 + ((start + step) % span);
        if (wantDistrict !== null && f.district(x + w / 2) !== wantDistrict) continue;
        if (f.side === plaza.side && f.roadZ === plaza.z && x + w > plaza.x0 && x < plaza.x1) continue;
        if (tryPlace(a, f, x, 0) >= 0 || tryPlace(a, f, x, TILE_SIZE) >= 0) return true;
        res.placementsRefused++;
      }
    }
    return false;
  };
  const uniques = [...buildingsCat].sort((p, q) => q.footprint.tilesX * q.footprint.tilesZ - p.footprint.tilesX * p.footprint.tilesZ || q.dimensions.height - p.dimensions.height);
  for (const a of uniques) {
    if (res.buildings >= maxBuildings) break;
    const d = DISTRICT_OVERRIDE[a.id] ?? DISTRICT_OF[a.category] ?? 'collectif';
    if (!placeOnce(a, d)) placeOnce(a, null);
  }
  // Passe B : remplissage des rues par les files de quartier (répétitions avec variantes).
  for (const f of frontages) fill(f, (d) => queues[d][qIndex[d] % queues[d].length] ?? null, false);
  const missingNow = (): CatalogAsset[] => buildingsCat.filter((a) => !placed.has(a.id));
  res.missing = missingNow().map((a) => a.id);
  res.distinctBuildings = placed.size;

  // 5) Décor de présentation.
  const ground = (x: number, z: number): boolean => sim.canHostDecor(x, z);
  const pz0 = cz + halfWidth('boulevard') + 4;
  const pcx = (plaza.x0 + plaza.x1) / 2, pcz = pz0 + 22;
  const push = (assetId: string, x: number, z: number, rot = 0): void => { if (ground(x, z)) res.decor.push({ assetId, x, z, rot }); };
  push('fontaine_place', pcx, pcz);
  for (const [dx, dz, r] of [[-9, 0, 1], [9, 0, 3], [0, -9, 0], [0, 9, 2]] as const) push('banc_bois', pcx + dx, pcz + dz, r);
  for (const [dx, dz] of [[-16, -14], [16, -14], [-16, 14], [16, 14]] as const) push('arbre_feuillu_rond', pcx + dx, pcz + dz);
  for (const [dx, dz] of [[-6, -15], [6, -15], [-6, 15], [6, 15]] as const) push('jardiniere_plante_a', pcx + dx, pcz + dz);
  push('lampadaire_fonte', pcx - 12, pcz - 4); push('lampadaire_fonte', pcx + 12, pcz + 4);
  push('poubelle_metal', pcx - 12, pcz + 2); push('borne_incendie', plaza.x0 + 1, pz0 + 1);
  push('table_pique_nique', pcx + 16, pcz); push('terrasse_cafe', pcx - 17, pcz + 1, 1);
  push('arbuste_searsia_a', pcx - 20, pcz - 6); push('arbuste_searsia_b', pcx + 20, pcz + 6);
  // Arbres du parc (emplacements proposés par l'artiste, hors kiosque et aire de jeux).
  const b = sim.buildings;
  for (let i = 0; i < b.count; i++) {
    const a = cat.assets[b.assetIndex[i]!];
    if (a?.id !== 'public_parc_kiosque') continue;
    const th = rotAngle(b.rot[i]!);
    const c = Math.cos(th), s = Math.sin(th);
    const pts: [number, number, string][] = [[11, 6, 'arbre_jacaranda'], [-11, 6, 'arbre_feuillu_rond'], [11, -2, 'arbre_feuillu_jeune'], [-11, 2, 'arbre_feuillu_rond'],
      [6, 11, 'arbre_peuplier'], [-6, 11, 'arbre_feuillu_jeune'], [-12, -2, 'arbre_petit_ornement'], [3, -12, 'arbre_feuillu_rond']];
    for (const [lx, lz, id] of pts) res.decor.push({ assetId: id, x: b.x[i]! + lx * c + lz * s, z: b.z[i]! - lx * s + lz * c, rot: 0 });
  }
  // Vue rue : au milieu d'un îlot, sur le trottoir du boulevard (entre lampadaires et arbres d'alignement), regard
  // le long de la rue vers les tours du centre : façades à droite, arbres, chaussée sur un tiers de l'image.
  const hwB = halfWidth('boulevard');
  res.views.street = { x: cx - colStep * 0.44, z: cz + hwB - 2.3, lookX: cx + colStep, lookZ: cz + hwB - 4 };
  res.ms = Date.now() - t0;
  return res;
}

/** Site plat et sec près du centre de la carte (score : eau puis rugosité). */
function pickSite(sim: Simulation, hx: number, hz: number): [number, number] {
  const t = sim.terrain!;
  let best = Infinity;
  let bx = 0, bz = 0;
  for (let oz = -320; oz <= 320; oz += 64) {
    for (let ox = -320; ox <= 320; ox += 64) {
      let wet = 0, n = 0, s = 0, s2 = 0;
      for (let z = oz - hz; z <= oz + hz; z += 32) {
        for (let x = ox - hx; x <= ox + hx; x += 32) {
          const h = sim.groundHeight(x, z);
          if (!Number.isFinite(h) || sim.isWet(x, z) || h < t.waterLevel + 1) wet++;
          else { s += h; s2 += h * h; n++; }
        }
      }
      const sd = n > 1 ? Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2)) : 1e3;
      const score = wet * 40 + sd + Math.hypot(ox, oz) * 0.01;
      if (score < best) { best = score; bx = ox; bz = oz; }
    }
  }
  return [bx, bz];
}
