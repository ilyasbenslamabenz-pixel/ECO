/**
 * COMMERCES : boulangerie de quartier, supermarché avec parking, café-brasserie à terrasse,
 * station-service, centre commercial.
 */
import {
  bays, cornice, dormer, downpipe, fbox, flatRoof, gableRoof, mansardRoof, rectAt, rooftopUnit, row, subFrame, volume,
  balcony, chimney, mast,
  type BuildingDef, type Ctx, type OpeningSpec,
} from '../kit/index';
import {
  bench, curtainWall, disc, edgeFrame, fence, fpf, hCylinder, lampPost, lettering, litSeed, M, npPalette, pallet, parkingLot,
  planter, ring, shrub, signPanel, slab, stripedAwning, terraceSet, wallAC, glass, P,
} from './parts';

const SRC = 'tools/buildings/nonresidential/commerce.ts';

/* ------------------------------------------------------------------ */
/* 1. Boulangerie de quartier (R+1 + combles)                          */
/* ------------------------------------------------------------------ */
export const boulangerie: BuildingDef = {
  id: 'commerce_boulangerie',
  nameFr: 'Boulangerie de quartier',
  category: 'commercial',
  footprint: { tilesX: 1, tilesZ: 1 },
  cost: 42000,
  upkeepPerMonth: 90,
  residents: 2,
  jobs: 5,
  density: 'faible',
  style: 'faubourg',
  tags: ['commerce', 'commerce_de_proximite', 'boulangerie', 'vitrine', 'store_banne', 'service:alimentation', 'rayon:250'],
  source: `${SRC}#boulangerie`,
  palette: npPalette({
    facade: M('enduit_creme', '#f1e6d0'),
    soubassement: M('pierre_taille', '#c9c0b0'),
    encadrement: M('pierre_taille', '#efe8da'),
    toiture: M('toit_tuiles'),
    menuiserie: M('bardage_blanc', '#3f2f28', { roughness: 0.6 }),
    volet: M('bardage_blanc', '#7d8f74'),
    enseigne: M('bardage_blanc', '#4a2c22'),
    lettres: M('enduit_blanc', '#e9c77a', { metalness: 0.6, roughness: 0.35 }),
    store_a: M('enduit_peint', '#a9332b', { doubleSided: true }),
    porte: M('bardage_blanc', '#3f2f28'),
  }),
  variants: [
    { id: 'origine', nameFr: 'Enduit crème, store bordeaux' },
    { id: 'bleu', nameFr: 'Devanture bleu nuit, store bleu', materialOverrides: { enseigne: { color: '#1f3550' }, menuiserie: { color: '#1f3550' }, store_a: { color: '#2f5f8f' }, porte: { color: '#1f3550' } } },
    { id: 'vert', nameFr: 'Façade ocre, devanture vert sapin', materialOverrides: { facade: { textureSet: 'enduit_peint', color: '#e2b977' }, enseigne: { color: '#2d4a35' }, menuiserie: { color: '#2d4a35' }, store_a: { color: '#3f7a4c' } } },
    { id: 'brique', nameFr: 'Brique rouge, devanture noire', materialOverrides: { facade: { textureSet: 'brique_rouge', color: '#ffffff' }, enseigne: { color: '#1e1e1e' }, menuiserie: { color: '#1e1e1e' }, store_a: { color: '#6f6f6f' } } },
  ],
  build(ctx: Ctx): void {
    const x0 = -3.8, x1 = 3.8, z0 = -3.2, z1 = 3.2;
    const W = x1 - x0;
    const g = 3.7; // rez-de-chaussée commercial
    const eave = g + 2.9;
    const shop = { u0: 0.45, u1: 5.45, v0: 0.0, v1: 2.95 };
    const S: OpeningSpec[] = [
      { kind: 'shop', r: shop, o: { awning: false, sign: false, doorAt: 'left', signMat: 'enseigne' } },
      { kind: 'door', r: rectAt(6.55, 0.95, 0.05, 2.45), o: { style: 'panneaux', transom: 0.35, doorMat: 'porte' } },
      ...row([1.9, 5.7], 1.15, g + 0.35, 1.75, () => ({ kind: 'window', o: { shutters: 'battants', sill: false, railing: 'fer', leaves: 2, bars: 2, surround: 0.12 } })),
    ];
    const N: OpeningSpec[] = [
      { kind: 'door', r: rectAt(2.0, 1.0, 0.05, 2.3), o: { style: 'vitree' } },
      { kind: 'window', r: rectAt(5.2, 1.2, 1.1, 1.0), o: { shutters: 'none', bars: 1 } },
      ...row([2.0, 5.5], 1.0, g + 0.7, 1.4, () => ({ kind: 'window', o: { shutters: 'battants', leaves: 2 } })),
    ];
    const F = volume(ctx, {
      x0, x1, z0, z1, h: eave, wallMat: 'facade', sides: { S, N, E: row([3.4], 1.0, g + 0.7, 1.4, () => ({ kind: 'window', o: { shutters: 'battants' } })) },
      plinth: { h: 0.35, d: 0.04 }, ...(ctx.lod === 0 ? { quoins: { v0: g + 0.2 } } : {}),
      bands: [{ v: g, h: 0.2, d: 0.08 }], cornice: { profile: [[0.12, 0.06], [0.1, 0.14]] },
    });
    // devanture boiserie : pilastres + bandeau d'enseigne + lettrage
    fbox(ctx, 'enseigne', F.S, shop.u0 - 0.3, shop.u0, 0, g - 0.05, 0, 0.14, 'back');
    fbox(ctx, 'enseigne', F.S, shop.u1, shop.u1 + 0.3, 0, g - 0.05, 0, 0.14, 'back');
    fbox(ctx, 'enseigne', F.S, shop.u0 - 0.35, shop.u1 + 0.35, shop.v1 + 0.02, g - 0.02, 0, 0.16, 'back');
    fbox(ctx, 'enseigne', F.S, shop.u0 - 0.42, shop.u1 + 0.42, g - 0.1, g + 0.02, 0, 0.24, 'back');
    lettering(ctx, 'lettres', F.S, 'BOULANGERIE', (shop.u0 + shop.u1) / 2, shop.v1 + 0.2, 0.36, 0.16, 0.04);
    stripedAwning(ctx, F.S, shop.u0, shop.u1, shop.v1 - 0.02, 1.25, 0.55, { stripe: 0.3 });
    // enseigne drapeau (épi de blé stylisé)
    const fl = subFrame(F.S, 7.2, g + 0.6, 0, 1, 1);
    fbox(ctx, 'garde_corps', fl, -0.05, 0.05, 0.5, 0.56, 0, 0.75, '');
    const blade = edgeFrame(P(fl, 0, 0, 0.12)[0] - 0.02, P(fl, 0, 0, 0.12)[2], P(fl, 0, 0, 0.82)[0] - 0.02, P(fl, 0, 0, 0.82)[2], fl.o[1], 1);
    fbox(ctx, 'enseigne', blade, 0, 0.7, -0.35, 0.45, -0.03, 0.03, '');
    disc(ctx, 'lettres', blade, 0.35, 0.05, 0.22, 0.035, 14);
    const bladeB = { ...blade, o: P(blade, 0.7, 0, 0), u: [-blade.u[0], 0, -blade.u[2]] as [number, number, number], n: [-blade.n[0], 0, -blade.n[2]] as [number, number, number] };
    disc(ctx, 'lettres', bladeB, 0.35, 0.05, 0.22, 0.035, 14);
    // toiture : deux pans, lucarne, souche
    const roof = gableRoof(ctx, { x0, x1, z0, z1, y: eave + 0.22, pitch: 38, axis: 'x', overhang: 0.35, verge: 0.2, gableMat: 'facade' });
    dormer(ctx, subFrame(F.S, 0, 0, -0.9, W, 10), 3.8, eave + 0.95, 1.3, 1.25, 2.2, { wallMat: 'rive', cheekMat: 'rive', win: { leaves: 2, bars: 1 } });
    chimney(ctx, 2.6, -1.0, 0.6, 0.5, roof.ridgeY - 1.4, roof.ridgeY + 0.9, { pots: 2 });
    downpipe(ctx, F.S, 0.15, eave);
    wallAC(ctx, F.N, 6.4, 2.6);
    // terrasse devant : banc et jardinières
    bench(ctx, x1 - 0.9, 0, z1 + 0.45, 0, 1.2);
    planter(ctx, x0 + 0.1, z1 + 0.15, x0 + 0.8, z1 + 0.7, 0, 0.45);
  },
};

