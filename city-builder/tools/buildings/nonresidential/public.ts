/**
 * ÉQUIPEMENTS PUBLICS : hôtel de ville, école, caserne de pompiers, commissariat, hôpital,
 * musée-bibliothèque, église, gare, parc aménagé.
 */
import {
  bays, chimney, cornice, dormer, fbox, flatRoof, gableRoof, hipRoof, mansardRoof, mast, rectAt, rooftopUnit, row, stairHouse,
  subFrame, volume,
  type BuildingDef, type Ctx, type Frame, type OpeningSpec, type Rect,
} from '../kit/index';
import {
  archWindow, bench, clockFace, column, curtainWall, disc, dome, edgeFrame, fence, flagPole, fpf, glass, hCylinder, lampPost,
  lettering, litSeed, M, mark, wallStrip, npPalette, oculus, pediment, planter, polyFrames, regularPoly, ribbonFloors, ring, shrub, slab,
  spire, steps, P,
} from './parts';

const SRC = 'tools/buildings/nonresidential/public.ts';
const FLAG = ['drapeau_bleu', 'drapeau_blanc', 'drapeau_rouge'];
const flagRoles = {
  drapeau_bleu: M('enduit_peint', '#1f3f8f', { doubleSided: true }),
  drapeau_blanc: M('enduit_blanc', '#f6f6f2', { doubleSided: true }),
  drapeau_rouge: M('enduit_peint', '#c8202a', { doubleSided: true }),
};

/** Baies cintrées posées dans des trous `blind` d'une façade. */
function arches(ctx: Ctx, f: Frame, rs: Rect[], wallMat: string, o: Parameters<typeof archWindow>[4] = {}): void {
  for (const r of rs) archWindow(ctx, f, r, wallMat, o);
}
const archRect = (uc: number, w: number, v0: number, h: number): Rect => rectAt(uc, w, v0, h);

/* ------------------------------------------------------------------ */
/* 15. Hôtel de ville                                                   */
/* ------------------------------------------------------------------ */
export const mairie: BuildingDef = {
  id: 'public_hotel_de_ville',
  nameFr: 'Hôtel de ville',
  category: 'public',
  footprint: { tilesX: 4, tilesZ: 3 },
  cost: 1600000,
  upkeepPerMonth: 2400,
  residents: 0,
  jobs: 85,
  density: 'moyenne',
  style: 'neoclassique',
  tags: ['public', 'administration', 'mairie', 'colonnade', 'fronton', 'horloge', 'campanile', 'service:administration', 'rayon:3000', 'attractivite:2'],
  source: `${SRC}#mairie`,
  lodDistances: [220, 900],
  palette: npPalette({
    facade: M('pierre_taille', '#f0e9da'),
    soubassement: M('pierre_taille', '#d2c8b6'),
    encadrement: M('pierre_taille', '#f7f2e8'),
    colonne: M('pierre_taille', '#fbf7ee'),
    toiture: M('toit_ardoise', '#6f757c'),
    zinc: M('toit_tole_ondulee', '#7c8388', { metalness: 1, roughness: 0.5 }),
    menuiserie: M('bardage_blanc', '#e9e6dd'),
    porte: M('bardage_blanc', '#2f3d55'),
    lettres: M('enduit_peint', '#7a5c2a', { metalness: 0.8, roughness: 0.35 }),
    dome_cuivre: M('toit_tole_ondulee', '#6fa38e', { metalness: 0.6, roughness: 0.5 }),
    ...flagRoles,
  }),
  variants: [
    { id: 'origine', nameFr: 'Pierre claire, toits d\'ardoise' },
    { id: 'brique', nameFr: 'Brique et pierre', materialOverrides: { facade: { textureSet: 'brique_orange', color: '#ffffff' } } },
    { id: 'ocre', nameFr: 'Enduit ocre, toits de tuiles', materialOverrides: { facade: { textureSet: 'enduit_peint', color: '#e7c98f' }, toiture: { textureSet: 'toit_tuiles', color: '#ffffff' } } },
  ],
  build(ctx: Ctx): void {
    const x0 = -14.6, x1 = 14.6, z0 = -9.6, z1 = 1.6;
    const g = 5.0, e = 4.6;
    const top = g + e;
    const W = x1 - x0, D = z1 - z0;
    const wingU = [...bays(9.6, 3, 0.4), ...bays(9.6, 3, 0.4).map((u) => u + W - 9.6)];
    const win1 = { shutters: 'none' as const, leaves: 2, bars: 3, transom: 0.8, surround: 0.2, keystone: true, sill: false, railing: 'barreaux' as const };
    const S: OpeningSpec[] = [
      ...wingU.map((u) => ({ kind: 'blind' as const, r: archRect(u, 1.5, 0.9, 3.4) })),
      ...wingU.map((u) => ({ kind: 'window' as const, r: rectAt(u, 1.4, g + 0.3, 3.0), o: win1 })),
    ];
    const F = volume(ctx, {
      x0, x1, z0, z1, h: top, wallMat: 'facade', sides: {
        S,
        E: [...bays(D, 3, 0.6).map((u) => ({ kind: 'blind' as const, r: archRect(u, 1.5, 0.9, 3.4) })), ...bays(D, 3, 0.6).map((u) => ({ kind: 'window' as const, r: rectAt(u, 1.4, g + 0.3, 3.0), o: win1 }))],
        W: [...bays(D, 3, 0.6).map((u) => ({ kind: 'blind' as const, r: archRect(u, 1.5, 0.9, 3.4) })), ...bays(D, 3, 0.6).map((u) => ({ kind: 'window' as const, r: rectAt(u, 1.4, g + 0.3, 3.0), o: win1 }))],
        N: [{ kind: 'door', r: rectAt(W / 2, 1.8, 0.05, 2.8), o: { style: 'double', transom: 0.6 } }, ...[0, 1].flatMap((k) => row(bays(W, 9, 0.6).filter((_, i) => i !== 4 || k === 1), 1.3, 1.0 + k * g, 2.6, () => ({ kind: 'window' as const, o: { shutters: 'none' as const, leaves: 2, bars: 2, surround: 0.15 } })))],
      },
      plinth: { h: 0.8, d: 0.06 }, ...(ctx.lod === 0 ? { quoins: { v0: 0.8 } } : {}),
      bands: [{ v: g - 0.1, h: 0.3, d: 0.12 }],
      cornice: { profile: [[0.18, 0.08], [0.14, 0.2], [0.22, 0.42]] },
    });
    arches(ctx, F.S, wingU.map((u) => archRect(u, 1.5, 0.9, 3.4)), 'facade', { mullions: 2, transoms: 1 });
    arches(ctx, F.E, bays(D, 3, 0.6).map((u) => archRect(u, 1.5, 0.9, 3.4)), 'facade', { mullions: 2 });
    arches(ctx, F.W, bays(D, 3, 0.6).map((u) => archRect(u, 1.5, 0.9, 3.4)), 'facade', { mullions: 2 });
    // refends (bossages) du rez-de-chaussée
    if (ctx.lod === 0) for (const fr of [F.S, F.E, F.W]) for (let k = 1; k < 7; k++) fbox(ctx, 'soubassement', fr, 0, fr.w, 0.8 + k * 0.6 - 0.04, 0.8 + k * 0.6, 0, 0.02, 'back');
    // avant-corps central : colonnade colossale sur perron, entablement, fronton à horloge
    const ac0 = 9.6, ac1 = W - 9.6; // repère S
    const acW = ac1 - ac0;
    const AC = subFrame(F.S, ac0, 0, 0, acW, top);
    fbox(ctx, 'facade', F.S, ac0, ac1, 0, top, 0, 2.0, 'back');
    // trois portes cintrées dans l'avant-corps (en applique sur sa face avant)
    const acF = subFrame(F.S, ac0, 0, 2.0, acW, top);
    for (const u of bays(acW, 3, 0.8)) {
      fbox(ctx, 'porte', acF, u - 0.85, u + 0.85, 1.4, 4.4, -0.12, 0.02, 'back');
      fbox(ctx, 'encadrement', acF, u - 1.1, u + 1.1, 1.4, 4.75, 0, 0.06, 'back');
      fbox(ctx, 'porte', acF, u - 0.85, u + 0.85, 1.4, 4.4, 0.06, 0.08, 'back');
      if (ctx.lod === 0) for (const du of [-0.42, 0.42]) fbox(ctx, 'menuiserie', acF, u + du - 0.3, u + du + 0.3, 2.0, 3.8, 0.08, 0.11, 'back');
      glass(ctx, acF, u - 0.8, u + 0.8, 4.45, 4.7, 0.07);
      archWindow(ctx, acF, rectAt(u, 1.4, g + 0.4, 3.6), 'facade', { mullions: 2, sill: true });
    }
    // perron
    const colD = 1.4;
    fbox(ctx, 'soubassement', acF, -1.2, acW + 1.2, 0, 1.4, 0, colD + 0.8, 'back');
    steps(ctx, 'soubassement', subFrame(acF, 0, 0, colD + 0.8, acW, top), 0.4, acW - 0.4, 1.4, 5, 0.36);
    // colonnes colossales (6) devant l'avant-corps
    for (const u of bays(acW + 0.8, 6, 0.3)) {
      const p = P(acF, u - 0.4, 1.4, colD);
      column(ctx, 'colonne', p[0], 1.4, p[2], 0.42, top - 1.4);
    }
    // entablement + frise + lettrage
    fbox(ctx, 'encadrement', acF, -1.0, acW + 1.0, top, top + 1.5, -2.0, colD + 0.6, '');
    lettering(ctx, 'lettres', acF, 'HÔTEL DE VILLE', acW / 2, top + 0.42, 0.62, colD + 0.6, 0.04);
    pediment(ctx, 'encadrement', acF, -1.0, acW + 1.0, top + 1.85, 3.2, colD + 0.6, -2.0);
    clockFace(ctx, subFrame(acF, 0, 0, colD + 0.62, acW, top), acW / 2, top + 3.0, 0.85, 0.05, 10.1);
    // toiture à la Mansart + lucarnes
    mansardRoof(ctx, { x0, x1, z0, z1, y: top + 0.55, lowerH: 3.0, inset: 1.2, upperPitch: 12 });
    for (const u of wingU) dormer(ctx, subFrame(F.S, 0, 0, 0.02, W, 20), u, top + 0.8, 1.2, 1.7, 0.9, { wallMat: 'encadrement', cheekMat: 'zinc', roofMat: 'zinc', pitch: 40, win: { leaves: 2, bars: 1 } });
    chimney(ctx, -10, -6.5, 1.6, 0.6, top + 2.8, top + 5.0, { mat: 'facade', pots: 3 });
    chimney(ctx, 10, -6.5, 1.6, 0.6, top + 2.8, top + 5.0, { mat: 'facade', pots: 3 });
    // campanile sur le faîte : socle carré, arcades, dôme en cuivre, girouette
    const cy = top + 3.6, cz = -4.0;
    ctx.mb.box('facade', -1.8, cy - 1.0, cz - 1.8, 1.8, cy + 1.2, cz + 1.8, 'ny');
    ctx.mb.box('encadrement', -2.0, cy + 1.2, cz - 2.0, 2.0, cy + 1.45, cz + 2.0, '');
    for (const [dx, dz] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]] as const) ctx.mb.box('encadrement', dx - 0.3, cy + 1.45, cz + dz - 0.3, dx + 0.3, cy + 4.2, cz + dz + 0.3, '');
    ctx.mb.box('encadrement', -2.0, cy + 4.2, cz - 2.0, 2.0, cy + 4.55, cz + 2.0, '');
    if (ctx.lod < 2) ctx.mb.cylinder('garde_corps', 0, cy + 2.0, cz, 0.55, 1.4, 10, true, 0.8); // cloche
    dome(ctx, 'dome_cuivre', 0, cy + 4.55, cz, 1.9, ctx.lod === 0 ? 14 : 8, ctx.lod === 0 ? 5 : 3, 1.25);
    ctx.mb.cylinder('garde_corps', 0, cy + 6.9, cz, 0.05, 2.2, 6, true);
    // drapeaux sur le balcon de l'avant-corps
    flagPole(ctx, P(acF, 0.6, 0, colD)[0], top + 1.5, P(acF, 0.6, 0, colD)[2], 3.5, FLAG);
    flagPole(ctx, P(acF, acW - 0.6, 0, colD)[0], top + 1.5, P(acF, acW - 0.6, 0, colD)[2], 3.5, FLAG);
    // parvis
    slab(ctx, 'paves', x0, z1, x1, 12.0, 0, 0.08);
    for (const x of [-10.5, 10.5]) { lampPost(ctx, x, 0.08, 9.0, 4.5, [0, 0, -1]); planter(ctx, x - 1.8, 10.2, x + 1.8, 11.6, 0.08, 0.5); }
    bench(ctx, -6.5, 0.08, 10.8, 0, 1.8);
    bench(ctx, 6.5, 0.08, 10.8, 0, 1.8);
    void AC; void cornice;
  },
};

