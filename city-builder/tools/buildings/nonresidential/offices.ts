/**
 * BUREAUX et GRATTE-CIEL : immeuble de bureaux R+6 à brise-soleil, tour vitrée à mur-rideau,
 * gratte-ciel Art déco à étages en retrait, tour iconique torsadée à couronnement.
 */
import {
  fbox, flatRoof, mast, rectAt, rooftopUnit, stairHouse, subFrame, volume, wall,
  type BuildingDef, type Ctx, type Frame,
} from '../kit/index';
import {
  bench, curtainWall, edgeFrame, fpf, glass, lampPost, lettering, litSeed, M, npPalette, planter, polyFrames, regularPoly, ribbonFloors, shrub, wallStrip,
  slab, spire, P,
} from './parts';

const SRC = 'tools/buildings/nonresidential/offices.ts';

/** Prisme polygonal plein (toit plat) : faces latérales optionnelles, dessus. */
function prism(ctx: Ctx, mat: string, poly: [number, number][], y0: number, y1: number, sides = true, top: string | null = mat): void {
  ctx.mb.extrude(mat, poly, y0, y1, { top, sides });
}

/** Polygone XZ décalé (agrandi) de e (polygone convexe). */
function inflate(poly: [number, number][], e: number): [number, number][] {
  const n = poly.length;
  let cx = 0, cz = 0;
  for (const [x, z] of poly) { cx += x / n; cz += z / n; }
  return poly.map(([x, z]) => { const dx = x - cx, dz = z - cz; const l = Math.hypot(dx, dz) || 1; return [x + (dx / l) * e, z + (dz / l) * e]; });
}

/** Rectangle à angles abattus (octogone irrégulier), ordre S→E→N→W. */
function chamferRect(x0: number, z0: number, x1: number, z1: number, c: number): [number, number][] {
  return [[x0 + c, z1], [x1 - c, z1], [x1, z1 - c], [x1, z0 + c], [x1 - c, z0], [x0 + c, z0], [x0, z0 + c], [x0, z1 - c]];
}

/**
 * Façade « à piles » (Art déco) : trumeaux de pierre continus, baies en retrait superposées
 * séparées par des allèges métalliques. Mur percé de bandes verticales.
 */
function pierFacade(ctx: Ctx, f: Frame, o: { v0: number; v1: number; cols: number; floorH: number; margin?: number; ratio?: number; wallMat?: string; spandrelMat?: string; seed?: number }): void {
  const wm = o.wallMat ?? 'facade';
  const sm = o.spandrelMat ?? 'meneau';
  const m = o.margin ?? 1.0;
  const cw = (f.w - 2 * m) / o.cols;
  const ww = cw * (o.ratio ?? 0.55);
  const strips = Array.from({ length: o.cols }, (_, i) => ({ u0: m + i * cw + (cw - ww) / 2, u1: m + i * cw + (cw + ww) / 2, v0: o.v0 + 0.9, v1: o.v1 - 0.6 }));
  wall(ctx, wm, f, ctx.lod === 2 ? [] : strips, 0, f.w, o.v0, o.v1);
  const nF = Math.max(1, Math.round((o.v1 - o.v0 - 1.5) / o.floorH));
  const fh = (o.v1 - 0.6 - (o.v0 + 0.9)) / nF;
  const R = ctx.lod === 2 ? -0.04 : 0.3;
  const seed = o.seed ?? Math.round(f.o[0] * 3 + f.o[2] * 7 + f.o[1]);
  strips.forEach((s, i) => {
    if (ctx.lod < 2) {
      fq4(ctx, wm, f, s, R);
    }
    if (ctx.lod === 2) {
      glass(ctx, f, s.u0, s.u1, s.v0, s.v1, 0.04, litSeed(seed, i, 99));
      return;
    }
    for (let k = 0; k < nF; k++) {
      const va = s.v0 + k * fh;
      glass(ctx, f, s.u0, s.u1, va + fh * 0.32, va + fh, -R, litSeed(seed, i, k));
      fpf(ctx, sm, f, [[s.u0, va, -R + 0.02], [s.u1, va, -R + 0.02], [s.u1, va + fh * 0.32, -R + 0.02], [s.u0, va + fh * 0.32, -R + 0.02]], [0, 0, 1]);
    }
    // meneau central continu (un seul élément par bande)
    if (ctx.lod === 0) fbox(ctx, sm, f, (s.u0 + s.u1) / 2 - 0.04, (s.u0 + s.u1) / 2 + 0.04, s.v0, s.v1, -R, -R + 0.08, 'back top bottom');
  });
}