/* ------------------------------------------------------------------ */
/* 2. Supermarché avec parking                                          */
/* ------------------------------------------------------------------ */
export const supermarche: BuildingDef = {
  id: 'commerce_supermarche',
  nameFr: 'Supermarché et son parking',
  category: 'commercial',
  footprint: { tilesX: 4, tilesZ: 4 },
  cost: 680000,
  upkeepPerMonth: 1300,
  residents: 0,
  jobs: 65,
  density: 'moyenne',
  style: 'grande_surface',
  tags: ['commerce', 'grande_surface', 'parking', 'quai_livraison', 'service:alimentation', 'rayon:900'],
  source: `${SRC}#supermarche`,
  lodDistances: [180, 700],
  frontage: [{ x: 0, z: 15.6, nx: 0, nz: 1, kind: 'vehicle' }, { x: 15.6, z: -10, nx: 1, nz: 0, kind: 'delivery' }],
  palette: npPalette({
    facade: M('panneaux_facade_sombres', '#c9ccce'),
    facade_b: M('bardage_composite', '#ffffff'),
    soubassement: M('beton_facade', '#b8b4ac'),
    enseigne: M('enduit_peint', '#1f6f4a'),
    logo: M('enduit_peint', '#f08a24'),
    logo_b: M('enduit_peint', '#8cc63f'),
    dalle: M('beton_facade', '#e4e1da'),
    menuiserie: M('bardage_blanc', '#d9dcdd', { metalness: 0.6, roughness: 0.4 }),
    store: M('metal_rideau', '#d4d6d6'),
  }),
  variants: [
    { id: 'origine', nameFr: 'Vert et orange' },
    { id: 'bleu', nameFr: 'Bleu et jaune', materialOverrides: { enseigne: { color: '#1d4f8f' }, logo: { color: '#f2c230' }, logo_b: { color: '#ffffff' } } },
    { id: 'rouge', nameFr: 'Rouge, bardage bois', materialOverrides: { enseigne: { color: '#b02a2a' }, facade_b: { textureSet: 'bardage_bois', color: '#ffffff' } } },
  ],
  build(ctx: Ctx): void {
    const x0 = -15.6, x1 = 13.2, z0 = -15.6, z1 = -2.8;
    const H = 7.2;
    const W = x1 - x0;
    const ent = { u0: 10.4, u1: 18.4 };
    const F = volume(ctx, {
      x0, x1, z0, z1, h: H, wallMat: 'facade',
      sides: {
        S: [{ kind: 'blind', r: { u0: ent.u0, u1: ent.u1, v0: 0, v1: 5.4 } }, ...row([3.2, 7.2, 21.6, 25.6], 3.2, 0.6, 2.2, () => ({ kind: 'window', o: { shutters: 'none', leaves: 3, sill: true, reveal: 0.2 } }))],
        N: [{ kind: 'door', r: rectAt(5, 1.0, 0.05, 2.2), o: { style: 'moderne' } }, { kind: 'door', r: rectAt(26, 1.0, 0.05, 2.2), o: { style: 'moderne' } }],
        E: [{ kind: 'blind', r: { u0: 1.6, u1: 4.6, v0: 1.2, v1: 4.7 } }, { kind: 'blind', r: { u0: 6.2, u1: 9.2, v0: 1.2, v1: 4.7 } }, { kind: 'door', r: rectAt(11.6, 1.0, 1.25, 2.2), o: { style: 'moderne', steps: 1.2 } }],
      },
      plinth: { h: 0.6, d: 0.03 },
    });
    // bardage composite en bandeau haut (attique) + couvertine
    fbox(ctx, 'facade_b', F.S, -0.1, W + 0.1, H - 1.6, H + 0.6, 0, 0.12, 'back');
    for (const s of [F.E, F.W, F.N]) fbox(ctx, 'facade_b', s, -0.1, s.w + 0.1, H - 1.6, H + 0.6, 0, 0.12, 'back');
    flatRoof(ctx, { x0, x1, z0, z1, y: H - 0.2, parapet: H + 0.6, t: 0.3 });
    // entrée vitrée (sas) en saillie sous un portique
    curtainWall(ctx, F.S, { u0: ent.u0, u1: ent.u1, v0: 0, v1: 5.4, cols: 8, floorH: 2.7, mullionMat: 'menuiserie' });
    const pf = subFrame(F.S, 0, 0, 0, W, H);
    fbox(ctx, 'enseigne', pf, ent.u0 - 1.0, ent.u0 - 0.2, 0, H + 2.6, 0, 2.6, 'back');
    fbox(ctx, 'enseigne', pf, ent.u1 + 0.2, ent.u1 + 1.0, 0, H + 2.6, 0, 2.6, 'back');
    fbox(ctx, 'enseigne', pf, ent.u0 - 1.0, ent.u1 + 1.0, H - 0.6, H + 2.6, 0.2, 2.6, '');
    lettering(ctx, 'lettres', pf, 'MARCHÉ', (ent.u0 + ent.u1) / 2 + 0.8, H + 0.35, 1.1, 2.6, 0.08);
    // logo original : soleil levant + feuille
    const lu = (ent.u0 + ent.u1) / 2 - 3.6;
    disc(ctx, 'logo', pf, lu, H + 0.95, 0.75, 2.64, ctx.lod === 0 ? 20 : 10);
    fpf(ctx, 'logo_b', pf, [[lu + 0.2, H + 0.55, 2.68], [lu + 1.15, H + 1.3, 2.68], [lu + 0.55, H + 1.75, 2.68]], [0, 0, 1]);
    // auvent filant (marquise) devant les vitrines
    fbox(ctx, 'dalle', F.S, 0.8, W - 0.8, 3.4, 3.65, 0, 2.6, '');
    for (const u of [1.2, 5.4, 9.4, 19.4, 23.4, 27.6]) ctx.mb.cylinder('acier', P(F.S, u, 0, 2.3)[0], 0, P(F.S, u, 0, 2.3)[2], 0.1, 3.4, ctx.lod === 0 ? 8 : 5, false);
    // petites enseignes de rayons sur la marquise
    if (ctx.lod < 2) {
      lettering(ctx, 'enseigne', subFrame(F.S, 0, 0, 2.6, W, H), 'PRIMEURS', 5.5, 3.42, 0.22, 0.0, 0.03);
      lettering(ctx, 'enseigne', subFrame(F.S, 0, 0, 2.6, W, H), 'BOULANGERIE', 23.6, 3.42, 0.22, 0.0, 0.03);
    }
    // quais de livraison (est)
    for (const r of [{ u0: 1.6, u1: 4.6 }, { u0: 6.2, u1: 9.2 }]) {
      const fr = F.E;
      fpf(ctx, 'store', fr, [[r.u0, 1.2, -0.08], [r.u1, 1.2, -0.08], [r.u1, 4.7, -0.08], [r.u0, 4.7, -0.08]], [0, 0, 1]);
      fbox(ctx, 'beton', fr, r.u0 - 0.6, r.u1 + 0.6, 0, 1.2, 0, 0.6, 'back bottom');
      if (ctx.lod < 2) {
        fbox(ctx, 'garde_corps', fr, r.u0 - 0.3, r.u0, 1.2, 4.9, 0, 0.5, 'back');
        fbox(ctx, 'garde_corps', fr, r.u1, r.u1 + 0.3, 1.2, 4.9, 0, 0.5, 'back');
        fbox(ctx, 'garde_corps', fr, r.u0 - 0.3, r.u1 + 0.3, 4.7, 5.1, 0, 0.5, 'back');
        fbox(ctx, 'marquage_j', fr, r.u0 - 0.6, r.u1 + 0.6, 1.05, 1.2, 0.6, 0.61, 'back');
      }
    }
    fbox(ctx, 'dalle', F.E, 0.8, 10.0, 5.2, 5.4, 0, 1.6, '');
    // toiture : CTA, groupes froids, lanterneaux
    rooftopUnit(ctx, -9, H - 0.2, -11, 3.2, 1.8, 1.4);
    rooftopUnit(ctx, -3, H - 0.2, -11, 3.2, 1.8, 1.4);
    rooftopUnit(ctx, 9, H - 0.2, -12.5, 2.0, 1.4, 1.0);
    for (const x of [-10, -3, 4, 11]) for (const z of [-7]) {
      ctx.mb.box('menuiserie', x - 1, H - 0.2, z - 1, x + 1, H + 0.15, z + 1, 'ny py');
      const prev = ctx.mb.lit; ctx.mb.lit = -1;
      ctx.mb.polyFacing('verre', [[x - 1, H + 0.15, z + 1], [x + 1, H + 0.15, z + 1], [x + 0.6, H + 0.55, z], [x - 0.6, H + 0.55, z]], [0, 1, 1]);
      ctx.mb.polyFacing('verre', [[x - 1, H + 0.15, z - 1], [x + 1, H + 0.15, z - 1], [x + 0.6, H + 0.55, z], [x - 0.6, H + 0.55, z]], [0, 1, -1]);
      ctx.mb.lit = prev;
    }
    // parking (devant) + parvis
    slab(ctx, 'dallage', x0, z1, x1, z1 + 2.6, 0, 0.14);
    parkingLot(ctx, x0, z1 + 2.6, 15.6, 15.6, 0, { disabled: 2, stallD: 4.8, aisle: 5.4 });
    // abri à chariots
    const cx = 9.5, cz = 7.6;
    if (ctx.lod < 2) for (const dx of [-2.5, 2.5]) for (const dz of [-0.9, 0.9]) ctx.mb.box('acier', cx + dx - 0.05, 0, cz + dz - 0.05, cx + dx + 0.05, 2.3, cz + dz + 0.05, 'ny');
    ctx.mb.box('enseigne', cx - 2.7, 2.3, cz - 1.1, cx + 2.7, 2.45, cz + 1.1, '');
    if (ctx.lod === 0) for (let k = 0; k < 7; k++) ctx.mb.box('acier', cx - 2.2 + k * 0.6, 0.15, cz - 0.7, cx - 2.0 + k * 0.6, 1.0, cz + 0.7, 'ny');
    // bornes et arbustes du parvis
    for (const x of [-12, -6, 6]) planter(ctx, x - 0.8, z1 + 0.6, x + 0.8, z1 + 1.6, 0.14, 0.45);
  },
};

