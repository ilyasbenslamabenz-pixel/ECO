/**
 * Modèles 3D originaux du réseau électrique (phase 2B, sous-étape 4) — générés en code avec le kit
 * (tools/buildings/kit) : géométrie procédurale, UV en mètres, matériaux PBR par rôle pointant vers les jeux de
 * textures DÉJÀ présents (aucun pixel ajouté), 3 LOD (0 complet, 1 allégé, 2 silhouettes).
 *
 * Bâtiments (posés par le joueur, onglet Industrie) : centrale thermique au gaz, éolienne (mât + nacelle),
 * ferme solaire, centrale hydroélectrique au fil de l'eau (barrage), poste de transformation.
 * Éléments instanciés par le rendu : rotor d'éolienne (animé), pylône treillis des lignes HT.
 * Conventions : mètres, Y vers le haut, façade principale vers +Z, origine au centre de l'emprise.
 */
import type { BuildingDef, Ctx, KitMaterial, Palette, V3 } from '../buildings/kit/index';
import { npPalette } from '../buildings/nonresidential/parts';
import { GANTRY_HEIGHT, POWER_ASSETS, PYLON, TURBINE } from '../../src/shared/power/render-spec';
import { FACILITY_SPECS } from '../../src/shared/power/model';

const SRC = 'tools/power/models.ts';
const M = (set: string, color?: string, extra: Partial<KitMaterial> = {}): KitMaterial => ({ set, ...(color ? { color } : {}), ...extra });

/** Palette commune des ouvrages électriques. */
function powerPalette(over: Partial<Palette> = {}): Palette {
  return npPalette({
    acier_galva: M('metal_rideau', '#b7bcbf', { metalness: 1, roughness: 0.5 }),
    acier_peint: M('enduit_peint', '#7d868c', { roughness: 0.6 }),
    beton: M('sol_beton_brut', '#c9c5bd'),
    beton_clair: M('beton_facade', '#e6e2d9'),
    bardage_ind: M('bardage_blanc', '#c3c8cb', { roughness: 0.55 }),
    bardage_acc: M('enduit_peint', '#3d6f96', { roughness: 0.5 }),
    isolateur: M('enduit_peint', '#7a4a32', { roughness: 0.35 }),
    blanc_eol: M('enduit_blanc', '#f1f3f3', { roughness: 0.45 }),
    rouge_balise: M('enduit_peint', '#c8322a', { roughness: 0.5 }),
    gravier_poste: M('terrain_gravier', '#a7a39b'),
    cellule: { kind: 'glass', color: '#1b2a48' },
    cadre_pv: M('metal_rideau', '#c9cdd0', { metalness: 1, roughness: 0.4 }),
    eau_vive: M('beton_facade', '#7f9aa3', { roughness: 0.25 }),
    vanne: M('enduit_peint', '#3d6f8f', { roughness: 0.55 }),
    transfo: M('enduit_peint', '#7f8a87', { roughness: 0.55 }),
    ...over,
  });
}

/* ------------------------------------------------------------------ */
/* Briques                                                              */
/* ------------------------------------------------------------------ */

/** Membrure (tube à section carrée / polygonale) entre deux points. */
function bar(ctx: Ctx, mat: string, a: V3, b: V3, r: number, seg = 4): void { ctx.mb.tube(mat, a, b, r, seg, true); }

/** Clôture légère : poteaux, lisses haute et basse, panneau grillagé (quad double face). */
function lightFence(ctx: Ctx, A: V3, B: V3, h = 2.2): void {
  if (ctx.lod === 2) return;
  const L = Math.hypot(B[0] - A[0], B[2] - A[2]);
  const n = Math.max(1, Math.round(L / (ctx.lod === 0 ? 3 : 6)));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = A[0] + (B[0] - A[0]) * t, z = A[2] + (B[2] - A[2]) * t;
    ctx.mb.box('garde_corps', x - 0.05, A[1], z - 0.05, x + 0.05, A[1] + h, z + 0.05, 'ny');
  }
  const rails = ctx.lod === 0 ? [0.15, 0.8, 1.5, h] : [0.15, h];
  for (const y of rails) bar(ctx, 'garde_corps', [A[0], A[1] + y, A[2]], [B[0], B[1] + y, B[2]], 0.025, 4);
}

/** Clôture de tout le périmètre d'un rectangle, avec portail sur la face +Z. */
function perimeterFence(ctx: Ctx, x0: number, z0: number, x1: number, z1: number, gate = 6): void {
  const gm = (x0 + x1) / 2;
  lightFence(ctx, [x0, 0, z0], [x1, 0, z0]);
  lightFence(ctx, [x1, 0, z0], [x1, 0, z1]);
  lightFence(ctx, [x0, 0, z1], [x0, 0, z0]);
  lightFence(ctx, [x1, 0, z1], [gm + gate / 2, 0, z1]);
  lightFence(ctx, [gm - gate / 2, 0, z1], [x0, 0, z1]);
}

/** Dalle de sol (dessus + chants). */
function ground(ctx: Ctx, mat: string, x0: number, z0: number, x1: number, z1: number, h = 0.15): void {
  ctx.mb.box(mat, x0, 0, z0, x1, h, z1, 'ny');
}

/** Transformateur de puissance : cuve, radiateurs, traversées avec isolateurs, conservateur. */
function transformer(ctx: Ctx, x: number, z: number, w = 4.2, d = 3, h = 3.4, rot = 0): void {
  ctx.mb.push(x, 0, z, rot);
  ctx.mb.box('beton', -w / 2 - 0.6, 0, -d / 2 - 0.6, w / 2 + 0.6, 0.4, d / 2 + 0.6, 'ny');
  ctx.mb.box('transfo', -w / 2, 0.4, -d / 2, w / 2, 0.4 + h, d / 2, 'ny');
  if (ctx.lod < 2) {
    // radiateurs (ailettes) sur les deux grands côtés
    const n = ctx.lod === 0 ? 8 : 4;
    for (let i = 0; i < n; i++) {
      const u = -w / 2 + 0.3 + ((w - 0.6) * (i + 0.5)) / n;
      for (const s of [-1, 1]) ctx.mb.box('transfo', u - 0.05, 0.8, s > 0 ? d / 2 : -d / 2 - 0.9, u + 0.05, h - 0.1, s > 0 ? d / 2 + 0.9 : -d / 2, 'ny');
    }
    // conservateur
    ctx.mb.tube('transfo', [-w / 2 + 0.3, h + 1.3, -d / 2 + 0.5], [w / 2 - 0.3, h + 1.3, -d / 2 + 0.5], 0.45, ctx.lod === 0 ? 10 : 6, false);
    ctx.mb.box('acier_peint', -w / 2 + 0.6, h + 0.4, -d / 2 + 0.4, -w / 2 + 0.75, h + 1.0, -d / 2 + 0.6);
    ctx.mb.box('acier_peint', w / 2 - 0.75, h + 0.4, -d / 2 + 0.4, w / 2 - 0.6, h + 1.0, -d / 2 + 0.6);
  }
  // traversées HT : isolateurs empilés
  for (let k = 0; k < 3; k++) {
    const u = -w / 3 + (k * w) / 3;
    ctx.mb.cylinder('isolateur', u, 0.4 + h, d / 6, 0.22, 2.2, ctx.lod === 0 ? 8 : 5, true, 0.14);
    if (ctx.lod === 0) for (let j = 0; j < 4; j++) ctx.mb.cylinder('isolateur', u, 0.4 + h + 0.4 + j * 0.45, d / 6, 0.34, 0.1, 8, true);
  }
  ctx.mb.pop();
}

