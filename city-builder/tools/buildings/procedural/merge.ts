/**
 * Fusion des matériaux voisins par LOD (bâtiments procéduraux).
 *
 * Chaque matériau coûte une primitive glTF, soit ~2,3 Ko de JSON (matériau, accesseurs, vues meshopt, textures)
 * une fois le GLB compressé : aux LOD1/2, ce surcoût dépassait le poids de la géométrie. On fusionne donc, après
 * construction, les rôles de même nature (opaque/verre, mode d'UV, double face) dont la teinte est proche ; aux LOD
 * éloignés, les petits rôles (quelques % des sommets) rejoignent le rôle de teinte la plus voisine.
 */
import type { MeshBuilder, Palette, KitMaterial } from '../kit/index';

function rgb(m: KitMaterial): [number, number, number] {
  const c = /^#?([0-9a-f]{6})$/i.exec(m.color ?? '#ffffff')?.[1] ?? 'ffffff';
  return [parseInt(c.slice(0, 2), 16) / 255, parseInt(c.slice(2, 4), 16) / 255, parseInt(c.slice(4, 6), 16) / 255];
}
const dist = (a: KitMaterial, b: KitMaterial): number => {
  const x = rgb(a), y = rgb(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) / Math.sqrt(3);
};
const nature = (m: KitMaterial): string => `${m.kind ?? 'opaque'}|${m.uv ?? 'meters'}|${m.doubleSided ? 1 : 0}`;

/** Seuils par LOD : [même jeu de textures, petit rôle vers teinte voisine (tout jeu), part « petite » des sommets]. */
const RULES: Record<0 | 1 | 2, [number, number, number]> = {
  0: [0.05, 0, 0],
  1: [0.14, 0.25, 0.06],
  2: [1, 0.4, 0.1],
};

export function mergeRoles(mb: MeshBuilder, palette: Palette, lod: 0 | 1 | 2): void {
  const [sameSet, near, small] = RULES[lod];
  const verts = (r: string): number => (mb.prims.get(r)?.pos.length ?? 0) / 3;
  const into = (src: string, dst: string): void => {
    const a = mb.prims.get(dst)!, b = mb.prims.get(src)!;
    const base = a.pos.length / 3;
    a.pos.push(...b.pos); a.nor.push(...b.nor); a.uv.push(...b.uv); a.lit.push(...b.lit);
    for (const i of b.idx) a.idx.push(i + base);
    mb.prims.delete(src);
  };
  const total = (): number => [...mb.prims.keys()].reduce((s, r) => s + verts(r), 0);
  // 1) même jeu de textures et même nature, teinte proche : vers le rôle le plus fourni
  let changed = true;
  while (changed) {
    changed = false;
    const roles = [...mb.prims.keys()].filter((r) => palette[r]).sort((x, y) => verts(y) - verts(x));
    outer: for (let i = 0; i < roles.length; i++) {
      for (let j = i + 1; j < roles.length; j++) {
        const A = palette[roles[i]!]!, B = palette[roles[j]!]!;
        if (nature(A) !== nature(B) || (A.set ?? '') !== (B.set ?? '')) continue;
        if (dist(A, B) > sameSet) continue;
        into(roles[j]!, roles[i]!);
        changed = true;
        break outer;
      }
    }
  }
  if (near <= 0) return;
  // 2) petits rôles vers la teinte la plus voisine (même nature, tout jeu)
  const T = total();
  const roles = [...mb.prims.keys()].filter((r) => palette[r]).sort((x, y) => verts(x) - verts(y));
  for (const r of roles) {
    if (!mb.prims.has(r) || verts(r) > T * small) continue;
    const A = palette[r]!;
    let best = '', bd = Infinity;
    for (const o of mb.prims.keys()) {
      if (o === r || !palette[o] || nature(palette[o]!) !== nature(A) || verts(o) <= verts(r)) continue;
      const d = dist(A, palette[o]!);
      if (d < bd) { bd = d; best = o; }
    }
    if (best && bd <= near) into(r, best);
  }
}