/* ------------------------------------------------------------------ */
/* 16. École élémentaire                                                */
/* ------------------------------------------------------------------ */
export const ecole: BuildingDef = {
  id: 'public_ecole',
  nameFr: 'École élémentaire',
  category: 'public',
  footprint: { tilesX: 4, tilesZ: 3 },
  cost: 820000,
  upkeepPerMonth: 1500,
  residents: 0,
  jobs: 28,
  density: 'moyenne',
  style: 'groupe_scolaire',
  tags: ['public', 'education', 'ecole', 'cour', 'preau', 'service:education', 'rayon:900', 'capacite_service:300'],
  source: `${SRC}#ecole`,
  lodDistances: [200, 800],
  palette: npPalette({
    facade: M('brique_orange', '#ffffff'),
    facade_b: M('enduit_blanc', '#f1ede4'),
    soubassement: M('pierre_taille', '#c4bba9'),
    encadrement: M('pierre_taille', '#efe8da'),
    toiture: M('toit_tuiles', '#ffffff'),
    menuiserie: M('bardage_blanc', '#2f6f8f'),
    enseigne: M('enduit_peint', '#2f6f8f'),
    lettres: M('enduit_blanc', '#ffffff'),
    sol_cour: M('route_asphalte', '#b9b4ac'),
    jeu_a: M('enduit_peint', '#e0533b'),
    jeu_b: M('enduit_peint', '#3b8ad9'),
    jeu_c: M('enduit_peint', '#f2c230'),
    ...flagRoles,
  }),
  variants: [
    { id: 'origine', nameFr: 'Brique et enduit, menuiseries bleues' },
    { id: 'vert', nameFr: 'Enduit blanc, menuiseries vertes', materialOverrides: { facade: { textureSet: 'enduit_blanc', color: '#f3efe6' }, menuiserie: { color: '#3f7a4c' }, enseigne: { color: '#3f7a4c' } } },
    { id: 'jaune', nameFr: 'Brique rouge, menuiseries jaunes', materialOverrides: { facade: { textureSet: 'brique_rouge' }, menuiserie: { color: '#d9a52a' }, enseigne: { color: '#b0611e' } } },
  ],
  build(ctx: Ctx): void {
    // aile des classes (R+1) au nord + aile basse (cantine) à l'ouest
    const x0 = -15.6, x1 = 9.0, z0 = -11.6, z1 = -3.4;
    const g = 3.8, e = 3.6;
    const W = x1 - x0, D = z1 - z0;
    const classWin = (v: number): OpeningSpec[] => bays(W, 8, 0.4).map((u) => ({ kind: 'window' as const, r: rectAt(u, 2.2, v, 2.1), o: { shutters: 'none' as const, leaves: 3, transom: 0.6, surround: 0.0, lintel: true } }));
    const F = volume(ctx, {
      x0, x1, z0, z1, h: g + e, wallMat: 'facade', sides: {
        S: [...classWin(0.9).filter((_, i) => i !== 3), { kind: 'door', r: rectAt(bays(W, 8, 0.4)[3]!, 2.0, 0.05, 2.7), o: { style: 'double', transom: 0.6, canopy: 'verre' } }, ...classWin(g + 0.7)],
        N: [...classWin(0.9), ...classWin(g + 0.7)],
        E: row(bays(D, 2, 0.8), 1.3, g + 0.7, 2.1, () => ({ kind: 'window', o: { shutters: 'none', leaves: 2 } })),
      },
      plinth: { h: 0.5, d: 0.04 }, bands: [{ v: g - 0.1, h: 0.35, d: 0.06, mat: 'facade_b' }, { v: g + e - 0.4, h: 0.4, d: 0.04, mat: 'facade_b' }],
    });
    gableRoof(ctx, { x0, x1, z0, z1, y: g + e + 0.05, pitch: 32, axis: 'x', overhang: 0.5, verge: 0.3, gableMat: 'facade' });
    // fronton d'entrée avec enseigne, horloge et drapeau
    const uE = bays(W, 8, 0.4)[3]!;
    fbox(ctx, 'facade_b', F.S, uE - 2.4, uE + 2.4, 0, g + e + 2.6, 0, 0.4, 'back');
    fpf(ctx, 'facade_b', subFrame(F.S, 0, 0, 0.4, W, 20), [[uE - 2.4, g + e + 2.6, 0], [uE + 2.4, g + e + 2.6, 0], [uE, g + e + 4.0, 0]], [0, 0, 1]);
    if (ctx.lod < 2) {
      fpf(ctx, 'toiture', subFrame(F.S, 0, 0, 0.4, W, 20), [[uE - 2.6, g + e + 2.5, 0.1], [uE, g + e + 4.1, 0.1], [uE, g + e + 4.1, -2.0], [uE - 2.6, g + e + 2.5, -2.0]], [-1, 1.6, 0]);
      fpf(ctx, 'toiture', subFrame(F.S, 0, 0, 0.4, W, 20), [[uE, g + e + 4.1, 0.1], [uE + 2.6, g + e + 2.5, 0.1], [uE + 2.6, g + e + 2.5, -2.0], [uE, g + e + 4.1, -2.0]], [1, 1.6, 0]);
    }
    const EF = subFrame(F.S, 0, 0, 0.4, W, 20);
    lettering(ctx, 'enseigne', EF, 'ÉCOLE', uE, g + e + 0.6, 0.7, 0.0, 0.05);
    clockFace(ctx, EF, uE, g + e + 2.55, 0.55, 0.02, 8.5);
    flagPole(ctx, P(F.S, uE + 2.9, 0, 0.5)[0], g + 0.2, P(F.S, uE + 2.9, 0, 0.5)[2], 3.4, FLAG);
    // cantine (aile basse ouest)
    const cx0 = -15.6, cx1 = -7.6, cz0 = -3.4, cz1 = 4.6;
    const C = volume(ctx, {
      x0: cx0, x1: cx1, z0: cz0, z1: cz1, h: 4.0, wallMat: 'facade_b', sides: {
        E: row(bays(cz1 - cz0, 3, 0.4), 2.0, 0.6, 2.6, () => ({ kind: 'window', o: { shutters: 'none', leaves: 3, sill: false } })),
        S: [{ kind: 'door', r: rectAt(4, 1.6, 0.05, 2.5), o: { style: 'vitree' } }],
        W: row(bays(cz1 - cz0, 3, 0.4), 1.6, 1.2, 1.6, () => ({ kind: 'window', o: { shutters: 'none', leaves: 2 } })),
      },
      hidden: ['N'], plinth: { h: 0.4, d: 0.03 },
    });
    void C;
    hipRoof(ctx, { x0: cx0, x1: cx1, z0: cz0, z1: cz1, y: 4.05, pitch: 25, overhang: 0.5 });
    // préau (structure bois sur poteaux) à l'est
    const px0 = 2.6, px1 = 15.6, pz0 = -3.4, pz1 = 2.0;
    for (const x of [px0 + 0.3, (px0 + px1) / 2, px1 - 0.3]) ctx.mb.box('bois', x - 0.15, 0, pz1 - 0.45, x + 0.15, 3.4, pz1 - 0.15, 'ny');
    if (ctx.lod < 2) ctx.mb.box('bois', px0, 3.2, pz1 - 0.5, px1, 3.45, pz1 - 0.1, '');
    gableRoof(ctx, { x0: px0, x1: px1, z0: pz0, z1: pz1, y: 3.45, pitch: 12, axis: 'x', overhang: 0.4, gableMat: null, timber: true });
    // cour : enrobé clair + jeux peints (marelle, cercle, terrain)
    slab(ctx, 'sol_cour', -7.6, -3.4, 15.6, 11.6, 0, 0.06);
    const y = 0.072;
    if (ctx.lod < 2) {
      for (let k = 0; k < 7; k++) {
        const zz = 3.0 + k * 0.7;
        const mat = k % 3 === 0 ? 'jeu_a' : k % 3 === 1 ? 'jeu_b' : 'jeu_c';
        if (k === 2 || k === 4) { mark(ctx, -5.6, zz, -4.95, zz + 0.62, y, mat); mark(ctx, -4.85, zz, -4.2, zz + 0.62, y, mat); }
        else mark(ctx, -5.2, zz, -4.55, zz + 0.62, y, mat);
      }
      // terrain de basket : lignes
      const bx0 = 2.0, bx1 = 14.0, bz0 = 4.0, bz1 = 10.8;
      for (const [a, b, c, d] of [[bx0, bz0, bx1, bz0 + 0.08], [bx0, bz1 - 0.08, bx1, bz1], [bx0, bz0, bx0 + 0.08, bz1], [bx1 - 0.08, bz0, bx1, bz1], [8.0 - 0.04, bz0, 8.0 + 0.04, bz1]] as const) mark(ctx, a, b, c, d, y, 'marquage');
      // paniers
      for (const [x, s] of [[bx0 + 0.6, 1], [bx1 - 0.6, -1]] as const) {
        ctx.mb.box('garde_corps', x - 0.06, 0, 7.4 - 0.06, x + 0.06, 3.2, 7.4 + 0.06, 'ny');
        ctx.mb.box('facade_b', x + s * 0.1 - 0.03, 2.7, 6.6, x + s * 0.1 + 0.03, 3.7, 8.2, '');
        ctx.mb.cylinder('jeu_a', x + s * 0.4, 3.05, 7.4, 0.24, 0.03, 10, false);
      }
      // cercle de jeu
      const cf = edgeFrame(-4.0, 10.0, 4.0, 10.0, y, 1);
      void cf;
    }
    // clôture de la cour avec portail
    fence(ctx, [-7.6, 0.06, 11.5], [-1.5, 0.06, 11.5], 1.6);
    fence(ctx, [1.5, 0.06, 11.5], [15.5, 0.06, 11.5], 1.6);
    fence(ctx, [15.5, 0.06, 11.5], [15.5, 0.06, 2.0], 1.6);
    for (const x of [-1.5, 1.5]) ctx.mb.box('facade', x - 0.3, 0, 11.2, x + 0.3, 2.0, 11.8, 'ny');
    for (const [x, z] of [[-6.0, 8.0], [14.2, -1.0], [-2.2, -2.0]] as const) shrub(ctx, x, 0.06, z, 0.9);
    lampPost(ctx, 0, 0.06, 9.5, 4.5, [0, 0, -1]);
    void litSeed;
  },
};