/* ------------------------------------------------------------------ */
/* 3. Café-brasserie d'angle à terrasse (R+2 + mansarde)               */
/* ------------------------------------------------------------------ */
export const cafe: BuildingDef = {
  id: 'commerce_cafe_terrasse',
  nameFr: 'Café-brasserie à terrasse',
  category: 'commercial',
  footprint: { tilesX: 2, tilesZ: 2 },
  cost: 160000,
  upkeepPerMonth: 260,
  residents: 8,
  jobs: 12,
  density: 'moyenne',
  style: 'brasserie',
  tags: ['commerce', 'restaurant', 'cafe', 'terrasse', 'mansarde', 'service:restauration', 'rayon:400'],
  source: `${SRC}#cafe`,
  palette: npPalette({
    facade: M('pierre_taille', '#efe6d4'),
    soubassement: M('pierre_taille', '#cfc4b0'),
    encadrement: M('pierre_taille', '#f6f0e4'),
    toiture: M('toit_ardoise', '#7d838a'),
    zinc: M('toit_tole_ondulee', '#7f868b', { metalness: 1, roughness: 0.5 }),
    menuiserie: M('bardage_blanc', '#2b3b34', { roughness: 0.5 }),
    enseigne: M('bardage_blanc', '#233a30'),
    lettres: M('enduit_blanc', '#e3c27a', { metalness: 0.7, roughness: 0.3 }),
    store_a: M('enduit_peint', '#7a2430', { doubleSided: true }),
    store_b: M('enduit_blanc', '#efe7d6', { doubleSided: true }),
    bois: M('bardage_bois', '#ffffff'),
  }),
  variants: [
    { id: 'origine', nameFr: 'Pierre, devanture vert anglais, stores bordeaux' },
    { id: 'rouge', nameFr: 'Devanture rouge, stores rayés rouges', materialOverrides: { enseigne: { color: '#7c1f1c' }, menuiserie: { color: '#7c1f1c' }, store_a: { color: '#b3302a' } } },
    { id: 'noir', nameFr: 'Brique et devanture noire, stores gris', materialOverrides: { facade: { textureSet: 'brique_orange', color: '#ffffff' }, enseigne: { color: '#1b1b1b' }, menuiserie: { color: '#1b1b1b' }, store_a: { color: '#4a4f55' } } },
  ],
  build(ctx: Ctx): void {
    const x0 = -7.6, x1 = 5.4, z0 = -7.6, z1 = 1.2;
    const g = 4.0, fh = 3.0;
    const top = g + 2 * fh;
    const W = x1 - x0, D = z1 - z0;
    const usS = bays(W, 5, 0.2);
    const usE = bays(D, 3, 0.3);
    const shopS = usS.map((u) => ({ u0: u - 1.0, u1: u + 1.0, v0: 0, v1: 3.1 }));
    const shopE = usE.map((u) => ({ u0: u - 1.05, u1: u + 1.05, v0: 0, v1: 3.1 }));
    const up = (us: number[]): OpeningSpec[] => [0, 1].flatMap((f) => row(us, 1.2, g + f * fh + 0.05, 2.15, () => ({ kind: 'window', o: { sill: false, railing: null, leaves: 2, bars: 2, surround: 0.14, keystone: true, shutters: 'none' } })));
    const F = volume(ctx, {
      x0, x1, z0, z1, h: top, wallMat: 'facade',
      sides: {
        S: [...shopS.map((r, i) => ({ kind: 'shop' as const, r, o: { sign: false, awning: false, doorAt: i === 2 ? 'center' as const : 'left' as const } })), ...up(usS)],
        E: [...shopE.map((r) => ({ kind: 'shop' as const, r, o: { sign: false, awning: false, doorAt: 'center' as const } })), ...up(usE)],
        W: up(usE),
        N: [{ kind: 'door', r: rectAt(3, 1.0, 0.05, 2.3), o: { style: 'panneaux' } }, ...[0, 1].flatMap((f) => row(bays(W, 4, 0.6), 1.1, g + f * fh + 0.8, 1.5, () => ({ kind: 'window', o: { shutters: 'battants', leaves: 2 } })))],
      },
      plinth: { h: 0.3, d: 0.04 }, ...(ctx.lod === 0 ? { quoins: { v0: g } } : {}),
      bands: [{ v: g - 0.05, h: 0.22, d: 0.1 }, { v: g + fh - 0.05, h: 0.16, d: 0.06 }],
      cornice: { profile: [[0.12, 0.06], [0.1, 0.16], [0.14, 0.3]] },
    });
    // balcon filant au 2e étage (fer forgé)
    balcony(ctx, F.S, 0.2, W - 0.2, g + fh, { depth: 0.7, rail: 'fer', consoles: true });
    balcony(ctx, F.E, 0.2, D - 0.2, g + fh, { depth: 0.7, rail: 'barreaux', consoles: true });
    // devanture : bandeau d'enseigne filant sur les deux rues + lettrage
    for (const [fr, w, txt] of [[F.S, W, 'CAFÉ DE L\'AUBE'], [F.E, D, 'BRASSERIE']] as const) {
      fbox(ctx, 'enseigne', fr, -0.05, w + 0.05, 3.15, g - 0.08, 0, 0.18, 'back');
      lettering(ctx, 'lettres', fr, txt, w / 2, 3.3, 0.42, 0.18, 0.04);
      for (const u of fr === F.S ? usS : usE) {
        const hw = fr === F.S ? 1.0 : 1.05;
        fbox(ctx, 'enseigne', fr, u - hw - 0.25, u - hw, 0, 3.15, 0, 0.12, 'back');
        stripedAwning(ctx, fr, u - hw - 0.05, u + hw + 0.05, 3.12, fr === F.S ? 1.8 : 1.4, 0.65, { stripe: 0.38 });
      }
      fbox(ctx, 'enseigne', fr, w - 0.3, w, 0, 3.15, 0, 0.12, 'back');
    }
    // mansarde ardoise + lucarnes
    const m = mansardRoof(ctx, { x0, x1, z0, z1, y: top + 0.4, lowerH: 2.8, inset: 1.0, upperPitch: 12 });
    void m;
    for (const u of usS) dormer(ctx, subFrame(F.S, 0, 0, 0.02, W, 10), u, top + 0.6, 1.1, 1.5, 0.8, { wallMat: 'encadrement', cheekMat: 'zinc', roofMat: 'zinc', pitch: 40, win: { leaves: 2, bars: 1 } });
    chimney(ctx, -4.2, -6.6, 1.4, 0.55, top + 2.4, top + 4.6, { pots: 3, mat: 'facade' });
    chimney(ctx, 3.0, -6.6, 1.4, 0.55, top + 2.4, top + 4.6, { pots: 3, mat: 'facade' });
    // terrasse : plancher bois, garde-corps bas en jardinières, tables et parasols
    slab(ctx, 'bois', x0 + 0.3, z1 + 0.3, x1 - 0.3, z1 + 6.6, 0, 0.12);
    planter(ctx, x0 + 0.3, z1 + 6.0, x0 + 4.5, z1 + 6.6, 0.12, 0.6);
    planter(ctx, x1 - 4.5, z1 + 6.0, x1 - 0.3, z1 + 6.6, 0.12, 0.6);
    planter(ctx, x0 + 0.3, z1 + 0.8, x0 + 0.9, z1 + 6.0, 0.12, 0.6);
    planter(ctx, x1 - 0.9, z1 + 0.8, x1 - 0.3, z1 + 6.0, 0.12, 0.6);
    const tables: [number, number][] = [[-5.2, 2.8], [-2.2, 2.8], [0.8, 2.8], [3.4, 2.8], [-3.8, 5.4], [-0.8, 5.4], [2.2, 5.4]];
    tables.forEach(([x, z], i) => terraceSet(ctx, x, 0.12, z1 + z - 1.2, i % 3 === 0 ? 'store_b' : i % 3 === 1 ? 'store_a' : null));
    // ardoise menu sur pied
    if (ctx.lod < 2) {
      const fr = edgeFrame(-0.7, z1 + 6.3, 0.0, z1 + 6.3, 0.12, 1);
      fbox(ctx, 'garde_corps', fr, 0, 0.6, 0.0, 1.0, -0.03, 0.03, '');
    }
    lampPost(ctx, x1 - 0.6, 0.12, z1 + 3.5, 4.2, [-1, 0, 0]);
  },
};

