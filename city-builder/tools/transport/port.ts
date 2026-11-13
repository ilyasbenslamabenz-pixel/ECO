/**
 * Modèles du PORT (commerce + passagers), originaux, style européen moderne :
 * modules de quai (droit, angle, rampe ro-ro), portique à conteneurs (chariot, flèche, palonnier animables),
 * grue mobile portuaire (tourelle, flèche animables), conteneurs ISO 20'/40'/40' HC/frigorifique,
 * pile de conteneurs, entrepôt, capitainerie, gare maritime, porte-conteneurs, vraquier, ferry, remorqueur.
 * Repère : mètres, Y vers le haut, façade/avant vers +Z (côté mer pour les quais et les grues).
 */
import type { TransportDef } from './defs';
import { CONTAINER_MATS, MATERIALS, type MatKey } from './materials';
import { add, norm, scl, sub, type TMesh, type TModel, type V3 } from './mesh';
import { beacon, bollard, container, CT_W, ctHeight, ladder, lattice, lightMast, railing, rnd, wheelX } from './parts';
import { band, bandsBox, beamAt, deckY, funnel, hull, lifeboat, mast, radar, type HullSpec } from './ship';
import type { RegionName } from './textures';

const DEG = Math.PI / 180;

/* ------------------------------------------------------------------ */
/* Bords de quai                                                        */
/* ------------------------------------------------------------------ */

/** Dalle de quai : polygone (x, z) extrudé de y = −3 à 0 (béton). */
function slab(mb: TMesh, pts: [number, number][], mat: MatKey = 'beton', y0 = -3, y1 = 0): void {
  mb.push().rotX(-Math.PI / 2);
  mb.extrude(mat, pts.map(([x, z]) => [x, -z] as [number, number]), y0, y1);
  mb.pop();
}

/** Bord de quai le long d'une polyligne (mer à gauche du sens de parcours) : poutre de couronnement, défenses, bollards, échelles. */
function quayEdge(mb: TMesh, path: [number, number][], o: { fender: number; bollard: number; ladder?: number } = { fender: 8, bollard: 8 }): void {
  const lod = mb.lod;
  const CW = 1.4, top = 0.25, bot = -3;
  let s = 0;
  let nextF = o.fender / 2, nextB = o.bollard / 2 + 2, nextL = o.ladder ?? 1e9;
  for (let k = 0; k < path.length - 1; k++) {
    const [ax, az] = path[k]!, [bx, bz] = path[k + 1]!;
    const L = Math.hypot(bx - ax, bz - az);
    const d: [number, number] = [(bx - ax) / L, (bz - az) / L];
    const n: [number, number] = [-d[1], d[0]];
    const A: V3 = [ax, 0, az], B: V3 = [bx, 0, bz];
    const N: V3 = [n[0], 0, n[1]];
    const Ai = sub(A, scl(N, CW)), Bi = sub(B, scl(N, CW));
    const at = (p: V3, y: number): V3 => [p[0], y, p[2]];
    mb.quad('beton_clair', at(A, bot), at(B, bot), at(B, top), at(A, top));
    mb.quad('beton_clair', at(A, top), at(B, top), at(Bi, top), at(Ai, top));
    mb.quad('beton_clair', at(Bi, 0), at(Ai, 0), at(Ai, top), at(Bi, top));
    // bande hachurée jaune/noir au nez du quai
    const nh = Math.max(1, Math.round(L / 4));
    for (let q = 0; q < nh; q++) {
      const p0 = add(A, scl(sub(B, A), q / nh)), p1 = add(A, scl(sub(B, A), (q + 1) / nh));
      mb.quad('atlas', at(p0, top + 0.004), at(p1, top + 0.004), at(sub(p1, scl(N, 0.35)), top + 0.004), at(sub(p0, scl(N, 0.35)), top + 0.004), { region: 'hachures' });
    }
    const ang = Math.atan2(n[0], n[1]);
    while (nextF < s + L) {
      const p = add(A, scl([d[0], 0, d[1]], nextF - s));
      mb.push().translate(p[0], 0, p[2]).rotY(ang);
      // défense à panneau sur deux cônes caoutchouc
      if (lod < 2) { mb.tube('atlas', [-0.5, -1.6, 0], [-0.5, -1.6, 0.45], [0.45, 0.35], 8, false, 'noir'); mb.tube('atlas', [0.5, -1.6, 0], [0.5, -1.6, 0.45], [0.45, 0.35], 8, false, 'noir'); }
      mb.box('atlas', -1.1, -2.7, 0.45, 1.1, -0.5, 0.75, '', { region: 'defense' });
      mb.pop();
      nextF += o.fender;
    }
    while (nextB < s + L) {
      const p = add(A, scl([d[0], 0, d[1]], nextB - s));
      bollard(mb, p[0] - n[0] * 0.75, top, p[2] - n[1] * 0.75);
      nextB += o.bollard;
    }
    while (nextL < s + L) {
      const p = add(A, scl([d[0], 0, d[1]], nextL - s));
      ladder(mb, p[0], p[2], bot, top, N);
      nextL += 1e9;
    }
    s += L;
  }
}

/** Marquage au sol (decal plat) de a à b, largeur w. */
function groundLine(mb: TMesh, a: [number, number], b: [number, number], w: number, region: RegionName, y = 0.012, dash = 0, gap = 0): void {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const d: [number, number] = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const n: [number, number] = [-d[1] * w / 2, d[0] * w / 2];
  const seg = (t0: number, t1: number): void => {
    const p0: [number, number] = [a[0] + d[0] * t0, a[1] + d[1] * t0], p1: [number, number] = [a[0] + d[0] * t1, a[1] + d[1] * t1];
    mb.quad('decal', [p0[0] + n[0], y, p0[1] + n[1]], [p0[0] - n[0], y, p0[1] - n[1]], [p1[0] - n[0], y, p1[1] - n[1]], [p1[0] + n[0], y, p1[1] + n[1]], { region });
  };
  if (!dash) { const k = Math.max(1, Math.round(L / 30)); for (let i = 0; i < k; i++) seg((L * i) / k, (L * (i + 1)) / k); return; }
  for (let t = 0; t < L - 1e-6; t += dash + gap) seg(t, Math.min(L, t + dash));
}

/** Joints de dalles (lignes sombres fines). */
function slabJoints(mb: TMesh, x0: number, z0: number, x1: number, z1: number, step: number): void {
  if (mb.lod >= 2) return;
  for (let x = x0 + step; x < x1 - 0.1; x += step) mb.quad('atlas', [x - 0.02, 0.004, z1], [x + 0.02, 0.004, z1], [x + 0.02, 0.004, z0], [x - 0.02, 0.004, z0], { region: 'noir' });
  for (let z = z0 + step; z < z1 - 0.1; z += step) mb.quad('atlas', [x0, 0.004, z + 0.02], [x1, 0.004, z + 0.02], [x1, 0.004, z - 0.02], [x0, 0.004, z - 0.02], { region: 'noir' });
}

/** Rail de grue le long de X à z. */
function craneRail(mb: TMesh, x0: number, x1: number, z: number): void {
  mb.box('gris_fonce', x0, 0, z - 0.4, x1, 0.02, z + 0.4, 'ny');
  mb.box('gris', x0, 0, z - 0.07, x1, 0.14, z + 0.07, 'ny');
  if (mb.lod === 0) for (let x = x0 + 0.5; x < x1; x += 1.5) for (const s of [-1, 1]) mb.box('gris_fonce', x - 0.1, 0.02, z + s * 0.07 + (s > 0 ? 0 : -0.12), x + 0.1, 0.07, z + s * 0.07 + (s > 0 ? 0.12 : 0), 'ny');
}

function quaiDroit(m: TModel): void {
  const mb = m.mb;
  const X = 16, Z = 12;
  slab(mb, [[-X, -Z], [X, -Z], [X, Z - 1.4], [-X, Z - 1.4]]);
  quayEdge(mb, [[-X, Z], [X, Z]], { fender: 8, bollard: 16, ladder: 13 });
  craneRail(mb, -X, X, 10); craneRail(mb, -X, X, -10);
  slabJoints(mb, -X, -Z, X, Z - 1.4, 8);
  if (mb.lod < 2) {
    // caniveau à câbles du portique (caillebotis) et regards
    for (let x = -X; x < X; x += 4) mb.quad('atlas', [x, 0.01, -8.4], [x + 4, 0.01, -8.4], [x + 4, 0.01, -9.2], [x, 0.01, -9.2], { region: 'caillebotis' });
    for (const x of [-8, 8]) mb.box('gris_fonce', x - 0.6, 0, -11.2, x + 0.6, 0.12, -10.6, 'ny');
    groundLine(mb, [-X, 7.6], [X, 7.6], 0.2, 'marque_jaune', 0.012, 3, 3);
    groundLine(mb, [-X, 8.6], [X, 8.6], 0.15, 'marque_blanche');
    groundLine(mb, [-X, -6.5], [X, -6.5], 0.2, 'marque_jaune');
    mb.quad('decal', [-3, 0.013, 5.2], [3, 0.013, 5.2], [3, 0.013, 4.45], [-3, 0.013, 4.45], { region: 'numero_quai' });
  }
  lightMast(mb, 0, -11.2, 25);
}