/* ------------------------------------------------------------------ */
/* 17. Caserne de pompiers                                              */
/* ------------------------------------------------------------------ */
export const casernePompiers: BuildingDef = {
  id: 'public_caserne_pompiers',
  nameFr: 'Caserne de sapeurs-pompiers',
  category: 'public',
  footprint: { tilesX: 3, tilesZ: 3 },
  cost: 740000,
  upkeepPerMonth: 1700,
  residents: 0,
  jobs: 45,
  density: 'moyenne',
  style: 'equipement_contemporain',
  tags: ['public', 'secours', 'pompiers', 'tour_de_manoeuvre', 'service:incendie', 'rayon:1500', 'capacite_service:4'],
  source: `${SRC}#casernePompiers`,
  frontage: [{ x: -3, z: 12, nx: 0, nz: 1, kind: 'vehicle' }],
  palette: npPalette({
    facade: M('brique_rouge', '#ffffff'),
    facade_b: M('enduit_blanc', '#f2f0ea'),
    soubassement: M('beton_facade', '#c9c4ba'),
    porte_engin: M('metal_rideau', '#c62a22', { metalness: 0.5, roughness: 0.45 }),
    enseigne: M('enduit_peint', '#c62a22'),
    lettres: M('enduit_blanc', '#ffffff'),
    menuiserie: M('bardage_blanc', '#e9e9e6'),
    beton: M('sol_beton_brut', '#d6d2ca'),
    ...flagRoles,
  }),
  variants: [
    { id: 'origine', nameFr: 'Brique rouge et enduit blanc' },
    { id: 'beton', nameFr: 'Béton clair et rouge', materialOverrides: { facade: { textureSet: 'beton_facade', color: '#eeeae2' } } },
    { id: 'sombre', nameFr: 'Panneaux anthracite et rouge', materialOverrides: { facade: { textureSet: 'panneaux_facade_sombres', color: '#ffffff' } } },
  ],
  build(ctx: Ctx): void {
    // remise des engins (4 travées) + étage de vie
    const x0 = -11.6, x1 = 5.4, z0 = -11.6, z1 = -0.6;
    const g = 5.2, e = 3.4;
    const W = x1 - x0, D = z1 - z0;
    const doors = bays(W, 4, 0.5).map((u) => ({ u0: u - 1.8, u1: u + 1.8, v0: 0, v1: 4.4 }));
    const F = volume(ctx, {
      x0, x1, z0, z1, h: g + e, wallMat: 'facade', sides: {
        S: [...doors.map((r) => ({ kind: 'blind' as const, r })), ...row(bays(W, 8, 0.4), 1.2, g + 0.8, 1.6, () => ({ kind: 'window' as const, o: { shutters: 'roulant' as const, leaves: 2 } }))],
        N: [...row(bays(W, 4, 0.5), 3.6, 0, 4.4, () => ({ kind: 'blind' as const })), ...row(bays(W, 8, 0.4), 1.2, g + 0.8, 1.6, () => ({ kind: 'window' as const, o: { shutters: 'roulant' as const } }))],
        W: [{ kind: 'door', r: rectAt(D / 2, 1.0, 0.05, 2.3), o: { style: 'moderne' } }, ...row(bays(D, 3, 0.6), 1.2, g + 0.8, 1.6, () => ({ kind: 'window' as const, o: { shutters: 'roulant' as const } }))],
      },
      hidden: ['E'], plinth: { h: 0.4, d: 0.03, mat: 'soubassement' },
      bands: [{ v: g - 0.4, h: 0.45, d: 0.12, mat: 'facade_b' }],
    });
    // portes sectionnelles vitrées des remises
    for (const fr of [F.S, F.N]) for (const u of bays(W, 4, 0.5)) {
      const r = { u0: u - 1.8, u1: u + 1.8, v0: 0, v1: 4.4 };
      fpf(ctx, 'porte_engin', fr, [[r.u0, 0, -0.15], [r.u1, 0, -0.15], [r.u1, 4.4, -0.15], [r.u0, 4.4, -0.15]], [0, 0, 1]);
      if (ctx.lod < 2) {
        fpf(ctx, 'facade_b', fr, [[r.u0, 0, 0], [r.u0, 0, -0.15], [r.u0, 4.4, -0.15], [r.u0, 4.4, 0]], [1, 0, 0]);
        fpf(ctx, 'facade_b', fr, [[r.u1, 0, -0.15], [r.u1, 0, 0], [r.u1, 4.4, 0], [r.u1, 4.4, -0.15]], [-1, 0, 0]);
        glass(ctx, fr, r.u0 + 0.3, r.u1 - 0.3, 2.9, 3.4, -0.13, 2);
        if (ctx.lod === 0) for (let k = 1; k < 8; k++) fbox(ctx, 'porte_engin', fr, r.u0, r.u1, k * 0.55 - 0.02, k * 0.55 + 0.02, -0.15, -0.11, 'back');
        fbox(ctx, 'facade_b', fr, r.u0 - 0.25, r.u0, 0, 4.6, 0, 0.12, 'back');
        fbox(ctx, 'facade_b', fr, r.u1, r.u1 + 0.25, 0, 4.6, 0, 0.12, 'back');
      }
    }
    flatRoof(ctx, { x0, x1, z0, z1, y: g + e, parapet: g + e + 0.7, t: 0.25, copingMat: 'facade_b' });
    // bandeau d'enseigne rouge
    fbox(ctx, 'enseigne', F.S, -0.1, W + 0.1, g + e - 0.1, g + e + 0.9, 0, 0.14, 'back');
    lettering(ctx, 'lettres', F.S, 'SAPEURS-POMPIERS', W / 2, g + e + 0.1, 0.55, 0.14, 0.05);
    rooftopUnit(ctx, -6, g + e, -8, 2.2, 1.2, 1.0);
    // sirène + antennes
    mast(ctx, 2, g + e, -9, 6);
    if (ctx.lod < 2) hCylinder(ctx, 'acier', [-0.8, g + e + 2.0, -9.2], [-0.8, g + e + 2.0, -8.6], 0.3, 10);
    // tour de manœuvre (6 niveaux) à l'est, avec balcons d'exercice
    const tx0 = 5.4, tx1 = 10.4, tz0 = -11.6, tz1 = -6.0;
    const tH = 20.5;
    const T = volume(ctx, {
      x0: tx0, x1: tx1, z0: tz0, z1: tz1, h: tH, wallMat: 'facade_b', sides: {
        S: [0, 1, 2, 3, 4, 5].map((k) => ({ kind: 'blind' as const, r: rectAt(2.5, 1.3, 1.2 + k * 3.2, 1.9) })),
        E: [0, 1, 2, 3, 4, 5].map((k) => ({ kind: 'blind' as const, r: rectAt(2.8, 1.3, 1.2 + k * 3.2, 1.9) })),
        N: [{ kind: 'door', r: rectAt(2.5, 1.0, 0.05, 2.2), o: { style: 'moderne' } }],
      },
      plinth: { h: 0.4, d: 0.03, mat: 'soubassement' },
    });
    for (const fr of [T.S, T.E]) {
      for (let k = 0; k < 6; k++) {
        const r = rectAt(fr === T.S ? 2.5 : 2.8, 1.3, 1.2 + k * 3.2, 1.9);
        fpf(ctx, 'garde_corps', fr, [[r.u0, r.v0, -0.3], [r.u1, r.v0, -0.3], [r.u1, r.v1, -0.3], [r.u0, r.v1, -0.3]], [0, 0, 1]);
        if (ctx.lod < 2) {
          fpf(ctx, 'facade_b', fr, [[r.u0, r.v0, 0], [r.u0, r.v0, -0.3], [r.u0, r.v1, -0.3], [r.u0, r.v1, 0]], [1, 0, 0]);
          fpf(ctx, 'facade_b', fr, [[r.u1, r.v0, -0.3], [r.u1, r.v0, 0], [r.u1, r.v1, 0], [r.u1, r.v1, -0.3]], [-1, 0, 0]);
          fpf(ctx, 'facade_b', fr, [[r.u0, r.v1, -0.3], [r.u1, r.v1, -0.3], [r.u1, r.v1, 0], [r.u0, r.v1, 0]], [0, -1, 0]);
          fbox(ctx, 'garde_corps', fr, r.u0 - 0.5, r.u1 + 0.5, r.v0 - 0.12, r.v0, 0, 0.9, 'back');
          if (ctx.lod === 0) {
            const a = P(fr, r.u0 - 0.5, r.v0, 0.88), b = P(fr, r.u1 + 0.5, r.v0, 0.88);
            ctx.mb.tube('garde_corps', [a[0], a[1] + 1.0, a[2]], [b[0], b[1] + 1.0, b[2]], 0.03, 4);
          }
        }
      }
    }
    flatRoof(ctx, { x0: tx0, x1: tx1, z0: tz0, z1: tz1, y: tH, parapet: tH + 1.0, t: 0.2, copingMat: 'enseigne' });
    // tour : bandes rouges
    fbox(ctx, 'enseigne', T.W, -0.05, T.W.w + 0.05, 9.0, 9.6, 0, 0.06, 'back');
    // sèche-tuyaux : mât en tête de tour
    mast(ctx, 9.4, tH, -10.6, 4);
    // aire de manœuvre béton + marquages jaunes
    slab(ctx, 'beton', x0, z1, 11.6, 11.6, 0, 0.08);
    if (ctx.lod < 2) for (const u of bays(W, 4, 0.5)) {
      const x = x0 + u;
      mark(ctx, x - 1.9, z1 + 0.3, x - 1.75, z1 + 10, 0.09, 'marquage_j');
      mark(ctx, x + 1.75, z1 + 0.3, x + 1.9, z1 + 10, 0.09, 'marquage_j');
      for (let k = 0; k < 4; k++) mark(ctx, x - 1.6, z1 + 0.6 + k * 0.5, x + 1.6, z1 + 0.82 + k * 0.5, 0.09, 'marquage_j');
    }
    // poteau d'incendie, mât des couleurs
    if (ctx.lod < 2) { ctx.mb.cylinder('enseigne', 9.6, 0.08, 9.6, 0.16, 0.9, 10, true); ctx.mb.cylinder('enseigne', 9.6, 0.98, 9.6, 0.1, 0.12, 8, true); }
    flagPole(ctx, 8.5, 0.08, 4.0, 8, FLAG);
    lampPost(ctx, 10.8, 0.08, 1.0, 6, [-1, 0, 0]);
  },
};

/* ------------------------------------------------------------------ */
/* 18. Commissariat de police                                           */
/* ------------------------------------------------------------------ */
export const commissariat: BuildingDef = {
  id: 'public_commissariat',
  nameFr: 'Commissariat de police',
  category: 'public',
  footprint: { tilesX: 3, tilesZ: 2 },
  cost: 680000,
  upkeepPerMonth: 1600,
  residents: 0,
  jobs: 60,
  density: 'moyenne',
  style: 'equipement_contemporain',
  tags: ['public', 'securite', 'police', 'service:police', 'rayon:1500', 'capacite_service:6'],
  source: `${SRC}#commissariat`,
  palette: npPalette({
    facade: M('beton_facade', '#e9e6e0'),
    facade_b: M('panneaux_facade_sombres', '#ffffff'),
    soubassement: M('pierre_taille', '#a39c90'),
    enseigne: M('enduit_peint', '#1d3f7a'),
    lettres: M('enduit_blanc', '#ffffff'),
    meneau: M('metal_rideau', '#2f3438', { metalness: 1, roughness: 0.4 }),
    verre_mr: { kind: 'glass', color: '#4a6272' },
    ...flagRoles,
  }),
  variants: [
    { id: 'origine', nameFr: 'Béton clair et panneaux sombres' },
    { id: 'pierre', nameFr: 'Pierre et zinc', materialOverrides: { facade: { textureSet: 'pierre_taille', color: '#efe8da' }, facade_b: { textureSet: 'toit_tole_ondulee', color: '#9aa1a6' } } },
    { id: 'brique', nameFr: 'Brique sombre', materialOverrides: { facade: { textureSet: 'brique_parement', color: '#ffffff' } } },
  ],
  build(ctx: Ctx): void {
    const x0 = -11.6, x1 = 11.6, z0 = -7.6, z1 = 1.0;
    const g = 4.0, fh = 3.4;
    const top = g + 2 * fh;
    const W = x1 - x0;
    // socle en pierre + étages à fenêtres filantes et panneaux sombres
    const F = volume(ctx, {
      x0, x1, z0, z1, h: g, wallMat: 'soubassement', sides: {
        S: [{ kind: 'blind', r: { u0: 8.6, u1: 14.6, v0: 0, v1: 3.4 } }, ...row([2.5, 5.5, 17.7, 20.7], 2.0, 1.0, 2.0, () => ({ kind: 'window', o: { shutters: 'none', leaves: 2, sill: true } }))],
        N: [{ kind: 'door', r: rectAt(4, 1.2, 0.05, 2.3), o: { style: 'moderne' } }, { kind: 'blind', r: { u0: 14, u1: 18, v0: 0, v1: 3.2 } }],
        E: row([2.5, 6.0], 1.4, 1.2, 1.6, () => ({ kind: 'window', o: { shutters: 'none' } })),
        W: row([2.5, 6.0], 1.4, 1.2, 1.6, () => ({ kind: 'window', o: { shutters: 'none' } })),
      },
    });
    curtainWall(ctx, F.S, { u0: 8.6, u1: 14.6, v0: 0, v1: 3.4, cols: 4, floorH: 3.4, mullionMat: 'meneau' });
    fpf(ctx, 'porte_garage', F.N, [[14, 0, -0.1], [18, 0, -0.1], [18, 3.2, -0.1], [14, 3.2, -0.1]], [0, 0, 1]);
    const sides: [number, number, number, number][] = [[x0, z1, x1, z1], [x1, z1, x1, z0], [x1, z0, x0, z0], [x0, z0, x0, z1]];
    sides.forEach(([ax, az, bx, bz], i) => {
      const f = edgeFrame(ax, az, bx, bz, 0, top + 0.8);
      ribbonFloors(ctx, f, 'facade', { v0: g, floors: 2, floorH: fh, sill: 0.95, winH: 1.7, cols: Math.round(f.w / 1.6), margin: 0.8, seed: 300 + i });
      fbox(ctx, 'facade', f, 0, f.w, top, top + 0.8, 0, 0.001, 'back left right top bottom');
      // panneaux sombres verticaux rythmant la façade
      if (i % 2 === 0) for (const u of [f.w * 0.2, f.w * 0.5, f.w * 0.8]) fbox(ctx, 'facade_b', f, u - 0.5, u + 0.5, g, top + 0.8, 0, 0.2, ctx.lod === 2 ? 'back top bottom' : 'back');
    });
    flatRoof(ctx, { x0, x1, z0, z1, y: top + 0.2, parapet: top + 0.8, t: 0.25, copingMat: 'meneau' });
    // auvent d'entrée + caisson lumineux « POLICE » bleu
    fbox(ctx, 'meneau', F.S, 7.8, 15.4, 3.5, 3.8, 0, 2.6, '');
    fbox(ctx, 'enseigne', F.S, 8.2, 15.0, 3.8, 4.7, 2.0, 2.6, '');
    lettering(ctx, 'lettres', subFrame(F.S, 0, 0, 2.6, W, 6), 'POLICE', 11.6, 3.98, 0.55, 0.0, 0.05);
    lettering(ctx, 'enseigne', F.S, 'COMMISSARIAT', W / 2, top - 0.35, 0.45, 0.02, 0.05);
    for (const u of [8.2, 15.0]) { const p = P(F.S, u, 0, 2.3); ctx.mb.cylinder('meneau', p[0], 0, p[2], 0.12, 3.5, ctx.lod === 0 ? 8 : 5, false); }
    // toiture : antennes, édicule
    mast(ctx, -8, top + 0.2, -5, 8);
    mast(ctx, 8, top + 0.2, -5.5, 5);
    rooftopUnit(ctx, 0, top + 0.2, -4, 3.0, 1.6, 1.3);
    stairHouse(ctx, 4, -6.8, 7, -4.2, top + 0.2, 2.8, 'facade');
    // parvis, bornes anti-bélier, drapeaux
    slab(ctx, 'dallage', x0, z1, x1, 7.6, 0, 0.1);
    if (ctx.lod < 2) for (let k = 0; k < 9; k++) ctx.mb.cylinder('meneau', -8 + k * 2, 0.1, 6.8, 0.12, 0.9, ctx.lod === 0 ? 8 : 5, true);
    for (const x of [-3.0, -2.0, 0]) flagPole(ctx, x - 6, 0.1, 4.4, 7.5, x === 0 ? ['drapeau_bleu', 'drapeau_bleu', 'drapeau_bleu'] : FLAG);
    planter(ctx, 4.0, 4.0, 10.6, 5.2, 0.1, 0.55);
  },
};