/* ------------------------------------------------------------------ */
/* 4. Station-service                                                   */
/* ------------------------------------------------------------------ */
function pump(ctx: Ctx, x: number, z: number): void {
  const { mb } = ctx;
  mb.box('beton', x - 0.45, 0.12, z - 0.35, x + 0.45, 0.3, z + 0.35, 'ny');
  mb.box('menuiserie', x - 0.38, 0.3, z - 0.28, x + 0.38, 1.9, z + 0.28, 'ny');
  mb.box('enseigne', x - 0.4, 1.9, z - 0.3, x + 0.4, 2.15, z + 0.3, 'ny');
  if (ctx.lod === 2) return;
  for (const s of [1, -1]) {
    // écran et pistolets
    const zz = z + s * 0.285;
    const prev = mb.lit; mb.lit = 2;
    mb.polyFacing('verre', [[x - 0.2, 1.35, zz], [x + 0.2, 1.35, zz], [x + 0.2, 1.62, zz], [x - 0.2, 1.62, zz]], [0, 0, s]);
    mb.lit = prev;
    mb.box('garde_corps', x - 0.32, 0.8, zz, x + 0.32, 1.2, zz + s * 0.06);
    if (ctx.lod === 0) for (let k = 0; k < 3; k++) {
      const px = x - 0.24 + k * 0.24;
      mb.box(k === 1 ? 'logo' : k === 2 ? 'logo_b' : 'garde_corps', px - 0.04, 0.85, zz + s * 0.06, px + 0.04, 1.15, zz + s * 0.14);
      mb.tube('garde_corps', [px, 0.85, zz + s * 0.1], [px + 0.05, 0.35, zz + s * 0.25], 0.018, 4);
    }
  }
}

