/**
 * Garde-corps et balcons ÉCONOMES du générateur procédural.
 *
 * Le garde-corps du kit dessine chaque barreau en boîte (8 triangles) avec un pas de 11 à 13 cm : sur des balcons
 * filants de 20 m et cinq étages, il représente à lui seul plus de la moitié des triangles d'un immeuble.
 * Ici : barreau = 2 quadrilatères (avant / arrière, 4 triangles), pas adapté à la longueur, et au LOD1 un panneau
 * plein remplace les barreaux (même silhouette à distance, 10 triangles au lieu de 2 000).
 *
 * Styles : `barreaux` (acier), `fer` (fonte, avec frise), `verre` (garde-corps vitré), `plein` (allège maçonnée),
 * `bois` (lisses horizontales).
 */
import { P, type Ctx, type Frame, type RailStyle, type V3 } from '../kit/index';

/** Pas des barreaux au LOD0 : resserré sur les petits garde-corps, plus large sur les balcons filants. */
function step(L: number, style: RailStyle): number {
  const base = style === 'bois' ? 0.22 : style === 'fer' ? 0.17 : 0.16;
  if (L <= 3) return base;
  if (L <= 8) return base * 1.4;
  return base * 1.9;
}

/**
 * Garde-corps rectiligne de A à B (pieds, coordonnées du modèle), hauteur `h`.
 * `plainMat` sert au style `plein`.
 */
export function railLine(ctx: Ctx, A: V3, B: V3, h: number, style: RailStyle = 'barreaux', o: { posts?: boolean; plainMat?: string; mat?: string } = {}): void {
  const { mb } = ctx;
  const dx = B[0] - A[0];
  const dz = B[2] - A[2];
  const L = Math.hypot(dx, dz);
  if (L < 0.08 || h < 0.1) return;
  const gm = o.mat ?? (style === 'bois' ? 'bois' : 'garde_corps');
  mb.push(A[0], A[1], A[2], Math.atan2(-dz, dx));
  if (style === 'plein') {
    mb.box(o.plainMat ?? 'dalle', 0, 0, -0.06, L, h, 0.06, 'ny');
    mb.pop();
    return;
  }
  const t = style === 'bois' ? 0.045 : 0.025;
  // main courante (toujours)
  mb.box(gm, 0, h - t * 2, -t, L, h, t, ctx.lod === 2 ? 'ny nx px' : 'ny');
  if (ctx.lod === 2) {
    if (style === 'verre') { const p = mb.lit; mb.lit = -1; mb.quad('verre_gc', [0, 0.06, 0], [L, 0.06, 0], [L, h - 0.05, 0], [0, h - 0.05, 0]); mb.lit = p; }
    else mb.quad(gm, [0, 0.05, 0], [L, 0.05, 0], [L, h * 0.55, 0], [0, h * 0.55, 0]);
    mb.pop();
    return;
  }
  if (style === 'verre') {
    const p = mb.lit;
    mb.lit = -1;
    mb.quad('verre_gc', [0.03, 0.07, 0], [L - 0.03, 0.07, 0], [L - 0.03, h - 0.06, 0], [0.03, h - 0.06, 0]);
    mb.quad('verre_gc', [L - 0.03, 0.07, 0], [0.03, 0.07, 0], [0.03, h - 0.06, 0], [L - 0.03, h - 0.06, 0]);
    mb.lit = p;
    if (ctx.lod === 0 && (o.posts ?? true)) for (const x of [t, L - t]) mb.box(gm, x - t, 0, -t, x + t, h, t, 'ny');
    mb.pop();
    return;
  }
  // lisse basse
  mb.box(gm, 0, 0.05, -0.016, L, 0.1, 0.016, 'ny py nx px');
  if (ctx.lod === 1) {
    // panneau plein translucide visuellement (deux faces) : même silhouette, coût constant
    mb.quad(gm, [0.02, 0.1, 0], [L - 0.02, 0.1, 0], [L - 0.02, h - t * 2, 0], [0.02, h - t * 2, 0]);
    mb.quad(gm, [L - 0.02, 0.1, 0], [0.02, 0.1, 0], [0.02, h - t * 2, 0], [L - 0.02, h - t * 2, 0]);
    mb.pop();
    return;
  }
  const sp = step(L, style);
  const n = Math.max(1, Math.round(L / sp));
  const bw = style === 'bois' ? 0.03 : 0.012;
  if (style === 'bois') {
    // lisses horizontales + montants espacés
    for (const v of [h * 0.38, h * 0.66]) mb.box(gm, 0, v - 0.03, -0.02, L, v + 0.03, 0.02, 'ny py nx px');
    for (let i = 1; i < Math.max(2, Math.round(L / 1.1)); i++) {
      const x = (L * i) / Math.max(2, Math.round(L / 1.1));
      mb.box(gm, x - 0.04, 0.08, -0.03, x + 0.04, h - t * 2, 0.03, 'ny py');
    }
  } else {
    for (let i = 1; i < n; i++) {
      const x = (L * i) / n;
      mb.quad(gm, [x - bw, 0.1, 0.012], [x + bw, 0.1, 0.012], [x + bw, h - t * 2, 0.012], [x - bw, h - t * 2, 0.012]);
      mb.quad(gm, [x + bw, 0.1, -0.012], [x - bw, 0.1, -0.012], [x - bw, h - t * 2, -0.012], [x + bw, h - t * 2, -0.012]);
    }
    if (style === 'fer') {
      // frise : bande ajourée sous la main courante
      const m = Math.max(1, Math.round(L / 0.7));
      for (let i = 0; i < m; i++) {
        const x = (L * (i + 0.5)) / m;
        mb.quad(gm, [x - 0.09, h - 0.3, 0.014], [x + 0.09, h - 0.3, 0.014], [x + 0.09, h - 0.2, 0.014], [x - 0.09, h - 0.2, 0.014]);
        mb.quad(gm, [x + 0.09, h - 0.3, -0.014], [x - 0.09, h - 0.3, -0.014], [x - 0.09, h - 0.2, -0.014], [x + 0.09, h - 0.2, -0.014]);
      }
    }
  }
  if (o.posts ?? true) for (const x of [t, L - t]) mb.box(gm, x - t, 0, -t, x + t, h, t, 'ny');
  mb.pop();
}