function quaiAngle(m: TModel): void {
  const mb = m.mb;
  const H = 12, R = 8, CW = 1.4;
  const seg = mb.lod === 0 ? 8 : mb.lod === 1 ? 5 : 3;
  const path: [number, number][] = [[-H, H]];
  for (let k = 0; k <= seg; k++) { const a = Math.PI / 2 - (k / seg) * (Math.PI / 2); path.push([H - R + Math.cos(a) * R, H - R + Math.sin(a) * R]); }
  path.push([H, -H]);
  const inner = path.map(([x, z], k): [number, number] => {
    const p0 = path[Math.max(0, k - 1)]!, p1 = path[Math.min(path.length - 1, k + 1)]!;
    const dx = p1[0] - p0[0], dz = p1[1] - p0[1], l = Math.hypot(dx, dz);
    return [x + (dz / l) * CW, z - (dx / l) * CW];
  });
  slab(mb, [[-H, -H], [inner[inner.length - 1]![0], -H], ...inner.slice(1, -1).reverse(), [-H, inner[0]![1]]].reverse() as [number, number][]);
  quayEdge(mb, path, { fender: 7, bollard: 9, ladder: 10 });
  slabJoints(mb, -H, -H, H - CW - 0.5, H - CW - 0.5, 8);
  if (mb.lod < 2) groundLine(mb, [-H, 6], [4, 6], 0.2, 'marque_jaune', 0.012, 3, 3);
  lightMast(mb, -8, -8, 20, 3);
}

function quaiRampe(m: TModel): void {
  const mb = m.mb;
  const X = 12, Zb = 4;
  slab(mb, [[-X, -12], [X, -12], [X, Zb - 1.4], [-X, Zb - 1.4]]);
  slab(mb, [[-5, Zb - 1.4], [5, Zb - 1.4], [5, Zb], [-5, Zb]]);
  quayEdge(mb, [[-X, Zb], [-5, Zb]], { fender: 4, bollard: 5 });
  quayEdge(mb, [[5, Zb], [X, Zb]], { fender: 4, bollard: 5 });
  slabJoints(mb, -X, -12, X, Zb - 1.4, 8);
  if (mb.lod < 2) {
    groundLine(mb, [-3.5, -12], [-3.5, Zb], 0.15, 'marque_blanche');
    groundLine(mb, [3.5, -12], [3.5, Zb], 0.15, 'marque_blanche');
    for (let z = -10; z < Zb - 2; z += 4) groundLine(mb, [0, z], [0, z + 2], 0.15, 'marque_jaune');
  }
  // ducs d'albe (piles) et portique de levage
  for (const sx of [-1, 1]) {
    const x = sx * 6.8;
    mb.tube('beton_clair', [x, -3, 20], [x, 0.8, 20], 1.6, mb.lod === 0 ? 14 : 8, true);
    mb.box('bleu', x - 0.6, 0.8, 19.4, x + 0.6, 10, 20.6);
    if (mb.lod < 2) ladder(mb, x, 19.4, 0.8, 10, [0, 0, -1]);
  }
  mb.box('bleu', -7.4, 10, 19.3, 7.4, 11.2, 20.7);
  mb.box('bardage_blanc', -2, 11.2, 19.4, 2, 13.4, 20.6);
  if (mb.lod < 2) railing(mb, [-7.2, 11.2, 20.7], [7.2, 11.2, 20.7]);
  beacon(mb, [0, 13.4, 20], 'feu_rouge');
  // rampe (passerelle à véhicules) : nœud animable autour de la charnière
  const r = m.node('rampe', m.root, [0, 0, Zb], { kind: 'rotate', axis: 'x', min: -8, max: 6, note: 'inclinaison de la rampe (degrés) autour de la charnière' });
  const rb = r.mesh;
  rb.push().rotX(5 * DEG);
  rb.box('gris', -4.6, -0.7, 0, 4.6, 0, 18);
  rb.box('atlas', -4.6, 0, 0, -4.2, 0.35, 18, 'ny', { region: 'hachures' });
  rb.box('atlas', 4.2, 0, 0, 4.6, 0.35, 18, 'ny', { region: 'hachures' });
  if (rb.lod === 0) for (let z = 0.6; z < 17.5; z += 0.6) rb.box('gris_fonce', -4.2, 0, z, 4.2, 0.05, z + 0.12, 'ny');
  for (let k = 0; k < 8; k++) rb.box('gris', -4.4 + k * 1.1, -0.2, 18, -3.5 + k * 1.1, 0, 19.6);
  railing(rb, [-4.4, 0.35, 0], [-4.4, 0.35, 18]); railing(rb, [4.4, 0.35, 18], [4.4, 0.35, 0]);
  // câbles de levage (fixes) vers le portique
  if (rb.lod < 2) for (const sx of [-1, 1]) rb.tube('noir', [sx * 4.3, 0.3, 17], [sx * 6.3, 10.5, 20.5], 0.06, 4, false);
  rb.pop();
}