/* ------------------------------------------------------------------ */
/* 19. Hôpital                                                          */
/* ------------------------------------------------------------------ */
export const hopital: BuildingDef = {
  id: 'public_hopital',
  nameFr: 'Centre hospitalier',
  category: 'public',
  footprint: { tilesX: 5, tilesZ: 4 },
  cost: 4200000,
  upkeepPerMonth: 6500,
  residents: 0,
  jobs: 520,
  density: 'forte',
  style: 'hospitalier',
  tags: ['public', 'sante', 'hopital', 'urgences', 'heliport', 'service:sante', 'rayon:3500', 'capacite_service:260'],
  source: `${SRC}#hopital`,
  lodDistances: [240, 1000],
  frontage: [{ x: 0, z: 16, nx: 0, nz: 1, kind: 'pedestrian' }, { x: 16, z: 16, nx: 0, nz: 1, kind: 'vehicle' }],
  palette: npPalette({
    facade: M('enduit_blanc', '#f4f3ef'),
    facade_b: M('bardage_composite', '#9fc3d6'),
    soubassement: M('beton_facade', '#d2cfc8'),
    meneau: M('metal_rideau', '#8f989e', { metalness: 1, roughness: 0.4 }),
    enseigne: M('enduit_peint', '#2a7ab0'),
    croix: M('enduit_peint', '#d8262c'),
    lettres: M('enduit_blanc', '#ffffff'),
    heli: M('sol_beton_brut', '#8d8f90'),
    verre_mr: { kind: 'glass', color: '#5a7c8e' },
  }),
  variants: [
    { id: 'origine', nameFr: 'Blanc et bleu clair' },
    { id: 'vert', nameFr: 'Blanc et vert d\'eau', materialOverrides: { facade_b: { color: '#a6cfb4' }, enseigne: { color: '#2a8a5a' } } },
    { id: 'brique', nameFr: 'Brique et blanc', materialOverrides: { facade: { textureSet: 'brique_orange', color: '#ffffff' }, facade_b: { color: '#f0efe9' } } },
  ],
  build(ctx: Ctx): void {
    // socle (2 niveaux) : accueil, consultations, urgences
    const x0 = -19.6, x1 = 19.6, z0 = -15.6, z1 = 2.4;
    const g = 8.0;
    const W = x1 - x0, D = z1 - z0;
    const sidesB: [number, number, number, number][] = [[x0, z1, x1, z1], [x1, z1, x1, z0], [x1, z0, x0, z0], [x0, z0, x0, z1]];
    sidesB.forEach(([ax, az, bx, bz], i) => {
      const f = edgeFrame(ax, az, bx, bz, 0, g);
      wallStrip(ctx, 'facade', f, g, g + 0.7);
      if (i !== 0) wallStrip(ctx, 'soubassement', f, 0, 0.3);
      if (i === 0) {
        for (const [a, b] of [[0, 15.0], [24.2, 30.4]] as const) wallStrip(ctx, 'soubassement', f, 0, 0.3, a, b);
        wallStrip(ctx, 'facade', f, 0, g, 0, 0.6);
        // façade principale : fenêtres filantes de part et d'autre du hall
        for (const [u0, u1] of [[0.6, 15.0], [24.2, 30.4]] as const) {
          const sf = subFrame(f, u0, 0, 0, u1 - u0, g);
          ribbonFloors(ctx, sf, 'facade', { v0: 0.3, floors: 2, floorH: 3.85, sill: 0.95, winH: 1.8, cols: Math.round((u1 - u0) / 1.5), margin: 0.0, seed: 700 + u0 });
        }
        fbox(ctx, 'facade', f, 37.8, W, 0, g, 0, 0.001, 'back left right top bottom');
        fbox(ctx, 'facade', f, 30.4, 31.0, 0, g, 0, 0.001, 'back left right top bottom');
        fbox(ctx, 'facade', f, 31.0, 37.8, 3.6, g, 0, 0.001, 'back left right top bottom');
        fbox(ctx, 'facade', f, 15.0, 15.6, 0, g, 0, 0.001, 'back left right top bottom');
        fbox(ctx, 'facade', f, 23.6, 24.2, 0, g, 0, 0.001, 'back left right top bottom');
        fbox(ctx, 'facade', f, 15.6, 23.6, 7.2, g, 0, 0.001, 'back left right top bottom');
      } else if (i !== 2) {
        ribbonFloors(ctx, f, 'facade', { v0: 0.3, floors: 2, floorH: 3.85, sill: 0.95, winH: 1.8, cols: Math.round(f.w / 1.5), margin: 0.8, seed: 710 + i });
      } else {
        ribbonFloors(ctx, f, 'facade', { v0: 0.3, floors: 2, floorH: 3.85, sill: 1.6, winH: 1.2, cols: Math.round(f.w / 1.5), margin: 0.8, seed: 720 });
      }
    });
    curtainWall(ctx, edgeFrame(x0, z1, x1, z1, 0, g), { u0: 15.6, u1: 23.6, v0: 0, v1: 7.2, cols: 6, floorH: 3.6, mullionMat: 'meneau' });
    flatRoof(ctx, { x0, x1, z0, z1, y: g, parapet: g + 0.7, t: 0.25, copingMat: 'meneau' });
    // marquise du hall + enseigne et croix
    const SF = edgeFrame(x0, z1, x1, z1, 0, g);
    fbox(ctx, 'facade', SF, 14.4, 24.8, 3.7, 4.1, 0, 4.0, '');
    for (const u of [14.8, 24.4]) { const p = P(SF, u, 0, 3.7); ctx.mb.cylinder('meneau', p[0], 0, p[2], 0.15, 3.7, ctx.lod === 0 ? 8 : 5, false); }
    lettering(ctx, 'enseigne', subFrame(SF, 0, 0, 4.0, W, g), 'HÔPITAL', 19.6, 3.72, 0.32, 0.0, 0.04);
    // urgences : auvent ambulancier en saillie + caisson URGENCES rouge
    fbox(ctx, 'facade_b', SF, 30.6, 38.2, 3.9, 4.4, 0, 8.5, '');
    for (const u of [30.9, 37.9]) for (const d of [4.0, 8.2]) { const p = P(SF, u, 0, d); ctx.mb.box('meneau', p[0] - 0.15, 0, p[2] - 0.15, p[0] + 0.15, 3.9, p[2] + 0.15, 'ny'); }
    curtainWall(ctx, SF, { u0: 31.0, u1: 37.8, v0: 0, v1: 3.6, cols: 4, floorH: 3.6, mullionMat: 'meneau' });
    const uf = subFrame(SF, 0, 0, 8.5, W, g);
    fbox(ctx, 'croix', uf, 30.8, 38.0, 4.4, 5.3, -0.5, 0.0, '');
    lettering(ctx, 'lettres', uf, 'URGENCES', 34.4, 4.58, 0.55, 0.0, 0.05);
    // tour d'hospitalisation (R+7 au-dessus du socle)
    const tx0 = -14.0, tx1 = 10.0, tz0 = -13.0, tz1 = -2.0;
    const fh = 3.5, nF = 6;
    const ttop = g + nF * fh;
    const tSides: [number, number, number, number][] = [[tx0, tz1, tx1, tz1], [tx1, tz1, tx1, tz0], [tx1, tz0, tx0, tz0], [tx0, tz0, tx0, tz1]];
    tSides.forEach(([ax, az, bx, bz], i) => {
      const f = edgeFrame(ax, az, bx, bz, 0, ttop);
      ribbonFloors(ctx, f, 'facade', { v0: g, floors: nF, floorH: fh, sill: 0.9, winH: 1.6, cols: Math.round(f.w / 1.4), margin: 0.6, seed: 760 + i });
      wallStrip(ctx, 'facade', f, ttop, ttop + 0.8);
      // panneaux colorés en allège sur les façades longues
      if (i % 2 === 0 && ctx.lod < 2) for (let k = 0; k < nF; k++) for (let c = 0; c < 4; c++) {
        const u = 1.5 + c * (f.w - 3) / 3.5 + ((k % 2) * (f.w - 3)) / 7;
        fbox(ctx, 'facade_b', f, u - 0.9, u + 0.9, g + k * fh + 0.15, g + k * fh + 0.85, 0, 0.05, 'back');
      }
    });
    flatRoof(ctx, { x0: tx0, x1: tx1, z0: tz0, z1: tz1, y: ttop, parapet: ttop + 0.8, t: 0.25, copingMat: 'meneau' });
    // croix lumineuse en façade de la tour
    const TS = edgeFrame(tx0, tz1, tx1, tz1, 0, ttop);
    fbox(ctx, 'croix', TS, 20.6, 21.6, ttop - 3.8, ttop - 0.8, 0, 0.25, 'back');
    fbox(ctx, 'croix', TS, 19.6, 22.6, ttop - 2.8, ttop - 1.8, 0, 0.25, 'back');
    // héliport sur la tour : dalle, cercle, H
    const hx = -6.0, hz = -7.5, hy = ttop + 0.85;
    ctx.mb.box('heli', hx - 6.0, ttop + 0.2, hz - 5.0, hx + 6.0, hy, hz + 5.0, 'ny');
    if (ctx.lod < 2) {
      const n = ctx.lod === 0 ? 32 : 16;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2, b = ((i + 1) / n) * Math.PI * 2;
        ctx.mb.polyFacing('marquage', [[hx + Math.cos(a) * 4.2, hy + 0.01, hz + Math.sin(a) * 4.2], [hx + Math.cos(b) * 4.2, hy + 0.01, hz + Math.sin(b) * 4.2], [hx + Math.cos(b) * 3.8, hy + 0.01, hz + Math.sin(b) * 3.8], [hx + Math.cos(a) * 3.8, hy + 0.01, hz + Math.sin(a) * 3.8]], [0, 1, 0]);
      }
      mark(ctx, hx - 1.4, hz - 2.0, hx - 0.9, hz + 2.0, hy + 0.012, 'marquage');
      mark(ctx, hx + 0.9, hz - 2.0, hx + 1.4, hz + 2.0, hy + 0.012, 'marquage');
      mark(ctx, hx - 0.9, hz - 0.25, hx + 0.9, hz + 0.25, hy + 0.012, 'marquage');
      for (const [a, b] of [[hx - 6, hz - 5], [hx + 6, hz - 5], [hx - 6, hz + 5], [hx + 6, hz + 5]] as const) ctx.mb.box('marquage_j', a - 0.15, hy, b - 0.15, a + 0.15, hy + 0.25, b + 0.15, 'ny');
    }
    rooftopUnit(ctx, 5.0, ttop, -9.0, 3.4, 2.0, 1.8);
    rooftopUnit(ctx, 5.0, ttop, -4.8, 3.4, 2.0, 1.8);
    rooftopUnit(ctx, -14, g, 0.0, 3.0, 1.6, 1.4);
    stairHouse(ctx, 0.0, -12.0, 3.0, -9.0, ttop, 3.2, 'facade');
    // dépose-minute + parking ambulances
    slab(ctx, 'dallage', x0, z1, 4.0, 15.6, 0, 0.1);
    slab(ctx, 'sol', 4.0, z1, x1, 15.6, -0.1, 0.1);
    if (ctx.lod < 2) {
      for (let k = 0; k < 4; k++) { const x = 6.0 + k * 3.4; mark(ctx, x - 0.07, 7.5, x + 0.07, 14.0, 0.01, 'marquage'); }
      mark(ctx, 6.0, 14.0, 16.2, 14.12, 0.01, 'marquage');
      for (let k = 0; k < 3; k++) ctx.mb.quad('croix', [7.0 + k * 3.4, 0.008, 12.8], [8.4 + k * 3.4, 0.008, 12.8], [8.4 + k * 3.4, 0.008, 8.6], [7.0 + k * 3.4, 0.008, 8.6]);
    }
    for (const x of [-16, -8, -1]) { planter(ctx, x - 1.6, 9.0, x + 1.6, 10.6, 0.1, 0.5); bench(ctx, x, 0.1, 11.4, 0, 1.8); }
    for (const x of [-12, 2.5]) lampPost(ctx, x, 0.1, 14.5, 5.0, [0, 0, -1]);
    shrub(ctx, -18.5, 0.1, 14.0, 0.9);
    void D; void disc;
  },
};