export interface BalconOpts {
  depth?: number;
  slab?: number;
  rail?: RailStyle;
  railH?: number;
  consoles?: boolean;
  slabMat?: string;
  sides?: 'both' | 'none' | 'left' | 'right';
  deck?: boolean;
}

/** Balcon en saillie (dalle + garde-corps économe) de u0 à u1 sur la façade `f`, sol au niveau v. */
export function balcon(ctx: Ctx, f: Frame, u0: number, u1: number, v: number, o: BalconOpts = {}): void {
  const D = o.depth ?? 1.1;
  const T = o.slab ?? 0.16;
  const sm = o.slabMat ?? 'dalle';
  const { mb } = ctx;
  // dalle (dessus, dessous, chants)
  const q = (a: V3, b: V3, c: V3, d: V3): void => mb.quad(sm, a, b, c, d);
  const p = (u: number, vv: number, d: number): V3 => P(f, u, vv, d);
  q(p(u0, v, 0), p(u1, v, 0), p(u1, v, D), p(u0, v, D));
  q(p(u0, v - T, D), p(u1, v - T, D), p(u1, v - T, 0), p(u0, v - T, 0));
  q(p(u0, v - T, D), p(u0, v, D), p(u1, v, D), p(u1, v - T, D));
  if (o.sides !== 'none') {
    q(p(u1, v - T, D), p(u1, v, D), p(u1, v, 0), p(u1, v - T, 0));
    q(p(u0, v - T, 0), p(u0, v, 0), p(u0, v, D), p(u0, v - T, D));
  }
  const rs = o.rail ?? 'barreaux';
  const h = o.railH ?? 1.0;
  const inset = rs === 'plein' ? 0.06 : 0.035;
  railLine(ctx, p(u0 + inset, v, D - inset), p(u1 - inset, v, D - inset), h, rs, { plainMat: sm });
  const sides = o.sides ?? 'both';
  if (sides === 'both' || sides === 'left') railLine(ctx, p(u0 + inset, v, 0.02), p(u0 + inset, v, D - inset), h, rs, { posts: false, plainMat: sm });
  if (sides === 'both' || sides === 'right') railLine(ctx, p(u1 - inset, v, D - inset), p(u1 - inset, v, 0.02), h, rs, { posts: false, plainMat: sm });
  if (o.consoles && ctx.lod === 0) {
    const n = Math.max(2, Math.round((u1 - u0) / 2.2) + 1);
    for (let i = 0; i < n; i++) consoleEquerre(ctx, f, u0 + 0.2 + ((u1 - u0 - 0.4) * i) / (n - 1), v - T, D);
  }
}

/** Console en équerre sous une dalle de balcon (profil en S simplifié, deux joues + dessous). */
export function consoleEquerre(ctx: Ctx, f: Frame, uc: number, v: number, depth: number): void {
  const { mb } = ctx;
  const prof: [number, number][] = [[0.02, v], [depth * 0.72, v], [depth * 0.42, v - 0.2], [0.16, v - 0.44], [0.02, v - 0.44]];
  const side = (s: number): V3[] => prof.map(([d, y]) => P(f, uc + s * 0.06, y, d));
  mb.polyFacing('encadrement', side(-1), [-f.u[0], 0, -f.u[2]]);
  mb.polyFacing('encadrement', side(1), [f.u[0], 0, f.u[2]]);
  for (let i = 1; i < prof.length - 1; i++) {
    const a = prof[i]!, b = prof[i + 1]!;
    mb.polyFacing('encadrement', [P(f, uc - 0.06, a[1], a[0]), P(f, uc + 0.06, a[1], a[0]), P(f, uc + 0.06, b[1], b[0]), P(f, uc - 0.06, b[1], b[0])], [0, -0.4, f.n[2] || f.n[0]]);
  }
}