/** Tableaux d'une bande verticale en retrait R. */
function fq4(ctx: Ctx, mat: string, f: Frame, s: { u0: number; u1: number; v0: number; v1: number }, R: number): void {
  fpf(ctx, mat, f, [[s.u0, s.v0, 0], [s.u0, s.v0, -R], [s.u0, s.v1, -R], [s.u0, s.v1, 0]], [1, 0, 0]);
  fpf(ctx, mat, f, [[s.u1, s.v0, -R], [s.u1, s.v0, 0], [s.u1, s.v1, 0], [s.u1, s.v1, -R]], [-1, 0, 0]);
  fpf(ctx, mat, f, [[s.u0, s.v1, -R], [s.u1, s.v1, -R], [s.u1, s.v1, 0], [s.u0, s.v1, 0]], [0, -1, 0]);
  fpf(ctx, mat, f, [[s.u0, s.v0, 0], [s.u1, s.v0, 0], [s.u1, s.v0, -R], [s.u0, s.v0, -R]], [0, 1, 0]);
}

/* ------------------------------------------------------------------ */
/* 6. Immeuble de bureaux R+6 à brise-soleil                            */
/* ------------------------------------------------------------------ */
export const bureaux: BuildingDef = {
  id: 'bureaux_brise_soleil',
  nameFr: 'Immeuble de bureaux à brise-soleil',
  category: 'commercial',
  footprint: { tilesX: 3, tilesZ: 2 },
  cost: 1150000,
  upkeepPerMonth: 1500,
  residents: 0,
  jobs: 240,
  density: 'forte',
  style: 'tertiaire_contemporain',
  tags: ['bureaux', 'tertiaire', 'brise_soleil', 'attique', 'service:emplois_tertiaires'],
  source: `${SRC}#bureaux`,
  lodDistances: [200, 800],
  palette: npPalette({
    facade: M('beton_facade', '#f1eee8'),
    facade_b: M('bardage_bois', '#ffffff'),
    soubassement: M('pierre_taille', '#8f8a82'),
    encadrement: M('beton_facade', '#e9e6df'),
    meneau: M('metal_rideau', '#34393d', { metalness: 1, roughness: 0.4 }),
    lame: M('bardage_bois', '#e9d2b4'),
    dalle: M('beton_facade', '#f4f2ee'),
    enseigne: M('enduit_peint', '#20303c'),
    lettres: M('enduit_blanc', '#f6f6f2', { metalness: 0.5, roughness: 0.35 }),
    verre_mr: { kind: 'glass', color: '#4f6d7c' },
  }),
  variants: [
    { id: 'origine', nameFr: 'Béton clair, lames bois' },
    { id: 'sombre', nameFr: 'Béton anthracite, lames claires', materialOverrides: { facade: { textureSet: 'panneaux_facade_sombres', color: '#ffffff' }, lame: { color: '#f2e8d8' } } },
    { id: 'terre', nameFr: 'Brique, lames aluminium', materialOverrides: { facade: { textureSet: 'brique_parement', color: '#ffffff' }, lame: { textureSet: 'metal_rideau', color: '#c8ccd0' } } },
    { id: 'basse', nameFr: 'Version R+4', heightScale: 0.78 },
  ],
  build(ctx: Ctx): void {
    const x0 = -11.6, x1 = 11.6, z0 = -7.6, z1 = 4.4;
    const g = 4.4, fh = 3.6, nF = 5;
    const top = g + nF * fh;
    const W = x1 - x0, D = z1 - z0;
    // rez-de-chaussée : socle vitré en retrait sous l'étage (portique)
    const r = 1.6;
    const Gs = volume(ctx, { x0: x0 + 0.8, x1: x1 - 0.8, z0: z0 + 0.8, z1: z1 - r, h: g, wallMat: 'soubassement', sides: { S: [{ kind: 'blind', r: { u0: 0.4, u1: W - 2.0, v0: 0, v1: g - 0.5 } }], N: [{ kind: 'door', r: rectAt(5, 1.0, 0.05, 2.3), o: { style: 'moderne' } }, { kind: 'door', r: rectAt(15, 2.6, 0.05, 3.2), o: { style: 'moderne' } }], E: [{ kind: 'blind', r: { u0: 0.4, u1: D - r - 1.2, v0: 0, v1: g - 0.5 } }], W: [{ kind: 'blind', r: { u0: 0.8, u1: D - r - 1.2, v0: 0, v1: g - 0.5 } }] } });
    curtainWall(ctx, Gs.S, { u0: 0.4, u1: W - 2.0, v0: 0, v1: g - 0.5, cols: 14, floorH: g - 0.5, mullionMat: 'meneau', fin: 0.1 });
    curtainWall(ctx, Gs.E, { u0: 0.4, u1: D - r - 1.2, v0: 0, v1: g - 0.5, cols: 5, floorH: g - 0.5 });
    curtainWall(ctx, Gs.W, { u0: 0.8, u1: D - r - 1.2, v0: 0, v1: g - 0.5, cols: 5, floorH: g - 0.5 });
    // poteaux du portique
    for (let i = 0; i <= 6; i++) {
      const x = x0 + 0.6 + (i * (W - 1.2)) / 6;
      ctx.mb.box('dalle', x - 0.25, 0, z1 - 0.75, x + 0.25, g, z1 - 0.25, 'ny');
    }
    // sous-face de l'étage
    ctx.mb.quad('dalle', [x0, g, z1 - r + 0.2], [x1, g, z1 - r + 0.2], [x1, g, z1], [x0, g, z1]);
    ctx.mb.polyFacing('dalle', [[x0, g, z1], [x1, g, z1], [x1, g, z0], [x0, g, z0]], [0, -1, 0]);
    // étages : bandeaux de fenêtres filantes
    const sides: [number, number, number, number][] = [[x0, z1, x1, z1], [x1, z1, x1, z0], [x1, z0, x0, z0], [x0, z0, x0, z1]];
    sides.forEach(([ax, az, bx, bz], i) => {
      const f = edgeFrame(ax, az, bx, bz, 0, top);
      ribbonFloors(ctx, f, 'facade', { v0: g, floors: nF, floorH: fh, sill: 1.0, winH: 2.25, cols: Math.round(f.w / 1.35), margin: 0.5, seed: i * 31 });
      wallStrip(ctx, 'facade', f, top, top + 1.1);
      // brise-soleil verticaux en lames de bois (façades S et W)
      if (i === 0 || i === 3) {
        const n = Math.round(f.w / 1.35);
        const step = ctx.lod === 0 ? 1 : ctx.lod === 1 ? 2 : n;
        for (let k = 0; k <= n; k += step) {
          const u = 0.5 + (k * (f.w - 1.0)) / n;
          fbox(ctx, 'lame', f, u - 0.06, u + 0.06, g + 0.1, top - 0.1, 0.05, 0.75, ctx.lod === 2 ? 'back top bottom left' : 'back');
        }
        // bandeaux horizontaux porteurs
        for (let k = 0; k <= nF; k++) fbox(ctx, 'dalle', f, -0.1, f.w + 0.1, g + k * fh - 0.12, g + k * fh + 0.08, 0, 0.85, ctx.lod === 2 ? 'back bottom' : 'back');
      }
    });
    // attique en retrait (R+6) entièrement vitré + terrasse et pergola
    const ax0 = x0 + 2.2, ax1 = x1 - 5.2, az0 = z0 + 1.2, az1 = z1 - 3.0;
    flatRoof(ctx, { x0, x1, z0, z1, y: top, parapet: top + 1.1, t: 0.25, copingMat: 'dalle' });
    const A = volume(ctx, { x0: ax0, x1: ax1, z0: az0, z1: az1, y0: top, h: 3.6, wallMat: 'facade', sides: { S: [{ kind: 'blind', r: { u0: 0.3, u1: ax1 - ax0 - 0.3, v0: 0, v1: 3.0 } }], E: [{ kind: 'blind', r: { u0: 0.3, u1: az1 - az0 - 0.3, v0: 0, v1: 3.0 } }] } });
    curtainWall(ctx, A.S, { u0: 0.3, u1: ax1 - ax0 - 0.3, v0: 0, v1: 3.0, cols: 11, floorH: 3.0 });
    curtainWall(ctx, A.E, { u0: 0.3, u1: az1 - az0 - 0.3, v0: 0, v1: 3.0, cols: 4, floorH: 3.0 });
    flatRoof(ctx, { x0: ax0 - 0.6, x1: ax1 + 0.6, z0: az0 - 0.6, z1: az1 + 0.6, y: top + 3.6, parapet: top + 3.95, t: 0.15, copingMat: 'dalle' });
    // pergola de terrasse
    if (ctx.lod < 2) {
      for (const [x, z] of [[ax1 + 1.0, az1 + 0.4], [x1 - 0.8, az1 + 0.4], [ax1 + 1.0, az0 + 1.0], [x1 - 0.8, az0 + 1.0]] as const) ctx.mb.box('meneau', x - 0.08, top, z - 0.08, x + 0.08, top + 3.0, z + 0.08, 'ny');
      const n = ctx.lod === 0 ? 10 : 4;
      for (let k = 0; k <= n; k++) { const z = az0 + 1.0 + (k * (az1 - az0 - 0.6)) / n; ctx.mb.box('lame', ax1 + 0.9, top + 3.0, z - 0.05, x1 - 0.7, top + 3.15, z + 0.05); }
      planter(ctx, ax1 + 1.2, az1 + 1.2, x1 - 0.6, az1 + 2.0, top, 0.5);
    }
    // enseigne du siège sur l'attique + numéro sur le socle
    lettering(ctx, 'lettres', A.S, 'HORIZON', A.S.w / 2, 3.15, 0.38, 0.0, 0.05);
    lettering(ctx, 'enseigne', subFrame(Gs.S, 0, 0, 0.12, Gs.S.w, 4), '12', Gs.S.w - 1.0, 1.0, 1.4, 0.0, 0.06);
    rooftopUnit(ctx, -2, top + 3.6, -3.5, 2.6, 1.4, 1.2);
    rooftopUnit(ctx, 3.6, top, -5.2, 2.4, 1.2, 1.1);
    stairHouse(ctx, -9.4, -6.6, -6.6, -4.4, top, 2.8, 'facade');
    // parvis
    slab(ctx, 'dallage', x0, z1 - r, x1, z1 + 3.4, 0, 0.1);
    for (const x of [-8.5, 0, 8.5]) { planter(ctx, x - 1.4, z1 + 1.9, x + 1.4, z1 + 3.1, 0.1, 0.5); }
    bench(ctx, -4.3, 0.1, z1 + 2.6, 0, 1.8);
    bench(ctx, 4.3, 0.1, z1 + 2.6, 0, 1.8);
    void D;
  },
};

