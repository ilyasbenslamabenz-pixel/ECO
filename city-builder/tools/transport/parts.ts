/**
 * Pièces de détail partagées par les modèles transport : disques texturés, roues, garde-corps et treillis
 * (découpes alpha de l'atlas), échelles, bollards, défenses, mâts d'éclairage, feux, conteneurs ISO.
 * Le niveau de détail (mb.lod) simplifie ou supprime les pièces.
 */
import type { MatKey } from './materials';
import { add, cross, len, norm, scl, sub, TMesh, type V3 } from './mesh';
import { regionUv, type RegionName } from './textures';

/** Disque plan (centre c, normale n, rayon r) à UV radiales dans une région d'atlas. */
export function disc(mb: TMesh, mat: MatKey, c: V3, n: V3, r: number, seg: number, region: RegionName): void {
  const nn = norm(n);
  const ref: V3 = Math.abs(nn[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(ref, nn)), v = cross(nn, u);
  const R = regionUv(region);
  const uvAt = (a: number, k: number): [number, number] => [R.u0 + (R.u1 - R.u0) * (0.5 + 0.5 * k * Math.cos(a)), R.v0 + (R.v1 - R.v0) * (0.5 - 0.5 * k * Math.sin(a))];
  const ci = mb.vert(mat, c, nn, ...uvAt(0, 0));
  const ids: number[] = [];
  for (let k = 0; k < seg; k++) {
    const a = (k / seg) * Math.PI * 2;
    ids.push(mb.vert(mat, add(c, add(scl(u, Math.cos(a) * r), scl(v, Math.sin(a) * r))), nn, ...uvAt(a, 1)));
  }
  for (let k = 0; k < seg; k++) mb.tri(mat, ci, ids[k]!, ids[(k + 1) % seg]!);
}

/** Roue d'axe X centrée en c : bande noire + flancs texturés (pneu/jante). */
export function wheelX(mb: TMesh, c: V3, r: number, w: number): void {
  const seg = mb.lod === 0 ? 14 : mb.lod === 1 ? 8 : 6;
  mb.tube('atlas', [c[0] - w / 2, c[1], c[2]], [c[0] + w / 2, c[1], c[2]], r, seg, false, 'noir');
  disc(mb, 'atlas', [c[0] + w / 2, c[1], c[2]], [1, 0, 0], r, seg, 'pneu');
  disc(mb, 'atlas', [c[0] - w / 2, c[1], c[2]], [-1, 0, 0], r, seg, 'pneu');
}

/** Bande découpée (decal) verticale de a à b (au sol de la bande), hauteur h, région répétée tous les `rep` m. */
export function decalStrip(mb: TMesh, a: V3, b: V3, h: number, region: RegionName, rep: number, both = true): void {
  const L = len(sub(b, a));
  const n = Math.max(1, Math.round(L / rep));
  for (let k = 0; k < n; k++) {
    const p0 = add(a, scl(sub(b, a), k / n)), p1 = add(a, scl(sub(b, a), (k + 1) / n));
    mb.quad('decal', p0, p1, add(p1, [0, h, 0]), add(p0, [0, h, 0]), { region });
    if (!both) continue;
  }
}

/** Garde-corps de a à b (1,1 m), découpe alpha double face ; LOD2 : omis. */
export function railing(mb: TMesh, a: V3, b: V3, h = 1.1): void {
  if (mb.lod >= 2) return;
  decalStrip(mb, a, b, h, 'garde_corps', 4);
}

/** Panneau de treillis plan entre deux segments parallèles (a0→a1 bas, b0→b1 haut), travées de `rep` m. */
export function trussPanel(mb: TMesh, a0: V3, a1: V3, b0: V3, b1: V3, rep: number): void {
  const L = len(sub(a1, a0));
  const n = Math.max(1, Math.round(L / rep));
  for (let k = 0; k < n; k++) {
    const t0 = k / n, t1 = (k + 1) / n;
    const p = (s: V3, e: V3, t: number): V3 => add(s, scl(sub(e, s), t));
    mb.quad('decal', p(a0, a1, t0), p(a0, a1, t1), p(b0, b1, t1), p(b0, b1, t0), { region: 'treillis', rect: [0, 0, 0.25, 1] });
  }
}

/**
 * Treillis spatial (section rectangulaire w×h) de a vers b : 4 membrures tubulaires + diagonales.
 * LOD0 : géométrie complète ; LOD1 : membrures + panneaux découpés ; LOD2 : panneaux seuls sur une boîte légère.
 */
export function lattice(mb: TMesh, mat: MatKey, a: V3, b: V3, w: number, h: number, bay: number, chordR = 0.12): void {
  const ax = norm(sub(b, a));
  const ref: V3 = Math.abs(ax[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
  const u = scl(norm(cross(ax, ref)), w / 2), v = scl(norm(cross(scl(u, 1), ax)), h / 2);
  const corner = (p: V3, su: number, sv: number): V3 => add(p, add(scl(u, su), scl(v, sv)));
  const cs: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const L = len(sub(b, a));
  const n = Math.max(1, Math.round(L / bay));
  if (mb.lod === 0) {
    for (const [su, sv] of cs) mb.tube(mat, corner(a, su, sv), corner(b, su, sv), chordR, 6, false);
    for (let k = 0; k <= n; k++) {
      const p = add(a, scl(sub(b, a), k / n));
      for (let f = 0; f < 4; f++) { const [s0, t0] = cs[f]!, [s1, t1] = cs[(f + 1) % 4]!; mb.beam(mat, corner(p, s0, t0), corner(p, s1, t1), chordR * 0.8); }
      if (k === n) continue;
      const q = add(a, scl(sub(b, a), (k + 1) / n));
      for (let f = 0; f < 4; f++) {
        const [s0, t0] = cs[f]!, [s1, t1] = cs[(f + 1) % 4]!;
        if (k % 2) mb.beam(mat, corner(p, s0, t0), corner(q, s1, t1), chordR * 0.6); else mb.beam(mat, corner(p, s1, t1), corner(q, s0, t0), chordR * 0.6);
      }
    }
  } else {
    if (mb.lod === 1) for (const [su, sv] of cs) mb.beam(mat, corner(a, su, sv), corner(b, su, sv), chordR * 1.6);
    for (let f = 0; f < 4; f++) {
      const [s0, t0] = cs[f]!, [s1, t1] = cs[(f + 1) % 4]!;
      trussPanel(mb, corner(a, s0, t0), corner(b, s0, t0), corner(a, s1, t1), corner(b, s1, t1), bay);
    }
  }
}

/** Échelle verticale (decal) sur une face de normale n, de y0 à y1, largeur 0,5 m. */
export function ladder(mb: TMesh, x: number, z: number, y0: number, y1: number, n: V3): void {
  if (mb.lod >= 2) return;
  const t = norm(cross([0, 1, 0], n));
  const c: V3 = [x + n[0] * 0.15, 0, z + n[2] * 0.15];
  const p0 = add(c, scl(t, -0.25)), p1 = add(c, scl(t, 0.25));
  mb.quad('decal', [p0[0], y0, p0[2]], [p1[0], y0, p1[2]], [p1[0], y1, p1[2]], [p0[0], y1, p0[2]], { region: 'echelle', rect: [0, 0, 1, Math.min(1, (y1 - y0) / 3)] });
}

/** Bollard d'amarrage (tête champignon) au sol en (x, z). */
export function bollard(mb: TMesh, x: number, y: number, z: number): void {
  if (mb.lod >= 2) return;
  mb.push().translate(x, y, z);
  const seg = mb.lod === 0 ? 10 : 6;
  mb.lathe('noir', mb.lod === 0 ? [[0.32, 0], [0.3, 0.08], [0.22, 0.12], [0.2, 0.55], [0.3, 0.62], [0.34, 0.72], [0.3, 0.78], [0.001, 0.8]] : [[0.3, 0], [0.22, 0.1], [0.22, 0.6], [0.32, 0.75], [0.001, 0.8]], seg, 50);
  mb.pop();
}

/** Mât d'éclairage avec couronne de projecteurs. */
export function lightMast(mb: TMesh, x: number, z: number, h: number, heads = 4): void {
  const seg = mb.lod === 0 ? 8 : 6;
  mb.tube('gris_clair', [x, 0, z], [x, h, z], [0.35, 0.18], seg, mb.lod < 2);
  if (mb.lod === 0) mb.tube('gris', [x, 0, z], [x, 0.25, z], 0.55, 8, true);
  mb.box('gris', x - 1.2, h, z - 0.15, x + 1.2, h + 0.25, z + 0.15);
  for (let k = 0; k < heads; k++) {
    const hx = x - 1.0 + (2.0 * k) / Math.max(1, heads - 1);
    mb.box('gris_fonce', hx - 0.28, h + 0.25, z - 0.2, hx + 0.28, h + 0.75, z + 0.25, '', { pz: { region: 'feu_blanc' }, ny: { region: 'feu_blanc' } });
  }
}

/** Feu de balisage (petit cylindre + calotte émissive). */
export function beacon(mb: TMesh, p: V3, region: RegionName, r = 0.15, h = 0.3): void {
  if (mb.lod >= 2) { mb.box('atlas', p[0] - r, p[1], p[2] - r, p[0] + r, p[1] + h, p[2] + r, 'ny', { region }); return; }
  const seg = mb.lod === 0 ? 8 : 5;
  mb.tube('gris_fonce', p, add(p, [0, h * 0.6, 0]), r * 0.6, seg, false);
  mb.tube('atlas', add(p, [0, h * 0.6, 0]), add(p, [0, h, 0]), [r, r * 0.6], seg, true, region);
}

/* ------------------------------------------------------------------ */
/* Conteneurs ISO                                                       */
/* ------------------------------------------------------------------ */

export interface ContainerOpts { len: number; hc?: boolean; mat: MatKey; logo?: RegionName; reefer?: boolean; doorsTo?: 1 | -1; simple?: boolean }
export const CT_W = 2.438;
export const ctHeight = (hc?: boolean): number => (hc ? 2.896 : 2.591);

/** Conteneur posé en (x, y, z), longueur le long de X. */
export function container(mb: TMesh, x: number, y: number, z: number, o: ContainerOpts): void {
  const L = o.len, W = CT_W, H = ctHeight(o.hc);
  const x0 = x - L / 2, x1 = x + L / 2, z0 = z - W / 2, z1 = z + W / 2;
  const doors = o.doorsTo ?? 1;
  const lod = mb.lod;
  const shellMat = o.mat;
  if (lod >= 2) {
    mb.box(shellMat, x0, y, z0, x1, y + H, z1, 'ny');
    return;
  }
  const f = 0.11; // cadre (poteaux d'angle, longerons)
  // coque ondulée en retrait du cadre
  if (o.simple) mb.box(shellMat, x0, y, z0, x1, y + H, z1, 'ny');
  else mb.box(shellMat, x0 + 0.02, y + 0.12, z0 + 0.03, x1 - 0.02, y + H - 0.1, z1 - 0.03, 'ny');
  // cadre : longerons haut/bas, poteaux d'angle, traverses
  const fm: MatKey = shellMat;
  if (lod === 0 && !o.simple) {
    for (const zz of [z0, z1 - f]) {
      mb.box(fm, x0, y, zz, x1, y + 0.16, zz + f, 'ny');
      mb.box(fm, x0, y + H - 0.1, zz, x1, y + H, zz + f);
    }
    for (const xx of [x0, x1 - f]) for (const zz of [z0, z1 - f]) mb.box(fm, xx, y, zz, xx + f, y + H, zz + f, 'ny');
    for (const xx of [x0, x1 - f]) { mb.box(fm, xx, y, z0, xx + f, y + 0.16, z1, 'ny'); mb.box(fm, xx, y + H - 0.12, z0, xx + f, y + H, z1); }
    // pièces de coin (ouvertures ovales) : petits blocs gris foncés
    for (const xx of [x0 - 0.005, x1 - 0.175]) for (const zz of [z0 - 0.005, z1 - 0.155]) for (const yy of [y, y + H - 0.118]) mb.box('gris_fonce', xx, yy, zz, xx + 0.18, yy + 0.12, zz + 0.16);
  }
  // portes : barres et poignées (découpe) sur la face d'extrémité
  const xd = doors > 0 ? x1 + 0.012 : x0 - 0.012;
  const dz0 = doors > 0 ? z1 - 0.05 : z0 + 0.05, dz1 = doors > 0 ? z0 + 0.05 : z1 - 0.05;
  if (!o.reefer) mb.quad('decal', [xd, y + 0.12, dz0], [xd, y + 0.12, dz1], [xd, y + H - 0.1, dz1], [xd, y + H - 0.1, dz0], { region: 'barres_porte' });
  else {
    // groupe frigorifique en face avant (opposée aux portes) : grille + caisson
    const xr = doors > 0 ? x0 - 0.01 : x1 + 0.01;
    const za = doors > 0 ? z0 + 0.2 : z1 - 0.2, zb = doors > 0 ? z1 - 0.2 : z0 + 0.2;
    mb.quad('atlas', [xr, y + 0.3, za], [xr, y + 0.3, zb], [xr, y + H - 0.4, zb], [xr, y + H - 0.4, za], { region: 'calandre' });
    mb.quad('decal', [xd, y + 0.12, dz0], [xd, y + 0.12, dz1], [xd, y + H - 0.1, dz1], [xd, y + H - 0.1, dz0], { region: 'barres_porte' });
  }
  // logo sur les deux flancs
  if (o.logo) {
    const lw = Math.min(L * 0.62, 7), lh = lw / 8;
    const yl = y + H * 0.55;
    mb.quad('decal', [x - lw / 2, yl - lh / 2, z1 + 0.012], [x + lw / 2, yl - lh / 2, z1 + 0.012], [x + lw / 2, yl + lh / 2, z1 + 0.012], [x - lw / 2, yl + lh / 2, z1 + 0.012], { region: o.logo });
    mb.quad('decal', [x + lw / 2, yl - lh / 2, z0 - 0.012], [x - lw / 2, yl - lh / 2, z0 - 0.012], [x - lw / 2, yl + lh / 2, z0 - 0.012], [x + lw / 2, yl + lh / 2, z0 - 0.012], { region: o.logo });
  }
}

/** Petite fonction de hasard déterministe. */
export function rnd(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