/* ------------------------------------------------------------------ */
/* Portique à conteneurs (STS)                                          */
/* ------------------------------------------------------------------ */
function grueportique(m: TModel): void {
  const mb = m.mb, lod = mb.lod;
  const LX = 9, ZS = 10, ZL = -10; // pieds : x = ±9, rail mer z = +10, rail terre z = −10
  const GY = 42, GH = 3; // poutres de roulement : y 42..45
  const GX = 7.5; // demi-écartement des poutres
  // bogies et longrines
  for (const sx of [-1, 1]) {
    const x = sx * LX;
    mb.box('bleu', x - 0.9, 1.6, ZL - 2.5, x + 0.9, 3.2, ZS + 2.5);
    for (const z of [ZL, ZS]) {
      for (const dz of [-1.6, 1.6]) {
        mb.box('gris_fonce', x - 0.7, 0.55, z + dz - 1.4, x + 0.7, 1.6, z + dz + 1.4);
        if (lod < 2) for (const w of [-0.8, 0.8]) { mb.push().translate(x, 0.45, z + dz + w).rotY(Math.PI / 2); wheelX(mb, [0, 0, 0], 0.45, 0.3); mb.pop(); }
      }
      if (lod < 2) mb.box('atlas', x - 0.95, 1.6, z - 2.6, x + 0.95, 2.0, z + 2.6, 'ny', { region: 'hachures' });
    }
    // jambes (caissons légèrement effilés)
    for (const z of [ZL, ZS]) mb.beam('bleu', [x, 3.2, z], [x, GY, z], 1.9, 1.5);
    // entretoise diagonale côté terre (portique en K) et traverse basse
    mb.beam('bleu', [x, 14, ZL], [x, GY - 2, ZS], 0.9, 0.7);
    mb.beam('bleu', [x, 14, ZL], [x, 14, ZS], 1.1, 0.9);
  }
  // traverses de portique (haut) mer et terre
  for (const z of [ZL, ZS]) mb.box('bleu', -LX - 1, GY - 2.5, z - 1, LX + 1, GY, z + 1);
  // poutres de roulement (partie fixe : arrière-bec jusqu'à la charnière z = +10)
  for (const sx of [-1, 1]) {
    mb.box('blanc', sx * GX - 0.8, GY, -36, sx * GX + 0.8, GY + GH, ZS + 0.5);
    if (lod < 2) {
      railing(mb, [sx * (GX + 0.8), GY + GH, ZS], [sx * (GX + 0.8), GY + GH, -36]);
      mb.box('gris', sx * GX - 0.12, GY + GH, -36, sx * GX + 0.12, GY + GH + 0.2, ZS + 0.5);
    }
  }
  for (let z = -34; z <= ZS; z += 6) mb.box('blanc', -GX, GY, z - 0.5, GX, GY + 0.8, z + 0.5);
  // chevalet (A-frame) et haubans arrière
  const AY = 72, AZ = 4;
  for (const sx of [-1, 1]) {
    const x = sx * GX;
    mb.beam('blanc', [x, GY + GH, ZS], [x, AY, AZ], 1.3, 1.1);
    mb.beam('blanc', [x, GY + GH, ZL], [x, AY, AZ], 1.3, 1.1);
    mb.beam('blanc', [x, GY + GH, -35], [x, AY - 0.5, AZ], 0.7, 0.6);
  }
  mb.box('blanc', -GX - 0.7, AY - 1.6, AZ - 0.8, GX + 0.7, AY, AZ + 0.8);
  beacon(mb, [0, AY, AZ], 'feu_rouge', 0.25, 0.5);
  if (lod < 2) for (const sx of [-1, 1]) beacon(mb, [sx * GX, AY, AZ], 'feu_rouge', 0.2, 0.4);
  // salle des machines (arrière-bec)
  mb.box('bardage_blanc', -GX - 1, GY + GH, -36, GX + 1, GY + GH + 5.5, -24);
  mb.box('gris_clair', -GX - 1.3, GY + GH + 5.5, -36.3, GX + 1.3, GY + GH + 5.9, -23.7);
  if (lod < 2) {
    bandsBox(mb, -GX - 1, -36, GX + 1, -24, GY + GH + 2.2, GY + GH + 3.6, 'aeration', 4, 'px nx');
    mb.box('gris', -2, GY + GH + 5.9, -33, 2, GY + GH + 7, -30);
    mb.quad('decal', [-6, GY + GH + 1.2, -23.97], [6, GY + GH + 1.2, -23.97], [6, GY + GH + 2.7, -23.97], [-6, GY + GH + 2.7, -23.97], { region: 'logo_a' });
  }
  // cabine électrique et ascenseur sur la jambe terre
  mb.box('bardage_blanc', LX + 0.95, 6, ZL - 2, LX + 3.6, GY - 3, ZL + 1.5);
  if (lod < 2) {
    band(mb, [LX + 3.63, ZL + 1.5], [LX + 3.63, ZL - 2], 10, 11.2, 'aeration', 3.5);
    for (let y = 8; y < GY - 4; y += 6) ladder(mb, -LX - 0.95, ZL, y, y + 6, [-1, 0, 0]);
  }
  // enrouleur de câble d'alimentation (côté terre)
  mb.push().translate(-LX - 1.6, 4.2, 0).rotZ(Math.PI / 2);
  mb.lathe('jaune', [[2.2, -0.5], [2.2, 0.5], [0.6, 0.5], [0.6, -0.5]].map(([r, y]) => [r, y] as [number, number]), lod === 0 ? 16 : 8, 30);
  mb.pop();

  // --- flèche (partie mer), relevable autour de la charnière
  const boom = m.node('fleche', m.root, [0, GY + GH / 2, ZS + 0.5], { kind: 'rotate', axis: 'x', min: -80, max: 0, note: 'relevage de la flèche (degrés, négatif = vers le haut)' });
  const bb = boom.mesh;
  const BL = 52;
  for (const sx of [-1, 1]) {
    const x = sx * GX;
    bb.surface([[[x - 0.8, -GH / 2, 0], [x + 0.8, -GH / 2, 0], [x + 0.8, GH / 2, 0], [x - 0.8, GH / 2, 0]], [[x - 0.7, -0.6, BL], [x + 0.7, -0.6, BL], [x + 0.7, GH / 2, BL], [x - 0.7, GH / 2, BL]]], { mat: 'blanc', closedJ: true, smoothAngle: 10 });
    if (lod < 2) { railing(bb, [x + 0.8, GH / 2, 0], [x + 0.8, GH / 2, BL - 1]); bb.box('gris', x - 0.12, GH / 2, 0, x + 0.12, GH / 2 + 0.2, BL); }
    // haubans avant (du chevalet vers la flèche)
    const apex: V3 = [x, AY - (GY + GH / 2), AZ - (ZS + 0.5)];
    for (const zb of [24, 46]) bb.tube('blanc', apex, [x, GH / 2, zb], lod === 0 ? 0.35 : 0.5, lod === 0 ? 8 : 4, false);
  }
  for (let z = 3; z < BL; z += 6) bb.box('blanc', -GX, -GH / 2 + (z / BL) * 0.9, z - 0.4, GX, -GH / 2 + (z / BL) * 0.9 + 0.7, z + 0.4);
  bb.box('blanc', -GX - 0.8, -0.6, BL - 1, GX + 0.8, GH / 2, BL + 0.6);
  beacon(bb, [0, GH / 2, BL], 'feu_rouge', 0.25, 0.5);
  if (lod < 2) for (const sx of [-1, 1]) lightBox(bb, sx * GX, -GH / 2 - 0.2, 30);

  // --- chariot (roule sur les poutres le long de Z) + cabine suspendue
  const tr = m.node('chariot', m.root, [0, GY + GH, 0], { kind: 'translate', axis: 'z', min: -34, max: 60, note: 'translation du chariot le long de la flèche (m, relatif au centre du portique)' });
  const tb = tr.mesh;
  tb.box('jaune', -GX - 0.9, 0.2, -3.5, GX + 0.9, 1.6, 3.5);
  tb.box('bardage_blanc', -3, 1.6, -2.5, 3, 3.6, 2.5);
  if (tb.lod < 2) for (const sx of [-1, 1]) for (const dz of [-2.6, 2.6]) { tb.push().translate(sx * GX, 0.35, dz).rotY(Math.PI / 2); wheelX(tb, [0, 0, 0], 0.35, 0.25); tb.pop(); }
  // cabine de conduite sous le chariot (entre les poutres)
  tb.box('jaune', 2.5, -6.5, -0.6, 3.1, 0.2, 0.6);
  tb.box('blanc', 1.2, -9.5, -1.8, 4.6, -6.3, 1.8);
  if (tb.lod < 2) {
    for (const [a, b] of [[[1.17, 1.8], [1.17, -1.8]], [[4.63, -1.8], [4.63, 1.8]], [[1.2, 1.83], [4.6, 1.83]]] as [[number, number], [number, number]][]) band(tb, a, b, -8.9, -6.8, 'pont_vitres', 3.6);
    tb.quad('verre', [1.3, -9.53, 1.7], [4.5, -9.53, 1.7], [4.5, -9.53, -1.7], [1.3, -9.53, -1.7]);
  }
  // câbles de levage : nœud étirable (échelle Y = longueur pendante)
  const cab = m.node('cables', tr, [0, 0.2, 0], { kind: 'scale', axis: 'y', min: 2, max: 44, note: 'longueur pendante des câbles (m) = échelle Y ; suivre le palonnier' }, [1, 20, 1]);
  for (const [x, z] of [[-1.2, -0.5], [1.2, -0.5], [-1.2, 0.5], [1.2, 0.5]] as [number, number][]) cab.mesh.tube('noir', [x, 0, z], [x * 0.6, -1, z * 0.6], 0.035, 4, false);
  // palonnier (spreader) : translation verticale
  const sp = m.node('palonnier', tr, [0, -20, 0], { kind: 'translate', axis: 'y', min: -44, max: -2, note: 'hauteur du palonnier sous le chariot (m)' });
  const sb = sp.mesh;
  sb.box('jaune', -1.2, 0, -1, 1.2, 1.2, 1);
  sb.box('jaune', -6.1, -0.9, -0.35, 6.1, -0.2, 0.35);
  for (const sx of [-1, 1]) sb.box('jaune', sx * 6.1 - 0.4, -0.9, -1.25, sx * 6.1 + 0.4, -0.2, 1.25);
  if (sb.lod === 0) {
    sb.box('gris_fonce', -1.5, -0.4, -0.8, 1.5, 0, 0.8);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) sb.box('gris_fonce', sx * 6.1 - 0.15, -1.15, sz * 1.1 - 0.12, sx * 6.1 + 0.15, -0.9, sz * 1.1 + 0.12);
    for (const sx of [-1, 1]) sb.box('atlas', sx * 3 - 0.25, -0.2, -0.36, sx * 3 + 0.25, 0.1, 0.36, 'ny', { region: 'feu_jaune' });
  }
}

function lightBox(mb: TMesh, x: number, y: number, z: number): void {
  mb.box('gris_fonce', x - 0.4, y - 0.4, z - 0.3, x + 0.4, y, z + 0.3, '', { ny: { region: 'feu_blanc' } });
}

/* ------------------------------------------------------------------ */
/* Grue mobile portuaire                                                */
/* ------------------------------------------------------------------ */
function grueMobile(m: TModel): void {
  const mb = m.mb, lod = mb.lod;
  // châssis porteur : longeron central, essieux, stabilisateurs en X
  mb.box('orange', -9, 1.4, -2.2, 9, 3.2, 2.2);
  mb.box('gris_fonce', -9.2, 1.1, -2.3, 9.2, 1.45, 2.3);
  for (let k = 0; k < 6; k++) {
    const x = -7.5 + k * 3;
    for (const sz of [-1, 1]) {
      for (const dz of [0.95, 1.85]) {
        mb.push().translate(x, 0.7, sz * dz).rotY(Math.PI / 2);
        if (lod < 2) wheelX(mb, [0, 0, 0], 0.7, 0.45); else mb.box('noir', -0.22, -0.7, -0.7, 0.22, 0.7, 0.7, 'ny');
        mb.pop();
      }
    }
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as [number, number][]) {
    const a: V3 = [sx * 4, 2.6, sz * 1.8], b: V3 = [sx * 8.5, 2.6, sz * 8.5];
    mb.beam('orange', a, b, 0.9, 1.0);
    mb.box('orange', b[0] - 0.5, 0.6, b[2] - 0.5, b[0] + 0.5, 3.2, b[2] + 0.5);
    mb.tube('gris_fonce', [b[0], 0, b[2]], [b[0], 0.6, b[2]], 1.1, lod === 0 ? 12 : 8, true);
    if (lod < 2) mb.box('atlas', a[0] - 0.45, 3.11, a[2] - 0.45, a[0] + 0.45, 3.12, a[2] + 0.45, '', { py: { region: 'hachures' } });
  }
  if (lod < 2) { mb.box('atlas', -9.21, 1.6, -2.21, -9.2, 3.0, 2.21, '', { nx: { region: 'hachures' } }); mb.box('atlas', 9.2, 1.6, -2.21, 9.21, 3.0, 2.21, '', { px: { region: 'hachures' } }); }
  // couronne d'orientation
  mb.tube('gris_fonce', [0, 3.2, 0], [0, 3.8, 0], 2.6, lod === 0 ? 20 : 10, true);

  // --- tourelle (orientable autour de Y)
  const tu = m.node('tourelle', m.root, [0, 3.8, 0], { kind: 'rotate', axis: 'y', min: -180, max: 180, note: 'orientation de la tourelle (degrés)' });
  const t = tu.mesh;
  t.box('blanc', -7, 0, -3, 4, 4.2, 3);
  t.box('gris_fonce', -8.5, 0.2, -3.2, -6.8, 3.6, 3.2); // contrepoids
  if (t.lod < 2) {
    bandsBox(t, -7, -3, 4, 3, 1.4, 2.8, 'aeration', 3.5, 'pz nz');
    t.quad('decal', [-5.5, 0.6, 3.04], [1.5, 0.6, 3.04], [1.5, 1.5, 3.04], [-5.5, 1.5, 3.04], { region: 'logo_d' });
    railing(t, [-7, 4.2, 3], [4, 4.2, 3]); railing(t, [4, 4.2, -3], [-7, 4.2, -3]);
  }
  // tour et cabine
  t.box('orange', -1.6, 4.2, -1.6, 1.6, 22, 1.6);
  if (t.lod < 2) for (let y = 5; y < 21; y += 5) ladder(t, 0, -1.6, y, y + 5, [0, 0, -1]);
  t.box('blanc', -1.2, 22, -1.6, 2.6, 25, 1.8);
  if (t.lod < 2) bandsBox(t, -1.2, -1.6, 2.6, 1.8, 23, 24.7, 'pont_vitres', 3.4, 'px pz nz');
  t.box('gris_clair', -1.4, 25, -1.8, 2.8, 25.25, 2);
  beacon(t, [0.6, 25.25, 0], 'gyro', 0.2, 0.35);
  // vérin de relevage
  t.tube('gris_fonce', [-0.5, 4.5, 0], [6, 13, 0], 0.45, t.lod === 0 ? 8 : 5, true);

  // --- flèche treillis (relevable autour de son pied)
  const fl = m.node('fleche', tu, [4, 3.5, 0], { kind: 'rotate', axis: 'z', min: -25, max: 35, note: 'relevage de la flèche (degrés, relatif à l’angle de repos de 40°)' });
  const f = fl.mesh;
  const ang = 40 * DEG, BL = 46;
  const tip: V3 = [Math.cos(ang) * BL, Math.sin(ang) * BL, 0];
  lattice(f, 'orange', [0.5, 0.4, 0], tip, 2.2, 1.8, 4.6, 0.14);
  f.box('orange', -0.6, -0.8, -1.4, 1.4, 1.2, 1.4);
  f.push().translate(tip[0], tip[1], 0);
  f.box('orange', -0.8, -1.2, -1.3, 1.6, 0.8, 1.3);
  f.tube('gris', [1.2, -0.3, -0.9], [1.2, -0.3, 0.9], 1.0, f.lod === 0 ? 12 : 6, true);
  beacon(f, [0.4, 0.8, 0], 'feu_rouge');
  // câbles et moufle à crochet (pendant)
  if (f.lod < 2) for (const dz of [-0.4, 0.4]) f.tube('noir', [2.1, -0.4, dz], [2.1, -15, dz], 0.04, 4, false);
  f.box('jaune', 1.5, -16.6, -0.7, 2.7, -14.8, 0.7);
  f.box('gris_fonce', 1.9, -17.6, -0.15, 2.3, -16.6, 0.15);
  f.pop();
}