export const stationService: BuildingDef = {
  id: 'commerce_station_service',
  nameFr: 'Station-service et boutique',
  category: 'commercial',
  footprint: { tilesX: 3, tilesZ: 3 },
  cost: 220000,
  upkeepPerMonth: 420,
  residents: 0,
  jobs: 8,
  density: 'faible',
  style: 'station',
  tags: ['commerce', 'carburant', 'auvent', 'totem', 'service:carburant', 'rayon:1500'],
  source: `${SRC}#stationService`,
  frontage: [{ x: -6, z: 12, nx: 0, nz: 1, kind: 'vehicle' }, { x: 6, z: 12, nx: 0, nz: 1, kind: 'vehicle' }],
  palette: npPalette({
    facade: M('panneaux_facade_sombres', '#e8eaeb'),
    enseigne: M('enduit_peint', '#0f6a8f'),
    logo: M('enduit_peint', '#f2b32a'),
    logo_b: M('enduit_peint', '#2fa36b'),
    menuiserie: M('bardage_blanc', '#eef0f0', { metalness: 0.3, roughness: 0.4 }),
    dalle: M('bardage_blanc', '#f4f5f5', { metalness: 0.2, roughness: 0.35 }),
    beton: M('sol_beton_brut', '#d8d6d0'),
  }),
  variants: [
    { id: 'origine', nameFr: 'Bleu pétrole et jaune' },
    { id: 'vert', nameFr: 'Vert et blanc', materialOverrides: { enseigne: { color: '#1f7a43' }, logo: { color: '#ffffff' } } },
    { id: 'rouge', nameFr: 'Rouge et gris', materialOverrides: { enseigne: { color: '#b3261e' }, logo: { color: '#d9d9d9' }, logo_b: { color: '#f2b32a' } } },
  ],
  build(ctx: Ctx): void {
    // sols
    slab(ctx, 'sol', -12, -12, 12, 12, -0.1, 0.1);
    slab(ctx, 'beton', -8.5, -3.2, 8.5, 7.6, 0, 0.12);
    // boutique (fond de parcelle)
    const bx0 = -10.5, bx1 = 3.5, bz0 = -11.4, bz1 = -5.2, bh = 4.2;
    const B = volume(ctx, {
      x0: bx0, x1: bx1, z0: bz0, z1: bz1, h: bh, wallMat: 'facade',
      sides: {
        S: [{ kind: 'blind', r: { u0: 1.0, u1: 10.0, v0: 0, v1: 3.2 } }],
        N: [{ kind: 'door', r: rectAt(3, 1.0, 0.05, 2.2), o: { style: 'moderne' } }],
        E: [{ kind: 'door', r: rectAt(2.5, 0.9, 0.05, 2.2), o: { style: 'moderne' } }, { kind: 'window', r: rectAt(4.5, 1.2, 1.2, 0.9), o: { shutters: 'none' } }],
      },
      plinth: { h: 0.3, d: 0.02, mat: 'soubassement' },
    });
    curtainWall(ctx, B.S, { u0: 1.0, u1: 10.0, v0: 0, v1: 3.2, cols: 6, floorH: 3.2, mullionMat: 'menuiserie' });
    fbox(ctx, 'enseigne', B.S, -0.1, B.S.w + 0.1, 3.2, bh + 0.5, 0, 0.15, 'back');
    for (const s of [B.E, B.W, B.N]) fbox(ctx, 'enseigne', s, -0.1, s.w + 0.1, bh - 0.5, bh + 0.5, 0, 0.15, 'back');
    lettering(ctx, 'lettres', B.S, 'BOUTIQUE', 5.5, 3.45, 0.5, 0.15, 0.05);
    flatRoof(ctx, { x0: bx0, x1: bx1, z0: bz0, z1: bz1, y: bh, parapet: bh + 0.5, t: 0.2, copingMat: 'menuiserie' });
    rooftopUnit(ctx, -7, bh, -9.5, 1.6, 1.0, 0.9);
    fbox(ctx, 'dalle', B.S, 0.5, 10.5, 3.0, 3.18, 0, 1.4, '');
    // lavage (portique) à droite de la boutique
    const wx0 = 4.4, wx1 = 11.4;
    const WB = volume(ctx, { x0: wx0, x1: wx1, z0: -11.4, z1: -5.0, h: 4.6, wallMat: 'facade', sides: { S: [{ kind: 'blind', r: { u0: 1.6, u1: 5.4, v0: 0, v1: 3.8 } }] } });
    flatRoof(ctx, { x0: wx0, x1: wx1, z0: -11.4, z1: -5.0, y: 4.6, parapet: 5.0, t: 0.2, copingMat: 'menuiserie' });
    fpf(ctx, 'store', WB.S, [[1.6, 0, -1.5], [5.4, 0, -1.5], [5.4, 3.8, -1.5], [1.6, 3.8, -1.5]], [0, 0, 1]);
    if (ctx.lod < 2) {
      fpf(ctx, 'facade', WB.S, [[1.6, 0, 0], [1.6, 0, -1.5], [1.6, 3.8, -1.5], [1.6, 3.8, 0]], [1, 0, 0]);
      fpf(ctx, 'facade', WB.S, [[5.4, 0, -1.5], [5.4, 0, 0], [5.4, 3.8, 0], [5.4, 3.8, -1.5]], [-1, 0, 0]);
      fpf(ctx, 'facade', WB.S, [[1.6, 3.8, -1.5], [5.4, 3.8, -1.5], [5.4, 3.8, 0], [1.6, 3.8, 0]], [0, -1, 0]);
    }
    fbox(ctx, 'enseigne', WB.S, -0.1, WB.S.w + 0.1, 4.0, 5.0, 0, 0.15, 'back');
    lettering(ctx, 'lettres', WB.S, 'LAVAGE', 3.5, 4.2, 0.55, 0.15, 0.05);
    // auvent des pistes
    const cy = 5.4, cx0 = -8, cx1 = 8, cz0 = -2.6, cz1 = 7.0;
    for (const [x, z] of [[-4, 0.4], [4, 0.4], [-4, 4.0], [4, 4.0]] as const) {
      ctx.mb.box('menuiserie', x - 0.22, 0.12, z - 0.22, x + 0.22, cy, z + 0.22, 'ny');
      if (ctx.lod < 2) ctx.mb.box('beton', x - 0.35, 0.12, z - 0.35, x + 0.35, 0.5, z + 0.35, 'ny');
    }
    ctx.mb.box('dalle', cx0, cy, cz0, cx1, cy + 1.0, cz1, '');
    const Cs = edgeFrame(cx0, cz1, cx1, cz1, cy, 1.0), Cn = edgeFrame(cx1, cz0, cx0, cz0, cy, 1.0);
    const Ce = edgeFrame(cx1, cz1, cx1, cz0, cy, 1.0), Cw = edgeFrame(cx0, cz0, cx0, cz1, cy, 1.0);
    for (const fr of [Cs, Cn, Ce, Cw]) {
      fbox(ctx, 'enseigne', fr, -0.02, fr.w + 0.02, 0.12, 0.42, 0, 0.03, 'back');
      fbox(ctx, 'logo', fr, -0.02, fr.w + 0.02, 0.42, 0.5, 0, 0.035, 'back');
    }
    for (const fr of [Cs, Cn]) {
      lettering(ctx, 'enseigne', fr, 'RELAIS', fr.w / 2 + 1.0, 0.55, 0.36, 0.0, 0.04);
      disc(ctx, 'logo', fr, fr.w / 2 - 2.0, 0.73, 0.22, 0.02, 14);
    }
    // éclairage sous auvent
    if (ctx.lod < 2) {
      const prev = ctx.mb.lit; ctx.mb.lit = 2;
      for (const x of [-6, -2, 2, 6]) for (const z of [-0.6, 2.2, 5.0]) ctx.mb.quad('verre', [x - 0.6, cy - 0.01, z + 0.3], [x - 0.6, cy - 0.01, z - 0.3], [x + 0.6, cy - 0.01, z - 0.3], [x + 0.6, cy - 0.01, z + 0.3]);
      ctx.mb.lit = prev;
    }
    // îlots et pompes
    for (const x of [-4, 4]) {
      ctx.mb.box('beton', x - 0.6, 0.12, -1.6, x + 0.6, 0.3, 6.0, 'ny');
      ctx.mb.box('marquage_j', x - 0.62, 0.12, -1.62, x + 0.62, 0.2, -1.5, 'ny');
      pump(ctx, x, 1.0);
      pump(ctx, x, 3.4);
      if (ctx.lod < 2) {
        ctx.mb.box('acier', x - 0.2, 0.3, 5.0, x + 0.2, 1.0, 5.4, 'ny');
        ctx.mb.box('marquage_j', x - 0.06, 0.12, -2.6, x + 0.06, 0.95, -2.4, 'ny');
      }
    }
    // marquages au sol
    if (ctx.lod < 2) for (const x of [-8.2, 0, 8.2]) ctx.mb.quad('marquage', [x - 0.07, 0.125, 7.4], [x + 0.07, 0.125, 7.4], [x + 0.07, 0.125, -3.0], [x - 0.07, 0.125, -3.0]);
    // totem des prix
    const tx = -10.6, tz = 10.4;
    ctx.mb.box('beton', tx - 0.9, 0, tz - 0.4, tx + 0.9, 0.5, tz + 0.4, 'ny');
    ctx.mb.box('enseigne', tx - 0.8, 0.5, tz - 0.25, tx + 0.8, 6.4, tz + 0.25, 'ny');
    const T = edgeFrame(tx - 0.8, tz + 0.25, tx + 0.8, tz + 0.25, 0.5, 6.0);
    disc(ctx, 'logo', T, 0.8, 5.2, 0.5, 0.02, 16);
    ring(ctx, 'lettres', T, 0.8, 5.2, 0.5, 0.58, 0, 0.04, 16);
    const prices: [string, string][] = [['GAZOLE', '1.79'], ['SP95', '1.89'], ['SP98', '1.96']];
    prices.forEach(([lab, p], i) => {
      const v = 3.6 - i * 0.95;
      fbox(ctx, 'garde_corps', T, 0.1, 1.5, v, v + 0.8, 0, 0.03, 'back');
      lettering(ctx, 'lettres', T, lab, 0.8, v + 0.55, 0.14, 0.03, 0.01);
      lettering(ctx, 'logo', T, p, 0.8, v + 0.1, 0.32, 0.03, 0.01);
    });
    // borne de gonflage et poubelles
    if (ctx.lod < 2) {
      ctx.mb.box('enseigne', 9.6, 0, 9.2, 10.2, 1.4, 9.7, 'ny');
      hCylinder(ctx, 'acier', [9.9, 1.0, 9.7], [9.9, 1.0, 9.85], 0.18, 10);
    }
    lampPost(ctx, 11.3, 0, 0.5, 7, [-1, 0, 0]);
    lampPost(ctx, -11.3, 0, 0.5, 7, [1, 0, 0]);
    shrub(ctx, 10.6, 0, 11.0, 0.7);
    shrub(ctx, -8.6, 0, 11.0, 0.6);
  },
};