/* ------------------------------------------------------------------ */
/* 20. Musée-bibliothèque à coupole                                     */
/* ------------------------------------------------------------------ */
export const musee: BuildingDef = {
  id: 'public_musee_bibliotheque',
  nameFr: 'Musée-bibliothèque à coupole',
  category: 'public',
  footprint: { tilesX: 4, tilesZ: 3 },
  cost: 1350000,
  upkeepPerMonth: 1900,
  residents: 0,
  jobs: 40,
  density: 'moyenne',
  style: 'neoclassique',
  tags: ['public', 'culture', 'musee', 'bibliotheque', 'coupole', 'colonnade', 'service:culture', 'rayon:2500', 'attractivite:3'],
  source: `${SRC}#musee`,
  lodDistances: [220, 900],
  palette: npPalette({
    facade: M('pierre_taille', '#efe6d4'),
    soubassement: M('pierre_rustique', '#cdbfa6'),
    encadrement: M('pierre_taille', '#f8f3e8'),
    colonne: M('pierre_taille', '#fbf7ee'),
    toiture: M('toit_ardoise', '#74797f'),
    dome_cuivre: M('toit_tole_ondulee', '#79ad97', { metalness: 0.6, roughness: 0.5 }),
    lettres: M('enduit_peint', '#57462b', { metalness: 0.6, roughness: 0.4 }),
    porte: M('bardage_blanc', '#3a2f28'),
    menuiserie: M('bardage_blanc', '#3a2f28'),
  }),
  variants: [
    { id: 'origine', nameFr: 'Pierre blonde, coupole vert-de-gris' },
    { id: 'blanc', nameFr: 'Pierre blanche, coupole ardoise', materialOverrides: { facade: { color: '#f7f4ee' }, dome_cuivre: { textureSet: 'toit_ardoise', color: '#6a6f75' } } },
    { id: 'rose', nameFr: 'Grès rose, coupole dorée', materialOverrides: { facade: { textureSet: 'pierre_taille', color: '#e9c7b6' }, dome_cuivre: { textureSet: 'metal_rideau', color: '#d8b56a' } } },
  ],
  build(ctx: Ctx): void {
    const x0 = -15.0, x1 = 15.0, z0 = -10.0, z1 = 1.0;
    const H = 10.0, base = 1.6;
    const W = x1 - x0, D = z1 - z0;
    const winU = [...bays(10, 3, 0.6), ...bays(10, 3, 0.6).map((u) => u + 20)];
    const F = volume(ctx, {
      x0, x1, z0, z1, h: H, wallMat: 'facade', sides: {
        S: winU.map((u) => ({ kind: 'blind' as const, r: archRect(u, 1.6, base + 1.4, 5.2) })),
        E: bays(D, 4, 0.6).map((u) => ({ kind: 'blind' as const, r: archRect(u, 1.5, base + 1.4, 5.0) })),
        W: bays(D, 4, 0.6).map((u) => ({ kind: 'blind' as const, r: archRect(u, 1.5, base + 1.4, 5.0) })),
        N: [{ kind: 'door', r: rectAt(W / 2, 1.6, 0.05, 2.6), o: { style: 'double' } }],
      },
      plinth: { h: base, d: 0.08 },
      bands: [{ v: base + 0.9, h: 0.2, d: 0.06 }],
      cornice: { profile: [[0.2, 0.08], [0.18, 0.22], [0.25, 0.48]] },
    });
    arches(ctx, F.S, winU.map((u) => archRect(u, 1.6, base + 1.4, 5.2)), 'facade', { mullions: 2, transoms: 2 });
    arches(ctx, F.E, bays(D, 4, 0.6).map((u) => archRect(u, 1.5, base + 1.4, 5.0)), 'facade', { mullions: 2, transoms: 2 });
    arches(ctx, F.W, bays(D, 4, 0.6).map((u) => archRect(u, 1.5, base + 1.4, 5.0)), 'facade', { mullions: 2, transoms: 2 });
    // attique + balustrade
    for (const fr of [F.S, F.N, F.E, F.W]) {
      fbox(ctx, 'facade', fr, -0.48, fr.w + 0.48, H + 0.63, H + 1.6, -0.2, 0.3, 'back');
      fbox(ctx, 'encadrement', fr, -0.55, fr.w + 0.55, H + 1.6, H + 1.8, -0.2, 0.38, 'back');
      if (ctx.lod === 0) for (let u = 0.6; u < fr.w - 0.3; u += 0.55) ctx.mb.cylinder('encadrement', P(fr, u, 0, 0.1)[0], H + 0.65, P(fr, u, 0, 0.1)[2], 0.09, 0.9, 6, false, 0.06);
    }
    hipRoof(ctx, { x0: x0 + 0.5, x1: x1 - 0.5, z0: z0 + 0.5, z1: z1 - 0.5, y: H + 0.65, pitch: 14, overhang: -0.2, gutters: false });
    // portique : 6 colonnes, entablement, fronton
    const pf = subFrame(F.S, 10, 0, 0, 10, H);
    fbox(ctx, 'facade', pf, -0.6, 10.6, 0, H, 0, 0.6, 'back');
    fbox(ctx, 'soubassement', pf, -0.6, 10.6, 0, base, 0, 4.4, 'back');
    steps(ctx, 'soubassement', subFrame(pf, 0, 0, 4.4, 10, H), 0.4, 9.6, base, 5, 0.4);
    // porte monumentale + baies hautes
    const doorF = subFrame(pf, 0, 0, 0.6, 10, H);
    fbox(ctx, 'porte', doorF, 3.6, 6.4, base, base + 4.4, -0.2, 0.0, 'back');
    fbox(ctx, 'encadrement', doorF, 3.3, 6.7, base, base + 4.8, 0, 0.08, 'back');
    fbox(ctx, 'porte', doorF, 3.6, 6.4, base, base + 4.4, 0.08, 0.1, 'back');
    glass(ctx, doorF, 3.7, 6.3, base + 3.4, base + 4.3, 0.105, 2);
    for (const u of bays(10.4, 6, 0.3)) {
      const p = P(pf, u - 0.2, 0, 3.8);
      column(ctx, 'colonne', p[0], base, p[2], 0.45, H - base + 0.6);
    }
    fbox(ctx, 'encadrement', pf, -0.6, 10.6, H + 0.6, H + 2.0, 0.0, 4.7, '');
    lettering(ctx, 'lettres', subFrame(pf, 0, 0, 4.7, 10, H), 'MUSÉE', 5.0, H + 0.95, 0.75, 0.0, 0.04);
    pediment(ctx, 'encadrement', pf, -0.6, 10.6, H + 2.3, 2.6, 4.7, 0.0);
    // tambour + coupole + lanternon
    const cz = -4.5;
    const drumR = 5.2;
    const seg = ctx.lod === 0 ? 24 : ctx.lod === 1 ? 16 : 10;
    ctx.mb.cylinder('facade', 0, H + 1.8, cz, drumR, 4.2, seg, false);
    const drum = polyFrames(regularPoly(12, drumR * 0.99, 0, 0, cz), H + 1.8, 4.2);
    if (ctx.lod < 2) drum.forEach((f, i) => {
      glass(ctx, f, f.w * 0.3, f.w * 0.7, 1.0, 3.3, 0.02, litSeed(i, 3, 9));
      fbox(ctx, 'encadrement', f, f.w * 0.26, f.w * 0.74, 0.85, 1.0, 0, 0.1, 'back');
      fbox(ctx, 'encadrement', f, -0.1, 0.25, 0, 4.2, 0, 0.25, 'back');
    });
    ctx.mb.cylinder('encadrement', 0, H + 6.0, cz, drumR + 0.3, 0.45, seg, true);
    dome(ctx, 'dome_cuivre', 0, H + 6.45, cz, drumR, seg, ctx.lod === 0 ? 8 : 4, 1.0);
    if (ctx.lod < 2) {
      const n = ctx.lod === 0 ? 12 : 6;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const pts: [number, number, number][] = [];
        for (let k = 0; k <= 6; k++) { const ph = (k / 6) * (Math.PI / 2) * 0.86; pts.push([Math.cos(a) * Math.cos(ph) * (drumR + 0.06), H + 6.45 + Math.sin(ph) * (drumR + 0.06), cz + Math.sin(a) * Math.cos(ph) * (drumR + 0.06)]); }
        for (let k = 0; k < 6; k++) ctx.mb.tube('encadrement', pts[k]!, pts[k + 1]!, 0.08, 4);
      }
    }
    const ly = H + 6.45 + drumR * 0.94;
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; ctx.mb.box('encadrement', Math.cos(a) * 1.0 - 0.12, ly, cz + Math.sin(a) * 1.0 - 0.12, Math.cos(a) * 1.0 + 0.12, ly + 1.8, cz + Math.sin(a) * 1.0 + 0.12, ''); }
    ctx.mb.cylinder('encadrement', 0, ly + 1.8, cz, 1.3, 0.3, 12, true);
    dome(ctx, 'dome_cuivre', 0, ly + 2.1, cz, 1.1, 10, 3, 1.1);
    ctx.mb.cylinder('garde_corps', 0, ly + 3.3, cz, 0.05, 1.4, 6, true);
    // parvis + jardinières
    slab(ctx, 'paves', x0, z1, x1, 11.6, 0, 0.08);
    for (const x of [-11, 11]) { planter(ctx, x - 2.5, 7.4, x + 2.5, 9.4, 0.08, 0.6); lampPost(ctx, x, 0.08, 10.8, 4.5, [0, 0, -1]); }
    for (const x of [-11, -6.5, 6.5, 11]) bench(ctx, x, 0.08, 6.4, Math.PI, 1.8);
  },
};

