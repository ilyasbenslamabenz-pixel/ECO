/**
 * INDUSTRIE : manufacture à sheds et cheminée, entrepôt logistique à quais, château d'eau,
 * silos de coopérative agricole, atelier artisanal.
 */
import {
  bays, fbox, flatRoof, gableRoof, mast, rectAt, rooftopUnit, row, shedRoof, subFrame, volume,
  type BuildingDef, type Ctx, type OpeningSpec,
} from '../kit/index';
import {
  curtainWall, disc, dome, edgeFrame, factoryChimney, fence, fireEscape, fpf, hCylinder, lampPost, lettering, loadingDock, M,
  mark, npPalette, pallet, parkingLot, railingSimple, sawtoothRoof, shrub, signPanel, slab, spire, wallAC, P,
} from './parts';

const SRC = 'tools/buildings/nonresidential/industry.ts';

/* ------------------------------------------------------------------ */
/* 10. Manufacture en brique à sheds et grande cheminée                 */
/* ------------------------------------------------------------------ */
export const manufacture: BuildingDef = {
  id: 'industrie_manufacture_sheds',
  nameFr: 'Manufacture à sheds et cheminée',
  category: 'industrial',
  footprint: { tilesX: 4, tilesZ: 3 },
  cost: 520000,
  upkeepPerMonth: 900,
  residents: 0,
  jobs: 140,
  density: 'moyenne',
  style: 'industriel_brique',
  tags: ['industrie', 'usine', 'sheds', 'cheminee', 'brique', 'pollution:2', 'service:emplois_industriels'],
  source: `${SRC}#manufacture`,
  lodDistances: [200, 800],
  frontage: [{ x: -4, z: 12, nx: 0, nz: 1, kind: 'delivery' }, { x: 11, z: 12, nx: 0, nz: 1, kind: 'pedestrian' }],
  palette: npPalette({
    facade: M('brique_rouge', '#ffffff'),
    soubassement: M('pierre_taille', '#b5ac9c'),
    encadrement: M('pierre_taille', '#e4dccd'),
    toiture: M('toit_tuiles_grises', '#c9c6c0'),
    menuiserie: M('metal_rideau', '#3f4a44', { metalness: 0.8, roughness: 0.5 }),
    store: M('metal_rideau', '#6f7a72'),
    cheminee: M('brique_orange', '#e8d2c2'),
    enseigne: M('enduit_blanc', '#efe9dc'),
    lettres: M('enduit_peint', '#3a2a22'),
  }),
  variants: [
    { id: 'origine', nameFr: 'Brique rouge, menuiseries vert-de-gris' },
    { id: 'claire', nameFr: 'Brique orangée, menuiseries noires', materialOverrides: { facade: { textureSet: 'brique_orange' }, menuiserie: { color: '#2a2a2a' } } },
    { id: 'enduit', nameFr: 'Enduit ocre et brique', materialOverrides: { facade: { textureSet: 'enduit_peint', color: '#d9b98a' }, menuiserie: { color: '#4f6f8f' } } },
  ],
  build(ctx: Ctx): void {
    const hx0 = -15.6, hx1 = 7.0, hz0 = -11.6, hz1 = 5.6;
    const H = 6.4;
    const W = hx1 - hx0, D = hz1 - hz0;
    const win = { shutters: 'none' as const, leaves: 3, bars: 3, transom: 0.9, frameMat: 'menuiserie', surround: 0.18, lintel: false, keystone: true, reveal: 0.3 };
    const us = bays(W, 6, 0.6);
    const S: OpeningSpec[] = us.map((u, i) => (i === 2 ? { kind: 'blind' as const, r: rectAt(u, 4.2, 0, 4.6) } : { kind: 'window' as const, r: rectAt(u, 2.4, 1.2, 3.8), o: win }));
    const F = volume(ctx, {
      x0: hx0, x1: hx1, z0: hz0, z1: hz1, h: H, wallMat: 'facade',
      sides: {
        S,
        W: row(bays(D, 5, 0.6), 2.2, 1.2, 3.8, () => ({ kind: 'window', o: win })),
        N: row(bays(W, 6, 0.6), 2.2, 1.6, 3.4, () => ({ kind: 'window', o: win })),
        E: [{ kind: 'door', r: rectAt(3.0, 1.2, 0.05, 2.4), o: { style: 'panneaux' } }],
      },
      plinth: { h: 0.5, d: 0.05 }, ...(ctx.lod === 0 ? { quoins: { v0: 0.5 } } : {}),
      bands: [{ v: H - 0.5, h: 0.25, d: 0.08 }],
    });
    // grand portail coulissant
    const pu = us[2]!;
    fpf(ctx, 'store', F.S, [[pu - 2.1, 0, -0.15], [pu + 2.1, 0, -0.15], [pu + 2.1, 4.6, -0.15], [pu - 2.1, 4.6, -0.15]], [0, 0, 1]);
    if (ctx.lod < 2) {
      for (const [a, b] of [[pu - 2.1, pu - 1.95], [pu + 1.95, pu + 2.1]] as const) fpf(ctx, 'facade', F.S, [[a, 0, 0], [a, 0, -0.15], [a, 4.6, -0.15], [a, 4.6, 0]], [1, 0, 0]);
      fbox(ctx, 'encadrement', F.S, pu - 2.4, pu + 2.4, 4.6, 5.0, 0, 0.1, 'back');
      fbox(ctx, 'garde_corps', F.S, pu - 4.6, pu + 2.3, 4.7, 4.8, 0, 0.15, 'back');
      if (ctx.lod === 0) for (let k = 0; k < 4; k++) fbox(ctx, 'menuiserie', F.S, pu - 2.1, pu + 2.1, 0.8 + k * 1.1, 0.86 + k * 1.1, -0.15, -0.1, 'back');
    }
    // pignons crénelés (façade S) : murs pignons des sheds visibles à l'ouest et à l'est
    sawtoothRoof(ctx, hx0, hx1, hz0, hz1, H, 5, 3.0, { roofMat: 'toiture', wallMat: 'facade' });
    // bâtiment administratif (R+1) à l'est
    const ox0 = hx1, ox1 = 15.6, oz0 = -3.0, oz1 = 5.6;
    const OW = ox1 - ox0;
    const O = volume(ctx, {
      x0: ox0, x1: ox1, z0: oz0, z1: oz1, h: 7.6, wallMat: 'facade',
      sides: {
        S: [{ kind: 'door', r: rectAt(OW / 2, 1.4, 0.05, 2.6), o: { style: 'vitree', transom: 0.5, steps: 0.3, canopy: 'dalle', surround: 0.15 } }, ...row([1.6, OW - 1.6], 1.2, 1.0, 1.8, () => ({ kind: 'window', o: { ...win, leaves: 2, bars: 2, transom: 0.5 } })), ...row(bays(OW, 3, 0.4), 1.2, 4.6, 1.8, () => ({ kind: 'window', o: { ...win, leaves: 2, bars: 2, transom: 0.5 } }))],
        E: [0, 1].flatMap((f) => row(bays(oz1 - oz0, 3, 0.5), 1.2, 1.0 + f * 3.6, 1.8, () => ({ kind: 'window', o: { ...win, leaves: 2, bars: 2, transom: 0.5 } }))),
        N: row([2, OW - 2], 1.0, 4.6, 1.6, () => ({ kind: 'window', o: { ...win, leaves: 2 } })),
      },
      hidden: ['W'], plinth: { h: 0.5, d: 0.05 }, ...(ctx.lod === 0 ? { quoins: { v0: 0.5 } } : {}),
      bands: [{ v: 3.8, h: 0.2, d: 0.06 }], cornice: { profile: [[0.15, 0.06], [0.15, 0.14]] },
    });
    gableRoof(ctx, { x0: ox0, x1: ox1, z0: oz0, z1: oz1, y: 7.6 + 0.29, pitch: 30, axis: 'x', overhang: 0.35, verge: 0.2, gableMat: 'facade', gables: [false, true] });
    // fronton d'enseigne
    fbox(ctx, 'enseigne', O.S, 0.6, OW - 0.6, 6.5, 7.3, 0, 0.1, 'back');
    lettering(ctx, 'lettres', O.S, 'MANUFACTURE', OW / 2, 6.68, 0.42, 0.1, 0.04);
    // chaufferie + grande cheminée
    const bx0 = 8.0, bx1 = 13.6, bz0 = -11.6, bz1 = -5.0;
    volume(ctx, { x0: bx0, x1: bx1, z0: bz0, z1: bz1, h: 5.2, wallMat: 'facade', sides: { S: [{ kind: 'door', r: rectAt(2.6, 1.6, 0.05, 3.0), o: { style: 'double' } }], E: row([3.3], 1.6, 2.0, 2.2, () => ({ kind: 'window', o: win })) }, plinth: { h: 0.5, d: 0.05 } });
    gableRoof(ctx, { x0: bx0, x1: bx1, z0: bz0, z1: bz1, y: 5.4, pitch: 25, axis: 'z', overhang: 0.3, gableMat: 'facade' });
    factoryChimney(ctx, 12.2, -2.6 - 4.2, 0, 34, 1.5, 0.95);
    // cuve d'eau sur pylônes
    const tx = -12.5, tz = 8.6;
    if (ctx.lod < 2) for (const [dx, dz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]] as const) ctx.mb.box('garde_corps', tx + dx - 0.1, 0, tz + dz - 0.1, tx + dx + 0.1, 7.5, tz + dz + 0.1, 'ny');
    else ctx.mb.box('garde_corps', tx - 1.3, 0, tz - 1.3, tx + 1.3, 7.5, tz + 1.3, 'ny');
    ctx.mb.cylinder('acier', tx, 7.5, tz, 1.9, 3.2, ctx.lod === 0 ? 14 : 8, false);
    spire(ctx, 'acier', tx, 10.7, tz, 1.95, 0.9, ctx.lod === 0 ? 14 : 8);
    // cour pavée, palettes, lampadaires
    slab(ctx, 'paves', hx0, hz1, 15.6, 11.6, 0, 0.08);
    for (let k = 0; k < 4; k++) pallet(ctx, -6.5 + k * 1.4, 0.08, 7.3, k !== 3, 0);
    pallet(ctx, -6.5, 1.13, 7.3, true, 0);
    lampPost(ctx, 2.0, 0.08, 11.0, 6, [0, 0, -1]);
    lampPost(ctx, -9.0, 0.08, 11.0, 6, [0, 0, -1]);
    downpipeRow(ctx);
    void D; void subFrame;
  },
};
function downpipeRow(_ctx: Ctx): void { /* les descentes sont portées par les noues des sheds (non visibles) */ }