/* ------------------------------------------------------------------ */
/* 5. Centre commercial (galerie, cinéma, enseigne locomotive)          */
/* ------------------------------------------------------------------ */
export const centreCommercial: BuildingDef = {
  id: 'commerce_centre_commercial',
  nameFr: 'Centre commercial',
  category: 'commercial',
  footprint: { tilesX: 5, tilesZ: 4 },
  cost: 2400000,
  upkeepPerMonth: 4200,
  residents: 0,
  jobs: 320,
  density: 'forte',
  style: 'centre_commercial',
  tags: ['commerce', 'galerie_marchande', 'cinema', 'verriere', 'service:commerces', 'rayon:2500'],
  source: `${SRC}#centreCommercial`,
  lodDistances: [220, 900],
  palette: npPalette({
    facade: M('panneaux_facade_sombres', '#d9dcdc'),
    facade_b: M('carreaux_facade', '#ffffff'),
    soubassement: M('beton_facade', '#b1aca2'),
    enseigne: M('enduit_peint', '#2c2f6b'),
    logo: M('enduit_peint', '#e94e3d'),
    logo_b: M('enduit_peint', '#f6c445'),
    dalle: M('beton_facade', '#ece9e3'),
    menuiserie: M('bardage_blanc', '#c9ccce', { metalness: 0.6, roughness: 0.35 }),
    brique: M('brique_parement', '#ffffff'),
    bardage: M('bardage_bois', '#ffffff'),
  }),
  variants: [
    { id: 'origine', nameFr: 'Panneaux gris, cinéma bleu nuit' },
    { id: 'chaud', nameFr: 'Brique et bois', materialOverrides: { facade: { textureSet: 'brique_orange', color: '#ffffff' }, enseigne: { color: '#4a2a1f' } } },
    { id: 'clair', nameFr: 'Béton clair, enseignes vertes', materialOverrides: { facade: { textureSet: 'beton_facade', color: '#f2efe8' }, enseigne: { color: '#1f5c46' }, logo: { color: '#9ccb3b' } } },
  ],
  build(ctx: Ctx): void {
    const x0 = -19.6, x1 = 19.6, z0 = -15.6, z1 = 8.0;
    const H = 11.5;
    const W = x1 - x0;
    // corps principal (galerie)
    const shops = [2.2, 6.6, 11.0, 28.2, 32.6, 37.0];
    const F = volume(ctx, {
      x0: -12, x1: 12, z0, z1, h: H, wallMat: 'facade',
      sides: {
        S: [{ kind: 'blind', r: { u0: 7.0, u1: 17.0, v0: 0, v1: 10.0 } }, ...row([2.5, 21.5], 3.2, 0, 3.4, () => ({ kind: 'shop', o: { awning: false, sign: true, doorAt: 'center' } }))],
        N: [{ kind: 'door', r: rectAt(12, 2.0, 0.05, 2.6), o: { style: 'double' } }],
      },
      hidden: ['E', 'W'], plinth: { h: 0.5, d: 0.03 },
    });
    void shops;
    // entrée monumentale vitrée en saillie
    const ef = subFrame(F.S, 7.0, 0, 0, 10, 10);
    curtainWall(ctx, F.S, { u0: 7.0, u1: 17.0, v0: 0, v1: 10.0, cols: 8, floorH: 3.33, mullionMat: 'menuiserie', fin: 0.12 });
    fbox(ctx, 'dalle', ef, -0.8, 10.8, 10.0, 11.6, -0.2, 3.2, '');
    fbox(ctx, 'dalle', ef, -0.8, 0, 0, 10.0, -0.2, 3.2, 'back');
    fbox(ctx, 'dalle', ef, 10.0, 10.8, 0, 10.0, -0.2, 3.2, 'back');
    lettering(ctx, 'lettres', ef, 'LES ARCADES', 5.0, 10.35, 0.85, 3.2, 0.08);
    // ailes : cinéma (est) et grande enseigne (ouest)
    const cin = volume(ctx, {
      x0: 12, x1: x1, z0, z1, h: H + 3.0, wallMat: 'enseigne',
      sides: { S: [{ kind: 'door', r: rectAt(3.8, 3.6, 0.05, 2.8), o: { style: 'double', canopy: 'verre' } }], E: [{ kind: 'door', r: rectAt(4, 1.2, 0.05, 2.2), o: { style: 'moderne' } }] },
      hidden: ['W'], plinth: { h: 0.5, d: 0.03 },
    });
    flatRoof(ctx, { x0: 12, x1, z0, z1, y: H + 2.4, parapet: H + 3.0, t: 0.3 });
    // enseigne verticale du cinéma (lettres empilées)
    const vs = subFrame(cin.S, 0, 0, 0, cin.S.w, H + 3);
    fbox(ctx, 'logo', vs, 4.0, 4.3, 3.6, H + 3.4, 0, 1.4, '');
    const blade = edgeFrame(P(vs, 4.3, 0, 1.4)[0], P(vs, 4.3, 0, 1.4)[2], P(vs, 4.3, 0, 0)[0], P(vs, 4.3, 0, 0)[2], 0, 1);
    'CINÉMA'.split('').forEach((ch, i) => lettering(ctx, 'lettres', blade, ch, 0.7, H + 1.9 - i * 1.25, 0.9, 0.0, 0.05));
    // affiches lumineuses
    for (const u of [0.5, 5.7]) {
      fbox(ctx, 'garde_corps', cin.S, u, u + 1.4, 3.6, 5.8, 0, 0.1, 'back');
      glass(ctx, cin.S, u + 0.1, u + 1.3, 3.7, 5.7, 0.105, 2);
    }
    const anc = volume(ctx, {
      x0, x1: -12, z0, z1, h: H - 1.5, wallMat: 'brique',
      sides: {
        S: [{ kind: 'blind', r: { u0: 1.4, u1: 6.2, v0: 0, v1: 4.2 } }],
        W: row(bays(z1 - z0, 6, 1), 1.6, 3.0, 4.5, () => ({ kind: 'window', o: { shutters: 'none', leaves: 2, transom: 1.0 } })),
      },
      hidden: ['E'], plinth: { h: 0.5, d: 0.03 },
    });
    curtainWall(ctx, anc.S, { u0: 1.4, u1: 6.2, v0: 0, v1: 4.2, cols: 4, floorH: 4.2, mullionMat: 'menuiserie' });
    fbox(ctx, 'bardage', anc.S, 0, anc.S.w, 5.0, H - 1.5, 0, 0.1, 'back');
    lettering(ctx, 'enseigne', anc.S, 'MODE', 3.8, 6.7, 1.0, 0.1, 0.08);
    flatRoof(ctx, { x0, x1: -12, z0, z1, y: H - 2.1, parapet: H - 1.5, t: 0.3 });
    // bandeau carrelé + couronnement du corps central
    fbox(ctx, 'facade_b', F.S, 0, 7.0, 4.0, H, 0, 0.08, 'back');
    fbox(ctx, 'facade_b', F.S, 17.0, 24.0, 4.0, H, 0, 0.08, 'back');
    flatRoof(ctx, { x0: -12, x1: 12, z0, z1, y: H - 0.5, parapet: H + 0.3, t: 0.3 });
    // verrière en berceau sur la galerie (axe z)
    const vy = H - 0.5, vr = 3.2, vx = 0;
    const nseg = ctx.lod === 0 ? 8 : ctx.lod === 1 ? 6 : 4;
    for (let i = 0; i < nseg; i++) {
      const a = Math.PI - (i / nseg) * Math.PI, b = Math.PI - ((i + 1) / nseg) * Math.PI;
      const A: [number, number] = [vx + Math.cos(a) * vr, vy + 0.6 + Math.sin(a) * vr * 0.6];
      const Bp: [number, number] = [vx + Math.cos(b) * vr, vy + 0.6 + Math.sin(b) * vr * 0.6];
      const prev = ctx.mb.lit; ctx.mb.lit = 2;
      ctx.mb.polyFacing('verre', [[A[0], A[1], z0 + 2], [Bp[0], Bp[1], z0 + 2], [Bp[0], Bp[1], z1 - 2], [A[0], A[1], z1 - 2]], [Math.cos((a + b) / 2), Math.sin((a + b) / 2), 0]);
      ctx.mb.lit = prev;
    }
    if (ctx.lod < 2) {
      for (let z = z0 + 2; z <= z1 - 2 + 0.01; z += ctx.lod === 0 ? 2.4 : 4.8) {
        for (let i = 0; i < nseg; i++) {
          const a = Math.PI - (i / nseg) * Math.PI, b = Math.PI - ((i + 1) / nseg) * Math.PI;
          ctx.mb.tube('menuiserie', [vx + Math.cos(a) * vr, vy + 0.6 + Math.sin(a) * vr * 0.6, z], [vx + Math.cos(b) * vr, vy + 0.6 + Math.sin(b) * vr * 0.6, z], 0.06, 4);
        }
      }
      ctx.mb.box('menuiserie', -vr - 0.2, vy, z0 + 2, -vr + 0.1, vy + 0.6, z1 - 2, '');
      ctx.mb.box('menuiserie', vr - 0.1, vy, z0 + 2, vr + 0.2, vy + 0.6, z1 - 2, '');
    }
    for (const fr of [subFrame(edgeFrame(-vr, z1 - 2, vr, z1 - 2, vy, 3), 0, 0, 0, 2 * vr, 3)]) void fr;
    // pignons de la verrière
    for (const [z, s] of [[z1 - 2, 1], [z0 + 2, -1]] as const) {
      const pts: [number, number, number][] = [];
      for (let i = 0; i <= nseg; i++) { const a = Math.PI - (i / nseg) * Math.PI; pts.push([vx + Math.cos(a) * vr, vy + 0.6 + Math.sin(a) * vr * 0.6, z]); }
      pts.push([vr, vy, z], [-vr, vy, z]);
      const prev = ctx.mb.lit; ctx.mb.lit = 2;
      ctx.mb.polyFacing('verre', pts, [0, 0, s]);
      ctx.mb.lit = prev;
    }
    // équipements de toiture
    rooftopUnit(ctx, -8, H - 0.5, -11, 3.0, 1.8, 1.5);
    rooftopUnit(ctx, 8, H - 0.5, -11, 3.0, 1.8, 1.5);
    rooftopUnit(ctx, 16, H + 2.4, -8, 2.4, 1.6, 1.2);
    rooftopUnit(ctx, -16, H - 2.1, -6, 2.4, 1.6, 1.2);
    mast(ctx, 18, H + 2.4, -13, 4);
    // parvis : dallage, jardinières, bancs, lampadaires
    slab(ctx, 'dallage', x0, z1, x1, 15.6, 0, 0.14);
    for (const x of [-15, -6, 6, 15]) { planter(ctx, x - 1.2, 11.5, x + 1.2, 13.3, 0.14, 0.5); bench(ctx, x, 0.14, 10.6, 0, 1.8); }
    for (const x of [-10.5, 0, 10.5]) lampPost(ctx, x, 0.14, 14.6, 5.5, [0, 0, -1]);
    for (const x of [-18.5, 18.5]) shrub(ctx, x, 0.14, 14.0, 0.8);
    void W; void fence; void pallet; void cornice; void hCylinder; void litSeed;
  },
};

export const COMMERCE: BuildingDef[] = [boulangerie, supermarche, cafe, stationService, centreCommercial];