/* ------------------------------------------------------------------ */
/* 21. Église à clocher-porche                                          */
/* ------------------------------------------------------------------ */
export const eglise: BuildingDef = {
  id: 'public_eglise',
  nameFr: 'Église à clocher-porche',
  category: 'public',
  footprint: { tilesX: 2, tilesZ: 4 },
  cost: 900000,
  upkeepPerMonth: 700,
  residents: 0,
  jobs: 4,
  density: 'faible',
  style: 'roman_gothique',
  tags: ['public', 'culte', 'eglise', 'clocher', 'patrimoine', 'monument', 'service:patrimoine', 'attractivite:2'],
  source: `${SRC}#eglise`,
  lodDistances: [240, 1000],
  palette: npPalette({
    facade: M('pierre_moellons', '#e6dccb'),
    encadrement: M('pierre_taille', '#efe7d7'),
    soubassement: M('pierre_rustique', '#d4c8b2'),
    toiture: M('toit_ardoise', '#6c7278'),
    fleche: M('toit_ardoise', '#5f656b'),
    porte: M('bardage_blanc', '#5a3a26'),
    menuiserie: M('metal_rideau', '#3a3d40', { metalness: 0.8, roughness: 0.5 }),
    verre: { kind: 'glass', color: '#5f6e88' },
  }),
  variants: [
    { id: 'origine', nameFr: 'Moellons clairs, ardoise' },
    { id: 'tuiles', nameFr: 'Pierre ocre, tuiles', materialOverrides: { facade: { color: '#e8cfa2' }, toiture: { textureSet: 'toit_tuiles', color: '#ffffff' } } },
    { id: 'gris', nameFr: 'Granit gris, ardoise', materialOverrides: { facade: { textureSet: 'pierre_rustique', color: '#cfcac2' } } },
  ],
  build(ctx: Ctx): void {
    const nx0 = -5.6, nx1 = 5.6, nz0 = -12.0, nz1 = 6.0;
    const nH = 11.0;
    const NW = nx1 - nx0, ND = nz1 - nz0;
    const sideWin = bays(ND, 5, 0.8).map((u) => archRect(u, 1.6, 3.2, 5.6));
    const F = volume(ctx, {
      x0: nx0, x1: nx1, z0: nz0, z1: nz1, h: nH, wallMat: 'facade', sides: {
        E: sideWin.map((r) => ({ kind: 'blind' as const, r })),
        W: sideWin.map((r) => ({ kind: 'blind' as const, r })),
      },
      hidden: ['S', 'N'], plinth: { h: 0.8, d: 0.1 }, ...(ctx.lod === 0 ? { quoins: { v0: 0.8 } } : {}),
    });
    arches(ctx, F.E, sideWin, 'facade', { mullions: 2, transoms: 2, surroundMat: 'encadrement' });
    arches(ctx, F.W, sideWin, 'facade', { mullions: 2, transoms: 2, surroundMat: 'encadrement' });
    // contreforts entre les baies
    for (const fr of [F.E, F.W]) for (let k = 0; k <= 5; k++) {
      const u = 0.8 + (k * (ND - 1.6)) / 5;
      fbox(ctx, 'encadrement', fr, u - 0.4, u + 0.4, 0, 6.0, 0, 1.2, 'back');
      fbox(ctx, 'encadrement', fr, u - 0.35, u + 0.35, 6.0, 9.5, 0, 0.7, 'back');
      fpf(ctx, 'toiture', fr, [[u - 0.4, 6.0, 1.2], [u + 0.4, 6.0, 1.2], [u + 0.35, 6.6, 0.7], [u - 0.35, 6.6, 0.7]], [0, 1, 1]);
      fpf(ctx, 'toiture', fr, [[u - 0.35, 9.5, 0.7], [u + 0.35, 9.5, 0.7], [u + 0.35, 10.2, 0.0], [u - 0.35, 10.2, 0.0]], [0, 1, 1]);
    }
    const roof = gableRoof(ctx, { x0: nx0, x1: nx1, z0: nz0, z1: nz1, y: nH, pitch: 48, axis: 'z', overhang: 0.4, verge: 0.2, gableMat: 'facade', gables: [true, false] });
    // façade occidentale (S, côté rue) : portail, rosace, pignon sous le clocher
    const tw = 5.6, tz1 = nz1 + 4.2;
    const tx0 = -tw / 2, tx1 = tw / 2;
    const S = edgeFrame(nx0, nz1, nx1, nz1, 0, nH);
    // murs de façade de part et d'autre du clocher
    fbox(ctx, 'facade', S, 0, (NW - tw) / 2, 0, nH, -0.01, 0.0, 'back left right top bottom');
    fbox(ctx, 'facade', S, (NW + tw) / 2, NW, 0, nH, -0.01, 0.0, 'back left right top bottom');
    const yAt = nH + (tx0 - nx0) * Math.tan((48 * Math.PI) / 180);
    ctx.mb.polyFacing('facade', [[nx0, nH, nz1], [tx0, nH, nz1], [tx0, yAt, nz1]], [0, 0, 1]);
    ctx.mb.polyFacing('facade', [[tx1, nH, nz1], [nx1, nH, nz1], [tx1, yAt, nz1]], [0, 0, 1]);
    void roof;
    // clocher-porche : 3 étages + beffroi + flèche
    const TH = 24.0;
    const T = volume(ctx, {
      x0: tx0, x1: tx1, z0: nz1 - 0.6, z1: tz1, h: TH, wallMat: 'facade', sides: {
        S: [{ kind: 'blind', r: { u0: 1.5, u1: 4.1, v0: 0, v1: 5.2 } }, { kind: 'blind', r: { u0: 1.3, u1: 4.3, v0: 7.2, v1: 10.2 } }, { kind: 'blind', r: archRect(2.8, 1.6, 18.0, 4.6) }],
        E: [{ kind: 'blind', r: archRect(2.4, 1.6, 18.0, 4.6) }],
        W: [{ kind: 'blind', r: archRect(2.4, 1.6, 18.0, 4.6) }],
        N: [{ kind: 'blind', r: archRect(2.8, 1.6, 18.0, 4.6) }],
      },
      plinth: { h: 0.8, d: 0.1 }, ...(ctx.lod === 0 ? { quoins: { v0: 0.8 } } : {}),
      bands: [{ v: 6.4, h: 0.3, d: 0.12 }, { v: 16.8, h: 0.3, d: 0.12 }],
      cornice: { profile: [[0.2, 0.1], [0.2, 0.25]] },
    });
    // portail en plein cintre ébrasé
    archWindow(ctx, T.S, { u0: 1.5, u1: 4.1, v0: 0, v1: 5.2 }, 'facade', { R: 0.7, mullions: 1, transoms: 0, sill: false, surroundMat: 'encadrement' });
    fpf(ctx, 'porte', T.S, [[1.55, 0, -0.62], [4.05, 0, -0.62], [4.05, 3.9, -0.62], [1.55, 3.9, -0.62]], [0, 0, 1]);
    if (ctx.lod === 0) for (const u of [2.15, 2.8, 3.45]) fbox(ctx, 'menuiserie', T.S, u - 0.03, u + 0.03, 0.3, 3.7, -0.62, -0.58, 'back');
    // rosace
    oculus(ctx, T.S, 2.8, 8.7, 1.5, 'facade', { spokes: 12 });
    // baie haute + abat-sons du beffroi
    for (const [fr, u] of [[T.S, 2.8], [T.E, 2.4], [T.W, 2.4], [T.N, 2.8]] as const) {
      archWindow(ctx, fr, archRect(u, 1.6, 18.0, 4.6), 'facade', { mullions: 2, transoms: 0, lit: -1 });
      if (ctx.lod < 2) for (let k = 0; k < 6; k++) fbox(ctx, 'fleche', fr, u - 0.78, u + 0.78, 18.3 + k * 0.5, 18.4 + k * 0.5, -0.2, 0.0, 'back');
      clockFace(ctx, fr, u, 14.4, 1.0, 0.05, 2.9);
    }
    // flèche octogonale en ardoise + clocheton
    spire(ctx, 'fleche', 0, TH + 0.45, (nz1 - 0.6 + tz1) / 2, tw * 0.62, 15.0, 8, Math.PI / 8);
    if (ctx.lod < 2) for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const x = dx * (tw / 2 - 0.4), z = (nz1 - 0.6 + tz1) / 2 + dz * ((tz1 - nz1 + 0.6) / 2 - 0.4);
      spire(ctx, 'fleche', x, TH + 0.45, z, 0.55, 2.6, 4);
    }
    ctx.mb.cylinder('menuiserie', 0, TH + 15.2, (nz1 - 0.6 + tz1) / 2, 0.06, 2.2, 6, true);
    if (ctx.lod < 2) ctx.mb.box('menuiserie', -0.5, TH + 16.6, (nz1 - 0.6 + tz1) / 2 - 0.04, 0.5, TH + 16.7, (nz1 - 0.6 + tz1) / 2 + 0.04, '');
    // chevet : abside semi-octogonale + toit conique
    const az = nz0;
    const ar = NW / 2;
    const apsePts: [number, number][] = [];
    for (let k = 0; k <= 4; k++) { const a = Math.PI - (k / 4) * Math.PI; apsePts.push([Math.cos(a) * ar, az - Math.sin(a) * ar * 0.9]); }
    for (let k = 0; k < 4; k++) {
      const a = apsePts[k]!, b = apsePts[k + 1]!;
      const fr = edgeFrame(a[0], a[1], b[0], b[1], 0, nH);
      // l'ordre a→b tourne dans le sens horaire vu de dessus : normale vers l'extérieur = -n de edgeFrame(a,b)
      const out: Frame = { o: P(fr, fr.w, 0, 0), u: [-fr.u[0], 0, -fr.u[2]], n: [-fr.n[0], 0, -fr.n[2]], w: fr.w, h: fr.h };
      const r = archRect(out.w / 2, 1.1, 3.2, 4.2);
      fpf(ctx, 'facade', out, [[0, 0, 0], [out.w, 0, 0], [out.w, out.h, 0], [0, out.h, 0]], [0, 0, 1]);
      glass(ctx, out, r.u0, r.u1, r.v0, r.v1 - 0.55, 0.03);
      if (ctx.lod < 2) fbox(ctx, 'encadrement', out, r.u0 - 0.15, r.u1 + 0.15, r.v0 - 0.1, r.v1, 0, 0.02, 'back');
    }
    for (let k = 0; k < 4; k++) {
      const a = apsePts[k]!, b = apsePts[k + 1]!;
      ctx.mb.polyFacing('toiture', [[a[0] * 1.08, nH - 0.2, az + (a[1] - az) * 1.08], [b[0] * 1.08, nH - 0.2, az + (b[1] - az) * 1.08], [0, nH + 3.6, az]], [(a[0] + b[0]) / 2, 1, (a[1] + b[1]) / 2 - az]);
    }
    // parvis + emmarchement
    slab(ctx, 'paves', -7.6, tz1, 7.6, tz1 + 3.0, 0, 0.08);
    steps(ctx, 'soubassement', subFrame(T.S, -0.4, 0, 0, tw + 0.8, 1), 0, tw + 0.8, 0.45, 3, 0.4);
    for (const x of [-6.5, 6.5]) shrub(ctx, x, 0, tz1 - 1.0, 0.8);
    void ring; void disc; void hCylinder; void mansardRoof; void dormer; void chimney; void cornice; void stairHouse; void flatRoof; void rooftopUnit; void mast;
  },
};

