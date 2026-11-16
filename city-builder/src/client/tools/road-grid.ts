/**
 * Quadrillage local côté client : champ de trames de la carte (src/shared/grid-field.ts) construit sur le miroir de
 * la simulation (routes, empreintes des bâtiments), mis en cache par version du miroir. Utilisé par le quadrillage au
 * sol de tous les outils, les cases de l'outil Zones et l'aimantation de l'outil de pose : ce que le joueur voit est
 * exactement là où le bâtiment se pose. TypeScript pur (aucun three).
 */
import { FIELD_FADE, FIELD_ROAD_REACH, GridField, ObbBuckets, type FieldRoad, type ObbQuery } from '../../shared/grid-field';
import { pickPhase, roadGridFrame, type RoadGridFrame } from '../../shared/road-grid';
import type { Obb } from '../../shared/footprint';
import { roadWidth, type NearestEdge, type WorldMirror } from './mirror';
import { alignTrace, type AlignEnd, type AlignResult } from './road-align';

/** Au-delà de cette distance (m) au BORD de la route, le quadrillage ne suit plus la route (champ : bâtiment voisin ou monde). */
export const ROAD_GRID_REACH = FIELD_ROAD_REACH;

/** Empreintes des bâtiments à moins de `r` m de (x, z). */
export function obbsNear(m: WorldMirror, x: number, z: number, r: number): Obb[] {
  const out: Obb[] = [];
  for (const b of m.buildings.values()) {
    if (Math.abs(b.x - x) > r || Math.abs(b.z - z) > r) continue;
    const o = m.buildingObb(b);
    if (o) out.push(o);
  }
  return out;
}

const cache = new WeakMap<WorldMirror, { version: number; field: GridField; query: ObbQuery; roads: FieldRoad[]; preview?: { key: string; field: GridField } }>();

/** Routes du miroir vues par le champ (axe, demi-largeur trottoirs compris). */
export function mirrorFieldRoads(m: WorldMirror): FieldRoad[] {
  const roads: FieldRoad[] = [];
  for (const e of m.edges.values()) {
    const v = m.edgeView(e);
    if (v) roads.push({ id: v.id, poly: v.poly, half: roadWidth(v.kindId) / 2 });
  }
  return roads;
}

/** Champ de trames du miroir (recalculé quand les routes ou les bâtiments changent). */
export function fieldFor(m: WorldMirror): GridField {
  return fieldEntry(m).field;
}

function fieldEntry(m: WorldMirror): NonNullable<ReturnType<typeof cache.get>> {
  const c = cache.get(m);
  if (c && c.version === m.version) return c;
  const obbs: Obb[] = [];
  for (const b of m.buildings.values()) { const o = m.buildingObb(b); if (o) obbs.push(o); }
  const query = new ObbBuckets(obbs).query, roads = mirrorFieldRoads(m);
  const e = { version: m.version, field: new GridField(roads, query), query, roads };
  cache.set(m, e);
  return e;
}

/** Route en cours de tracé, vue par le champ (aperçu) : polyligne de l'axe et demi-largeur. */
export interface PreviewRoad { poly: readonly number[]; half: number }

/** Clé d'un aperçu de route (au centimètre) ; '' sans aperçu. */
export function previewKey(p: PreviewRoad | null): string {
  return p ? `${p.half}:${p.poly.map((v) => v.toFixed(2)).join(',')}` : '';
}

/**
 * Champ de trames affiché pendant le tracé d'une route : celui du miroir AVEC la route aperçue (trame de la route
 * telle qu'elle sera une fois posée : ce que le joueur voit pendant le tracé est le quadrillage d'après la pose).
 * Valable dans `previewBox(p)` seulement (seules les routes assez proches y sont reprises : construction rapide à
 * chaque mouvement du curseur) ; ailleurs, le champ du miroir (`fieldFor`) est inchangé.
 */
export function fieldWithPreview(m: WorldMirror, p: PreviewRoad | null): GridField {
  const e = fieldEntry(m);
  const box = previewBox(p);
  if (!p || !box) return e.field;
  const key = previewKey(p);
  if (e.preview?.key === key) return e.preview.field;
  const pad = FIELD_ROAD_REACH + FIELD_FADE + 40;
  const near = e.roads.filter((r) => {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let k = 0; k + 1 < r.poly.length; k += 2) { const x = r.poly[k]!, z = r.poly[k + 1]!; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    const g = pad + r.half;
    return x1 + g >= box.x0 && x0 - g <= box.x1 && z1 + g >= box.z0 && z0 - g <= box.z1;
  });
  const field = new GridField([...near, { id: -1, poly: p.poly, half: p.half }], e.query);
  e.preview = { key, field };
  return field;
}