/* ------------------------------------------------------------------ */
/* Conteneurs                                                           */
/* ------------------------------------------------------------------ */
const CT_NAMES: Partial<Record<MatKey, string>> = { ct_rouge: 'Rouge', ct_bleu: 'Bleu', ct_vert: 'Vert', ct_gris: 'Gris', ct_orange: 'Orange', ct_blanc: 'Blanc', ct_jaune: 'Jaune', ct_brun: 'Brun' };
function ctVariants(base: MatKey): TransportDef['variants'] {
  return CONTAINER_MATS.filter((k) => k !== base).map((k) => ({ id: k.slice(3), nameFr: `Coque ${CT_NAMES[k]!.toLowerCase()}`, overrides: { [base]: MATERIALS[k].color } }));
}
function ctDef(id: string, nameFr: string, len: number, hc: boolean, mat: MatKey, logo: RegionName, reefer = false): TransportDef {
  return {
    id, nameFr, group: 'port', category: 'prop', kind: 'conteneur', lodDistances: [90, 300],
    build: (m) => container(m.mb, 0, 0, 0, { len, hc, mat, logo, reefer }),
    variants: ctVariants(mat), tags: [`longueur_pieds:${len > 7 ? 40 : 20}`, ...(hc ? ['high_cube'] : []), ...(reefer ? ['frigorifique'] : [])],
  };
}