/* ------------------------------------------------------------------ */
/* 22. Gare de voyageurs                                                */
/* ------------------------------------------------------------------ */
export const gare: BuildingDef = {
  id: 'public_gare',
  nameFr: 'Gare de voyageurs',
  category: 'public',
  footprint: { tilesX: 5, tilesZ: 3 },
  cost: 2100000,
  upkeepPerMonth: 2600,
  residents: 0,
  jobs: 70,
  density: 'moyenne',
  style: 'gare_historique',
  tags: ['public', 'transport', 'gare', 'verriere', 'horloge', 'service:transport', 'rayon:2500', 'attractivite:2'],
  source: `${SRC}#gare`,
  lodDistances: [240, 1000],
  palette: npPalette({
    facade: M('pierre_taille', '#ece2d0'),
    facade_b: M('brique_orange', '#ffffff'),
    soubassement: M('pierre_rustique', '#cbbfa8'),
    encadrement: M('pierre_taille', '#f7f1e5'),
    toiture: M('toit_ardoise', '#6f757b'),
    zinc: M('toit_tole_ondulee', '#7f878c', { metalness: 1, roughness: 0.5 }),
    menuiserie: M('metal_rideau', '#2f4f4a', { metalness: 0.8, roughness: 0.45 }),
    meneau: M('metal_rideau', '#2f4f4a', { metalness: 0.9, roughness: 0.4 }),
    lettres: M('enduit_peint', '#2f4f4a'),
    quai: M('trottoir_dalles', '#d8d4cc'),
    rail: M('metal_rideau', '#8a8f93', { metalness: 1, roughness: 0.3 }),
    traverse: M('bardage_bois', '#9a8a78'),
    verre_mr: { kind: 'glass', color: '#7f9aa8' },
  }),
  variants: [
    { id: 'origine', nameFr: 'Pierre et brique, fers vert sapin' },
    { id: 'bleu', nameFr: 'Pierre claire, fers bleu', materialOverrides: { menuiserie: { color: '#2f4a6f' }, meneau: { color: '#2f4a6f' }, lettres: { color: '#2f4a6f' } } },
    { id: 'brique', nameFr: 'Tout brique, fers rouges', materialOverrides: { facade: { textureSet: 'brique_rouge', color: '#ffffff' }, menuiserie: { color: '#7a2a24' }, meneau: { color: '#7a2a24' } } },
  ],
  build(ctx: Ctx): void {
    // grand hall central : façade à grande baie thermale + horloge
    const hx0 = -7.5, hx1 = 7.5, hz0 = -8.0, hz1 = 3.0;
    const hH = 13.0;
    const HW = hx1 - hx0;
    const big = { u0: 2.0, u1: HW - 2.0, v0: 1.0, v1: 1.0 + 4.5 + (HW - 4.0) / 2 };
    const Hv = volume(ctx, {
      x0: hx0, x1: hx1, z0: hz0, z1: hz1, h: hH, wallMat: 'facade', sides: {
        S: [{ kind: 'blind', r: big }],
        N: [{ kind: 'blind', r: big }],
      },
      hidden: ['E', 'W'], plinth: { h: 1.0, d: 0.08 }, ...(ctx.lod === 0 ? { quoins: { v0: 1.0 } } : {}),
      cornice: { profile: [[0.2, 0.08], [0.2, 0.25], [0.25, 0.45]] },
    });
    for (const fr of [Hv.S, Hv.N]) {
      archWindow(ctx, fr, big, 'facade', { R: 0.6, mullions: 5, transoms: 2, sill: false, surroundMat: 'encadrement', frameMat: 'meneau', lit: 2 });
      // portes vitrées au pied de la baie
      if (fr === Hv.S) for (const u of [4.0, 7.5, 11.0]) fbox(ctx, 'menuiserie', fr, u - 1.0, u + 1.0, 1.0, 3.6, -0.5, -0.45, 'back');
    }
    // fronton cintré + horloge + lettrage
    fbox(ctx, 'encadrement', Hv.S, 0, HW, hH - 1.4, hH - 0.4, 0, 0.1, 'back');
    lettering(ctx, 'lettres', Hv.S, 'GARE', HW / 2, hH - 1.22, 0.65, 0.1, 0.05);
    const pf = subFrame(Hv.S, 0, 0, 0, HW, hH + 4);
    const segs = ctx.lod === 0 ? 12 : 6;
    const arc: [number, number, number][] = [];
    for (let i = 0; i <= segs; i++) { const t = Math.PI - (i / segs) * Math.PI; arc.push([HW / 2 + Math.cos(t) * (HW / 2), hH + 0.62 + Math.sin(t) * 3.4, 0]); }
    fpf(ctx, 'facade', pf, [[0, hH + 0.62, 0], [HW, hH + 0.62, 0], ...arc.slice(1, -1).reverse()], [0, 0, 1]);
    clockFace(ctx, pf, HW / 2, hH + 2.0, 1.2, 0.04, 9.1);
    // toit du hall : demi-berceau en ardoise
    const rz0 = hz0 - 0.3, rz1 = hz1 + 0.05;
    for (let i = 0; i < segs; i++) {
      const a = arc[i]!, b = arc[i + 1]!;
      const A: [number, number] = [hx0 + a[0], a[1]], B: [number, number] = [hx0 + b[0], b[1]];
      ctx.mb.polyFacing('toiture', [[A[0], A[1] + 0.05, rz1], [B[0], B[1] + 0.05, rz1], [B[0], B[1] + 0.05, rz0], [A[0], A[1] + 0.05, rz0]], [(A[0] + B[0]) / 2, 1, 0]);
    }
    // pignon N du berceau
    fpf(ctx, 'facade', subFrame(Hv.N, 0, 0, 0, HW, hH + 4), [[0, hH + 0.62, 0], [HW, hH + 0.62, 0], ...arc.slice(1, -1).map(([u, v]) => [HW - u, v, 0] as [number, number, number]).reverse()], [0, 0, 1]);
    // ailes basses (R+1) en brique à chaînages de pierre
    for (const [ax0, ax1, side] of [[-19.6, hx0, 'W'], [hx1, 15.6, 'E']] as const) {
      const AW = ax1 - ax0;
      const wing = volume(ctx, {
        x0: ax0, x1: ax1, z0: -7.0, z1: 2.0, h: 8.2, wallMat: 'facade_b', sides: {
          S: [...bays(AW, Math.round(AW / 3), 0.4).map((u) => ({ kind: 'blind' as const, r: archRect(u, 1.5, 0.9, 3.4) })), ...row(bays(AW, Math.round(AW / 3), 0.4), 1.2, 5.0, 2.0, () => ({ kind: 'window' as const, o: { shutters: 'none' as const, leaves: 2, bars: 1, surround: 0.14, surroundMat: 'encadrement' } }))],
          N: bays(AW, Math.round(AW / 3), 0.4).map((u) => ({ kind: 'blind' as const, r: archRect(u, 1.6, 0.4, 3.6) })),
          [side]: row(bays(9, 2, 0.6), 1.2, 5.0, 2.0, () => ({ kind: 'window' as const, o: { shutters: 'none' as const, leaves: 2, surround: 0.14 } })),
        },
        hidden: [side === 'W' ? 'E' : 'W'], plinth: { h: 0.9, d: 0.06, mat: 'soubassement' }, ...(ctx.lod === 0 ? { quoins: { v0: 0.9, mat: 'encadrement' } } : {}),
        bands: [{ v: 4.5, h: 0.25, d: 0.08, mat: 'encadrement' }],
        cornice: { profile: [[0.15, 0.06], [0.18, 0.2]], mat: 'encadrement' },
      });
      arches(ctx, wing.S, bays(AW, Math.round(AW / 3), 0.4).map((u) => archRect(u, 1.5, 0.9, 3.4)), 'facade_b', { mullions: 2, surroundMat: 'encadrement' });
      arches(ctx, wing.N, bays(AW, Math.round(AW / 3), 0.4).map((u) => archRect(u, 1.6, 0.4, 3.6)), 'facade_b', { mullions: 2, sill: false, surroundMat: 'encadrement' });
      hipRoof(ctx, { x0: ax0, x1: ax1, z0: -7.0, z1: 2.0, y: 8.45, pitch: 30, overhang: 0.4 });
    }
    // marquise d'entrée (verre sur consoles en fonte)
    const mq = edgeFrame(hx0, hz1, hx1, hz1, 0, 6);
    fbox(ctx, 'meneau', mq, 0.5, HW - 0.5, 4.2, 4.35, 0, 2.6, '');
    if (ctx.lod < 2) {
      const prev = ctx.mb.lit; ctx.mb.lit = -1;
      fpf(ctx, 'verre_gc', mq, [[0.6, 4.36, 0.1], [HW - 0.6, 4.36, 0.1], [HW - 0.6, 4.6, 2.5], [0.6, 4.6, 2.5]], [0, 1, 0.1]);
      ctx.mb.lit = prev;
      for (let u = 1.0; u < HW - 0.5; u += 2.2) fpf(ctx, 'meneau', mq, [[u, 3.3, 0], [u, 4.2, 0], [u, 4.2, 2.2]], [1, 0, 0]);
    }
    // quais et verrière à l'arrière (N) : 2 quais, 2 voies
    const qz1 = -8.0, qz0 = -15.6;
    slab(ctx, 'quai', -19.6, qz1 - 3.6, 15.6, qz1, 0, 0.9);
    if (ctx.lod < 2) {
      ctx.mb.box('marquage_j', -19.6, 0.9, qz1 - 3.6, 15.6, 0.905, qz1 - 3.25, 'ny');
      // voie : ballast, traverses, rails
      ctx.mb.box('gravier', -19.6, 0, qz0, 15.6, 0.25, qz1 - 3.6, 'ny');
      if (ctx.lod === 0) for (let x = -19.2; x < 15.4; x += 0.7) ctx.mb.box('traverse', x - 0.12, 0.25, -14.9, x + 0.12, 0.38, -12.3, 'ny');
      for (const z of [-14.3, -12.9]) ctx.mb.box('rail', -19.6, 0.38, z - 0.04, 15.6, 0.52, z + 0.04, 'ny');
    }
    // verrière de quai sur colonnes en fonte
    for (let x = -18; x <= 14; x += 8) {
      ctx.mb.cylinder('meneau', x, 0.9, qz1 - 2.2, 0.16, 4.6, ctx.lod === 0 ? 8 : 5, false);
      if (ctx.lod < 2) ctx.mb.box('meneau', x - 0.25, 5.5, qz1 - 6.5, x + 0.25, 5.8, qz1 - 0.2, '');
    }
    const prev = ctx.mb.lit; ctx.mb.lit = -1;
    ctx.mb.polyFacing('verre_gc', [[-19.6, 5.8, qz1 - 6.6], [15.6, 5.8, qz1 - 6.6], [15.6, 6.8, qz1 - 2.2], [-19.6, 6.8, qz1 - 2.2]], [0, 1, -0.2]);
    ctx.mb.polyFacing('verre_gc', [[-19.6, 6.8, qz1 - 2.2], [15.6, 6.8, qz1 - 2.2], [15.6, 6.4, qz1 - 0.1], [-19.6, 6.4, qz1 - 0.1]], [0, 1, 0.2]);
    ctx.mb.lit = prev;
    ctx.mb.box('meneau', -19.6, 5.6, qz1 - 6.7, 15.6, 5.85, qz1 - 6.5, '');
    // parvis : dalles, arrêt de taxis, bancs, lampadaires
    slab(ctx, 'dallage', -19.6, 2.0, 15.6, 8.6, 0, 0.1);
    if (ctx.lod < 2) {
      ctx.mb.box('marquage_j', 4.0, 0.1, 7.6, 15.0, 0.11, 7.75, 'ny');
    }
    for (const x of [-15, -10, 10]) bench(ctx, x, 0.1, 6.5, Math.PI, 1.8);
    for (const x of [-17, -3, 8, 14]) lampPost(ctx, x, 0.1, 8.0, 4.8, [0, 0, -1]);
    void glass; void curtainWall;
  },
};

