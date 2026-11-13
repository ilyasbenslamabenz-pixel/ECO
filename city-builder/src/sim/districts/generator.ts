/**
 * Quartiers — GÉNÉRATEUR : demande (type, graine, rectangle) -> plan (routes puis lots).
 *
 * Méthode (déterministe : PRNG sfc32 semé par la graine et le type ; aucun état global) :
 *  1. Trame viaire dans le repère local du rectangle : lignes E-O (« rangées ») et N-S (« colonnes ») espacées
 *     selon le profil, avec irrégularité ; voies du pourtour, voie principale centrale, voies particulières
 *     (rue piétonne du centre historique, sens unique du faubourg…) ; des tronçons de colonnes intérieures sont
 *     supprimés (îlots longs, carrefours en T) ou remplacés par des impasses (pavillonnaire, activités).
 *     Les voies sont des tronçons DROITS d'un carrefour au suivant (choix de robustesse : un refus local de la
 *     simulation — eau, pente — n'empêche pas le reste ; les courbes ne sont pas utilisées).
 *  2. Équipements d'abord (école, église, parc, commerces de proximité… selon la surface), sur des rives tirées au sort.
 *  3. Lotissement de chaque rive : curseur le long de la voie, façade tournée vers la voie (même convention que
 *     src/sim/city-builder.ts), recul et espacement du profil, modèle choisi par tirage PONDÉRÉ :
 *        poids = catégorie × tag de quartier × gradient de hauteur × commerce sur voie principale
 *                × anti-répétition (même modèle dans un rayon de 48 m : ×0,12 par occurrence ; lot contigu
 *                  identique : ×0,001, donc jamais s'il existe une alternative) × équilibrage (modèles déjà très posés).
 *     Variantes en rotation, différentes de celle d'un voisin contigu de même modèle.
 *  4. Validité d'un lot (reprend les règles de `Simulation.placeBuilding`) : hors de toute voie du plan
 *     (demi-largeur + marge), sans recouvrement d'un autre lot, à moins de 8 m de sa voie (accès route), au sec,
 *     pente acceptable, emprise libre (`env.blocked`).
 * Rotation du quartier : quarts de tour entiers (les décimales sont arrondies).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { isBuildingCategory, type AssetCatalog, type CatalogAsset } from '../../shared/catalog';
import { MAX_BUILDING_SLOPE, TILE_SIZE } from '../../shared/constants';
import { Rng } from '../rng';
import { halfWidth, ROAD_KINDS, type RoadKindId } from '../roads/types';
import { measureDiversity, type DiversityItem } from './diversity';
import { DISTRICT_PROFILES, districtTypesOf, isTaggedForDistrict, matchesEquipment, styleOf, type DistrictProfile } from './profiles';
import {
  DISTRICT_TYPES, MAX_DISTRICT_SIZE, MIN_DISTRICT_SIZE,
  type DistrictEnv, type DistrictPlan, type DistrictRequest, type LotRole, type PlannedLot, type PlannedRoad,
} from './types';

/** Marge entre le bord d'une voie (trottoir compris) et une emprise. */
const ROAD_MARGIN = 0.6;
/** Distance maximale emprise - voie pour l'accès route (ROAD_ACCESS_MARGIN_M = 8 m dans la simulation). */
const MAX_ACCESS = 7.6;
const REPEAT_RADIUS = 48;

interface Seg { ax: number; az: number; bx: number; bz: number; kind: RoadKindId; half: number; horizontal: boolean; index: number }
interface Front { seg: Seg; /** Normale vers le lot (repère local). */ nx: number; nz: number; main: boolean }
interface Placed { x0: number; z0: number; x1: number; z1: number; cx: number; cz: number; asset: number; variant: number; size: number }

