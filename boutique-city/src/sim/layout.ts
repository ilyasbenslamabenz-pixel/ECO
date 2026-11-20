/**
 * Aménagement intérieur d'un local, vu de dessus : grille de cases de 1 m, porte au milieu de la façade (rangée du
 * bas, z = gridD − 1). Règles : meubles dans la grille, sans chevauchement, porte dégagée, chaque meuble accessible
 * depuis la porte (une case libre voisine reliée à la porte). TypeScript pur.
 */
import { FURNITURE_BY_ID, type FurnitureDef, type StoreKind } from './catalog';

export interface PlacedItem {
  uid: number;
  def: string;
  /** Case du coin haut-gauche. */
  x: number;
  z: number;
  /**
   * Quarts de tour (0..3). Face avant du meuble : 0 → +z (vers la porte), 1 → +x, 2 → −z, 3 → −x. Rotation impaire :
   * largeur et profondeur échangées.
   */
  rot: Rot;
}

export type Rot = 0 | 1 | 2 | 3;

/** Direction de la face avant d'un meuble tourné de `rot` quarts de tour. */
export function frontDir(rot: Rot): [number, number] {
  return ([[0, 1], [1, 0], [0, -1], [-1, 0]] as const)[rot] as [number, number];
}

export interface LayoutStats {
  registers: number;
  machines: number;
  seats: number;
  /** Unités stockables par type de meuble de présentation. */
  capacity: Record<StoreKind, number>;
  /** Décoration rapportée à la surface (0 = nue ; ≈ 1 = soignée). */
  decor: number;
  /** Valeur du mobilier (CHF). */
  value: number;
  /** Meubles inaccessibles (uid). */
  blocked: number[];
}

export function footprint(def: FurnitureDef, rot: Rot): { w: number; d: number } {
  return rot % 2 ? { w: def.d, d: def.w } : { w: def.w, d: def.d };
}

/** Cases voisines (hors diagonales) d'un meuble, côté avant d'abord, puis côtés, puis arrière. */
export function neighbourCells(it: PlacedItem, def: FurnitureDef): [number, number][] {
  const f = footprint(def, it.rot);
  const [fx, fz] = frontDir(it.rot);
  const out: { c: [number, number]; score: number }[] = [];
  for (let z = it.z - 1; z <= it.z + f.d; z++) {
    for (let x = it.x - 1; x <= it.x + f.w; x++) {
      const inside = x >= it.x && x < it.x + f.w && z >= it.z && z < it.z + f.d;
      const corner = (x === it.x - 1 || x === it.x + f.w) && (z === it.z - 1 || z === it.z + f.d);
      if (inside || corner) continue;
      const cx = x + 0.5 - (it.x + f.w / 2), cz = z + 0.5 - (it.z + f.d / 2);
      out.push({ c: [x, z], score: -(cx * fx + cz * fz) });
    }
  }
  return out.sort((a, b) => a.score - b.score).map((o) => o.c);
}

/** Cases devant (côté client) et derrière (côté employé) d'une caisse. */
export function registerSides(it: PlacedItem, def: FurnitureDef): { front: [number, number][]; back: [number, number][] } {
  const f = footprint(def, it.rot);
  const [fx, fz] = frontDir(it.rot);
  const front: [number, number][] = [], back: [number, number][] = [];
  for (let z = it.z; z < it.z + f.d; z++) {
    for (let x = it.x; x < it.x + f.w; x++) {
      const fxC = x + fx, fzC = z + fz, bxC = x - fx, bzC = z - fz;
      const inF = fxC >= it.x && fxC < it.x + f.w && fzC >= it.z && fzC < it.z + f.d;
      const inB = bxC >= it.x && bxC < it.x + f.w && bzC >= it.z && bzC < it.z + f.d;
      if (!inF) front.push([fxC, fzC]);
      if (!inB) back.push([bxC, bzC]);
    }
  }
  return { front, back };
}

/** Cases de la porte (2 cases au milieu de la rangée du bas). */
export function doorCells(gridW: number, gridD: number): [number, number][] {
  const x0 = Math.floor(gridW / 2) - 1;
  return [[x0, gridD - 1], [x0 + 1, gridD - 1]];
}