/** Portique d'arrivée de ligne (deux poteaux treillis simplifiés + poutre) à la hauteur GANTRY_HEIGHT. */
function gantry(ctx: Ctx, x: number, z: number, span: number, rot = 0): void {
  const H = GANTRY_HEIGHT + 1;
  ctx.mb.push(x, 0, z, rot);
  for (const s of [-1, 1]) {
    const px = (s * span) / 2;
    if (ctx.lod === 2) ctx.mb.box('acier_galva', px - 0.35, 0, -0.35, px + 0.35, H, 0.35, 'ny');
    else {
      const r = ctx.lod === 0 ? 0.07 : 0.1;
      const c: [number, number][] = [[-0.45, -0.45], [0.45, -0.45], [0.45, 0.45], [-0.45, 0.45]];
      for (const [a, b] of c) bar(ctx, 'acier_galva', [px + a, 0, b], [px + a * 0.6, H, b * 0.6], r);
      if (ctx.lod === 0) {
        for (let k = 0; k < 6; k++) {
          const y0 = (k * H) / 6, y1 = ((k + 1) * H) / 6;
          bar(ctx, 'acier_galva', [px - 0.42, y0, 0.42], [px + 0.42, y1, 0.42], 0.04);
          bar(ctx, 'acier_galva', [px + 0.42, y0, -0.42], [px - 0.42, y1, -0.42], 0.04);
        }
      }
    }
    ctx.mb.box('beton', px - 0.8, 0, -0.8, px + 0.8, 0.5, 0.8, 'ny');
  }
  ctx.mb.box('acier_galva', -span / 2, H - 0.8, -0.35, span / 2, H, 0.35);
  if (ctx.lod < 2) {
    for (let k = 0; k < 3; k++) {
      const u = -span / 3 + (k * span) / 3;
      ctx.mb.cylinder('isolateur', u, H - 2.6, 0, 0.12, 1.8, 6, true);
    }
  }
  ctx.mb.pop();
}