function typeSalt(type: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < type.length; i++) { h ^= type.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** Positions des lignes de la trame sur [-span/2, span/2] (bornes comprises). */
function gridLines(span: number, target: number, jitter: number, rng: Rng): number[] {
  const n = Math.max(1, Math.round(span / target));
  const w: number[] = [];
  let sum = 0;
  for (let i = 0; i < n; i++) { const v = 1 + jitter * (rng.next() * 2 - 1); w.push(v); sum += v; }
  const out = [-span / 2];
  let acc = 0;
  for (let i = 0; i < n - 1; i++) { acc += w[i]!; out.push(Math.round((-span / 2 + (span * acc) / sum) * 2) / 2); }
  out.push(span / 2);
  return out;
}

const clampSize = (v: number): number => Math.max(MIN_DISTRICT_SIZE, Math.min(MAX_DISTRICT_SIZE, Number.isFinite(v) ? v : MIN_DISTRICT_SIZE));
const r2 = (v: number): number => Math.round(v * 100) / 100;

export function generateDistrict(req: DistrictRequest, catalog: AssetCatalog, env: DistrictEnv = {}): DistrictPlan {
  if (!(DISTRICT_TYPES as readonly string[]).includes(req.type)) throw new Error(`Type de quartier inconnu : ${String(req.type)}`);
  const profile: DistrictProfile = DISTRICT_PROFILES[req.type];
  const W = clampSize(req.width), D = clampSize(req.depth);
  const R = ((Math.round(req.rot ?? 0) % 4) + 4) % 4;
  const cosR = [1, 0, -1, 0][R]!, sinR = [0, 1, 0, -1][R]!;
  const toWorld = (lx: number, lz: number): [number, number] => [req.x + lx * cosR + lz * sinR, req.z - lx * sinR + lz * cosR];
  const rng = new Rng((req.seed ^ typeSalt(req.type)) >>> 0);

  /* ------------------------------ 1. Trame viaire ------------------------------ */
  const xs = gridLines(W, profile.blockW, profile.jitter, rng);
  const zs = gridLines(D, profile.blockD, profile.jitter, rng);
  const nx = xs.length - 1, nz = zs.length - 1;
  const midRow = nz >= 2 ? Math.round(nz / 2) : -1;
  const midCol = nx >= 2 ? Math.round(nx / 2) : -1;
  const lineKind = (i: number, n: number, mid: number, main: RoadKindId): RoadKindId => {
    if (i === 0 || i === n) return profile.edgeKind;
    if (i === mid) return main;
    if (profile.specialKind && profile.specialEvery > 0 && (i + (mid < 0 ? 0 : mid)) % profile.specialEvery === 1) return profile.specialKind;
    return profile.streetKind;
  };
  const colMain: RoadKindId = profile.mainKind === 'boulevard' ? 'avenue' : profile.mainKind;
  const segs: Seg[] = [];
  const fronts: Front[] = [];
  const mk = (ax: number, az: number, bx: number, bz: number, kind: RoadKindId): Seg => ({ ax, az, bx, bz, kind, half: halfWidth(kind), horizontal: az === bz, index: segs.length });
  /**
   * Un tronçon dont une extrémité est dans l'eau (ou hors carte) serait refusé par la simulation : il est
   * écarté du plan, ainsi que ses rives (les lots suivraient sans accès route).
   */
  const buildable = (ax: number, az: number, bx: number, bz: number, kind: RoadKindId): boolean => {
    if (!env.isWet && !env.heightAt) return true;
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 1e-6) return false;
    const ux = (bx - ax) / L, uz = (bz - az) / L;
    const half = halfWidth(kind) + 1;
    const n = Math.max(4, Math.ceil(L / 6));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const cx = ax + (bx - ax) * t, cz = az + (bz - az) * t;
      // Axe et bords de l'emprise (la simulation refuse une chaussée qui touche l'eau).
      for (const o of [0, half, -half]) {
        const [wx, wz] = toWorld(cx - uz * o, cz + ux * o);
        if (env.isWet?.(wx, wz)) return false;
        if (env.heightAt && !Number.isFinite(env.heightAt(wx, wz))) return false;
      }
    }
    return true;
  };
  for (let j = 0; j <= nz; j++) {
    const kind = lineKind(j, nz, midRow, profile.mainKind);
    for (let i = 0; i < nx; i++) {
      if (!buildable(xs[i]!, zs[j]!, xs[i + 1]!, zs[j]!, kind)) continue;
      const s = mk(xs[i]!, zs[j]!, xs[i + 1]!, zs[j]!, kind);
      segs.push(s);
      if (j < nz) fronts.push({ seg: s, nx: 0, nz: 1, main: j === midRow });
      if (j > 0) fronts.push({ seg: s, nx: 0, nz: -1, main: j === midRow });
    }
  }
  const colFronts: Front[] = [];
  for (let i = 0; i <= nx; i++) {
    const kind = lineKind(i, nx, midCol, colMain);
    const interior = i > 0 && i < nx && i !== midCol;
    for (let j = 0; j < nz; j++) {
      let z0 = zs[j]!, z1 = zs[j + 1]!;
      let stub = false;
      if (interior && rng.next() < profile.dropSegment) {
        if (rng.next() >= profile.impasse || z1 - z0 < 56) continue;
        // Impasse : demi-tronçon partant de l'une des deux rangées.
        const len = Math.round((z1 - z0) * 0.45);
        if (rng.next() < 0.5) z1 = z0 + len; else z0 = z1 - len;
        stub = true;
      }
      if (!buildable(xs[i]!, z0, xs[i]!, z1, stub ? profile.streetKind : kind)) continue;
      const s = mk(xs[i]!, z0, xs[i]!, z1, stub ? profile.streetKind : kind);
      segs.push(s);
      if (i < nx) colFronts.push({ seg: s, nx: 1, nz: 0, main: i === midCol });
      if (i > 0) colFronts.push({ seg: s, nx: -1, nz: 0, main: i === midCol });
    }
  }
  fronts.push(...colFronts);

  /* ------------------------------ 2. Candidats ------------------------------ */
  const assets = catalog.assets;
  const ordinary: number[] = [];
  for (let k = 0; k < assets.length; k++) {
    const a = assets[k]!;
    if (!isBuildingCategory(a.category) || a.footprint.tilesX <= 0 || a.footprint.tilesZ <= 0) continue;
    if ((profile.categories[a.category] ?? 0) <= 0) continue;
    if (!districtTypesOf(a).includes(req.type)) continue;
    ordinary.push(k);
  }
  const placed: Placed[] = [];
  const lots: PlannedLot[] = [];
  const used = new Map<number, number>();
  const hw = W / 2, hd = D / 2;

  const distRectSeg = (x0: number, z0: number, x1: number, z1: number, s: Seg): number => {
    const sx0 = Math.min(s.ax, s.bx), sx1 = Math.max(s.ax, s.bx), sz0 = Math.min(s.az, s.bz), sz1 = Math.max(s.az, s.bz);
    return Math.hypot(Math.max(0, x0 - sx1, sx0 - x1), Math.max(0, z0 - sz1, sz0 - z1));
  };
  const sep = profile.attached ? 0 : 2;
  const valid = (x0: number, z0: number, x1: number, z1: number, tiles: number): boolean => {
    if (x0 < -hw || x1 > hw || z0 < -hd || z1 > hd) return false;
    for (const s of segs) if (distRectSeg(x0, z0, x1, z1, s) - s.half < ROAD_MARGIN - 0.05) return false;
    for (const p of placed) if (x0 < p.x1 + sep - 0.01 && x1 > p.x0 - sep + 0.01 && z0 < p.z1 + sep - 0.01 && z1 > p.z0 - sep + 0.01) return false;
    if (env.heightAt || env.isWet || env.blocked) {
      let hMin = Infinity, hMax = -Infinity, mnx = Infinity, mnz = Infinity, mxx = -Infinity, mxz = -Infinity;
      for (const [lx, lz] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [(x0 + x1) / 2, (z0 + z1) / 2]] as const) {
        const [wx, wz] = toWorld(lx, lz);
        if (wx < mnx) mnx = wx; if (wx > mxx) mxx = wx; if (wz < mnz) mnz = wz; if (wz > mxz) mxz = wz;
        if (env.isWet?.(wx, wz)) return false;
        if (env.heightAt) {
          const h = env.heightAt(wx, wz);
          if (!Number.isFinite(h)) return false;
          if (h < hMin) hMin = h; if (h > hMax) hMax = h;
        }
      }
      if (env.heightAt && (hMax - hMin) / (tiles * TILE_SIZE) > MAX_BUILDING_SLOPE * 0.8) return false;
      if (env.blocked?.(mnx, mnz, mxx, mxz)) return false;
    }
    return true;
  };

  /** Rectangle local d'un modèle posé à l'abscisse `s` (début) d'une rive, avec le recul `setback`. */
  const rectOn = (f: Front, a: CatalogAsset, s: number, setback: number): [number, number, number, number] => {
    const w = a.footprint.tilesX * TILE_SIZE, d = a.footprint.tilesZ * TILE_SIZE;
    const off = f.seg.half + ROAD_MARGIN + setback;
    if (f.seg.horizontal) {
      const xa = Math.min(f.seg.ax, f.seg.bx) + s;
      const za = f.nz > 0 ? f.seg.az + off : f.seg.az - off - d;
      return [xa, za, xa + w, za + d];
    }
    const za = Math.min(f.seg.az, f.seg.bz) + s;
    const xa = f.nx > 0 ? f.seg.ax + off : f.seg.ax - off - d;
    return [xa, za, xa + d, za + w];
  };
  const localRot = (f: Front): number => (f.nz > 0 ? 2 : f.nz < 0 ? 0 : f.nx > 0 ? 3 : 1);
  const frontLen = (f: Front): number => Math.abs(f.seg.bx - f.seg.ax) + Math.abs(f.seg.bz - f.seg.az);

  const commit = (f: Front, k: number, rect: [number, number, number, number], role: LotRole): void => {
    const a = assets[k]!;
    const [x0, z0, x1, z1] = rect;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const size = Math.max(a.footprint.tilesX, a.footprint.tilesZ) * TILE_SIZE;
    const n = used.get(k) ?? 0;
    let variant = a.variants.length > 0 ? n % a.variants.length : -1;
    if (a.variants.length > 1) {
      // Jamais la même variante qu'un voisin contigu de même modèle.
      for (let t = 0; t < a.variants.length; t++) {
        const clash = placed.some((p) => p.asset === k && p.variant === variant && Math.hypot(p.cx - cx, p.cz - cz) <= (p.size + size) / 2 + 6);
        if (!clash) break;
        variant = (variant + 1) % a.variants.length;
      }
    }
    used.set(k, n + 1);
    placed.push({ x0, z0, x1, z1, cx, cz, asset: k, variant, size });
    const [wx, wz] = toWorld(cx, cz);
    lots.push({ assetId: a.id, variant, x: r2(wx), z: r2(wz), rot: (localRot(f) + R) % 4, role, road: f.seg.index });
  };

  /* ------------------------------ 3. Équipements ------------------------------ */
  const areaHa = (W * D) / 10000;
  let equipments = 0;
  const equipUsed = new Set<number>();
  for (const spec of profile.equipments) {
    const count = Math.max(spec.min, Math.min(spec.max, Math.round(areaHa / spec.perHa)));
    const cands: number[] = [];
    for (let k = 0; k < assets.length; k++) {
      const a = assets[k]!;
      if (isBuildingCategory(a.category) && a.footprint.tilesX > 0 && matchesEquipment(a, spec)) cands.push(k);
    }
    for (let c = 0; c < count && cands.length > 0; c++) {
      const fresh = cands.filter((k) => !equipUsed.has(k));
      const pool = fresh.length > 0 ? fresh : cands;
      const k = pool[Math.floor(rng.next() * pool.length)]!;
      const a = assets[k]!;
      const w = a.footprint.tilesX * TILE_SIZE;
      const start = Math.floor(rng.next() * fronts.length);
      let done = false;
      for (let q = 0; q < fronts.length && !done; q++) {
        const f = fronts[(start + q) % fronts.length]!;
        const L = frontLen(f);
        if (L < w + 8) continue;
        const s0 = Math.floor(rng.next() * (L - w));
        for (let step = 0; step < L - w && !done; step += 6) {
          const s = (s0 + step) % (L - w);
          const rect = rectOn(f, a, s, Math.min(profile.setback[1], 3));
          if (!valid(rect[0], rect[1], rect[2], rect[3], Math.max(a.footprint.tilesX, a.footprint.tilesZ))) continue;
          commit(f, k, rect, a.category === 'commercial' ? 'commerce' : 'equipement');
          equipUsed.add(k);
          equipments++;
          done = true;
        }
      }
    }
  }

  /* ------------------------------ 4. Lotissement ------------------------------ */
  const weights: number[] = new Array<number>(ordinary.length).fill(0);
  if (ordinary.length > 0) {
    for (const f of fronts) {
      const L = frontLen(f);
      const setbackRow = rng.range(profile.setback[0], profile.setback[1]);
      let s = 1;
      let prevMitoyen = false;
      while (s < L - 6) {
        const remaining = L - s;
        // Position approchée du lot (pour le gradient de hauteur et l'anti-répétition).
        const probe = rectOn(f, assets[ordinary[0]!]!, s, setbackRow);
        const px = (probe[0] + probe[2]) / 2, pz = (probe[1] + probe[3]) / 2;
        const centrality = Math.max(0, 1 - Math.max(Math.abs(px) / hw, Math.abs(pz) / hd));
        const hWant = profile.heightEdge + (profile.heightCentre - profile.heightEdge) * centrality;
        let any = false;
        for (let c = 0; c < ordinary.length; c++) {
          const k = ordinary[c]!;
          const a = assets[k]!;
          if (a.footprint.tilesX * TILE_SIZE > remaining) { weights[c] = 0; continue; }
          let wgt = profile.categories[a.category] ?? 0;
          if (isTaggedForDistrict(a)) wgt *= profile.taggedBoost;
          wgt *= Math.exp(-Math.abs(Math.log(Math.max(3, a.dimensions.height) / hWant)) * profile.heightSharpness);
          if (a.category === 'commercial') wgt *= f.main ? profile.commerceOnMain : 0.6;
          const size = Math.max(a.footprint.tilesX, a.footprint.tilesZ) * TILE_SIZE;
          let near = 0, touching = false;
          for (const p of placed) {
            if (p.asset !== k) continue;
            const d = Math.hypot(p.cx - px, p.cz - pz);
            if (d <= REPEAT_RADIUS) near++;
            if (d <= (p.size + size) / 2 + 8) touching = true;
          }
          wgt *= Math.pow(0.12, near);
          if (touching) wgt *= 0.001;
          wgt /= 1 + 0.35 * (used.get(k) ?? 0);
          weights[c] = wgt;
          if (wgt > 0) any = true;
        }
        if (!any) break;
        let done = false;
        for (let attempt = 0; attempt < 6 && !done; attempt++) {
          let sum = 0;
          for (const v of weights) sum += v;
          if (sum <= 0) break;
          const c = rng.weighted(weights);
          const k = ordinary[c]!;
          const a = assets[k]!;
          const mitoyen = a.tags.includes('mitoyen');
          const setback = Math.min(MAX_ACCESS - ROAD_MARGIN, profile.aligned ? setbackRow : rng.range(profile.setback[0], profile.setback[1]));
          const rect = rectOn(f, a, s, setback);
          if (valid(rect[0], rect[1], rect[2], rect[3], Math.max(a.footprint.tilesX, a.footprint.tilesZ))) {
            commit(f, k, rect, a.category === 'commercial' ? 'commerce' : 'bati');
            const gap = profile.attached && mitoyen ? 0 : rng.range(profile.gap[0], profile.gap[1]);
            s += a.footprint.tilesX * TILE_SIZE + gap;
            prevMitoyen = mitoyen;
            done = true;
          } else weights[c] = 0;
        }
        if (!done) s += 4;
      }
      void prevMitoyen;
    }
  }

  /* ------------------------------ 5. Sortie ------------------------------ */
  const roads: PlannedRoad[] = segs.map((s) => {
    const [ax, az] = toWorld(s.ax, s.az);
    const [bx, bz] = toWorld(s.bx, s.bz);
    return { kind: s.kind, points: [r2(ax), r2(az), r2(bx), r2(bz)] };
  });
  const corners = [toWorld(-hw, -hd), toWorld(hw, hd)];
  const bounds = {
    minX: Math.min(corners[0]![0], corners[1]![0]), minZ: Math.min(corners[0]![1], corners[1]![1]),
    maxX: Math.max(corners[0]![0], corners[1]![0]), maxZ: Math.max(corners[0]![1], corners[1]![1]),
  };
  const byId = new Map<string, CatalogAsset>();
  for (const a of assets) byId.set(a.id, a);
  const items: DiversityItem[] = lots.map((l) => {
    const a = byId.get(l.assetId)!;
    return { assetId: l.assetId, variant: l.variant, x: l.x, z: l.z, size: Math.max(a.footprint.tilesX, a.footprint.tilesZ) * TILE_SIZE };
  });
  const div = measureDiversity(items, { styleOf: (id) => { const a = byId.get(id); return a ? styleOf(a) : undefined; } });
  let residents = 0, jobs = 0, cost = 0, hSum = 0, roadLength = 0;
  for (const l of lots) {
    const a = byId.get(l.assetId)!;
    residents += a.capacity.residents; jobs += a.capacity.jobs; cost += a.cost; hSum += a.dimensions.height;
  }
  for (const s of segs) {
    const len = Math.abs(s.bx - s.ax) + Math.abs(s.bz - s.az);
    roadLength += len;
    cost += len * ROAD_KINDS[s.kind].costPerMeter;
  }
  return {
    type: req.type, seed: req.seed, rot: R, center: [req.x, req.z], size: [W, D], bounds, roads, lots,
    stats: {
      roads: roads.length, roadLength: Math.round(roadLength), lots: lots.length, distinctAssets: div.distinctAssets,
      repetitionIndex: div.repetitionIndex, adjacentTwinRate: div.adjacentTwinRate, styles: div.styles,
      residents, jobs, cost: Math.round(cost), meanHeight: lots.length > 0 ? hSum / lots.length : 0, equipments,
    },
  };
}