/** Bloc de stockage : 3 travées de 40' × 6 rangées × 1 à 4 niveaux (teintes et logos mélangés). */
function pileConteneurs(m: TModel): void {
  const mb = m.mb, r = rnd(17);
  const logos: RegionName[] = ['logo_a', 'logo_b', 'logo_c', 'logo_d'];
  const bays = 3, rows = 6, L = 12.192, gapX = 0.45, gapZ = 0.38;
  for (let b = 0; b < bays; b++) for (let k = 0; k < rows; k++) {
    const tiers = 1 + Math.floor(r() * 4.2);
    const x = (b - (bays - 1) / 2) * (L + gapX), z = (k - (rows - 1) / 2) * (CT_W + gapZ);
    if (mb.lod >= 2) { mb.box(CONTAINER_MATS[Math.floor(r() * 8)]!, x - L / 2, 0, z - CT_W / 2, x + L / 2, tiers * ctHeight(false), z + CT_W / 2, 'ny'); continue; }
    for (let t = 0; t < Math.min(4, tiers); t++) {
      const mat = CONTAINER_MATS[Math.floor(r() * 8)]!;
      const showLogo = mb.lod === 0 || k === 0 || k === rows - 1;
      container(mb, x, t * ctHeight(false), z, { len: L, mat, ...(showLogo && (k === 0 || k === rows - 1) ? { logo: logos[Math.floor(r() * 4)]! } : {}), doorsTo: r() < 0.5 ? 1 : -1 });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Bâtiments portuaires                                                 */
/* ------------------------------------------------------------------ */

/** Toit à deux pans (faîtage le long de X), débord `ov`. */
function gableRoof(mb: TMesh, x0: number, x1: number, z0: number, z1: number, y: number, rise: number, mat: MatKey, ov = 0.4): void {
  const zc = (z0 + z1) / 2;
  const A: V3 = [x0 - ov, y, z1 + ov], B: V3 = [x1 + ov, y, z1 + ov], C: V3 = [x1 + ov, y + rise, zc], D: V3 = [x0 - ov, y + rise, zc];
  mb.quad(mat, A, B, C, D);
  mb.quad(mat, [x1 + ov, y, z0 - ov], [x0 - ov, y, z0 - ov], D, C);
  // sous-face et pignons
  mb.quad('gris', [x0 - ov, y, z0 - ov], [x1 + ov, y, z0 - ov], [x1 + ov, y, z1 + ov], [x0 - ov, y, z1 + ov]);
  for (const [x, s] of [[x0, -1], [x1, 1]] as [number, number][]) {
    if (s > 0) mb.quad('bardage', [x, y, z1], [x, y, z0], [x, y + rise, zc], [x, y + rise, zc]);
    else mb.quad('bardage', [x, y, z0], [x, y, z1], [x, y + rise, zc], [x, y + rise, zc]);
  }
}

function entrepot(m: TModel): void {
  const mb = m.mb, lod = mb.lod;
  const X = 27, Z = 15.2, H = 11;
  // socle béton + bardage
  mb.box('beton_clair', -X, 0, -Z, X, 1.2, Z, 'ny');
  mb.box('bardage', -X + 0.05, 1.2, -Z + 0.05, X - 0.05, H, Z - 0.05, 'ny py');
  gableRoof(mb, -X, X, -Z, Z, H, 1.6, 'bardage_gris', 0.5);
  // lanterneaux (bandes vitrées) sur les deux pans
  if (lod < 2) for (let x = -X + 4; x < X - 4; x += 8) for (const s of [-1, 1]) {
    const z0 = s * 3, z1 = s * 11, y0 = H + 1.6 * (1 - Math.abs(z0) / Z) + 0.03, y1 = H + 1.6 * (1 - Math.abs(z1) / Z) + 0.03;
    if (s > 0) mb.quad('verre', [x, y1, z1], [x + 2.5, y1, z1], [x + 2.5, y0, z0], [x, y0, z0]);
    else mb.quad('verre', [x + 2.5, y1, z1], [x, y1, z1], [x, y0, z0], [x + 2.5, y0, z0]);
  }
  // quai de chargement côté +Z : portes sectionnelles, auvent, butoirs
  mb.box('beton', -X, 0, Z, X - 8, 1.2, Z + 3.2, 'ny');
  for (let k = 0; k < 6; k++) {
    const x = -X + 4.5 + k * 7.2;
    mb.quad('atlas', [x - 2, 1.2, Z + 0.03], [x + 2, 1.2, Z + 0.03], [x + 2, 5.6, Z + 0.03], [x - 2, 5.6, Z + 0.03], { region: 'porte_quai' });
    if (lod === 0) { for (const sx of [-1, 1]) mb.box('noir', x + sx * 1.6 - 0.2, 0.5, Z + 3.2, x + sx * 1.6 + 0.2, 1.1, Z + 3.45); mb.box('gris', x - 1.5, 1.2, Z + 0.1, x + 1.5, 1.24, Z + 2.2); }
  }
  mb.box('gris_clair', -X, 6.4, Z, X - 8, 6.8, Z + 4.4);
  if (lod < 2) for (let x = -X + 1; x < X - 8; x += 9) mb.beam('gris', [x, 6.4, Z + 0.1], [x, 9.2, Z + 0.1], 0.25), mb.beam('gris', [x, 9.2, Z + 0.1], [x, 6.8, Z + 4.2], 0.2);
  // côté −Z : 3 portes poids lourds + portes piétonnes
  for (let k = 0; k < 3; k++) {
    const x = -X + 9 + k * 18;
    mb.quad('atlas', [x + 2.5, 0, -Z - 0.03], [x - 2.5, 0, -Z - 0.03], [x - 2.5, 5.5, -Z - 0.03], [x + 2.5, 5.5, -Z - 0.03], { region: 'porte_quai' });
    mb.box('gris_clair', x - 3.2, 5.8, -Z - 1.5, x + 3.2, 6.1, -Z);
  }
  // bureaux en bout (+X)
  mb.box('beton_clair', X - 8, 0, Z - 9, X + 0.6, 8, Z + 3.4, 'ny');
  mb.box('gris_fonce', X - 8.2, 8, Z - 9.2, X + 0.8, 8.5, Z + 3.6);
  if (lod < 2) {
    for (const y of [1.2, 4.6]) bandsBox(mb, X - 8, Z - 9, X + 0.6, Z + 3.4, y, y + 2.4, 'bureaux', 3, 'pz px');
    mb.quad('decal', [X + 0.65, 8.7, Z - 1], [X + 0.65, 8.7, Z - 13], [X + 0.65, 10.2, Z - 13], [X + 0.65, 10.2, Z - 1], { region: 'logo_b' });
    // descentes d'eaux pluviales
    for (let x = -X + 6; x < X - 8; x += 12) for (const s of [-1, 1]) mb.tube('gris', [x, 0.2, s * (Z + 0.25)], [x, H, s * (Z + 0.25)], 0.1, 6, false);
    mb.box('gris', -X - 0.3, H - 0.4, Z - 0.1, X + 0.3, H, Z + 0.5);
    mb.box('gris', -X - 0.3, H - 0.4, -Z - 0.5, X + 0.3, H, -Z + 0.1);
    for (let x = -X + 10; x < X - 10; x += 16) { mb.box('gris_clair', x - 1.2, H + 1.1, -1.2, x + 1.2, H + 2.2, 1.2); mb.box('atlas', x - 1.21, H + 1.3, -1.21, x + 1.21, H + 2.0, 1.21, 'ny py', { region: 'aeration' }); }
  }
}

function capitainerie(m: TModel): void {
  const mb = m.mb, lod = mb.lod;
  // bloc de bureaux R+2 (béton clair, bandeaux vitrés)
  const X0 = -11, X1 = 5, Z0 = -6, Z1 = 6;
  mb.box('beton_clair', X0, 0, Z0, X1, 10.4, Z1, 'ny');
  mb.box('gris_fonce', X0 - 0.2, 10.4, Z0 - 0.2, X1 + 0.2, 11, Z1 + 0.2);
  for (const y of [0.9, 4.3, 7.7]) bandsBox(mb, X0, Z0, X1, Z1, y, y + 2.2, 'bureaux', 4, 'pz nz nx px');
  mb.box('verre', -6, 0, Z1, -2, 2.8, Z1 + 0.06);
  mb.box('gris_clair', -7, 2.9, Z1, -1, 3.2, Z1 + 2.2);
  mb.quad('decal', [-9.5, 11.2, Z1 + 0.25], [3.5, 11.2, Z1 + 0.25], [3.5, 12.8, Z1 + 0.25], [-9.5, 12.8, Z1 + 0.25], { region: 'ens_capitainerie' });
  if (lod < 2) { mb.box('gris', -9.5, 11, Z1 + 0.15, 3.5, 11.2, Z1 + 0.3); mb.box('gris', -5, 11, -3, -1, 12.5, 1); railing(mb, [X0, 11, Z0], [X0, 11, Z1]); }
  // tour de vigie octogonale
  const seg = 8, TX = 8.5, TZ = 0, R0 = 3.6;
  mb.push().translate(TX, 0, TZ).rotY(Math.PI / 8);
  mb.lathe('blanc', [[R0, 0], [R0 * 0.85, 22], [R0 * 0.85, 22.2]], seg, 10);
  // salle de veille : vitrage incliné
  const rows: V3[][] = [];
  for (const [r, y] of [[R0 * 0.85, 22.2], [R0 * 1.25, 26.4]] as [number, number][]) { const row: V3[] = []; for (let k = 0; k <= seg; k++) { const a = (k / seg) * Math.PI * 2; row.push([Math.cos(a) * r, y, -Math.sin(a) * r]); } rows.push(row); }
  mb.surface(rows, { mat: 'atlas', region: 'vitrage_tour', uv: (i, j) => [(j % 2) * 1, 1 - i], smoothAngle: 5, autoOrient: true });
  mb.lathe('gris_fonce', [[R0 * 1.25, 26.4], [R0 * 1.45, 26.6], [R0 * 1.45, 27.1], [0.001, 27.4]], seg, 10);
  mb.pop();
  if (lod < 2) {
    // coursive et garde-corps
    mb.push().translate(TX, 0, TZ);
    mb.lathe('gris', [[R0 * 0.85, 21.6], [R0 * 1.35, 21.6], [R0 * 1.35, 21.9], [R0 * 0.85, 21.9]], seg, 5);
    for (let k = 0; k < seg; k++) { const a0 = (k / seg) * Math.PI * 2 + Math.PI / 8, a1 = ((k + 1) / seg) * Math.PI * 2 + Math.PI / 8; railing(mb, [Math.cos(a0) * R0 * 1.35, 21.9, -Math.sin(a0) * R0 * 1.35], [Math.cos(a1) * R0 * 1.35, 21.9, -Math.sin(a1) * R0 * 1.35]); }
    // fenêtres étroites de la cage d'escalier
    for (let y = 4; y < 20; y += 4) mb.box('verre', R0 * 0.88 - 0.25, y, -0.4, R0 * 0.88 + 0.06, y + 1.6, 0.4);
    mb.pop();
  }
  // antennes, radar animable
  mb.tube('gris_clair', [TX, 27.4, TZ], [TX, 33, TZ], [0.18, 0.08], 6, true);
  if (lod < 2) { mb.beam('gris_clair', [TX - 1.5, 31, TZ], [TX + 1.5, 31, TZ], 0.1); beacon(mb, [TX, 33, TZ], 'feu_rouge'); mb.tube('blanc', [TX - 1.5, 31, TZ], [TX - 1.5, 32.2, TZ], 0.25, 6, true); }
  const rd = m.node('radar', m.root, [TX, 27.4, TZ - 1.5], { kind: 'rotate', axis: 'y', min: 0, max: 360, note: 'rotation continue de l’antenne radar' });
  rd.mesh.tube('gris_clair', [0, 0, 0], [0, 0.6, 0], 0.15, 6, true);
  rd.mesh.box('blanc', -2.2, 0.6, -0.15, 2.2, 0.95, 0.15);
  // mât de pavillon
  mb.tube('blanc', [X0 + 1, 11, Z1 - 1], [X0 + 1, 19, Z1 - 1], 0.08, 6, true);
  if (lod === 0) {
    // équipements de toiture, poteaux d'auvent, descentes d'eaux pluviales, bancs
    for (const x of [-8.5, -2.5]) { mb.box('gris_clair', x - 1.1, 11, -4.5, x + 1.1, 12.2, -2.5); mb.box('atlas', x - 1.11, 11.2, -4.51, x + 1.11, 12, -2.49, 'ny py', { region: 'aeration' }); }
    for (const x of [-6.8, -1.2]) mb.tube('gris', [x, 0, Z1 + 2], [x, 2.9, Z1 + 2], 0.1, 6, false);
    for (const x of [X0 + 0.3, X1 - 0.3]) mb.tube('gris', [x, 0.2, Z1 + 0.15], [x, 10.4, Z1 + 0.15], 0.08, 6, false);
    for (const x of [-9.5, 2.5]) { mb.box('gris_fonce', x, 0.45, Z1 + 3, x + 1.8, 0.5, Z1 + 3.5); for (const dx of [0.2, 1.6]) mb.box('gris_fonce', x + dx - 0.05, 0, Z1 + 3.05, x + dx + 0.05, 0.45, Z1 + 3.45); }
  }
}

function gareMaritime(m: TModel): void {
  const mb = m.mb, lod = mb.lod;
  const X = 23.5, Z0 = -10, Z1 = 10, H = 9;
  // hall : socle, façades vitrées entre refends béton
  mb.box('beton_clair', -X, 0, Z0, X, 0.6, Z1, 'ny');
  mb.box('gris_fonce', -X + 0.2, 0.6, Z0 + 0.2, X - 0.2, H, Z1 - 0.2, 'py');
  for (let x = -X; x <= X + 0.01; x += 4.7) {
    mb.box('beton_clair', x - 0.35, 0.6, Z1 - 0.6, x + 0.35, H, Z1 + 0.3);
    mb.box('beton_clair', x - 0.35, 0.6, Z0 - 0.3, x + 0.35, H, Z0 + 0.6);
  }
  for (let x = -X + 0.35; x < X - 0.3; x += 4.7) {
    for (const [z, s] of [[Z1 - 0.15, 1], [Z0 + 0.15, -1]] as [number, number][]) {
      const xa = s > 0 ? x : x + 4.0, xb = s > 0 ? x + 4.0 : x;
      mb.quad('atlas', [xa, 0.6, z], [xb, 0.6, z], [xb, 4.8, z], [xa, 4.8, z], { region: 'vitrage' });
      mb.quad('atlas', [xa, 4.8, z], [xb, 4.8, z], [xb, H, z], [xa, H, z], { region: 'vitrage' });
    }
  }
  for (const x of [-X - 0.01, X + 0.01]) {
    const s = x > 0 ? 1 : -1;
    for (let z = Z0 + 1; z < Z1 - 1; z += 4.5) {
      const za = s > 0 ? z + 4 : z, zb = s > 0 ? z : z + 4;
      mb.quad('beton_clair', [x, 0.6, za], [x, 0.6, zb], [x, H, zb], [x, H, za]);
    }
  }
  // toiture en voûte surbaissée (le long de X) avec large débord côté ville (+Z)
  const ns = lod === 0 ? 14 : lod === 1 ? 8 : 4;
  const rowsTop: V3[][] = [];
  for (const x of [-X - 1.5, X + 1.5]) {
    const row: V3[] = [];
    for (let k = 0; k <= ns; k++) { const t = k / ns; const z = Z0 - 1.5 + t * (Z1 + 7 - Z0 + 1.5); row.push([x, H + 0.6 + Math.sin(t * Math.PI) * 3.2, z]); }
    rowsTop.push(row);
  }
  mb.surface(rowsTop, { mat: 'bardage_blanc', smoothAngle: 30, flip: false });
  const under: V3[][] = rowsTop.map((r) => r.map((p) => [p[0], p[1] - 0.5, p[2]] as V3));
  mb.surface(under, { mat: 'blanc', smoothAngle: 30, flip: true });
  for (const [x, s] of [[-X - 1.5, -1], [X + 1.5, 1]] as [number, number][]) {
    const top = rowsTop[s < 0 ? 0 : 1]!, bot = under[s < 0 ? 0 : 1]!;
    for (let k = 0; k < ns; k++) { if (s > 0) mb.quad('gris_clair', bot[k + 1]!, bot[k]!, top[k]!, top[k + 1]!); else mb.quad('gris_clair', bot[k]!, bot[k + 1]!, top[k + 1]!, top[k]!); }
    void x;
  }
  // poteaux de l'auvent (dépose-minute)
  for (let x = -X + 2; x <= X - 1; x += 7.5) mb.tube('blanc', [x, 0, Z1 + 5.5], [x, H + 1.8, Z1 + 5.5], 0.3, lod === 0 ? 10 : 6, false);
  mb.quad('decal', [-9, H + 0.9, Z1 + 6.6], [9, H + 0.9, Z1 + 6.6], [9, H + 3.2, Z1 + 6.6], [-9, H + 3.2, Z1 + 6.6], { region: 'ens_gare' });
  // passerelle d'embarquement surélevée vers le quai (−Z)
  mb.box('blanc', -2, 6.2, Z0 - 18, 2, 9.2, Z0);
  if (lod < 2) {
    band(mb, [2.03, Z0], [2.03, Z0 - 18], 7, 8.6, 'passerelle_vitre', 4.5);
    band(mb, [-2.03, Z0 - 18], [-2.03, Z0], 7, 8.6, 'passerelle_vitre', 4.5);
  }
  for (const z of [Z0 - 6, Z0 - 16]) for (const sx of [-1, 1]) mb.tube('gris_clair', [sx * 1.5, 0, z], [sx * 1.5, 6.2, z], 0.25, 8, false);
  // tour d'escalier en bout de passerelle
  mb.box('beton_clair', -3, 0, Z0 - 22, 3, 10.5, Z0 - 18);
  if (lod < 2) band(mb, [3.03, Z0 - 18], [3.03, Z0 - 22], 1, 9.5, 'vitrage', 2);
}

/* ------------------------------------------------------------------ */
/* Navires                                                              */
/* ------------------------------------------------------------------ */

/** Nom de navire sur les deux bords (avant) et marques de tirant d'eau. */
function hullDecals(mb: TMesh, h: HullSpec, nameRegion: RegionName, nameZ: number, nameY: number, nameH: number): void {
  if (mb.lod >= 2) return;
  const w = nameH * 8;
  const half = (z: number): number => beamAt(h, z) + 0.06;
  // tribord (+X) : lecture vers l'arrière ; bâbord (−X)
  const z0 = nameZ - w / 2, z1 = nameZ + w / 2;
  mb.quad('decal', [half(z1), nameY, z1], [half(z0), nameY, z0], [half(z0), nameY + nameH, z0], [half(z1), nameY + nameH, z1], { region: nameRegion });
  mb.quad('decal', [-half(z0), nameY, z0], [-half(z1), nameY, z1], [-half(z1), nameY + nameH, z1], [-half(z0), nameY + nameH, z0], { region: nameRegion });
  for (const z of [h.L / 2 - 12, -h.L / 2 + 6]) {
    const x = beamAt(h, z) * 0.98 + 0.06;
    mb.quad('decal', [x, -h.T * 0.8, z + 0.6], [x, -h.T * 0.8, z - 0.6], [x, 1.5, z - 0.6], [x, 1.5, z + 0.6], { region: 'coque_marques', rect: [0, 0, 0.08, 1] });
  }
}

/** Château (logements + passerelle) : bloc à n ponts, ailerons de passerelle, mât, radar. */
function accommodation(mb: TMesh, zc: number, dz: number, w: number, y0: number, decks: number, beam: number): number {
  const lod = mb.lod, DH = 2.8;
  let y = y0;
  for (let k = 0; k < decks; k++) {
    const ww = w - (k === decks - 1 ? 0 : 0) , dd = dz - k * 0.15;
    mb.box('blanc', -ww / 2, y, zc - dd / 2, ww / 2, y + DH, zc + dd / 2);
    if (k < decks - 1) { if (lod < 2) bandsBox(mb, -ww / 2, zc - dd / 2, ww / 2, zc + dd / 2, y + 0.9, y + 2.0, 'hublots', 10, 'pz px nx nz'); }
    else bandsBox(mb, -ww / 2, zc - dd / 2, ww / 2, zc + dd / 2, y + 0.6, y + 2.4, 'pont_vitres', 6, 'pz px nx');
    if (lod === 0 && k < decks - 1) mb.box('gris_clair', -ww / 2 - 0.4, y + DH - 0.15, zc - dd / 2 - 0.4, ww / 2 + 0.4, y + DH, zc + dd / 2 + 0.4);
    y += DH;
  }
  // ailerons de passerelle jusqu'au bordé
  mb.box('blanc', -beam, y - DH + 0.4, zc + dz / 2 - 3.4 - (decks - 1) * 0.075, beam, y - DH + 1.0, zc + dz / 2 - (decks - 1) * 0.075);
  if (lod < 2) { railing(mb, [-beam, y - DH + 1.0, zc + dz / 2 - (decks - 1) * 0.075], [beam, y - DH + 1.0, zc + dz / 2 - (decks - 1) * 0.075]); }
  mb.box('gris_clair', -w / 2 - 0.3, y, zc - dz / 2 - 0.3, w / 2 + 0.3, y + 0.3, zc + dz / 2 + 0.3);
  mast(mb, 0, y + 0.3, zc - 1, 8);
  radar(mb, 2.5, y + 0.3, zc + 1); radar(mb, -2.5, y + 0.3, zc - 2);
  return y;
}

const PC: HullSpec = { L: 190, B: 30, D: 16, T: 9.5, bow: 0.2, stern: 0.16, transom: 0.62, sheer: 2.4, rake: 7, top: 'bleu_nuit', bottom: 'antifouling', boot: 0.8, bulb: true, deck: 'vert_pont', band: { mat: 'blanc', y0: 5.9, y1: 6.5 } };

function porteConteneurs(m: TModel): void {
  const mb = m.mb, lod = mb.lod, h = PC, r = rnd(5);
  hull(mb, h);
  const dk = h.D - h.T; // 6,5
  // gaillard d'avant et brise-lames
  const zf = h.L / 2 - 16;
  mb.box('bleu_nuit', -beamAt(h, zf) + 0.4, dk, zf, beamAt(h, zf) - 0.4, dk + 2.4, zf + 10);
  mb.quad('vert_pont', [-beamAt(h, zf) + 0.4, dk + 2.41, zf + 10], [beamAt(h, zf) - 0.4, dk + 2.41, zf + 10], [beamAt(h, zf) - 0.4, dk + 2.41, zf], [-beamAt(h, zf) + 0.4, dk + 2.41, zf]);
  mb.push().translate(0, dk, zf - 1);
  mb.quad('blanc', [-12, 0, 0], [0, 0, 3], [0, 4, 3], [-12, 4, 0]); mb.quad('blanc', [0, 0, 3], [12, 0, 0], [12, 4, 0], [0, 4, 3]);
  mb.pop();
  mast(mb, 0, dk + 2.4, zf + 6, 10);
  if (lod < 2) for (const sx of [-1, 1]) { mb.tube('gris', [sx * 4, dk + 2.4, zf + 4], [sx * 4, dk + 3.6, zf + 4], 0.7, 10, true); mb.tube('gris', [sx * 7, dk + 2.4, zf + 7], [sx * 7, dk + 3.0, zf + 7], 0.5, 8, true); }
  // château arrière et cheminée
  const za = -h.L / 2 + 30;
  const top = accommodation(mb, za, 12, 22, dk, 7, h.B / 2);
  funnel(mb, 0, dk, za - 13, 7, 9, 13, 'bleu_nuit', true);
  void top;
  // panneaux de cale + piles de conteneurs (rangées le long du navire)
  const bays = 9, bayL = 12.192 + 0.9, z0 = za + 9;
  const rowsN = 12, H = ctHeight(false);
  const logos: RegionName[] = ['logo_a', 'logo_b', 'logo_c', 'logo_d'];
  for (let b = 0; b < bays; b++) {
    const zc = z0 + b * (bayL + 0.6) + bayL / 2;
    const half = Math.min(beamAt(h, zc - bayL / 2), beamAt(h, zc + bayL / 2)) - 0.8;
    const nrow = Math.min(rowsN, Math.floor((half * 2) / (CT_W + 0.05)));
    mb.box('vert_pont', -half, dk, zc - bayL / 2, half, dk + 0.9, zc + bayL / 2);
    // passerelle de saisissage entre baies
    if (lod < 2 && b > 0) { mb.box('gris', -half, dk, zc - bayL / 2 - 0.6, half, dk + 4, zc - bayL / 2 - 0.2); railing(mb, [-half, dk + 4, zc - bayL / 2 - 0.4], [half, dk + 4, zc - bayL / 2 - 0.4]); }
    const maxT = b > bays - 3 ? 3 : 5;
    for (let k = 0; k < nrow; k++) {
      const x = (k - (nrow - 1) / 2) * (CT_W + 0.05);
      const tiers = Math.max(1, maxT - Math.floor(r() * 2) - (Math.abs(k - (nrow - 1) / 2) > nrow / 2 - 1.5 ? 1 : 0));
      if (lod >= 1) {
        // pile d'un bloc par colonne, couleurs par niveau aux LOD1
        if (lod === 1) for (let t = 0; t < tiers; t++) mb.box(CONTAINER_MATS[Math.floor(r() * 8)]!, x - CT_W / 2, dk + 0.9 + t * H, zc - bayL / 2 + 0.3, x + CT_W / 2, dk + 0.9 + (t + 1) * H, zc + bayL / 2 - 0.3, 'ny');
        else mb.box(CONTAINER_MATS[(b + k) % 8]!, x - CT_W / 2, dk + 0.9, zc - bayL / 2 + 0.3, x + CT_W / 2, dk + 0.9 + tiers * H, zc + bayL / 2 - 0.3, 'ny');
        continue;
      }
      for (let t = 0; t < tiers; t++) {
        mb.push().translate(x, dk + 0.9 + t * H, zc).rotY(Math.PI / 2);
        const edge = k === 0 || k === nrow - 1;
        container(mb, 0, 0, 0, { len: 12.192, simple: true, mat: CONTAINER_MATS[Math.floor(r() * 8)]!, ...(edge && r() < 0.6 ? { logo: logos[Math.floor(r() * 4)]! } : {}), doorsTo: -1 });
        mb.pop();
      }
    }
  }
  hullDecals(mb, h, 'nom_pc', h.L / 2 - 22, 2.4, 1.8);
  if (lod < 2) {
    // ancres (écubiers) et chaumards
    for (const sx of [-1, 1]) mb.box('noir', sx * (beamAt(h, h.L / 2 - 8) - 0.1) - 0.8, dk - 3.5, h.L / 2 - 9.5, sx * (beamAt(h, h.L / 2 - 8) - 0.1) + 0.8, dk - 1.6, h.L / 2 - 7.5);
    railing(mb, [-beamAt(h, -h.L / 2 + 2), dk, -h.L / 2 + 2], [beamAt(h, -h.L / 2 + 2), dk, -h.L / 2 + 2]);
  }
  // canot de sauvetage en chute libre (arrière)
  mb.push().translate(0, dk + 3, -h.L / 2 + 4).rotX(-0.45);
  lifeboat(mb, [0, 0, 0], 8.5);
  mb.pop();
}

const VR: HullSpec = { L: 180, B: 30, D: 16.5, T: 10.5, bow: 0.18, stern: 0.15, transom: 0.66, sheer: 2.2, rake: 5, top: 'noir', bottom: 'antifouling', boot: 0.8, bulb: true, deck: 'rouge' };

function vraquier(m: TModel): void {
  const mb = m.mb, lod = mb.lod, h = VR;
  hull(mb, h);
  const dk = h.D - h.T;
  const zf = h.L / 2 - 14;
  mb.box('noir', -beamAt(h, zf) + 0.3, dk, zf, beamAt(h, zf) - 0.3, dk + 2.6, zf + 8);
  mb.quad('rouge', [-beamAt(h, zf) + 0.3, dk + 2.61, zf + 8], [beamAt(h, zf) - 0.3, dk + 2.61, zf + 8], [beamAt(h, zf) - 0.3, dk + 2.61, zf], [-beamAt(h, zf) + 0.3, dk + 2.61, zf]);
  mast(mb, 0, dk + 2.6, zf + 5, 9);
  const za = -h.L / 2 + 22;
  accommodation(mb, za, 13, 20, dk, 6, h.B / 2);
  funnel(mb, 0, dk + 2, za - 12, 6, 8, 11, 'noir', true);
  // 7 cales : hiloires + panneaux à nervures, grues de pont entre cales
  const n = 7, hl = 15.5, gap = 3.8, zs = za + 10;
  for (let k = 0; k < n; k++) {
    const z0 = zs + k * (hl + gap), z1 = z0 + hl;
    const half = Math.min(beamAt(h, z0), beamAt(h, z1)) * 0.62;
    mb.box('rouge', -half, dk, z0, half, dk + 1.6, z1);
    mb.box('atlas', -half + 0.3, dk + 1.6, z0 + 0.2, half - 0.3, dk + 2.3, z1 - 0.2, 'ny', { py: { region: 'ecoutille' }, px: { region: 'ecoutille', rect: [0, 0, 1, 0.1] }, nx: { region: 'ecoutille', rect: [0, 0, 1, 0.1] }, pz: { region: 'ecoutille', rect: [0, 0, 1, 0.1] }, nz: { region: 'ecoutille', rect: [0, 0, 1, 0.1] } });
    if (k % 2 === 1 && k < n - 1) deckCrane(mb, 0, dk, z1 + gap / 2, k);
  }
  hullDecals(mb, h, 'nom_vrac', h.L / 2 - 22, 3.2, 1.8);
  if (lod < 2) for (const s of [-1, 1]) railing(mb, [s * beamAt(h, -40), dk, s > 0 ? 60 : -60], [s * beamAt(h, -40), dk, s > 0 ? -60 : 60]);
}

function deckCrane(mb: TMesh, x: number, y: number, z: number, k: number): void {
  mb.tube('blanc', [x, y, z], [x, y + 9, z], 1.4, mb.lod === 0 ? 12 : 8, true);
  mb.box('blanc', x - 1.6, y + 9, z - 1.8, x + 1.6, y + 12, z + 1.8);
  if (mb.lod < 2) bandsBox(mb, x - 1.6, z - 1.8, x + 1.6, z + 1.8, y + 10, y + 11.5, 'pont_vitres', 3.2, 'pz px nx');
  const ang = (k % 4 === 1 ? 1 : -1) * 0.5;
  const a: V3 = [x + Math.sin(ang) * 1.4, y + 10, z + Math.cos(ang) * 1.4];
  const b: V3 = [x + Math.sin(ang) * 26, y + 22, z + Math.cos(ang) * 26];
  mb.beam('jaune', a, b, 1.1, 1.3);
  if (mb.lod < 2) { mb.tube('noir', b, [b[0], y + 6, b[2]], 0.05, 4, false); mb.box('jaune', b[0] - 0.4, y + 5, b[2] - 0.4, b[0] + 0.4, y + 6, b[2] + 0.4); }
}

const FE: HullSpec = { L: 152, B: 26, D: 10, T: 6.2, bow: 0.24, stern: 0.12, transom: 0.55, sheer: 1.8, rake: 6, top: 'blanc', bottom: 'antifouling', boot: 0.9, bulb: true, deck: 'gris_clair', band: { mat: 'livree', y0: 2.0, y1: 3.2 } };

function ferry(m: TModel): void {
  const mb = m.mb, lod = mb.lod, h = FE;
  hull(mb, h);
  const dk = h.D - h.T;
  // superstructure : ponts étagés en retrait progressif, avant arrondi
  const decks = 6, DH = 2.9;
  let y = dk;
  for (let k = 0; k < decks; k++) {
    const zb = -h.L / 2 + 10 + k * 2.5, zf = h.L / 2 - 30 - k * 1.8;
    const w = h.B / 2 - 0.4 - (k > 3 ? (k - 3) * 1.6 : 0);
    mb.box('blanc', -w, y, zb, w, y + DH, zf - 3);
    // avant arrondi (demi-cylindre aplati)
    mb.push().translate(0, y, zf - 3).scale(w, 1, 4);
    mb.lathe('blanc', [[1, 0], [1, DH]], lod === 0 ? 16 : 8, 60);
    mb.pop();
    if (lod < 2) {
      const reg: RegionName = k === decks - 2 ? 'pont_vitres' : 'hublots';
      band(mb, [w + 0.03, zf - 3], [w + 0.03, zb], y + 0.8, y + 2.1, reg, 10);
      band(mb, [-w - 0.03, zb], [-w - 0.03, zf - 3], y + 0.8, y + 2.1, reg, 10);
      if (k > 0 && k < 4) { railing(mb, [w + 0.4, y, zb], [w + 0.4, y, zf - 3]); railing(mb, [-w - 0.4, y, zf - 3], [-w - 0.4, y, zb]); }
    }
    y += DH;
  }
  // canots sur bossoirs (deux bords)
  for (const sx of [-1, 1] as const) for (let k = 0; k < 4; k++) lifeboat(mb, [sx * (h.B / 2 - 2.2), dk + DH * 2 + 0.3, -30 + k * 14], 9, sx);
  // cheminées jumelles inclinées
  for (const sx of [-1, 1]) { mb.push().translate(sx * 5, y, -h.L / 2 + 30).rotX(-0.12); funnel(mb, 0, 0, 0, 3.8, 8, 9, 'livree', sx > 0); mb.pop(); }
  mast(mb, 0, y, 18, 9);
  radar(mb, 0, y, 10);
  // porte arrière (rampe relevée)
  mb.box('gris', -6, 0.5, -h.L / 2 - 0.3, 6, dk - 0.2, -h.L / 2 + 0.1);
  if (lod < 2) mb.box('atlas', -6, 0.5, -h.L / 2 - 0.32, 6, 0.9, -h.L / 2 - 0.31, '', { nz: { region: 'hachures' } });
  hullDecals(mb, h, 'nom_ferry', h.L / 2 - 25, dk - 1.2, 1.7);
  if (lod < 2) for (const sx of [-1, 1]) { const z = h.L / 2 - 20; mb.quad('decal', [sx * (beamAt(h, z) + 0.06), 3.8, z + (sx > 0 ? 4 : -4)], [sx * (beamAt(h, z) + 0.06), 3.8, z + (sx > 0 ? -4 : 4)], [sx * (beamAt(h, z) + 0.06), 4.8, z + (sx > 0 ? -4 : 4)], [sx * (beamAt(h, z) + 0.06), 4.8, z + (sx > 0 ? 4 : -4)], { region: 'cheminee_logo' }); }
}

const RM: HullSpec = { L: 32, B: 12, D: 7.6, T: 5.2, bow: 0.4, stern: 0.25, transom: 0.7, sheer: 0.9, rake: 1.2, top: 'rouge', bottom: 'noir', boot: 1.3, bulb: false, deck: 'gris' };

function remorqueur(m: TModel): void {
  const mb = m.mb, lod = mb.lod, h = RM;
  hull(mb, h);
  const dk = h.D - h.T;
  // ceinture de défense (boudin caoutchouc) le long du livet
  const ns = lod === 0 ? 24 : 12;
  const ring: V3[] = [];
  for (let k = 0; k <= ns; k++) { const z = -h.L / 2 + 0.6 + (k / ns) * (h.L - 1.2); ring.push([beamAt(h, z) + 0.2, dk - 0.5, z]); }
  for (let k = ns; k >= 0; k--) { const p = ring[k]!; ring.push([-p[0], p[1], p[2]]); }
  for (let k = 0; k < ring.length - 1; k++) mb.tube('atlas', ring[k]!, ring[k + 1]!, 0.45, lod === 0 ? 6 : 4, false, 'defense');
  if (lod < 2) for (const dx of [-1.8, 0, 1.8]) mb.tube('atlas', [dx, dk - 1.5, h.L / 2 + 0.6], [dx, dk + 0.3, h.L / 2 + 0.6], 0.55, 8, true, 'noir');
  // pavois
  mb.box('rouge', -h.B / 2 + 0.6, dk, h.L / 2 - 8, h.B / 2 - 0.6, dk + 1.1, h.L / 2 - 3);
  // roof / timonerie surélevée
  mb.box('blanc', -4, dk, -2, 4, dk + 2.6, 7);
  if (lod < 2) bandsBox(mb, -4, -2, 4, 7, dk + 1, dk + 2, 'hublots', 4, 'px nx pz');
  mb.box('blanc', -3.2, dk + 2.6, 0, 3.2, dk + 5.2, 6);
  bandsBox(mb, -3.2, 0, 3.2, 6, dk + 3.3, dk + 4.9, 'pont_vitres', 3.2, 'pz px nx nz');
  mb.box('gris_clair', -3.6, dk + 5.2, -0.4, 3.6, dk + 5.5, 6.4);
  mast(mb, 0, dk + 5.5, 2, 6);
  // canons à eau (lance incendie)
  if (lod < 2) for (const sx of [-1, 1]) { mb.tube('rouge', [sx * 2.4, dk + 5.5, 4.5], [sx * 2.4, dk + 6.6, 4.5], 0.2, 6, true); mb.tube('rouge', [sx * 2.4, dk + 6.6, 4.5], [sx * 2.4, dk + 6.9, 6.2], 0.12, 6, true); }
  // cheminées et treuil de remorquage arrière
  for (const sx of [-1, 1]) mb.box('blanc', sx * 2.6 - 0.6, dk + 2.6, -1.8, sx * 2.6 + 0.6, dk + 6.2, -0.4);
  mb.tube('jaune', [-2, dk + 1.2, -8], [2, dk + 1.2, -8], 1.0, lod === 0 ? 12 : 6, true);
  mb.box('gris', -2.6, dk, -8.8, 2.6, dk + 0.6, -7.2);
  if (lod < 2) { mb.box('jaune', -0.5, dk, -13.2, 0.5, dk + 1.6, -12.4); railing(mb, [-h.B / 2 + 0.6, dk, -h.L / 2 + 1], [h.B / 2 - 0.6, dk, -h.L / 2 + 1]); }
  hullDecals(mb, h, 'nom_remorqueur', 6, 0.9, 0.9);
}

/* ------------------------------------------------------------------ */
/* Registre                                                             */
/* ------------------------------------------------------------------ */
const crane = (o: Partial<Record<MatKey, string>>, id: string, nameFr: string): NonNullable<TransportDef['variants']>[number] => ({ id, nameFr, overrides: o });
const ship = (draft: number): Partial<TransportDef> => ({ origin: 'flottaison', draftM: draft });

export const PORT_DEFS: TransportDef[] = [
  { id: 'port_quai_droit', nameFr: 'Quai — module droit (32 m)', group: 'port', category: 'prop', kind: 'quai', lodDistances: [220, 700], build: quaiDroit, origin: 'niveau', tags: ['module', 'niveau:quai_y0', 'ecartement_rails:20'] },
  { id: 'port_quai_angle', nameFr: 'Quai — module d’angle', group: 'port', category: 'prop', kind: 'quai', lodDistances: [220, 700], build: quaiAngle, origin: 'niveau', tags: ['module', 'niveau:quai_y0'] },
  { id: 'port_quai_rampe', nameFr: 'Quai — rampe ro-ro (ferries)', group: 'port', category: 'prop', kind: 'quai', lodDistances: [220, 700], build: quaiRampe, origin: 'niveau', tags: ['module', 'niveau:quai_y0', 'passagers'] },
  { id: 'port_grue_portique', nameFr: 'Portique à conteneurs', group: 'port', category: 'prop', kind: 'grue', lodDistances: [350, 1200], build: grueportique, tags: ['ecartement_rails:20'],
    variants: [crane({ bleu: '#d0622a' }, 'orange', 'Portique orange'), crane({ bleu: '#b8312a', blanc: '#e9e9e5' }, 'rouge', 'Portique rouge'), crane({ bleu: '#3e7a4f' }, 'vert', 'Portique vert')] },
  { id: 'port_grue_mobile', nameFr: 'Grue mobile portuaire', group: 'port', category: 'prop', kind: 'grue', lodDistances: [250, 900], build: grueMobile,
    variants: [crane({ orange: '#e0a321' }, 'jaune', 'Grue jaune'), crane({ orange: '#2a5b8c' }, 'bleu', 'Grue bleue')] },
  ctDef('port_conteneur_20', 'Conteneur 20 pieds (NORDA)', 6.058, false, 'ct_bleu', 'logo_a'),
  ctDef('port_conteneur_40', 'Conteneur 40 pieds (KALIX)', 12.192, false, 'ct_rouge', 'logo_b'),
  ctDef('port_conteneur_40hc', 'Conteneur 40 pieds high cube (MERIDO)', 12.192, true, 'ct_vert', 'logo_c'),
  ctDef('port_conteneur_frigo', 'Conteneur frigorifique 40 pieds (TAVRO)', 12.192, true, 'ct_blanc', 'logo_d', true),
  { id: 'port_pile_conteneurs', nameFr: 'Bloc de conteneurs empilés', group: 'port', category: 'prop', kind: 'conteneur', lodDistances: [200, 700], build: pileConteneurs, tags: ['stockage'] },
  { id: 'port_entrepot', nameFr: 'Entrepôt portuaire', group: 'port', category: 'industrial', kind: 'entrepot', lodDistances: [250, 900], build: entrepot,
    footprint: { tilesX: 7, tilesZ: 5 }, cost: 420000, upkeepPerMonth: 2600, capacity: { residents: 0, jobs: 45 },
    frontage: [{ x: 0, z: 20, nx: 0, nz: 1, kind: 'delivery' }, { x: 24, z: 20, nx: 0, nz: 1, kind: 'pedestrian' }],
    variants: [crane({ bardage: '#7f9db8' }, 'bleu', 'Bardage bleu acier'), crane({ bardage: '#c9b48f' }, 'sable', 'Bardage sable')] },
  { id: 'port_capitainerie', nameFr: 'Capitainerie', group: 'port', category: 'public', kind: 'capitainerie', lodDistances: [250, 900], build: capitainerie,
    footprint: { tilesX: 4, tilesZ: 2 }, cost: 380000, upkeepPerMonth: 2100, capacity: { residents: 0, jobs: 25 },
    frontage: [{ x: -4, z: 8, nx: 0, nz: 1, kind: 'pedestrian' }] },
  { id: 'port_gare_maritime', nameFr: 'Gare maritime', group: 'port', category: 'public', kind: 'terminal_passagers', lodDistances: [250, 900], build: gareMaritime,
    footprint: { tilesX: 7, tilesZ: 7 }, cost: 950000, upkeepPerMonth: 5200, capacity: { residents: 0, jobs: 80 },
    frontage: [{ x: 0, z: 25, nx: 0, nz: 1, kind: 'pedestrian' }, { x: 12, z: 25, nx: 0, nz: 1, kind: 'vehicle' }] },
  { id: 'port_porte_conteneurs', nameFr: 'Porte-conteneurs (190 m)', group: 'port', category: 'prop', kind: 'navire', lodDistances: [500, 1800], build: porteConteneurs, ...ship(9.5),
    variants: [crane({ bleu_nuit: '#7d2a24' }, 'rouge', 'Coque rouge'), crane({ bleu_nuit: '#2b2f33' }, 'noir', 'Coque noire')] },
  { id: 'port_vraquier', nameFr: 'Vraquier (180 m)', group: 'port', category: 'prop', kind: 'navire', lodDistances: [500, 1800], build: vraquier, ...ship(10.5),
    variants: [crane({ noir: '#2a4a6b' }, 'bleu', 'Coque bleue')] },
  { id: 'port_ferry', nameFr: 'Ferry à passagers (152 m)', group: 'port', category: 'prop', kind: 'navire', lodDistances: [500, 1800], build: ferry, ...ship(6.2), tags: ['passagers'],
    variants: [crane({ livree: '#1f7a6b' }, 'vert', 'Livrée verte'), crane({ livree: '#b02a2a' }, 'rouge', 'Livrée rouge')] },
  { id: 'port_remorqueur', nameFr: 'Remorqueur portuaire', group: 'port', category: 'prop', kind: 'navire', lodDistances: [250, 900], build: remorqueur, ...ship(5.2),
    variants: [crane({ rouge: '#1f4f8a' }, 'bleu', 'Coque bleue'), crane({ rouge: '#d9a426' }, 'jaune', 'Coque jaune')] },
];