/* ------------------------------------------------------------------ */
/* 11. Entrepôt logistique à quais                                      */
/* ------------------------------------------------------------------ */
export const entrepot: BuildingDef = {
  id: 'industrie_entrepot_logistique',
  nameFr: 'Entrepôt logistique à quais',
  category: 'industrial',
  footprint: { tilesX: 5, tilesZ: 4 },
  cost: 900000,
  upkeepPerMonth: 1100,
  residents: 0,
  jobs: 110,
  density: 'moyenne',
  style: 'logistique',
  tags: ['industrie', 'entrepot', 'logistique', 'quais', 'trafic_poids_lourds', 'service:fret'],
  source: `${SRC}#entrepot`,
  lodDistances: [220, 900],
  frontage: [{ x: 0, z: 16, nx: 0, nz: 1, kind: 'delivery' }],
  palette: npPalette({
    facade: M('bardage_composite', '#e9ebec'),
    facade_b: M('toit_bac_acier', '#ffffff'),
    toiture: M('toit_tole_ondulee', '#c9ccce'),
    soubassement: M('beton_facade', '#cfcbc3'),
    enseigne: M('enduit_peint', '#1c4c8c'),
    logo: M('enduit_peint', '#e85a1f'),
    store: M('metal_rideau', '#d9dadb'),
    menuiserie: M('metal_rideau', '#5f666b', { metalness: 0.8, roughness: 0.45 }),
  }),
  variants: [
    { id: 'origine', nameFr: 'Bardage blanc, bandeau rouge, logo bleu' },
    { id: 'gris', nameFr: 'Bardage gris anthracite, bandeau orange', materialOverrides: { facade: { textureSet: 'panneaux_facade_sombres', color: '#ffffff' }, enseigne: { color: '#e88a1f' } } },
    { id: 'vert', nameFr: 'Bardage blanc, bandeau vert', materialOverrides: { facade_b: { textureSet: 'enduit_peint', color: '#3f8a4f' }, enseigne: { color: '#245a34' } } },
  ],
  build(ctx: Ctx): void {
    const x0 = -19.6, x1 = 19.6, z0 = -15.6, z1 = 1.6;
    const H = 10.5;
    const W = x1 - x0;
    const docks = [10, 14.5, 19, 23.5, 28, 32.5];
    const dockH = 1.2;
    const S: OpeningSpec[] = docks.map((u) => ({ kind: 'blind' as const, r: { u0: u - 1.5, u1: u + 1.5, v0: dockH, v1: dockH + 3.6 } }));
    S.push({ kind: 'blind', r: { u0: 1.0, u1: 6.4, v0: 0.6, v1: 7.4 } });
    S.push({ kind: 'blind', r: { u0: 36.0, u1: 38.4, v0: 0, v1: 4.2 } });
    const F = volume(ctx, {
      x0, x1, z0, z1, h: H, wallMat: 'facade',
      sides: {
        S,
        E: [{ kind: 'blind', r: { u0: 4, u1: 8.5, v0: 0, v1: 5 } }],
        W: row(bays(z1 - z0, 4, 2), 1.4, 4.4, 1.2, () => ({ kind: 'window', o: { shutters: 'none' } })),
        N: [{ kind: 'door', r: rectAt(6, 1.0, 0.05, 2.2), o: { style: 'moderne' } }, { kind: 'door', r: rectAt(32, 1.0, 0.05, 2.2), o: { style: 'moderne' } }],
      },
      plinth: { h: 1.2, d: 0.02, mat: 'soubassement' },
    });
    // bandeau coloré et couvertine
    for (const fr of [F.S, F.E, F.W, F.N]) fbox(ctx, 'facade_b', fr, -0.05, fr.w + 0.05, H - 1.8, H - 0.8, 0, 0.06, 'back');
    // toiture à faible pente + acrotère
    gableRoof(ctx, { x0: x0 + 0.3, x1: x1 - 0.3, z0: z0 + 0.3, z1: z1 - 0.3, y: H - 0.6, pitch: 5, axis: 'x', overhang: -0.05, verge: -0.05, gableMat: null, gutters: false });
    flatRoof(ctx, { x0, x1, z0, z1, y: H - 0.6, parapet: H, t: 0.3, copingMat: 'menuiserie' });
    // quais
    for (const u of docks) loadingDock(ctx, F.S, { u0: u - 1.5, u1: u + 1.5, v0: dockH, v1: dockH + 3.6 }, dockH);
    fbox(ctx, 'menuiserie', F.S, docks[0]! - 2.6, docks[docks.length - 1]! + 2.6, dockH + 4.3, dockH + 4.55, 0, 2.6, '');
    if (ctx.lod < 2) for (const u of docks) {
      const p = P(F.S, u - 2.2, 0, 2.5);
      void p;
    }
    // porte sectionnelle de plain-pied (est) et petite porte S
    fpf(ctx, 'store', F.E, [[4, 0, -0.08], [8.5, 0, -0.08], [8.5, 5, -0.08], [4, 5, -0.08]], [0, 0, 1]);
    fpf(ctx, 'store', F.S, [[36.0, 0, -0.08], [38.4, 0, -0.08], [38.4, 4.2, -0.08], [36.0, 4.2, -0.08]], [0, 0, 1]);
    // bloc bureaux vitré (angle ouest) en saillie
    const ob = subFrame(F.S, 0, 0, 0, W, H);
    curtainWall(ctx, F.S, { u0: 1.0, u1: 6.4, v0: 0.6, v1: 7.4, cols: 4, floorH: 3.4, spandrel: 0.8, spandrelMat: 'menuiserie' });
    fbox(ctx, 'menuiserie', ob, 0.6, 6.8, 7.4, 7.7, 0, 1.2, '');
    // enseigne + logo
    lettering(ctx, 'enseigne', F.S, 'LOGISTIQUE', 22, H - 3.2, 0.95, 0.0, 0.07);
    const lu = 13.6;
    disc(ctx, 'logo', F.S, lu, H - 2.7, 0.8, 0.06, ctx.lod === 0 ? 18 : 10);
    fpf(ctx, 'enseigne', F.S, [[lu - 0.5, H - 3.1, 0.09], [lu + 0.6, H - 2.7, 0.09], [lu - 0.5, H - 2.3, 0.09]], [0, 0, 1]);
    // équipements toiture : exutoires de fumée
    if (ctx.lod < 2) for (let k = 0; k < 5; k++) for (const z of [-11, -4]) {
      const x = -15 + k * 7.5;
      ctx.mb.box('menuiserie', x - 0.8, H - 0.4, z - 0.6, x + 0.8, H + 0.1, z + 0.6, 'ny');
      ctx.mb.box('verre_gc', x - 0.75, H + 0.1, z - 0.55, x + 0.75, H + 0.12, z + 0.55, 'ny');
    }
    // cour poids lourds : enrobé + marquages d'aires de quai + bordures
    slab(ctx, 'sol', x0, z1, x1, 15.6, -0.1, 0.1);
    if (ctx.lod < 2) {
      for (const u of docks) for (const s of [-1.75, 1.75]) mark(ctx, x0 + u + s - 0.08, z1 + 0.6, x0 + u + s + 0.08, z1 + 14, 0.012, 'marquage');
      mark(ctx, x0 + 4, 14.6, x1 - 4, 14.75, 0.012, 'marquage_j');
      ctx.mb.box('bordure', x0, 0, 15.3, x0 + 14, 0.14, 15.6, 'ny');
      ctx.mb.box('bordure', x1 - 14, 0, 15.3, x1, 0.14, 15.6, 'ny');
    }
    for (const x of [-18, 18]) lampPost(ctx, x, 0, 9, 9, [x < 0 ? 1 : -1, 0, 0]);
    // poste de garde
    volume(ctx, { x0: -18.8, x1: -15.6, z0: 11.6, z1: 14.6, h: 2.8, wallMat: 'facade_b', sides: { S: row([1.6], 1.8, 1.0, 1.2, () => ({ kind: 'window', o: { shutters: 'none' } })), E: [{ kind: 'door', r: rectAt(1.5, 0.9, 0.05, 2.1), o: { style: 'moderne' } }] } });
    flatRoof(ctx, { x0: -19.0, x1: -15.4, z0: 11.4, z1: 14.8, y: 2.8, parapet: 3.0, t: 0.15 });
    if (ctx.lod < 2) { ctx.mb.box('marquage', -15.4, 1.0, 13.0, -9.0, 1.1, 13.1); ctx.mb.box('logo', -14.0, 1.0, 12.99, -13.0, 1.1, 13.11); ctx.mb.box('logo', -12.0, 1.0, 12.99, -11.0, 1.1, 13.11); ctx.mb.box('logo', -10.0, 1.0, 12.99, -9.0, 1.1, 13.11); }
    void signPanel; void fireEscape; void parkingLot;
  },
};