/* ------------------------------------------------------------------ */
/* 7. Tour vitrée à mur-rideau (R+25)                                   */
/* ------------------------------------------------------------------ */
export const tourVitree: BuildingDef = {
  id: 'tour_vitree_mur_rideau',
  nameFr: 'Tour de bureaux vitrée',
  category: 'skyscraper',
  footprint: { tilesX: 3, tilesZ: 3 },
  cost: 6800000,
  upkeepPerMonth: 7200,
  residents: 0,
  jobs: 1400,
  density: 'tres_forte',
  style: 'international',
  tags: ['gratte_ciel', 'bureaux', 'mur_rideau', 'socle', 'service:emplois_tertiaires'],
  source: `${SRC}#tourVitree`,
  lodDistances: [280, 1200],
  palette: npPalette({
    facade: M('pierre_taille', '#bdb8b0'),
    meneau: M('metal_rideau', '#9aa3aa', { metalness: 1, roughness: 0.35 }),
    allege: M('panneaux_facade_sombres', '#5c6670'),
    dalle: M('beton_facade', '#d8d6d2'),
    lettres: M('enduit_blanc', '#f2f2ee', { metalness: 0.6, roughness: 0.3 }),
    verre_mr: { kind: 'glass', color: '#3f6680' },
  }),
  variants: [
    { id: 'origine', nameFr: 'Verre bleu, aluminium clair' },
    { id: 'bronze', nameFr: 'Verre bronze, montants sombres', materialOverrides: { verre_mr: { color: '#6e5a45' }, meneau: { color: '#3a3532' }, allege: { color: '#4a3c33' } } },
    { id: 'vert', nameFr: 'Verre vert d’eau', materialOverrides: { verre_mr: { color: '#4f7a72' }, allege: { color: '#6d7c78' } } },
    { id: 'haute', nameFr: 'Verre bleu, R+33', heightScale: 1.3 },
  ],
  build(ctx: Ctx): void {
    // socle (2 niveaux) en pierre + hall vitré
    const P0 = 11.6;
    const ph = 9.0;
    const S = volume(ctx, {
      x0: -P0, x1: P0, z0: -P0, z1: P0 - 3.4, h: ph, wallMat: 'facade',
      sides: {
        S: [{ kind: 'blind', r: { u0: 3.0, u1: 2 * P0 - 3.0, v0: 0, v1: ph - 1.2 } }],
        E: [{ kind: 'blind', r: { u0: 2, u1: 2 * P0 - 4, v0: 0.6, v1: ph - 1.2 } }],
        W: [{ kind: 'blind', r: { u0: 2, u1: 2 * P0 - 4, v0: 0.6, v1: ph - 1.2 } }],
        N: [{ kind: 'door', r: rectAt(6, 1.0, 0.05, 2.3), o: { style: 'moderne' } }, { kind: 'door', r: rectAt(15, 3.0, 0.05, 3.6), o: { style: 'moderne' } }],
      },
      plinth: { h: 0.5, d: 0.03, mat: 'dalle' },
    });
    curtainWall(ctx, S.S, { u0: 3.0, u1: 2 * P0 - 3.0, v0: 0, v1: ph - 1.2, cols: 9, floorH: (ph - 1.2) / 2, mullionMat: 'meneau', fin: 0.15 });
    curtainWall(ctx, S.E, { u0: 2, u1: 2 * P0 - 4, v0: 0.6, v1: ph - 1.2, cols: 8, floorH: (ph - 1.8) / 2 });
    curtainWall(ctx, S.W, { u0: 2, u1: 2 * P0 - 4, v0: 0.6, v1: ph - 1.2, cols: 8, floorH: (ph - 1.8) / 2 });
    flatRoof(ctx, { x0: -P0, x1: P0, z0: -P0, z1: P0 - 3.4, y: ph, parapet: ph + 0.9, t: 0.3, copingMat: 'meneau' });
    // auvent d'entrée
    fbox(ctx, 'meneau', S.S, 5.5, 2 * P0 - 5.5, ph - 1.6, ph - 1.3, 0, 3.0, '');
    lettering(ctx, 'lettres', S.S, 'TOUR ALTAIR', P0, ph - 1.05, 0.7, 0.0, 0.06);
    // fût : plan carré à angles abattus
    const T = 9.0, c = 2.0;
    const fl = 3.6, nF = 26;
    const y0 = ph, y1 = ph + nF * fl;
    const poly = chamferRect(-T, -T, T, T, c);
    const frames = polyFrames(poly, y0, y1 - y0);
    frames.forEach((f, i) => {
      const cols = Math.max(1, Math.round(f.w / 1.5));
      curtainWall(ctx, f, { cols, floorH: fl, spandrel: 1.0, spandrelMat: 'allege', mullionMat: 'meneau', fin: 0.12, finEvery: i % 2 === 0 ? 2 : 0, finDepth: 0.4, seed: i * 101 });
    });
    // étages techniques (bandes de ventelles) tous les 9 niveaux
    for (const k of [9, 18]) {
      const v = y0 + k * fl;
      for (const f of polyFrames(inflate(poly, 0.06), v, fl)) {
        fbox(ctx, 'allege', f, 0, f.w, 0, fl, 0, 0.05, 'back');
        if (ctx.lod === 0) for (let j = 1; j < 8; j++) fbox(ctx, 'meneau', f, 0, f.w, (j * fl) / 8 - 0.04, (j * fl) / 8 + 0.04, 0.05, 0.2, 'back left right');
      }
    }
    // couronnement : écran vitré dépassant de la toiture + édicule technique
    const crownH = 6.0;
    prism(ctx, 'dalle', inflate(poly, -0.3), y1 - 0.2, y1, false, 'terrasse');
    for (const f of polyFrames(poly, y1, crownH)) {
      glass(ctx, f, 0, f.w, 0, crownH, 0, -1, 'verre_mr');
      if (ctx.lod < 2) {
        fbox(ctx, 'meneau', f, 0, f.w, crownH - 0.2, crownH, -0.2, 0.12, '');
        const n = Math.max(1, Math.round(f.w / 3));
        for (let j = 0; j <= n; j++) fbox(ctx, 'meneau', f, (j * f.w) / n - 0.06, (j * f.w) / n + 0.06, 0, crownH, -0.3, 0.1, 'back');
      }
    }
    // face intérieure de l'écran (double face pour la vue plongeante)
    for (const f of polyFrames(poly, y1, crownH)) fpf(ctx, 'allege', f, [[0, 0, -0.25], [f.w, 0, -0.25], [f.w, crownH, -0.25], [0, crownH, -0.25]], [0, 0, -1]);
    rooftopUnit(ctx, -3, y1, -2, 4.0, 2.4, 2.4);
    rooftopUnit(ctx, 3.5, y1, 2.5, 3.0, 2.0, 2.0);
    ctx.mb.box('allege', -2.5, y1, 1.5, 0.5, y1 + 4.5, 5, 'ny');
    mast(ctx, 0, y1 + 4.5, 3.2, 9);
    // parvis
    slab(ctx, "dallage", -P0, P0 - 3.4, P0, P0, 0, 0.1);
    for (const x of [-8, 8]) shrub(ctx, x, 0.1, P0 - 1.0, 0.8);
    lampPost(ctx, -4.5, 0.1, P0 - 0.6, 4.5, [0, 0, -1]);
    lampPost(ctx, 4.5, 0.1, P0 - 0.6, 4.5, [0, 0, -1]);
  },
};