/** Boîte (x0, z0, x1, z1) du champ que la route aperçue peut modifier (portée des trames de route et fondu compris). */
export function previewBox(p: PreviewRoad | null): { x0: number; z0: number; x1: number; z1: number } | null {
  if (!p || p.poly.length < 4) return null;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let k = 0; k + 1 < p.poly.length; k += 2) { const x = p.poly[k]!, z = p.poly[k + 1]!; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const r = p.half + FIELD_ROAD_REACH + FIELD_FADE + 4;
  return { x0: x0 - r, z0: z0 - r, x1: x1 + r, z1: z1 + r };
}

/**
 * Trame d'une route trouvée par `nearestEdge` en (x, z) : celle du champ (lignes affichées) si elle suit cette route,
 * sinon (bord de champ) la trame de la route avec la phase du voisin parallèle le plus proche.
 */
export function frameForEdge(m: WorldMirror, near: NearestEdge, x: number, z: number): RoadGridFrame {
  const half = roadWidth(near.edge.kindId) / 2;
  const f = roadGridFrame(near.px, near.pz, near.tx, near.tz, half);
  const g = fieldFor(m).roadFrameAt(x, z);
  const s = g && g.tx * f.tx + g.tz * f.tz > 0 ? 1 : -1;
  if (g && Math.abs(g.tx * f.tx + g.tz * f.tz) > 0.9995 && Math.abs(g.cn - s * f.cn) < 0.6 && Math.abs(g.offset - f.offset) < 0.01) {
    // Même route (même axe à la courbure près) : trame du champ, réexprimée dans le sens de `f`.
    f.phase = ((s * g.phase) % f.cell + f.cell) % f.cell;
    return f;
  }
  f.phase = pickPhase(f, obbsNear(m, x, z, 90), x, z);
  return f;
}

/** Trame locale de route au point (x, z) ; null loin de toute route. */
export function localRoadGrid(m: WorldMirror, x: number, z: number, reach = ROAD_GRID_REACH): { frame: RoadGridFrame; edgeId: number } | null {
  const near = m.nearestEdge(x, z, reach + 16);
  if (!near) return null;
  if (near.dist - roadWidth(near.edge.kindId) / 2 > reach) return null;
  return { frame: frameForEdge(m, near, x, z), edgeId: near.edge.id };
}

/** Extrémité de tracé vue par l'aimantation au quadrillage (src/client/tools/road-align.ts). */
interface DraftEnd { x: number; z: number; snap: string; edgeId?: number; guide?: { label: string } }

/**
 * Tracé droit (start → end) d'une route de demi-largeur `half` calé sur le quadrillage affiché AVANT le tracé
 * (champ du miroir) : direction, ligne des façades sur une ligne affichée, extrémités sur les lignes transversales.
 * Null si rien à caler (tracé en biais, trop court, accroches qui l'interdisent).
 */
export function alignDraft<T extends DraftEnd>(m: WorldMirror, start: T, end: T, half: number): { start: T; end: T; result: AlignResult } | null {
  const len = Math.hypot(end.x - start.x, end.z - start.z);
  if (len < 4) return null;
  const toEnd = (p: DraftEnd): AlignEnd => {
    if (p.snap === 'node') return { x: p.x, z: p.z, fixed: true };
    if (p.snap === 'edge') { const e = m.nearestEdge(p.x, p.z, 0.6); return e ? { x: p.x, z: p.z, slide: { tx: e.tx, tz: e.tz } } : { x: p.x, z: p.z, fixed: true }; }
    // Ligne guide d'îlot (parallèle à une route, à distance d'îlot) : prioritaire.
    if (p.guide && /îlot/.test(p.guide.label)) return { x: p.x, z: p.z, fixed: true };
    return { x: p.x, z: p.z };
  };
  // Lignes affichées du côté du tracé (à 8 m du départ au plus : départ accroché à une route → côté de la nouvelle rue).
  const k = Math.min(len / 2, 8) / len;
  const L = fieldFor(m).linesAt(start.x + (end.x - start.x) * k, start.z + (end.z - start.z) * k);
  const ends = [toEnd(start), toEnd(end)] as const;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = alignTrace(ends[0], ends[1], half, L);
    if (!r) return null;
    // Un point accroché à un tronçon doit y rester après glissement ; sinon il ne glisse pas.
    let ok = true;
    for (const [i, p, q] of [[0, start, r.start], [1, end, r.end]] as const) {
      if (p.snap !== 'edge' || (Math.abs(q.x - p.x) < 1e-6 && Math.abs(q.z - p.z) < 1e-6)) continue;
      if (m.nearestEdge(q.x, q.z, 0.6)?.edge.id !== p.edgeId) { ends[i].fixed = true; ok = false; }
    }
    if (ok) return { start: { ...start, x: r.start.x, z: r.start.z }, end: { ...end, x: r.end.x, z: r.end.z }, result: r };
  }
  return null;
}