/* ------------------------------------------------------------------ */
/* 12. Château d'eau en béton                                           */
/* ------------------------------------------------------------------ */
export const chateauEau: BuildingDef = {
  id: 'industrie_chateau_eau',
  nameFr: 'Château d\'eau',
  category: 'industrial',
  footprint: { tilesX: 2, tilesZ: 2 },
  cost: 260000,
  upkeepPerMonth: 300,
  residents: 0,
  jobs: 3,
  density: 'faible',
  style: 'ouvrage_hydraulique',
  tags: ['industrie', 'eau', 'reservoir', 'repere_visuel', 'service:eau', 'rayon:1800', 'capacite_service:12000'],
  source: `${SRC}#chateauEau`,
  palette: npPalette({
    facade: M('beton_facade', '#eeeae2'),
    facade_b: M('enduit_peint', '#9fc0d8'),
    encadrement: M('beton_facade', '#f6f3ec'),
    dalle: M('beton_facade', '#d9d5cc'),
    lettres: M('enduit_peint', '#2f5c86'),
    porte: M('bardage_blanc', '#4c6f8a'),
  }),
  variants: [
    { id: 'origine', nameFr: 'Béton clair, cuve bleu ciel' },
    { id: 'blanc', nameFr: 'Béton blanc, cuve blanche', materialOverrides: { facade_b: { color: '#f2f2ee' } } },
    { id: 'vert', nameFr: 'Béton, cuve vert d\'eau', materialOverrides: { facade_b: { color: '#a8cbb7' }, lettres: { color: '#2d5e45' } } },
    { id: 'haut', nameFr: 'Fût rehaussé', heightScale: 1.25 },
  ],
  build(ctx: Ctx): void {
    const seg = ctx.lod === 0 ? 28 : ctx.lod === 1 ? 16 : 10;
    const r0 = 2.6;
    const shaftH = 24;
    // socle octogonal
    ctx.mb.cylinder('dalle', 0, 0, 0, 3.6, 0.8, 8, true, 3.4);
    // fût cannelé : cylindre + pilastres
    ctx.mb.cylinder('facade', 0, 0.8, 0, r0, shaftH - 0.8, seg, false, r0 * 0.92);
    if (ctx.lod < 2) {
      const n = 8;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.PI / 8;
        const c = Math.cos(a), s = Math.sin(a);
        const f = edgeFrame(c * r0 - s * 0.3, s * r0 + c * 0.3, c * r0 + s * 0.3, s * r0 - c * 0.3, 0.8, shaftH);
        // nervure verticale (légère inclinaison ignorée : r0 → 0.92 r0)
        fbox(ctx, 'encadrement', f, 0, 0.6, 0, shaftH - 0.8, -0.1, 0.18, 'back');
      }
      // fentes d'éclairage de l'escalier intérieur
      const fs = edgeFrame(-0.4, r0 * 0.96 + 0.01, 0.4, r0 * 0.96 + 0.01, 0.8, shaftH);
      for (let k = 0; k < 6; k++) {
        const prev = ctx.mb.lit; ctx.mb.lit = 0.3 + k * 0.1;
        fpf(ctx, 'verre', fs, [[0.25, 4 + k * 3.2, 0.02], [0.55, 4 + k * 3.2, 0.02], [0.55, 5.6 + k * 3.2, 0.02], [0.25, 5.6 + k * 3.2, 0.02]], [0, 0, 1]);
        ctx.mb.lit = prev;
      }
    }
    // porte d'accès + marquise
    const fd = edgeFrame(-0.9, r0 + 0.02, 0.9, r0 + 0.02, 0.8, 4);
    fbox(ctx, 'porte', fd, 0.35, 1.45, 0, 2.3, 0, 0.12, 'back');
    fbox(ctx, 'dalle', fd, -0.1, 1.9, 2.5, 2.7, 0, 1.1, '');
    // cuve : tronc de cône inférieur, couronne cylindrique, coupole
    const tank0 = shaftH;
    ctx.mb.cylinder('facade', 0, tank0, 0, r0 * 0.92, 5.0, seg, false, 7.6);
    ctx.mb.cylinder('facade_b', 0, tank0 + 5.0, 0, 7.6, 5.6, seg, false, 7.6);
    // bandeaux de la cuve
    ctx.mb.cylinder('encadrement', 0, tank0 + 5.0, 0, 7.75, 0.4, seg, false, 7.75);
    ctx.mb.cylinder('encadrement', 0, tank0 + 10.2, 0, 7.8, 0.5, seg, false, 7.8);
    // coupole
    dome(ctx, 'dalle', 0, tank0 + 10.7, 0, 7.8, seg, ctx.lod === 0 ? 6 : 3, 0.28);
    // garde-corps de la coursive et lanterneau
    if (ctx.lod < 2) {
      const n = ctx.lod === 0 ? 24 : 12;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2, b = ((i + 1) / n) * Math.PI * 2;
        railingSimple(ctx, [Math.cos(a) * 7.6, tank0 + 10.7, Math.sin(a) * 7.6], [Math.cos(b) * 7.6, tank0 + 10.7, Math.sin(b) * 7.6], 1.0);
      }
    }
    ctx.mb.cylinder('dalle', 0, tank0 + 12.7, 0, 1.4, 1.4, ctx.lod === 0 ? 12 : 6, true, 1.2);
    // antennes de télécommunication
    mast(ctx, 0, tank0 + 14.1, 0, 7);
    if (ctx.lod < 2) for (const a of [0.3, 2.4, 4.5]) ctx.mb.box('acier', Math.cos(a) * 1.6 - 0.15, tank0 + 11.5, Math.sin(a) * 1.6 - 0.1, Math.cos(a) * 1.6 + 0.15, tank0 + 13.5, Math.sin(a) * 1.6 + 0.1, '');
    // lettrage « EAU » sur la cuve (face sud), légèrement facetté
    const fE = edgeFrame(-3.2, 7.68, 3.2, 7.68, tank0 + 5.4, 4);
    lettering(ctx, 'lettres', fE, 'EAU', 3.2, 1.4, 2.0, 0.0, 0.08);
    // clôture
    const fz = 7.6;
    fence(ctx, [-fz, 0, fz], [-1.6, 0, fz], 1.8);
    fence(ctx, [1.6, 0, fz], [fz, 0, fz], 1.8);
    fence(ctx, [fz, 0, fz], [fz, 0, -fz], 1.8);
    fence(ctx, [fz, 0, -fz], [-fz, 0, -fz], 1.8);
    fence(ctx, [-fz, 0, -fz], [-fz, 0, fz], 1.8);
    slab(ctx, 'gravier', -fz, -fz, fz, fz, 0, 0.05);
    slab(ctx, 'beton', -1.2, r0, 1.2, fz, 0.05, 0.05);
    shrub(ctx, -5.5, 0.05, 5.8, 0.8);
    shrub(ctx, 5.5, 0.05, 5.8, 0.7);
  },
};