/** Grille d'occupation : 0 libre, sinon uid + 1. */
export function occupancy(items: readonly PlacedItem[], gridW: number, gridD: number): Int32Array {
  const g = new Int32Array(gridW * gridD);
  for (const it of items) {
    const def = FURNITURE_BY_ID.get(it.def);
    if (!def) continue;
    const f = footprint(def, it.rot);
    for (let z = it.z; z < it.z + f.d; z++) for (let x = it.x; x < it.x + f.w; x++) if (x >= 0 && z >= 0 && x < gridW && z < gridD) g[z * gridW + x] = it.uid + 1;
  }
  return g;
}

/** Raison du refus de poser un meuble, ou null si possible. */
export function canPlace(items: readonly PlacedItem[], gridW: number, gridD: number, def: FurnitureDef, x: number, z: number, rot: Rot, ignoreUid = -1): string | null {
  const f = footprint(def, rot);
  if (x < 0 || z < 0 || x + f.w > gridW || z + f.d > gridD) return 'Hors du local';
  const occ = occupancy(items.filter((i) => i.uid !== ignoreUid), gridW, gridD);
  const door = doorCells(gridW, gridD);
  for (let zz = z; zz < z + f.d; zz++) {
    for (let xx = x; xx < x + f.w; xx++) {
      if (occ[zz * gridW + xx]) return 'Place déjà occupée';
      if (door.some(([dx, dz]) => dx === xx && (dz === zz || dz - 1 === zz))) return "Laissez l'entrée dégagée";
    }
  }
  return null;
}

/** Statistiques de l'aménagement (capacités, décoration, accessibilité). */
export function layoutStats(items: readonly PlacedItem[], gridW: number, gridD: number): LayoutStats {
  const capacity: Record<StoreKind, number> = { rayon: 0, frigo: 0, comptoir: 0, vitrine: 0, portant: 0 };
  let registers = 0, machines = 0, seats = 0, decor = 0, value = 0;
  const blocked = unreachable(items, gridW, gridD);
  for (const it of items) {
    const def = FURNITURE_BY_ID.get(it.def);
    if (!def) continue;
    value += def.price;
    decor += def.decor ?? 0;
    if (blocked.includes(it.uid)) continue; // inaccessible : ne sert à rien
    if (def.kind === 'caisse') registers++;
    else if (def.kind === 'machine') machines++;
    else if (def.kind === 'table') seats += def.seats ?? 0;
    if (def.capacity && def.kind in capacity) capacity[def.kind as StoreKind] += def.capacity;
  }
  // 1 point de décoration pour 12 m² ≈ local soigné.
  return { registers, machines, seats, capacity, decor: Math.min(1.5, (decor * 12) / Math.max(1, gridW * gridD)), value, blocked };
}

/** Meubles sans case libre voisine reliée à la porte. */
export function unreachable(items: readonly PlacedItem[], gridW: number, gridD: number): number[] {
  const occ = occupancy(items, gridW, gridD);
  const seen = new Uint8Array(gridW * gridD);
  const q: number[] = [];
  for (const [x, z] of doorCells(gridW, gridD)) { const k = z * gridW + x; if (!occ[k]) { seen[k] = 1; q.push(k); } }
  while (q.length) {
    const k = q.pop()!;
    const x = k % gridW, z = (k - x) / gridW;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= gridW || nz >= gridD) continue;
      const n = nz * gridW + nx;
      if (seen[n] || occ[n]) continue;
      seen[n] = 1; q.push(n);
    }
  }
  const out: number[] = [];
  for (const it of items) {
    const def = FURNITURE_BY_ID.get(it.def);
    if (!def || def.kind === 'deco') continue; // la décoration n'a pas besoin d'être atteinte
    const f = footprint(def, it.rot);
    let ok = false;
    for (let z = it.z - 1; z <= it.z + f.d && !ok; z++) {
      for (let x = it.x - 1; x <= it.x + f.w && !ok; x++) {
        const inside = x >= it.x && x < it.x + f.w && z >= it.z && z < it.z + f.d;
        const corner = (x === it.x - 1 || x === it.x + f.w) && (z === it.z - 1 || z === it.z + f.d);
        if (inside || corner || x < 0 || z < 0 || x >= gridW || z >= gridD) continue;
        if (seen[z * gridW + x]) ok = true;
      }
    }
    if (!ok) out.push(it.uid);
  }
  return out;
}