/* ------------------------------------------------------------------ */
/* 8. Gratte-ciel Art déco à étages en retrait                          */
/* ------------------------------------------------------------------ */
export const gratteCielRetraits: BuildingDef = {
  id: 'gratte_ciel_retraits',
  nameFr: 'Gratte-ciel à étages en retrait',
  category: 'skyscraper',
  footprint: { tilesX: 4, tilesZ: 4 },
  cost: 9800000,
  upkeepPerMonth: 9800,
  residents: 0,
  jobs: 2100,
  density: 'tres_forte',
  style: 'art_deco',
  tags: ['gratte_ciel', 'bureaux', 'art_deco', 'retraits', 'fleche', 'service:emplois_tertiaires'],
  source: `${SRC}#gratteCielRetraits`,
  lodDistances: [320, 1400],
  palette: npPalette({
    facade: M('pierre_taille', '#e6dccb'),
    soubassement: M('pierre_taille', '#cfc6b6'),
    encadrement: M('pierre_taille', '#f3ecdf'),
    meneau: M('metal_rideau', '#3c3a36', { metalness: 1, roughness: 0.45 }),
    ornement: M('metal_rideau', '#c9a45a', { metalness: 1, roughness: 0.3 }),
    acier: M('metal_rideau', '#d8dcde', { metalness: 1, roughness: 0.2 }),
    terrasse: M('terrain_gravier', '#a8a39a'),
    lettres: M('enduit_blanc', '#d9b56a', { metalness: 0.9, roughness: 0.3 }),
    verre: { kind: 'glass', color: '#3b4d5a' },
  }),
  variants: [
    { id: 'origine', nameFr: 'Pierre claire, ornements dorés' },
    { id: 'brique', nameFr: 'Brique et pierre', materialOverrides: { facade: { textureSet: 'brique_orange', color: '#ffffff' } } },
    { id: 'gris', nameFr: 'Granit gris, ornements argent', materialOverrides: { facade: { textureSet: 'beton_facade', color: '#c9c9c6' }, ornement: { color: '#d4d8db' } } },
  ],
  build(ctx: Ctx): void {
    const tiers: { h: number; hw: number; cols: number }[] = [
      { h: 32, hw: 14.8, cols: 10 },
      { h: 42, hw: 12.2, cols: 8 },
      { h: 36, hw: 9.2, cols: 6 },
      { h: 22, hw: 6.4, cols: 4 },
    ];
    let y = 0;
    tiers.forEach((t, ti) => {
      const hw = t.hw;
      const sideFr: Frame[] = [];
      const pts: [number, number, number, number][] = [[-hw, hw, hw, hw], [hw, hw, hw, -hw], [hw, -hw, -hw, -hw], [-hw, -hw, -hw, hw]];
      pts.forEach(([ax, az, bx, bz], i) => {
        const f = edgeFrame(ax, az, bx, bz, y, t.h);
        sideFr.push(f);
        if (ti === 0) {
          // socle : grandes arcades d'entrée en pierre rustique + étages à piles
          const ent = { u0: f.w / 2 - 3.2, u1: f.w / 2 + 3.2, v0: 0, v1: 9.5 };
          const hasEnt = i === 0;
          wall(ctx, 'soubassement', f, ctx.lod === 2 || !hasEnt ? [] : [ent], 0, f.w, 0, 10.4);
          if (hasEnt) {
            glass(ctx, f, ent.u0, ent.u1, ent.v0, ent.v1, ctx.lod === 2 ? 0.04 : -0.6, 2);
            if (ctx.lod < 2) {
              fq4(ctx, 'soubassement', f, ent, 0.6);
              for (let k = 1; k < 4; k++) fbox(ctx, 'ornement', f, ent.u0 + (k * (ent.u1 - ent.u0)) / 4 - 0.06, ent.u0 + (k * (ent.u1 - ent.u0)) / 4 + 0.06, 0, ent.v1, -0.6, -0.5, 'back');
              fbox(ctx, 'ornement', f, ent.u0, ent.u1, 3.3, 3.5, -0.6, -0.48, 'back');
              // marquise dorée
              fbox(ctx, 'ornement', f, ent.u0 - 0.6, ent.u1 + 0.6, 3.6, 4.0, 0, 2.2, '');
            }
            lettering(ctx, 'lettres', f, 'MERIDIEN', f.w / 2, 7.6, 1.0, 0.04, 0.06);
          } else if (ctx.lod < 2) {
            for (let k = 0; k < 5; k++) {
              const u = 3 + k * ((f.w - 6) / 4);
              fbox(ctx, 'meneau', f, u - 1.0, u + 1.0, 1.0, 8.0, 0, 0.04, 'back');
              glass(ctx, f, u - 0.9, u + 0.9, 1.1, 7.9, 0.045, litSeed(i, k, 5));
            }
          }
          fbox(ctx, 'encadrement', f, -0.25, f.w + 0.25, 10.4, 11.0, 0, 0.25, 'back');
          pierFacade(ctx, f, { v0: 11.0, v1: t.h, cols: t.cols, floorH: 3.7, margin: 1.4, seed: i * 17 + ti });
        } else {
          pierFacade(ctx, f, { v0: 0, v1: t.h, cols: t.cols, floorH: 3.7, margin: 1.2, seed: i * 17 + ti });
        }
        // chaînes d'angle saillantes (piles d'angle)
        if (ctx.lod < 2) {
          fbox(ctx, 'facade', f, -0.3, 0.9, ti === 0 ? 11 : 0, t.h + 1.2, 0, 0.3, 'back');
          fbox(ctx, 'facade', f, f.w - 0.9, f.w + 0.3, ti === 0 ? 11 : 0, t.h + 1.2, 0, 0.3, 'back');
        }
        // bandeau d'attique orné
        fbox(ctx, 'encadrement', f, -0.3, f.w + 0.3, t.h - 0.2, t.h + 1.2, 0, 0.2, 'back');
        if (ctx.lod === 0) for (let k = 0; k < Math.floor(f.w / 1.6); k++) {
          const u = 0.8 + k * 1.6;
          fpf(ctx, 'ornement', f, [[u, t.h + 0.1, 0.22], [u + 0.6, t.h + 0.1, 0.22], [u + 0.3, t.h + 0.9, 0.22]], [0, 0, 1]);
        }
      });
      // terrasse du retrait + acrotère
      const nh = tiers[ti + 1]?.hw ?? 0;
      flatRoof(ctx, { x0: -hw, x1: hw, z0: -hw, z1: hw, y: y + t.h, parapet: y + t.h + 1.2, t: 0.3, copingMat: 'encadrement' });
      if (nh > 0 && ctx.lod < 2) {
        // pinacles aux angles du retrait
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          const px = sx * (hw - 0.9), pz = sz * (hw - 0.9);
          ctx.mb.box('encadrement', px - 0.6, y + t.h + 1.2, pz - 0.6, px + 0.6, y + t.h + 3.4, pz + 0.6, 'ny');
          spire(ctx, 'ornement', px, y + t.h + 3.4, pz, 0.6 * Math.SQRT2, 2.2, 4);
        }
      }
      void sideFr;
      y += t.h;
    });
    // couronnement : gradins + flèche
    const steps: [number, number][] = [[5.0, 3.0], [3.8, 3.0], [2.6, 3.5], [1.6, 4.0]];
    for (const [hw, h] of steps) {
      const fr = [edgeFrame(-hw, hw, hw, hw, y, h), edgeFrame(hw, hw, hw, -hw, y, h), edgeFrame(hw, -hw, -hw, -hw, y, h), edgeFrame(-hw, -hw, -hw, hw, y, h)];
      for (const f of fr) {
        fpf(ctx, 'facade', f, [[0, 0, 0], [f.w, 0, 0], [f.w, h, 0], [0, h, 0]], [0, 0, 1]);
        if (ctx.lod < 2) {
          const n = Math.max(2, Math.round(f.w / 1.1));
          for (let k = 1; k < n; k++) {
            const u = (k * f.w) / n;
            fbox(ctx, 'ornement', f, u - 0.12, u + 0.12, 0.3, h - 0.2, 0, 0.18, 'back');
            if (ctx.lod === 0) glass(ctx, f, u - 0.08, u + 0.08, 0.5, h - 0.4, 0.185, 2);
          }
        }
      }
      ctx.mb.box('encadrement', -hw - 0.2, y + h, -hw - 0.2, hw + 0.2, y + h + 0.3, hw + 0.2, '');
      y += h + 0.3;
    }
    spire(ctx, 'acier', 0, y, 0, 1.4, 6, 8);
    ctx.mb.cylinder('acier', 0, y + 5, 0, 0.3, 18, ctx.lod === 0 ? 8 : 5, true, 0.04);
  },
};