/* ------------------------------------------------------------------ */
/* 13. Silos de coopérative agricole                                    */
/* ------------------------------------------------------------------ */
export const silos: BuildingDef = {
  id: 'industrie_silos_cooperative',
  nameFr: 'Silos de coopérative agricole',
  category: 'industrial',
  footprint: { tilesX: 3, tilesZ: 3 },
  cost: 410000,
  upkeepPerMonth: 520,
  residents: 0,
  jobs: 24,
  density: 'faible',
  style: 'agro_industriel',
  tags: ['industrie', 'silos', 'agriculture', 'stockage', 'repere_visuel', 'service:stockage_agricole'],
  source: `${SRC}#silos`,
  lodDistances: [220, 900],
  palette: npPalette({
    facade: M('beton_facade', '#e8e3d8'),
    facade_b: M('toit_tole_ondulee', '#d7d9da', { metalness: 0.9, roughness: 0.45 }),
    toiture: M('toit_tole_ondulee', '#b9bcbe'),
    dalle: M('beton_facade', '#d6d1c6'),
    enseigne: M('enduit_peint', '#2f6a3a'),
    lettres: M('enduit_blanc', '#f6f4ec'),
  }),
  variants: [
    { id: 'origine', nameFr: 'Béton, enseigne verte' },
    { id: 'metal', nameFr: 'Silos en tôle galvanisée', materialOverrides: { facade: { textureSet: 'toit_tole_ondulee', color: '#e4e6e7' } } },
    { id: 'ocre', nameFr: 'Béton ocré, enseigne rouge', materialOverrides: { facade: { color: '#e2cba6' }, enseigne: { color: '#9a2f24' } } },
  ],
  build(ctx: Ctx): void {
    const seg = ctx.lod === 0 ? 22 : ctx.lod === 1 ? 12 : 8;
    const R = 3.0, H = 25;
    const centers: [number, number][] = [[-7.6, -6.4], [-1.4, -6.4], [-7.6, -0.2], [-1.4, -0.2]];
    for (const [x, z] of centers) {
      ctx.mb.cylinder('dalle', x, 0, z, R + 0.3, 0.6, seg, false);
      ctx.mb.cylinder('facade', x, 0.6, z, R, H - 0.6, seg, false);
      spire(ctx, 'facade', x, H, z, R + 0.05, 1.6, seg, 0);
      if (ctx.lod < 2) {
        for (const yy of [6, 12, 18]) ctx.mb.cylinder('encadrement', x, yy, z, R + 0.06, 0.25, seg, false);
        ctx.mb.cylinder('dalle', x, H + 1.3, z, 0.6, 0.8, 8, true);
      }
    }
    // tour de manutention (élévateur) en tôle
    const tx0 = 2.2, tx1 = 7.6, tz0 = -9.8, tz1 = -3.6;
    const T = volume(ctx, {
      x0: tx0, x1: tx1, z0: tz0, z1: tz1, h: 33, wallMat: 'facade_b',
      sides: {
        S: [0, 1, 2, 3, 4].map((k) => ({ kind: 'window' as const, r: rectAt(2.7, 1.2, 4 + k * 5.8, 1.0), o: { shutters: 'none' as const, sill: false } })),
        E: [{ kind: 'door', r: rectAt(3, 1.0, 0.05, 2.2), o: { style: 'moderne' } }, ...[1, 2, 3, 4].map((k) => ({ kind: 'window' as const, r: rectAt(3.1, 1.2, 4 + k * 5.8, 1.0), o: { shutters: 'none' as const, sill: false } }))],
      },
    });
    gableRoof(ctx, { x0: tx0, x1: tx1, z0: tz0, z1: tz1, y: 33, pitch: 20, axis: 'z', overhang: 0.25, gableMat: 'facade_b' });
    fbox(ctx, 'enseigne', T.S, 0.2, T.S.w - 0.2, 27.5, 30.5, 0, 0.12, 'back');
    'COOP'.split('').forEach((ch, i) => lettering(ctx, 'lettres', T.S, ch, T.S.w / 2 - 1.5 + i * 1.0, 28.3, 0.9, 0.12, 0.05));
    // galerie de convoyeur au sommet des silos
    const gy = H + 1.8;
    ctx.mb.box('facade_b', -9.2, gy, -4.1, 2.2, gy + 2.0, -2.5, '');
    if (ctx.lod < 2) for (let x = -8.4; x <= 1.6; x += 2.5) ctx.mb.box('garde_corps', x - 0.08, gy - 1.6, -3.4, x + 0.08, gy, -3.2, '');
    // convoyeur incliné vers le hangar de réception
    hCylinder(ctx, 'facade_b', [5.0, 22, -3.6], [5.0, 5.2, 7.0], 0.6, ctx.lod === 0 ? 8 : 5, true);
    if (ctx.lod < 2) for (const t of [0.35, 0.7]) {
      const y = 22 + (5.2 - 22) * t, z = -3.6 + 10.6 * t;
      ctx.mb.box('garde_corps', 4.85, 0, z - 0.12, 5.15, y - 0.5, z + 0.12, 'ny');
    }
    // hangar de réception (fosse de déchargement des bennes)
    const hx0 = 0.6, hx1 = 11.6, hz0 = 4.0, hz1 = 11.6;
    const Hh = volume(ctx, {
      x0: hx0, x1: hx1, z0: hz0, z1: hz1, h: 6.2, wallMat: 'facade_b',
      sides: { S: [{ kind: 'blind', r: { u0: 2, u1: 7, v0: 0, v1: 5.2 } }], W: [{ kind: 'blind', r: { u0: 2, u1: 6, v0: 0, v1: 5.2 } }] },
      plinth: { h: 0.8, d: 0.02, mat: 'dalle' },
    });
    for (const [fr, a, b] of [[Hh.S, 2, 7], [Hh.W, 2, 6]] as const) {
      fpf(ctx, 'dalle', fr, [[a, 0.02, -0.0], [b, 0.02, -0.0], [b, 0.02, -3.0], [a, 0.02, -3.0]], [0, 1, 0]);
      fpf(ctx, 'garde_corps', fr, [[a, 0, -3.0], [b, 0, -3.0], [b, 5.2, -3.0], [a, 5.2, -3.0]], [0, 0, 1]);
      if (ctx.lod < 2) {
        fpf(ctx, 'facade_b', fr, [[a, 0, 0], [a, 0, -3], [a, 5.2, -3], [a, 5.2, 0]], [1, 0, 0]);
        fpf(ctx, 'facade_b', fr, [[b, 0, -3], [b, 0, 0], [b, 5.2, 0], [b, 5.2, -3]], [-1, 0, 0]);
        fpf(ctx, 'facade_b', fr, [[a, 5.2, -3], [b, 5.2, -3], [b, 5.2, 0], [a, 5.2, 0]], [0, -1, 0]);
      }
    }
    gableRoof(ctx, { x0: hx0, x1: hx1, z0: hz0, z1: hz1, y: 6.3, pitch: 15, axis: 'x', overhang: 0.4, gableMat: 'facade_b' });
    // pont-bascule et bureau d'accueil
    slab(ctx, 'beton', -11.6, 2.8, -0.4, 11.6, 0, 0.06);
    ctx.mb.box('acier', -9.5, 0.06, 5.0, -2.5, 0.14, 8.0, 'ny');
    volume(ctx, { x0: -11.4, x1: -7.4, z0: 9.0, z1: 11.4, h: 2.9, wallMat: 'facade', sides: { E: row([1.2], 1.4, 1.0, 1.2, () => ({ kind: 'window', o: { shutters: 'none' } })), S: [{ kind: 'door', r: rectAt(2, 0.9, 0.05, 2.1), o: { style: 'moderne' } }] } });
    flatRoof(ctx, { x0: -11.6, x1: -7.2, z0: 8.8, z1: 11.6, y: 2.9, parapet: 3.1, t: 0.15 });
    lampPost(ctx, -1.0, 0.06, 11.0, 7, [-1, 0, 0]);
  },
};