/** Bâtiment de commande (boîte enduite, porte, bandeau de fenêtres, acrotère). */
function controlHouse(ctx: Ctx, x0: number, z0: number, x1: number, z1: number, h: number): void {
  ctx.mb.box('beton_clair', x0, 0, z0, x1, h, z1, 'ny');
  ctx.mb.box('terrasse', x0 + 0.2, h, z0 + 0.2, x1 - 0.2, h + 0.05, z1 - 0.2, 'ny');
  ctx.mb.box('encadrement', x0 - 0.1, h - 0.3, z0 - 0.1, x1 + 0.1, h + 0.35, z1 + 0.1, 'ny');
  // porte + fenêtres en façade +Z
  ctx.mb.box('porte', x0 + 1, 0.05, z1, x0 + 2.2, 2.3, z1 + 0.06, 'nz');
  if (ctx.lod < 2) {
    const n = Math.max(1, Math.floor((x1 - x0 - 4) / 2));
    for (let i = 0; i < n; i++) {
      const u = x0 + 3.2 + i * 2;
      ctx.mb.lit = ((i * 37) % 10) / 10;
      ctx.mb.quad('verre', [u, 1.2, z1 + 0.03], [u + 1.3, 1.2, z1 + 0.03], [u + 1.3, 2.4, z1 + 0.03], [u, 2.4, z1 + 0.03]);
      ctx.mb.box('encadrement', u - 0.08, 1.1, z1, u + 1.38, 1.2, z1 + 0.12);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Centrale thermique au gaz (cycle combiné)                            */
/* ------------------------------------------------------------------ */

export const centraleGaz: BuildingDef = {
  id: POWER_ASSETS.thermique,
  nameFr: FACILITY_SPECS.thermique.nameFr,
  category: 'industrial',
  footprint: { tilesX: 6, tilesZ: 5 },
  cost: 8_500_000,
  upkeepPerMonth: 9_500,
  residents: 0,
  jobs: 60,
  density: 'moyenne',
  style: 'centrale_cycle_combine',
  tags: ['electricite', 'elec:centrale:thermique', 'industrie', 'energie', 'cheminee', 'service:electricite'],
  source: `${SRC}#centraleGaz`,
  lodDistances: [220, 900],
  palette: powerPalette({ facade: M('bardage_blanc', '#dfe2e3', { roughness: 0.55 }), equipement: M('enduit_peint', '#9aa1a5') }),
  variants: [
    { id: 'origine', nameFr: 'Bardage gris clair, aérocondenseur bleu' },
    { id: 'sable', nameFr: 'Bardage sable', materialOverrides: { facade: { color: '#e2d6bf' }, bardage_acc: { color: '#6d7b5a' } } },
  ],
  build(ctx: Ctx): void {
    const lod = ctx.lod;
    ground(ctx, 'gravier_poste', -23.8, -19.8, 23.8, 19.8, 0.1);
    ground(ctx, 'sol', -23, 10.5, 12, 19.5, 0.14); // voirie intérieure
    // Salle des machines (turbines) : bardage nervuré, bandeau vitré, toit terrasse.
    const hx0 = -22, hx1 = -2, hz0 = -4, hz1 = 9.5, hh = 15;
    ctx.mb.box('facade', hx0, 0, hz0, hx1, hh, hz1, 'ny');
    ctx.mb.box('terrasse', hx0 + 0.3, hh, hz0 + 0.3, hx1 - 0.3, hh + 0.05, hz1 - 0.3, 'ny');
    ctx.mb.box('acier_peint', hx0 - 0.15, hh - 0.6, hz0 - 0.15, hx1 + 0.15, hh + 0.4, hz1 + 0.15, 'ny');
    if (lod < 2) {
      for (let u = hx0 + 1.5; u < hx1 - 1; u += lod === 0 ? 1.5 : 3) {
        ctx.mb.box('acier_peint', u - 0.08, 0.3, hz1, u + 0.08, hh - 0.6, hz1 + 0.12, 'nz');
        ctx.mb.box('acier_peint', u - 0.08, 0.3, hz0 - 0.12, u + 0.08, hh - 0.6, hz0, 'pz');
      }
      ctx.mb.lit = 0.6;
      ctx.mb.quad('verre', [hx0 + 0.5, 11, hz1 + 0.14], [hx1 - 0.5, 11, hz1 + 0.14], [hx1 - 0.5, 13.6, hz1 + 0.14], [hx0 + 0.5, 13.6, hz1 + 0.14]);
      // grande porte de manutention
      ctx.mb.box('store', -9, 0.05, hz1 + 0.12, -4, 7, hz1 + 0.2, 'nz');
      // ponts roulants visibles par les lanterneaux
      for (let i = 0; i < (lod === 0 ? 4 : 2); i++) {
        const x = hx0 + 3 + i * 4.6;
        ctx.mb.box('equipement', x, hh, -1, x + 2.6, hh + 1.2, 6.5, 'ny');
      }
    }
    // Chaudières de récupération (HRSG) : deux blocs hauts, escaliers et passerelles.
    for (const [z0, z1] of [[-12, -3.5], [2.5, 11]] as const) {
      ctx.mb.box('bardage_ind', 1, 0, z0, 11, 22, z1, 'ny');
      ctx.mb.box('acier_peint', 0.8, 22, z0 - 0.2, 11.2, 22.6, z1 + 0.2, 'ny');
      if (lod < 2) {
        for (let y = 5; y < 22; y += lod === 0 ? 4.2 : 8.4) ctx.mb.box('garde_corps', 0.2, y, z0 - 0.8, 11.8, y + 0.12, z0, 'ny');
        // conduit de gaz chauds vers la turbine
        ctx.mb.box('bardage_ind', -2, 6, (z0 + z1) / 2 - 1.6, 1, 10, (z0 + z1) / 2 + 1.6);
        // carneau vers la cheminée
        ctx.mb.box('bardage_ind', 11, 16, (z0 + z1) / 2 - 1.2, 14, 19, (z0 + z1) / 2 + 1.2);
        // tuyauteries
        const seg = lod === 0 ? 8 : 5;
        for (let k = 0; k < 3; k++) ctx.mb.tube('acier_galva', [1 + 2 + k * 3, 22.6, z1 - 1], [1 + 2 + k * 3, 26, z1 - 1], 0.35, seg, false);
      }
    }
    // Cheminées acier avec plateformes et balisage.
    const segC = lod === 0 ? 20 : lod === 1 ? 12 : 8;
    for (const z of [-7.75, 6.75]) {
      ctx.mb.cylinder('beton', 15.8, 0, z, 2.8, 1.0, segC, true, 2.8);
      ctx.mb.cylinder('acier_galva', 15.8, 1, z, 2.2, 45, segC, true, 1.9);
      if (lod < 2) {
        for (const y of [20, 38]) ctx.mb.cylinder('garde_corps', 15.8, y, z, 2.9, 0.25, segC, true, 2.9);
        ctx.mb.cylinder('rouge_balise', 15.8, 42.5, z, 1.95, 2.0, segC, false, 1.92);
        ctx.mb.cylinder('rouge_balise', 15.8, 36, z, 2.0, 1.6, segC, false, 1.99);
      }
    }
    // Aérocondenseur : table sur poteaux, ventilateurs carénés.
    const ax0 = -22, ax1 = -3, az0 = -19.3, az1 = -6.5, ay = 9;
    if (lod < 2) {
      for (const x of [ax0 + 0.5, (ax0 + ax1) / 2, ax1 - 0.5]) for (const z of [az0 + 0.5, az1 - 0.5]) ctx.mb.box('acier_peint', x - 0.3, 0, z - 0.3, x + 0.3, ay, z + 0.3, 'ny');
      if (lod === 0) for (const z of [az0 + 0.5, az1 - 0.5]) bar(ctx, 'acier_peint', [ax0 + 0.5, 1, z], [(ax0 + ax1) / 2, ay - 1, z], 0.12);
    }
    ctx.mb.box('bardage_acc', ax0, ay, az0, ax1, ay + 1.6, az1, lod === 2 ? 'ny' : '');
    // faisceaux en A
    ctx.mb.quad('bardage_acc', [ax0, ay + 1.6, az0], [ax1, ay + 1.6, az0], [ax1, ay + 5.5, (az0 + az1) / 2], [ax0, ay + 5.5, (az0 + az1) / 2]);
    ctx.mb.quad('bardage_acc', [ax1, ay + 1.6, az1], [ax0, ay + 1.6, az1], [ax0, ay + 5.5, (az0 + az1) / 2], [ax1, ay + 5.5, (az0 + az1) / 2]);
    if (lod < 2) {
      for (let i = 0; i < 4; i++) for (const zz of [az0 + 3.2, az1 - 3.2]) {
        const x = ax0 + 2.6 + i * 4.6;
        ctx.mb.cylinder('acier_galva', x, ay + 1.6, zz, 2.0, 0.9, lod === 0 ? 16 : 10, false, 2.0);
        if (lod === 0) {
          ctx.mb.box('acier_peint', x - 1.9, ay + 2.3, zz - 0.06, x + 1.9, ay + 2.4, zz + 0.06);
          ctx.mb.box('acier_peint', x - 0.06, ay + 2.3, zz - 1.9, x + 0.06, ay + 2.4, zz + 1.9);
        }
      }
    }
    // Poste de départ : transformateurs + portique d'arrivée des lignes.
    transformer(ctx, 15, 15.5, 4, 2.8, 3.2);
    transformer(ctx, 20.6, 15.5, 4, 2.8, 3.2);
    gantry(ctx, 18, 11.2, 9);
    // Réception gaz : rack de tuyauteries et réservoirs horizontaux.
    if (lod < 2) {
      for (const z of [-17.5, -14.8]) ctx.mb.tube('vanne', [14, 1.4, z], [23, 1.4, z], 0.9, lod === 0 ? 12 : 6, false);
      for (const x of [14.5, 22.5]) for (const z of [-17.5, -14.8]) ctx.mb.box('beton', x - 0.3, 0, z - 0.9, x + 0.3, 0.8, z + 0.9, 'ny');
      ctx.mb.tube('acier_galva', [13, 3.2, -16], [2, 3.2, -16], 0.25, 6, false);
    }
    // Bâtiment administratif + clôture.
    controlHouse(ctx, -22, 12, -10, 18.6, 6.5);
    perimeterFence(ctx, -23.6, -19.6, 23.6, 19.6, 8);
  },
};

/* ------------------------------------------------------------------ */
/* Éolienne (mât, nacelle) + rotor (élément animé du rendu)              */
/* ------------------------------------------------------------------ */

export const eolienne: BuildingDef = {
  id: POWER_ASSETS.eolien,
  nameFr: FACILITY_SPECS.eolien.nameFr,
  category: 'industrial',
  footprint: { tilesX: 2, tilesZ: 2 },
  cost: 1_200_000,
  upkeepPerMonth: 1_100,
  residents: 0,
  jobs: 2,
  density: 'faible',
  style: 'eolienne_tubulaire',
  tags: ['electricite', 'elec:centrale:eolien', 'energie', 'renouvelable', 'repere_visuel', 'service:electricite'],
  source: `${SRC}#eolienne`,
  lodDistances: [300, 1500],
  palette: powerPalette(),
  variants: [{ id: 'origine', nameFr: 'Mât blanc' }],
  build(ctx: Ctx): void {
    const lod = ctx.lod;
    const seg = lod === 0 ? 24 : lod === 1 ? 14 : 8;
    // Massif de fondation (symétrique : l'origine reste l'axe du mât) et plateforme de grutage.
    ctx.mb.box('beton', -7.5, 0, -7.5, 7.5, 0.3, 7.5, 'ny');
    ctx.mb.cylinder('beton_clair', 0, 0.3, 0, 3.4, 0.6, seg, true, 3.2);
    // Mât tronconique en 3 viroles (brides visibles).
    const top = TURBINE.hubHeight - 1.8;
    const r0 = TURBINE.towerBaseRadius, r1 = TURBINE.towerTopRadius;
    const rs = [0.9, top * 0.36, top * 0.7, top];
    for (let i = 0; i < 3; i++) {
      const ya = rs[i]!, yb = rs[i + 1]!;
      const ra = r0 + (r1 - r0) * (ya / top), rb = r0 + (r1 - r0) * (yb / top);
      ctx.mb.cylinder('blanc_eol', 0, ya, 0, ra, yb - ya, seg, i === 2, rb);
      if (lod === 0 && i > 0) ctx.mb.cylinder('blanc_eol', 0, ya - 0.08, 0, ra + 0.06, 0.16, seg, false, ra + 0.06);
    }
    // Porte d'accès et escalier.
    ctx.mb.box('porte', -0.5, 0.9, r0 - 0.15, 0.5, 3.1, r0 + 0.12);
    if (lod < 2) {
      ctx.mb.box('garde_corps', -0.8, 0.9, r0 + 0.12, 0.8, 1.0, r0 + 1.6);
      for (let k = 0; k < 3; k++) ctx.mb.box('beton_clair', -0.7, 0.3 + k * 0.2, r0 + 1.6 + k * 0.3, 0.7, 0.5 + k * 0.2, r0 + 1.9 + k * 0.3);
    }
    // Nacelle : caisson profilé, capot arrondi, refroidisseur, anémomètre.
    const ny0 = top, ny1 = top + 3.8;
    const nz0 = -4.6, nz1 = 3.0, nw = 1.5;
    ctx.mb.box('blanc_eol', -nw, ny0 + 0.2, nz0, nw, ny1, nz1, '');
    ctx.mb.quad('blanc_eol', [-nw, ny1, nz1], [nw, ny1, nz1], [nw * 0.8, ny1 - 0.6, nz1 + 0.9], [-nw * 0.8, ny1 - 0.6, nz1 + 0.9]);
    ctx.mb.quad('blanc_eol', [-nw * 0.8, ny0 + 0.6, nz1 + 0.9], [nw * 0.8, ny0 + 0.6, nz1 + 0.9], [nw, ny0 + 0.2, nz1], [-nw, ny0 + 0.2, nz1]);
    ctx.mb.quad('blanc_eol', [-nw * 0.8, ny1 - 0.6, nz1 + 0.9], [nw * 0.8, ny1 - 0.6, nz1 + 0.9], [nw * 0.8, ny0 + 0.6, nz1 + 0.9], [-nw * 0.8, ny0 + 0.6, nz1 + 0.9]);
    // Arbre lent (sort du nez jusqu'au moyeu).
    ctx.mb.tube('acier_peint', [0, TURBINE.hubHeight, nz1 + 0.8], [0, TURBINE.hubHeight, TURBINE.hubForward - 0.8], 0.55, lod === 0 ? 12 : 6, false);
    if (lod < 2) {
      ctx.mb.box('acier_peint', -1.1, ny1, -4.6, 1.1, ny1 + 0.7, -2.6);
      ctx.mb.cylinder('acier_galva', 0.9, ny1, -4.8, 0.04, 1.6, 4, false);
      ctx.mb.cylinder('rouge_balise', -0.9, ny1, -4.8, 0.12, 0.6, 6, true);
      ctx.mb.cylinder('rouge_balise', -0.9, ny1 + 0.6, -4.8, 0.2, 0.25, 6, true);
    }
    // Liseré de balisage diurne en pied de mât (bandes rouges réglementaires simplifiées).
    if (lod < 2) ctx.mb.cylinder('rouge_balise', 0, 12, 0, r0 - 0.25 + 0.03, 1.2, seg, false, r0 - 0.27 + 0.03);
  },
};

/** Rotor : moyeu (cône) + 3 pales vrillées. Origine au centre du moyeu, axe de rotation = +Z (face au vent). */
export function buildRotor(ctx: Ctx): void {
  const lod = ctx.lod;
  const segH = lod === 0 ? 16 : lod === 1 ? 10 : 6;
  // Cône de nez (spinner) le long de +Z.
  const sp: [number, number][] = lod === 0 ? [[-0.9, 1.75], [0.2, 1.8], [1.2, 1.55], [2.1, 1.0], [2.7, 0.35], [2.9, 0]] : lod === 1 ? [[-0.9, 1.75], [0.8, 1.7], [2.2, 0.9], [2.9, 0]] : [[-0.9, 1.7], [1.2, 1.4], [2.9, 0]];
  for (let k = 0; k + 1 < sp.length; k++) {
    const [z0, ra] = sp[k]!, [z1, rb] = sp[k + 1]!;
    for (let i = 0; i < segH; i++) {
      const a0 = (i / segH) * Math.PI * 2, a1 = ((i + 1) / segH) * Math.PI * 2;
      const p = (r: number, a: number, z: number): V3 => [Math.cos(a) * r, Math.sin(a) * r, z];
      if (rb > 1e-3) ctx.mb.quad('blanc_eol', p(ra, a0, z0), p(ra, a1, z0), p(rb, a1, z1), p(rb, a0, z1));
      else ctx.mb.tri('blanc_eol', p(ra, a0, z0), p(ra, a1, z0), p(0, 0, z1));
    }
  }
  // Pales : sections profilées (lentille asymétrique) le long du rayon, corde et vrillage décroissants.
  const R = TURBINE.rotorRadius;
  const stations = lod === 0 ? [1.5, 3, 5.5, 8, 12, 17, 22, 27, 32, 36, 39.5, R] : lod === 1 ? [1.5, 5, 10, 20, 30, R] : [1.5, 12, R];
  const prof = lod === 0 ? [[1, 0], [0.55, 0.42], [0, 0.5], [-0.5, 0.25], [-1, 0], [-0.5, -0.12], [0, -0.18], [0.55, -0.12]] : lod === 1 ? [[1, 0], [0, 0.45], [-1, 0], [0, -0.15]] : [[1, 0], [-1, 0.25], [-1, -0.1]];
  for (let b = 0; b < 3; b++) {
    const ang = (b / 3) * Math.PI * 2;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const sections: V3[][] = stations.map((r) => {
      const t = r / R;
      const chord = r < 3 ? 1.6 + (r - 1.5) * 0.9 : Math.max(0.55, 3.6 * (1 - t) + 0.45 - Math.max(0, 0.45 - (r - 3) * 0.3));
      const thick = r < 3 ? 0.9 : 0.14 + 0.5 * (1 - t) * (1 - t);
      const twist = (14 * (1 - t) + 1) * Math.PI / 180;
      const ct = Math.cos(twist), st = Math.sin(twist);
      return prof.map(([px, pz]) => {
        // profil dans le plan (corde selon l'azimut local X, épaisseur selon Z), vrillé autour du rayon
        const cx = px! * chord * 0.5 - chord * 0.12, cz = pz! * thick * (r < 3 ? 1 : 1.6);
        const lx = cx * ct - cz * st, lz = cx * st + cz * ct;
        // rayon le long de +Y local de la pale, puis rotation de la pale autour de Z
        const x = lx, y = r, z = lz - 0.2;
        return [x * ca - y * sa, x * sa + y * ca, z] as V3;
      });
    });
    for (let s = 0; s + 1 < sections.length; s++) {
      const A = sections[s]!, B = sections[s + 1]!;
      for (let i = 0; i < A.length; i++) {
        const j = (i + 1) % A.length;
        ctx.mb.quad('blanc_eol', A[i]!, A[j]!, B[j]!, B[i]!);
      }
    }
    // bout de pale fermé
    const T = sections[sections.length - 1]!;
    ctx.mb.poly('blanc_eol', [...T].reverse());
    // repère rouge en bout de pale (balisage)
    if (lod < 2) {
      const r = R - 1.6;
      const x = -0.15;
      ctx.mb.quad('rouge_balise', [(x - 0.25) * ca - r * sa, (x - 0.25) * sa + r * ca, 0.1], [(x + 0.35) * ca - r * sa, (x + 0.35) * sa + r * ca, 0.1], [(x + 0.3) * ca - (R - 0.2) * sa, (x + 0.3) * sa + (R - 0.2) * ca, 0.1], [(x - 0.2) * ca - (R - 0.2) * sa, (x - 0.2) * sa + (R - 0.2) * ca, 0.1]);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Ferme solaire                                                         */
/* ------------------------------------------------------------------ */

export const fermeSolaire: BuildingDef = {
  id: POWER_ASSETS.solaire,
  nameFr: FACILITY_SPECS.solaire.nameFr,
  category: 'industrial',
  footprint: { tilesX: 6, tilesZ: 6 },
  cost: 2_400_000,
  upkeepPerMonth: 900,
  residents: 0,
  jobs: 3,
  density: 'faible',
  style: 'centrale_photovoltaique',
  tags: ['electricite', 'elec:centrale:solaire', 'energie', 'renouvelable', 'service:electricite'],
  source: `${SRC}#fermeSolaire`,
  lodDistances: [200, 800],
  palette: powerPalette({ gazon: M('terrain_herbe', '#93ad6a') }),
  variants: [{ id: 'origine', nameFr: 'Tables fixes orientées au sud' }],
  build(ctx: Ctx): void {
    const lod = ctx.lod;
    ground(ctx, 'gazon', -23.8, -23.8, 23.8, 23.8, 0.06);
    // Piste de maintenance en gravier.
    ctx.mb.box('gravier_poste', -23, 0.06, 19.6, 23, 0.1, 23, 'ny');
    // Tables inclinées (25°) : 6 rangées de 2 lignes de modules en portrait, face au sud (-Z).
    const tilt = 25 * Math.PI / 180;
    const depth = 4.2; // longueur inclinée de la table
    const rows = [-19.5, -13.2, -6.9, -0.6, 5.7, 12];
    const x0 = -21.5, x1 = 21.5;
    const cy = Math.cos(tilt), sy = Math.sin(tilt);
    const h0 = 0.8;
    for (const zr of rows) {
      const zf = zr, zb = zr + depth * cy;
      const yf = h0, yb = h0 + depth * sy;
      // poteaux et longerons
      if (lod < 2) {
        for (let x = x0 + 0.6; x <= x1; x += lod === 0 ? 4.3 : 8.6) {
          ctx.mb.box('acier_galva', x - 0.06, 0, zf + 0.5 - 0.06, x + 0.06, yf + 0.25, zf + 0.5 + 0.06, 'ny');
          ctx.mb.box('acier_galva', x - 0.06, 0, zb - 0.5 - 0.06, x + 0.06, yb - 0.3, zb - 0.5 + 0.06, 'ny');
          if (lod === 0) bar(ctx, 'acier_galva', [x, 0.15, zf + 0.5], [x, yb - 0.45, zb - 0.5], 0.04);
        }
      }
      const lift = 0.06;
      if (lod === 0) {
        // modules individuels (1,0 × 2,0 m) avec cadre, deux lignes en portrait
        const nMod = Math.floor((x1 - x0) / 1.04);
        for (let line = 0; line < 2; line++) {
          const t0 = line * 0.5 + 0.005, t1 = line * 0.5 + 0.495;
          for (let k = 0; k < nMod; k++) {
            const a = x0 + k * 1.04 + 0.02, b = a + 1.0;
            const za = zf + depth * cy * t0, zb2 = zf + depth * cy * t1;
            const ya = yf + depth * sy * t0 + lift, yb2 = yf + depth * sy * t1 + lift;
            ctx.mb.lit = -1;
            ctx.mb.quad('cellule', [a, ya, za], [b, ya, za], [b, yb2, zb2], [a, yb2, zb2]);
          }
        }
        // cadre aluminium (longerons haut, milieu, bas)
        for (const t of [0, 0.5, 1]) {
          const z = zf + depth * cy * t, y = yf + depth * sy * t + lift;
          ctx.mb.box('cadre_pv', x0, y - 0.05, z - 0.04, x1, y + 0.02, z + 0.04);
        }
      } else {
        ctx.mb.lit = -1;
        ctx.mb.quad('cellule', [x0, yf + lift, zf], [x1, yf + lift, zf], [x1, yb + lift, zb], [x0, yb + lift, zb]);
      }
      // dessous de table (structure)
      ctx.mb.quad('acier_galva', [x1, yf, zf], [x0, yf, zf], [x0, yb, zb], [x1, yb, zb]);
    }
    // Poste onduleur-transformateur (conteneurs) et portique de départ.
    ctx.mb.box('beton', 9, 0, 18.2, 20.5, 0.35, 21.6, 'ny');
    ctx.mb.box('equipement', 9.5, 0.35, 18.6, 15.5, 2.9, 21.2, 'ny');
    ctx.mb.box('transfo', 16.2, 0.35, 18.8, 20, 2.6, 21);
    if (lod < 2) {
      for (let i = 0; i < 4; i++) ctx.mb.box('acier_peint', 10 + i * 1.4, 0.8, 21.2, 10.9 + i * 1.4, 2.4, 21.28, 'nz');
      for (let i = 0; i < 5; i++) ctx.mb.box('transfo', 16.4 + i * 0.7, 0.6, 21, 16.5 + i * 0.7, 2.3, 21.6, 'nz');
    }
    gantry(ctx, -15, 21.4, 7);
    perimeterFence(ctx, -23.6, -23.6, 23.6, 23.6, 6);
  },
};

/* ------------------------------------------------------------------ */
/* Centrale hydroélectrique au fil de l'eau (barrage-usine)              */
/* ------------------------------------------------------------------ */

export const barrage: BuildingDef = {
  id: POWER_ASSETS.hydro,
  nameFr: FACILITY_SPECS.hydro.nameFr,
  category: 'industrial',
  footprint: { tilesX: 6, tilesZ: 4 },
  cost: 9_000_000,
  upkeepPerMonth: 5_000,
  residents: 0,
  jobs: 30,
  density: 'moyenne',
  style: 'barrage_usine',
  tags: ['electricite', 'elec:centrale:hydro', 'energie', 'renouvelable', 'eau', 'bord_de_l_eau', 'service:electricite'],
  source: `${SRC}#barrage`,
  lodDistances: [250, 1000],
  palette: powerPalette(),
  variants: [{ id: 'origine', nameFr: 'Béton, vannes bleues' }],
  build(ctx: Ctx): void {
    const lod = ctx.lod;
    // Corps du barrage : profil poids (amont vertical côté -Z, aval incliné vers +Z), 5 passes séparées par des piles.
    const X0 = -23.8, X1 = 23.8, H = 15;
    const prof: [number, number][] = [[-15.4, 0], [-15.4, H], [-11.5, H], [0, 1.5], [3, 0]];
    // extrusion du profil (plan YZ) le long de X : faces avant / arrière + facettes
    const pts = (x: number): V3[] => prof.map(([z, y]) => [x, y, z] as V3);
    const A = pts(X0), B = pts(X1);
    ctx.mb.polyFacing('beton', A, [-1, 0, 0]);
    ctx.mb.polyFacing('beton', B, [1, 0, 0]);
    for (let i = 0; i < prof.length; i++) {
      const j = (i + 1) % prof.length;
      if (i === prof.length - 1) continue; // base au sol
      ctx.mb.quad('beton', A[i]!, A[j]!, B[j]!, B[i]!);
    }
    // Couronnement, garde-corps, route de service.
    ctx.mb.box('beton_clair', X0, H, -15.9, X1, H + 0.6, -11, 'ny');
    if (lod < 2) {
      bar(ctx, 'garde_corps', [X0, H + 1.6, -15.8], [X1, H + 1.6, -15.8], 0.04);
      bar(ctx, 'garde_corps', [X0, H + 1.6, -11.1], [X1, H + 1.6, -11.1], 0.04);
      for (let x = X0 + 1; x < X1; x += lod === 0 ? 2.5 : 5) {
        ctx.mb.box('garde_corps', x - 0.04, H + 0.6, -15.84, x + 0.04, H + 1.6, -15.76);
        ctx.mb.box('garde_corps', x - 0.04, H + 0.6, -11.14, x + 0.04, H + 1.6, -11.06);
      }
    }
    // Évacuateur : piles et vannes segment sur la moitié est.
    const piers = [2, 6.2, 10.4, 14.6, 18.8, 22.8];
    for (const x of piers) {
      ctx.mb.box('beton_clair', x - 0.9, 0, -16, x + 0.9, H + 4.5, -6, 'ny');
      ctx.mb.box('beton_clair', x - 1.0, H + 4.5, -16.1, x + 1.0, H + 5.0, -5.9, 'ny');
    }
    for (let k = 0; k + 1 < piers.length; k++) {
      const xa = piers[k]! + 0.9, xb = piers[k + 1]! - 0.9;
      ctx.mb.box('vanne', xa, 3, -14.8, xb, 12.5, -14.2);
      if (lod < 2) {
        // bras de vanne + treuils sur la passerelle haute
        for (const x of [xa + 0.3, xb - 0.3]) bar(ctx, 'vanne', [x, 7.5, -14.2], [x, 9.5, -9.5], 0.18);
        ctx.mb.box('acier_peint', xa + 0.6, H + 5, -13, xb - 0.6, H + 6.2, -11);
        // nappe d'eau déversante (lame lisse) à l'aval
        ctx.mb.quad('eau_vive', [xa, 2.2, -11.2], [xb, 2.2, -11.2], [xb, 0.2, 2.6], [xa, 0.2, 2.6]);
      }
    }
    // Passerelle haute de manœuvre.
    ctx.mb.box('beton_clair', 1, H + 5, -13.2, 23.6, H + 5.6, -10.8, 'ny');
    // Usine (salle des groupes) sur la moitié ouest, côté aval.
    const ux0 = -23.2, ux1 = 0.6, uz0 = -11, uz1 = 7.5, uh = 12;
    ctx.mb.box('beton_clair', ux0, 0, uz0, ux1, uh, uz1, 'ny');
    ctx.mb.box('terrasse', ux0 + 0.3, uh, uz0 + 0.3, ux1 - 0.3, uh + 0.05, uz1 - 0.3, 'ny');
    ctx.mb.box('encadrement', ux0 - 0.15, uh - 0.4, uz0 - 0.15, ux1 + 0.15, uh + 0.5, uz1 + 0.15, 'ny');
    if (lod < 2) {
      // grandes baies verticales côté aval
      for (let i = 0; i < 6; i++) {
        const u = ux0 + 1.6 + i * 3.8;
        ctx.mb.lit = 0.2 + (i % 3) * 0.25;
        ctx.mb.quad('verre', [u, 2.5, uz1 + 0.03], [u + 2.4, 2.5, uz1 + 0.03], [u + 2.4, 10.5, uz1 + 0.03], [u, 10.5, uz1 + 0.03]);
        ctx.mb.box('encadrement', u - 0.2, 2.2, uz1, u + 2.6, 2.5, uz1 + 0.25);
      }
      // sorties des turbines (aspirateurs) au pied de l'usine
      for (let i = 0; i < 3; i++) {
        const x = ux0 + 4 + i * 7.5;
        ctx.mb.box('beton', x - 2.6, 0, uz1, x + 2.6, 3.2, uz1 + 1.6);
        ctx.mb.quad('eau_vive', [x - 2.2, 0.3, uz1 + 1.62], [x + 2.2, 0.3, uz1 + 1.62], [x + 2.2, 2.6, uz1 + 1.62], [x - 2.2, 2.6, uz1 + 1.62]);
      }
      // portique roulant sur le couronnement
      for (const x of [-20, -9]) {
        ctx.mb.box('vanne', x - 0.4, H + 0.6, -15.7, x + 0.4, H + 8, -15.0);
        ctx.mb.box('vanne', x - 0.4, H + 0.6, -11.9, x + 0.4, H + 8, -11.1);
      }
      ctx.mb.box('vanne', -20.6, H + 8, -15.9, -8.4, H + 9.2, -10.8);
      // grille de prise d'eau amont
      for (let x = ux0 + 1; x < ux1; x += lod === 0 ? 0.8 : 1.6) ctx.mb.box('acier_peint', x - 0.05, 1, -15.9, x + 0.05, 12, -15.5);
    }
    // Transformateurs et portique de départ sur la rive.
    transformer(ctx, -18, 11.2, 4, 2.6, 3);
    transformer(ctx, -11.5, 11.2, 4, 2.6, 3);
    gantry(ctx, -4, 13, 7);
    ground(ctx, 'sol', ux0, 8.8, 4, 15.8, 0.12);
  },
};

/* ------------------------------------------------------------------ */
/* Poste de transformation                                               */
/* ------------------------------------------------------------------ */

export const posteTransformation: BuildingDef = {
  id: POWER_ASSETS.poste,
  nameFr: FACILITY_SPECS.poste.nameFr,
  category: 'industrial',
  footprint: { tilesX: 4, tilesZ: 4 },
  cost: 650_000,
  upkeepPerMonth: 700,
  residents: 0,
  jobs: 4,
  density: 'faible',
  style: 'poste_haute_tension',
  tags: ['electricite', 'elec:poste', 'energie', 'reseau', 'service:electricite'],
  source: `${SRC}#posteTransformation`,
  lodDistances: [200, 800],
  palette: powerPalette(),
  variants: [{ id: 'origine', nameFr: 'Poste extérieur 225/20 kV' }],
  build(ctx: Ctx): void {
    const lod = ctx.lod;
    ground(ctx, 'gravier_poste', -15.8, -15.8, 15.8, 15.8, 0.1);
    ground(ctx, 'sol', -3, 4, 3, 15.8, 0.13);
    // Deux portiques d'arrivée (lignes HT) et jeux de barres.
    gantry(ctx, -7, -12.5, 10);
    gantry(ctx, 7, -12.5, 10);
    if (lod < 2) {
      for (const x of [-11, -7, -3, 3, 7, 11]) {
        // disjoncteurs / sectionneurs sur supports
        ctx.mb.box('acier_galva', x - 0.12, 0.1, -8.2, x + 0.12, 2.6, -7.9);
        ctx.mb.cylinder('isolateur', x, 2.6, -8.05, 0.2, 2.0, lod === 0 ? 8 : 5, true, 0.16);
        ctx.mb.box('acier_peint', x - 0.35, 4.6, -8.4, x + 0.35, 5.3, -7.7);
        ctx.mb.box('acier_galva', x - 0.12, 0.1, -4.2, x + 0.12, 2.6, -3.9);
        ctx.mb.cylinder('isolateur', x, 2.6, -4.05, 0.18, 1.8, lod === 0 ? 8 : 5, true, 0.15);
      }
      // jeu de barres (tubes) au-dessus des appareillages
      for (const z of [-8.05, -4.05]) ctx.mb.tube('acier_galva', [-12, 6.4, z], [12, 6.4, z], 0.08, 6, false);
      for (const x of [-12, 12]) for (const z of [-8.05, -4.05]) ctx.mb.box('acier_galva', x - 0.15, 0.1, z - 0.15, x + 0.15, 6.5, z + 0.15);
    }
    // Transformateurs.
    transformer(ctx, -7, 1.2, 4.4, 3, 3.6);
    transformer(ctx, 7, 1.2, 4.4, 3, 3.6);
    if (lod < 2) {
      // murs pare-feu entre transformateurs
      ctx.mb.box('beton', -0.25, 0, -1.5, 0.25, 6, 4, 'ny');
    }
    // Bâtiment de commande et clôture.
    controlHouse(ctx, 6, 8.5, 15, 14.5, 4.2);
    if (lod < 2) for (let k = 0; k < 4; k++) ctx.mb.box('equipement', -14 + k * 1.6, 0.1, 10, -13 + k * 1.6, 2.2, 11.2, 'ny');
    perimeterFence(ctx, -15.6, -15.6, 15.6, 15.6, 6);
  },
};

export const POWER_BUILDINGS: BuildingDef[] = [centraleGaz, eolienne, fermeSolaire, barrage, posteTransformation];

/* ------------------------------------------------------------------ */
/* Pylône treillis (élément instancié des lignes HT)                     */
/* ------------------------------------------------------------------ */

/** Pylône treillis à deux niveaux de consoles. Bras selon X, ligne selon Z. Origine au pied (centre). */
export function buildPylon(ctx: Ctx): void {
  const lod = ctx.lod;
  const Ht = PYLON.height;
  // gabarit : jambes (demi-largeur w(y)) du sol (3,6 m) à la taille (1,1 m à 20 m) puis fût (0,8 m au sommet)
  const w = (y: number): number => (y <= 20 ? 3.6 + (1.1 - 3.6) * (y / 20) : 1.1 + (0.75 - 1.1) * ((y - 20) / (Ht - 2 - 20)));
  const levels = lod === 0 ? [0, 3.2, 6.6, 10.2, 14, 17.2, 20, 22.6, 25.2, 28.1, 31, Ht - 2] : lod === 1 ? [0, 6.6, 14, 20, 22.6, 28.1, Ht - 2] : [0, 20, Ht - 2];
  const rL = lod === 0 ? 0.09 : lod === 1 ? 0.12 : 0.18;
  const rD = lod === 0 ? 0.05 : 0.08;
  const corner = (y: number, sx: number, sz: number): V3 => [sx * w(y), y, sz * w(y)];
  const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  // jambes
  for (let k = 0; k + 1 < levels.length; k++) {
    const y0 = levels[k]!, y1 = levels[k + 1]!;
    for (const [sx, sz] of corners) bar(ctx, 'acier_galva', corner(y0, sx, sz), corner(y1, sx, sz), rL, lod === 2 ? 4 : 4);
  }
  // fondations
  for (const [sx, sz] of corners) ctx.mb.box('beton', sx * 3.6 - 0.5, 0, sz * 3.6 - 0.5, sx * 3.6 + 0.5, 0.4, sz * 3.6 + 0.5, 'ny');
  // triangulation : ceintures horizontales et croix de Saint-André sur les 4 faces
  if (lod < 2) {
    for (let k = 0; k + 1 < levels.length; k++) {
      const y0 = levels[k]!, y1 = levels[k + 1]!;
      for (let f = 0; f < 4; f++) {
        const [ax, az] = corners[f]!, [bx, bz] = corners[(f + 1) % 4]!;
        bar(ctx, 'acier_galva', corner(y1, ax, az), corner(y1, bx, bz), rD);
        bar(ctx, 'acier_galva', corner(y0, ax, az), corner(y1, bx, bz), rD);
        if (lod === 0) bar(ctx, 'acier_galva', corner(y0, bx, bz), corner(y1, ax, az), rD);
      }
    }
  }
  // consoles (bras) : treillis triangulaire, membrure haute et basse
  const arms: [number, number][] = [[7.5, 25.1], [5.5, 30.6]];
  for (const [L, ya] of arms) {
    for (const s of [-1, 1]) {
      const root = w(ya);
      const tip: V3 = [s * L, ya, 0];
      if (lod === 2) { ctx.mb.box('acier_galva', Math.min(0, s * L), ya - 0.2, -0.2, Math.max(0, s * L), ya + 0.2, 0.2); continue; }
      for (const sz of [-1, 1]) {
        bar(ctx, 'acier_galva', [s * root, ya, sz * root], tip, rL * 0.8);            // membrure basse
        bar(ctx, 'acier_galva', [s * root, ya + 1.8, sz * root * 0.7], tip, rL * 0.7); // membrure haute
        if (lod === 0) {
          const n = Math.max(2, Math.round(L / 1.5));
          for (let i = 1; i < n; i++) {
            const t = i / n;
            const xb = s * (root + (L - root) * t), zb = sz * root * (1 - t);
            const xt = s * (root + (L - root) * t), yt = ya + 1.8 * (1 - t), zt = sz * root * 0.7 * (1 - t);
            bar(ctx, 'acier_galva', [xb, ya, zb], [xt, yt, zt], rD * 0.8);
          }
        }
      }
      // chaîne d'isolateurs suspendue au bout du bras
      const isoLen = 2.5;
      ctx.mb.cylinder('isolateur', s * L, ya - isoLen, 0, 0.09, isoLen, lod === 0 ? 6 : 4, true);
      if (lod === 0) for (let j = 0; j < 7; j++) ctx.mb.cylinder('isolateur', s * L, ya - isoLen + 0.25 + j * 0.32, 0, 0.17, 0.08, 8, true);
      ctx.mb.box('acier_peint', s * L - 0.25, ya - isoLen - 0.15, -0.12, s * L + 0.25, ya - isoLen, 0.12);
    }
  }
  // pointe du câble de garde
  bar(ctx, 'acier_galva', [-0.75, Ht - 2, -0.75], [0, Ht, 0], rD);
  bar(ctx, 'acier_galva', [0.75, Ht - 2, 0.75], [0, Ht, 0], rD);
  bar(ctx, 'acier_galva', [0.75, Ht - 2, -0.75], [0, Ht, 0], rD);
  bar(ctx, 'acier_galva', [-0.75, Ht - 2, 0.75], [0, Ht, 0], rD);
  // plaque de signalisation (danger de mort) sur une jambe
  if (lod === 0) ctx.mb.box('marquage_j', -2.8, 2.4, 2.86, -2.2, 3.0, 2.9);
}

/** Palettes des éléments instanciés. */
export const ROTOR_PALETTE = powerPalette();
export const PYLON_PALETTE = powerPalette();