/* ------------------------------------------------------------------ */
/* 23. Parc aménagé (kiosque, fontaine, allées, aire de jeux)            */
/* ------------------------------------------------------------------ */
export const parc: BuildingDef = {
  id: 'public_parc_kiosque',
  nameFr: 'Parc public à kiosque',
  category: 'public',
  footprint: { tilesX: 4, tilesZ: 4 },
  cost: 180000,
  upkeepPerMonth: 450,
  residents: 0,
  jobs: 4,
  density: 'faible',
  style: 'jardin_public',
  tags: ['public', 'parc', 'loisirs', 'kiosque', 'fontaine', 'aire_de_jeux', 'espace_vert', 'service:loisirs', 'rayon:600', 'attractivite:2'],
  source: `${SRC}#parc`,
  palette: npPalette({
    gazon: M('terrain_herbe', '#9cc06a'),
    vegetal: M('terrain_herbe', '#4f7a34'),
    fleurs_a: M('enduit_peint', '#d9475a'),
    fleurs_b: M('enduit_peint', '#f0c23b'),
    fleurs_c: M('enduit_peint', '#9a6ad0'),
    gravier: M('terrain_gravier', '#e6dccb'),
    encadrement: M('pierre_taille', '#efe8da'),
    eau: { kind: 'glass', color: '#3f6f86' },
    kiosque: M('bardage_blanc', '#e9eef0'),
    toiture: M('toit_tole_ondulee', '#6b8f7f', { metalness: 0.7, roughness: 0.45 }),
    jeu_a: M('enduit_peint', '#d9533b'),
    jeu_b: M('enduit_peint', '#3b7fd9'),
    bois: M('bardage_bois', '#ffffff'),
    sable: M('terrain_sable', '#ffffff'),
  }),
  variants: [
    { id: 'origine', nameFr: 'Kiosque vert d\'eau, massifs rouges et jaunes' },
    { id: 'printemps', nameFr: 'Massifs violets, kiosque blanc', materialOverrides: { fleurs_a: { color: '#b07ad8' }, fleurs_b: { color: '#f2f2f0' }, toiture: { color: '#4f5f6f' } } },
    { id: 'automne', nameFr: 'Gazon automnal, massifs orangés', materialOverrides: { gazon: { color: '#b9b06a' }, fleurs_a: { color: '#e07a2a' }, fleurs_b: { color: '#c0392b' } } },
  ],
  build(ctx: Ctx): void {
    const E = 15.8;
    // pelouses (4 quartiers séparés par des allées en croix + allée circulaire)
    slab(ctx, 'gravier', -E, -E, E, E, 0, 0.04);
    const path = 1.4;
    const rIn = 6.5, rOut = 8.0;
    // pelouses : quartiers avec découpe circulaire (polygone)
    const segs = ctx.lod === 0 ? 10 : ctx.lod === 1 ? 6 : 3;
    for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]] as const) {
      const pts: [number, number][] = [];
      // arc extérieur de l'allée circulaire, de l'axe X à l'axe Z
      for (let i = 0; i <= segs; i++) {
        const t = (i / segs) * (Math.PI / 2);
        const ax = Math.cos(t) * rOut, az = Math.sin(t) * rOut;
        pts.push([sx * Math.max(path / 2, ax), sz * Math.max(path / 2, az)]);
      }
      pts.push([sx * path / 2, sz * (E - 0.6)], [sx * (E - 0.6), sz * (E - 0.6)], [sx * (E - 0.6), sz * path / 2]);
      ctx.mb.extrude('gazon', sx * sz > 0 ? pts : [...pts].reverse(), 0.04, 0.12, { top: 'gazon', sides: true });
      // pelouse intérieure (anneau central)
      const inner: [number, number][] = [[sx * path / 2, sz * path / 2]];
      for (let i = 0; i <= segs; i++) {
        const t = (i / segs) * (Math.PI / 2);
        inner.push([sx * Math.max(path / 2, Math.cos(t) * rIn), sz * Math.max(path / 2, Math.sin(t) * rIn)]);
      }
      void inner;
      // massif fleuri en arc dans chaque quartier
      for (let i = 0; i < (ctx.lod === 0 ? 6 : 3); i++) {
        const t = ((i + 0.5) / (ctx.lod === 0 ? 6 : 3)) * (Math.PI / 2);
        const x = sx * Math.cos(t) * (rOut + 1.4), z = sz * Math.sin(t) * (rOut + 1.4);
        // corbeille fleurie : bordure de pierre + massif bombé + touffe de feuillage au centre
        ctx.mb.cylinder('encadrement', x, 0.12, z, 0.95, 0.22, ctx.lod === 0 ? 12 : 6, false);
        dome(ctx, i % 2 === 0 ? 'fleurs_a' : 'fleurs_b', x, 0.3, z, 0.9, ctx.lod === 0 ? 12 : 6, ctx.lod === 0 ? 3 : 2, 0.4);
        if (ctx.lod === 0) dome(ctx, 'vegetal', x, 0.55, z, 0.32, 8, 3, 0.9, true);
      }
      // haies taillées le long des bords
      ctx.mb.box('vegetal', sx > 0 ? E - 1.4 : -E + 0.6, 0.12, sz > 0 ? path / 2 + 2.6 : -E + 0.6, sx > 0 ? E - 0.6 : -E + 1.4, 1.1, sz > 0 ? E - 0.6 : -path / 2 - 2.6, 'ny');
      // arbustes isolés
      shrub(ctx, sx * 12.0, 0.12, sz * 11.0, 1.1);
      shrub(ctx, sx * 4.5, 0.12, sz * 12.5, 0.9);
    }
    // haie basse côté rue (S) interrompue par l'entrée
    ctx.mb.box('vegetal', -E + 0.6, 0.12, E - 1.3, -path / 2 - 1.4, 0.95, E - 0.6, 'ny');
    ctx.mb.box('vegetal', path / 2 + 1.4, 0.12, E - 1.3, E - 0.6, 0.95, E - 0.6, 'ny');
    // piliers d'entrée + grille
    for (const x of [-path / 2 - 1.3, path / 2 + 1.3]) {
      ctx.mb.box('encadrement', x - 0.35, 0, E - 1.3, x + 0.35, 2.2, E - 0.6, 'ny');
      if (ctx.lod < 2) ctx.mb.box('encadrement', x - 0.45, 2.2, E - 1.4, x + 0.45, 2.4, E - 0.5, '');
      if (ctx.lod < 2) dome(ctx, 'encadrement', x, 2.4, E - 0.95, 0.3, 8, 3, 1.0, true);
    }
    // bordures de l'allée circulaire
    // fontaine centrale : bassin octogonal + vasques
    const seg = ctx.lod === 0 ? 20 : 10;
    ctx.mb.cylinder('encadrement', 0, 0.04, 0, 3.4, 0.55, 8, false, 3.4);
    ctx.mb.cylinder('encadrement', 0, 0.59, 0, 3.55, 0.12, 8, true, 3.55);
    {
      const prev = ctx.mb.lit; ctx.mb.lit = -1;
      ctx.mb.extrude('eau', regularPoly(8, 3.15, 0), 0.45, 0.5, { top: 'eau', sides: false });
      ctx.mb.lit = prev;
    }
    ctx.mb.cylinder('encadrement', 0, 0.5, 0, 0.35, 1.6, seg, false, 0.25);
    ctx.mb.cylinder('encadrement', 0, 2.1, 0, 0.3, 0.3, seg, false, 1.5);
    {
      const prev = ctx.mb.lit; ctx.mb.lit = -1;
      ctx.mb.extrude('eau', regularPoly(12, 1.4, 0), 2.32, 2.36, { top: 'eau', sides: false });
      ctx.mb.lit = prev;
    }
    ctx.mb.cylinder('encadrement', 0, 2.4, 0, 0.15, 0.9, seg, false, 0.1);
    ctx.mb.cylinder('encadrement', 0, 3.3, 0, 0.12, 0.15, seg, false, 0.7);
    // kiosque à musique octogonal (quartier nord-ouest)
    const kx = -9.5, kz = -9.5;
    const kp = regularPoly(8, 3.4, 0, kx, kz);
    ctx.mb.extrude('encadrement', kp, 0.04, 1.0, { top: 'bois' });
    if (ctx.lod < 2) steps(ctx, 'encadrement', polyFrames(kp, 0.04, 1)[0]!, 0.6, polyFrames(kp, 0.04, 1)[0]!.w - 0.6, 0.96, 3, 0.35);
    for (const [x, z] of regularPoly(8, 3.1, Math.PI / 8, kx, kz)) ctx.mb.cylinder('kiosque', x, 1.0, z, 0.1, 3.0, ctx.lod === 0 ? 8 : 5, false);
    if (ctx.lod < 2) for (const f of polyFrames(regularPoly(8, 3.1, 0, kx, kz), 1.0, 1)) {
      if (f === undefined) continue;
      const a = P(f, 0, 0, 0), b = P(f, f.w, 0, 0);
      ctx.mb.tube('kiosque', [a[0], 1.9, a[2]], [b[0], 1.9, b[2]], 0.04, 4);
      if (ctx.lod === 0) for (let k = 1; k < 6; k++) { const t = k / 6; ctx.mb.box('kiosque', a[0] + (b[0] - a[0]) * t - 0.02, 1.0, a[2] + (b[2] - a[2]) * t - 0.02, a[0] + (b[0] - a[0]) * t + 0.02, 1.9, a[2] + (b[2] - a[2]) * t + 0.02, 'ny py'); }
    }
    ctx.mb.extrude('kiosque', regularPoly(8, 3.6, 0, kx, kz), 4.0, 4.3, { top: null, bottom: true });
    spire(ctx, 'toiture', kx, 4.3, kz, 3.9, 2.6, 8, Math.PI / 8);
    if (ctx.lod < 2) { dome(ctx, 'toiture', kx, 6.8, kz, 0.3, 8, 3, 1.2, true); ctx.mb.cylinder('garde_corps', kx, 7.0, kz, 0.03, 0.8, 5, true); }
    // aire de jeux (quartier nord-est) : bac à sable, toboggan, balançoire
    const px = 9.5, pz = -9.5;
    ctx.mb.box('bois', px - 3.2, 0.04, pz - 3.2, px + 3.2, 0.3, pz + 3.2, 'ny py');
    ctx.mb.box('sable', px - 3.0, 0.04, pz - 3.0, px + 3.0, 0.24, pz + 3.0, 'ny');
    // portique de balançoire
    if (ctx.lod < 2) for (const sx of [-1, 1]) {
      ctx.mb.tube('jeu_b', [px + sx * 2.2, 0.24, pz - 2.4], [px + sx * 2.2, 2.4, pz - 1.6], 0.06, 6);
      ctx.mb.tube('jeu_b', [px + sx * 2.2, 0.24, pz - 0.8], [px + sx * 2.2, 2.4, pz - 1.6], 0.06, 6);
    }
    ctx.mb.tube('jeu_b', [px - 2.2, 2.4, pz - 1.6], [px + 2.2, 2.4, pz - 1.6], 0.07, 6);
    if (ctx.lod < 2) for (const sx of [-0.9, 0.9]) {
      ctx.mb.box('garde_corps', px + sx - 0.22, 0.85, pz - 1.6 - 0.02, px + sx - 0.2, 2.4, pz - 1.6 + 0.02, '');
      ctx.mb.box('garde_corps', px + sx + 0.2, 0.85, pz - 1.6 - 0.02, px + sx + 0.22, 2.4, pz - 1.6 + 0.02, '');
      ctx.mb.box('jeu_a', px + sx - 0.25, 0.8, pz - 1.75, px + sx + 0.25, 0.86, pz - 1.45, '');
    }
    // toboggan : plateforme, échelle, glissière
    ctx.mb.box('jeu_a', px - 0.6, 1.5, pz + 0.6, px + 0.6, 1.62, pz + 1.8, '');
    for (const [dx, dz] of [[-0.55, 0.65], [0.55, 0.65], [-0.55, 1.75], [0.55, 1.75]] as const) ctx.mb.box('jeu_b', px + dx - 0.05, 0.24, pz + dz - 0.05, px + dx + 0.05, 2.4, pz + dz + 0.05, 'ny');
    ctx.mb.polyFacing('jeu_a', [[px - 0.4, 1.62, pz + 1.8], [px + 0.4, 1.62, pz + 1.8], [px + 0.4, 0.4, pz + 3.0], [px - 0.4, 0.4, pz + 3.0]], [0, 1, 1]);
    if (ctx.lod < 2) {
      ctx.mb.polyFacing('jeu_a', [[px - 0.4, 1.62, pz + 1.8], [px + 0.4, 1.62, pz + 1.8], [px + 0.4, 0.4, pz + 3.0], [px - 0.4, 0.4, pz + 3.0]], [0, -1, -1]);
      for (const sx of [-0.42, 0.42]) ctx.mb.box('jeu_a', px + sx - 0.03, 1.62, pz + 1.8, px + sx + 0.03, 1.85, pz + 1.85, '');
      spire(ctx, 'jeu_b', px, 2.4, pz + 1.2, 0.95, 0.9, 4);
      for (let k = 0; k < 5; k++) ctx.mb.box('jeu_b', px - 0.4, 0.4 + k * 0.28, pz + 0.55 - k * 0.0 - 0.02, px + 0.4, 0.44 + k * 0.28, pz + 0.55 + 0.02, '');
    }
    // bancs autour de l'allée circulaire + lampadaires
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + (i * Math.PI) / 4;
      bench(ctx, Math.cos(a) * (rOut + 0.5), 0.04, Math.sin(a) * (rOut + 0.5), -a - Math.PI / 2, 1.8);
    }
    for (const [x, z] of [[2.0, 12.0], [-2.0, -12.0], [12.0, -2.0], [-12.0, 2.0]] as const) lampPost(ctx, x, 0.04, z, 4.0, [-Math.sign(x) * (Math.abs(x) > 5 ? 1 : 0), 0, -Math.sign(z) * (Math.abs(z) > 5 ? 1 : 0)]);
    // poubelles
    if (ctx.lod < 2) for (const [x, z] of [[1.4, 9.0], [-1.4, -9.0]] as const) ctx.mb.cylinder('garde_corps', x, 0.04, z, 0.28, 0.9, 10, true);
    void ring; void hCylinder; void litSeed; void disc;
  },
};

export const PUBLIC: BuildingDef[] = [mairie, ecole, casernePompiers, commissariat, hopital, musee, eglise, gare, parc];