/* ------------------------------------------------------------------ */
/* 14. Atelier artisanal (mécanique / menuiserie)                       */
/* ------------------------------------------------------------------ */
export const atelier: BuildingDef = {
  id: 'industrie_atelier',
  nameFr: 'Atelier artisanal',
  category: 'industrial',
  footprint: { tilesX: 2, tilesZ: 2 },
  cost: 95000,
  upkeepPerMonth: 160,
  residents: 0,
  jobs: 14,
  density: 'faible',
  style: 'atelier',
  tags: ['industrie', 'artisanat', 'atelier', 'pme', 'service:emplois_industriels'],
  source: `${SRC}#atelier`,
  palette: npPalette({
    facade: M('toit_bac_acier', '#ffffff'),
    facade_b: M('bardage_bois', '#ffffff'),
    soubassement: M('beton_facade', '#c9c4ba'),
    toiture: M('toit_tole_ondulee', '#aeb2b4'),
    store: M('metal_rideau', '#e3e4e4'),
    enseigne: M('enduit_peint', '#2b2b2b'),
    lettres: M('enduit_peint', '#f2c230'),
    menuiserie: M('metal_rideau', '#3a3f43', { metalness: 0.8, roughness: 0.45 }),
  }),
  variants: [
    { id: 'origine', nameFr: 'Bac acier rouge, bardage bois' },
    { id: 'gris', nameFr: 'Bac acier gris, enseigne bleue', materialOverrides: { facade: { textureSet: 'toit_tole_ondulee', color: '#d0d3d5' }, enseigne: { color: '#1f4f8f' }, lettres: { color: '#ffffff' } } },
    { id: 'bois', nameFr: 'Tout bois, enseigne verte', materialOverrides: { facade: { textureSet: 'bardage_bois', color: '#ffffff' }, enseigne: { color: '#2d5a3a' } } },
  ],
  build(ctx: Ctx): void {
    const x0 = -7.6, x1 = 4.4, z0 = -7.6, z1 = 3.0;
    const W = x1 - x0;
    const F = volume(ctx, {
      x0, x1, z0, z1, h: 5.0, wallMat: 'facade',
      sides: {
        S: [{ kind: 'blind', r: { u0: 0.8, u1: 4.8, v0: 0, v1: 4.2 } }, { kind: 'blind', r: { u0: 5.6, u1: 9.6, v0: 0, v1: 4.2 } }],
        W: row(bays(z1 - z0, 3, 0.8), 2.0, 2.4, 1.2, () => ({ kind: 'window', o: { shutters: 'none', leaves: 3 } })),
        N: row(bays(W, 3, 0.8), 2.0, 2.4, 1.2, () => ({ kind: 'window', o: { shutters: 'none', leaves: 3 } })),
      },
      hidden: ['E'], plinth: { h: 0.6, d: 0.02, mat: 'soubassement' },
    });
    for (const [a, b] of [[0.8, 4.8], [5.6, 9.6]] as const) {
      fpf(ctx, 'store', F.S, [[a, 0, -0.1], [b, 0, -0.1], [b, 4.2, -0.1], [a, 4.2, -0.1]], [0, 0, 1]);
      if (ctx.lod < 2) {
        fbox(ctx, 'menuiserie', F.S, a - 0.12, a, 0, 4.3, 0, 0.12, 'back');
        fbox(ctx, 'menuiserie', F.S, b, b + 0.12, 0, 4.3, 0, 0.12, 'back');
        fbox(ctx, 'menuiserie', F.S, a - 0.15, b + 0.15, 4.2, 4.55, 0, 0.3, 'back');
        if (ctx.lod === 0) for (let k = 1; k < 7; k++) fbox(ctx, 'menuiserie', F.S, a, b, k * 0.6, k * 0.6 + 0.03, -0.1, -0.07, 'back');
      }
    }
    // toiture en sheds simples (mono-pente + bandeau vitré haut)
    shedRoof(ctx, { x0, x1, z0, z1, yLow: 5.0, yHigh: 7.4, low: 'S', overhang: 0.5, wallMat: 'facade' });
    // bandeau vitré haut sous la rive (face N)
    const nf = edgeFrame(x1, z0, x0, z0, 0, 8);
    for (let k = 0; k < 4; k++) fpf(ctx, 'verre', nf, [[0.6 + k * 2.75, 5.6, 0.02], [2.9 + k * 2.75, 5.6, 0.02], [2.9 + k * 2.75, 6.8, 0.02], [0.6 + k * 2.75, 6.8, 0.02]], [0, 0, 1]);
    // bureau en bardage bois (E) avec auvent
    const ox0 = x1, ox1 = 7.6, oz0 = -2.0, oz1 = 3.0;
    const O = volume(ctx, {
      x0: ox0, x1: ox1, z0: oz0, z1: oz1, h: 3.4, wallMat: 'facade_b',
      sides: { S: [{ kind: 'door', r: rectAt(1.0, 1.0, 0.05, 2.3), o: { style: 'vitree' } }, { kind: 'window', r: rectAt(2.4, 1.2, 1.0, 1.4), o: { shutters: 'none' } }], E: row([2.5], 1.8, 1.0, 1.4, () => ({ kind: 'window', o: { shutters: 'none', leaves: 2 } })) },
      plinth: { h: 0.3, d: 0.02, mat: 'soubassement' },
    });
    flatRoof(ctx, { x0: ox0, x1: ox1, z0: oz0, z1: oz1, y: 3.4, parapet: 3.7, t: 0.15, copingMat: 'menuiserie' });
    fbox(ctx, 'menuiserie', O.S, -0.1, O.S.w + 0.1, 2.6, 2.75, 0, 1.0, '');
    // enseigne
    fbox(ctx, 'enseigne', F.S, 1.6, 8.8, 4.65, 5.55, 0, 0.12, 'back');
    lettering(ctx, 'lettres', F.S, 'ATELIER', 5.2, 4.85, 0.5, 0.12, 0.04);
    // extérieur : dalle, palettes, conteneur à déchets, établi
    slab(ctx, 'beton', x0, z1, 7.6, 7.6, 0, 0.08);
    for (let k = 0; k < 3; k++) pallet(ctx, x0 + 1.2 + k * 1.4, 0.08, z1 + 3.4, true, 0);
    pallet(ctx, x0 + 1.2, 1.13, z1 + 3.4, true, 0);
    ctx.mb.box('enduit_benne', 5.0, 0.08, -6.6, 7.4, 1.3, -3.2, 'ny');
    if (ctx.lod < 2) {
      ctx.mb.box('menuiserie', 4.9, 1.3, -6.7, 7.5, 1.4, -3.1, 'ny');
      ctx.mb.cylinder('menuiserie', 5.4, 0.08, -3.1, 0.15, 0.2, 6, true);
    }
    wallAC(ctx, O.E, 1.0, 2.2);
    lampPost(ctx, 7.0, 0.08, 7.0, 5, [-1, 0, 0]);
    void ox1;
  },
};
atelier.palette['enduit_benne'] = M('metal_rideau', '#3f7a4c', { metalness: 0.6, roughness: 0.5 });

export const INDUSTRY: BuildingDef[] = [manufacture, entrepot, chateauEau, silos, atelier];