/* ------------------------------------------------------------------ */
/* 9. Tour iconique torsadée à couronnement                             */
/* ------------------------------------------------------------------ */
export const tourIconique: BuildingDef = {
  id: 'tour_iconique_couronne',
  nameFr: 'Tour iconique torsadée à couronne',
  category: 'skyscraper',
  footprint: { tilesX: 3, tilesZ: 3 },
  cost: 14500000,
  upkeepPerMonth: 12500,
  residents: 0,
  jobs: 2600,
  density: 'tres_forte',
  style: 'contemporain_iconique',
  tags: ['gratte_ciel', 'bureaux', 'tour_torsadee', 'couronne', 'monument', 'service:emplois_tertiaires', 'attractivite:3'],
  source: `${SRC}#tourIconique`,
  lodDistances: [350, 1600],
  palette: npPalette({
    facade: M('beton_facade', '#ecebe7'),
    meneau: M('metal_rideau', '#d6dbde', { metalness: 1, roughness: 0.25 }),
    nez: M('bardage_blanc', '#f4f4f2', { roughness: 0.5 }),
    acier: M('metal_rideau', '#e3e6e8', { metalness: 1, roughness: 0.2 }),
    lettres: M('enduit_blanc', '#ffffff', { metalness: 0.4, roughness: 0.3 }),
    verre_mr: { kind: 'glass', color: '#3f6f8f' },
    verre_couronne: { kind: 'glass', color: '#8fb6cc' },
  }),
  variants: [
    { id: 'origine', nameFr: 'Verre bleu, nez de dalle blancs' },
    { id: 'or', nameFr: 'Verre doré, nez de dalle champagne', materialOverrides: { verre_mr: { color: '#8a7350' }, nez: { color: '#d8c39a' }, verre_couronne: { color: '#e0c98f' } } },
    { id: 'nuit', nameFr: 'Verre sombre, nez de dalle anthracite', materialOverrides: { verre_mr: { color: '#2c3a46' }, nez: { color: '#3a3f44' } } },
  ],
  build(ctx: Ctx): void {
    // socle : hall octogonal vitré + parvis circulaire
    const n = 8;
    const baseR = 11.4;
    slab(ctx, 'dallage', -12.0, -12.0, 12.0, 12.0, 0, 0.1);
    const lobbyPoly = regularPoly(n, 10.4, 0);
    for (const [i, f] of polyFrames(lobbyPoly, 0.1, 7.5).entries()) {
      curtainWall(ctx, f, { cols: 3, floorH: 7.4, mullionMat: 'meneau', fin: 0.18, seed: 900 + i });
    }
    prism(ctx, 'nez', inflate(lobbyPoly, 0.6), 7.6, 8.4, true, 'terrasse');
    lettering(ctx, 'lettres', polyFrames(inflate(lobbyPoly, 0.6), 7.6, 0.8)[0]!, 'ZENITH', polyFrames(inflate(lobbyPoly, 0.6), 7.6, 0.8)[0]!.w / 2, 0.15, 0.5, 0.0, 0.05);
    // fût torsadé : plan carré à grands pans coupés, chaque étage tourne de 1,9° ; léger fruit
    const fl = 3.9, nF = 44;
    const y0 = 8.4;
    const twist = (1.9 * Math.PI) / 180;
    const shape = (R: number, rot: number): [number, number][] => {
      const c = R * 0.42;
      const sq = chamferRect(-R, -R, R, R, c);
      const cs = Math.cos(rot), sn = Math.sin(rot);
      return sq.map(([x, z]) => [x * cs - z * sn, x * sn + z * cs] as [number, number]);
    };
    for (let k = 0; k < nF; k++) {
      const y = y0 + k * fl;
      const t = k / nF;
      const R = 8.0 - 1.3 * t;
      const poly = shape(R, k * twist);
      const slabPoly = inflate(poly, 0.35);
      prism(ctx, 'nez', slabPoly, y, y + 0.55, true, k === nF - 1 ? 'terrasse' : null);
      if (ctx.lod < 2) ctx.mb.extrude('nez', slabPoly, y, y, { top: null, bottom: true, sides: false });
      polyFrames(poly, y + 0.55, fl - 0.55).forEach((f, i) => {
        const cells = ctx.lod === 2 ? 1 : Math.max(1, Math.round(f.w / 2.6));
        for (let c = 0; c < cells; c++) glass(ctx, f, (c * f.w) / cells, ((c + 1) * f.w) / cells, 0, fl - 0.55, 0, litSeed(k, i, c), 'verre_mr');
        if (ctx.lod === 0) fbox(ctx, 'meneau', f, -0.06, 0.06, 0, fl - 0.55, 0, 0.12, 'back top bottom left');
      });
    }
    const yTop = y0 + nF * fl;
    // couronne : 8 lames de verre alternativement hautes et basses, inclinées vers l'axe, nervures d'acier, anneaux, flèche
    const lastRot = (nF - 1) * twist;
    const ring0 = inflate(shape(8.0 - 1.3, lastRot), 0.35);
    const crownH = 28;
    const nr = ring0.length;
    for (let i = 0; i < nr; i++) {
      const a = ring0[i]!, b = ring0[(i + 1) % nr]!;
      const tall = i % 2 === 0;
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      const ml = Math.hypot(mx, mz) || 1;
      const rr = tall ? 1.2 : 3.6;
      const apex: [number, number, number] = [(mx / ml) * rr, yTop + (tall ? crownH : crownH * 0.55), (mz / ml) * rr];
      const prev = ctx.mb.lit; ctx.mb.lit = 2;
      ctx.mb.polyFacing('verre_couronne', [[a[0], yTop, a[1]], [b[0], yTop, b[1]], apex], [mx, 1.5, mz]);
      ctx.mb.polyFacing('verre_couronne', [[a[0], yTop, a[1]], [b[0], yTop, b[1]], apex], [-mx, -1.5, -mz]);
      ctx.mb.lit = prev;
      if (ctx.lod < 2) {
        ctx.mb.tube('acier', [a[0], yTop, a[1]], apex, 0.14, ctx.lod === 0 ? 6 : 4);
        ctx.mb.tube('acier', [b[0], yTop, b[1]], apex, 0.14, ctx.lod === 0 ? 6 : 4);
      }
    }
    // anneau intermédiaire
    const ringPoly = inflate(shape(4.6, lastRot), 0);
    prism(ctx, 'meneau', ringPoly, yTop + 11, yTop + 11.6, true, null);
    if (ctx.lod < 2) ctx.mb.extrude('meneau', ringPoly, yTop + 11, yTop + 11.6, { top: null, bottom: true, sides: false });
    // édicule et flèche
    prism(ctx, 'nez', shape(3.6, lastRot), yTop, yTop + 7, true);
    ctx.mb.cylinder('acier', 0, yTop + 7, 0, 0.9, crownH + 2, ctx.lod === 0 ? 12 : 6, false, 0.35);
    ctx.mb.cylinder('acier', 0, yTop + crownH + 9, 0, 0.35, 16, ctx.lod === 0 ? 8 : 5, true, 0.05);
    // parvis : bancs et massifs
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      shrub(ctx, Math.cos(a) * 11.0, 0.1, Math.sin(a) * 11.0, 0.7);
    }
    bench(ctx, -5.5, 0.1, 11.2, 0, 1.8);
    bench(ctx, 5.5, 0.1, 11.2, 0, 1.8);
    void baseR; void spire; void P; void planter; void stairHouse; void flatRoof;
  },
};

export const OFFICES: BuildingDef[] = [bureaux, tourVitree, gratteCielRetraits, tourIconique];
