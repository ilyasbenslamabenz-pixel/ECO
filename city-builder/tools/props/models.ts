/**
 * Mobilier urbain européen GÉNÉRÉ par le projet (aucune source externe ; CC0) : abris, signalisation générique,
 * stationnement vélo, propreté, protection, services. Dimensions réelles usuelles (m), face avant vers +Z,
 * longueur principale selon X. Chaque fonction construit un LOD (`m.lod` = 0, 1, 2).
 */
import { chain, I, Model, Rx, Ry, Rz, shapes, T, type Skin, type V3 } from './geom';

export interface PropDef {
  id: string;
  nameFr: string;
  /** Coût de pose (crédits) ; 0 = décor non vendu. */
  cost: number;
  tags: string[];
  /** Distances d'affichage LOD0 -> LOD1, LOD1 -> LOD2 (m). */
  lodDistances: [number, number];
  build: (m: Model) => void;
}

const PROP: [number, number] = [35, 100];
const BIG: [number, number] = [50, 160];
const PI = Math.PI;

// ---------------------------------------------------------------------------
// Pièces communes
// ---------------------------------------------------------------------------
/** Poteau rond galvanisé (base en y = 0) avec bouchon. */
function pole(m: Model, h: number, r: number, tf = I, skin: Skin = 'acier'): void {
  m.cyl(r, h, m.seg(12), skin, tf);
  if (m.detail()) m.cyl(r * 1.25, 0.03, m.seg(12), skin, chain(tf, T(0, h - 0.01, 0)));
}

/** Panneau de signalisation : poteau Ø 60 mm, plaque centrée à `cy`, colliers de fixation. */
function sign(m: Model, poly: [number, number][], front: Skin, cy: number): void {
  pole(m, cy + 0.25, 0.03);
  m.plate(poly, 0.025, front, 'acier', T(0, cy, 0.045));
  if (m.detail()) for (const dy of [-0.18, 0.18]) m.box(0.1, 0.05, 0.05, 'acier', T(0, cy + dy - 0.025, 0.012));
  if (m.detail(0)) m.cyl(0.06, 0.02, m.seg(12), 'beton', I); // scellement
}

// ---------------------------------------------------------------------------
// Abris et arrêts
// ---------------------------------------------------------------------------
function abribus(m: Model): void {
  const W = 4.0, D = 1.5, H = 2.45;
  const zb = -D / 2 + 0.05, zf = 0.25;
  // poteaux (tubes carrés arrondis -> cylindres)
  for (const x of [-W / 2 + 0.06, W / 2 - 0.06]) for (const z of [zb, zf]) m.cyl(0.045, H, m.seg(12), 'anthracite', T(x, 0, z));
  if (m.detail()) m.cyl(0.045, H, m.seg(12), 'anthracite', T(0, 0, zb));
  // toiture : plaque + bandeau avant
  m.box(W + 0.2, 0.08, D + 0.1, 'anthracite', T(0, H, -0.05));
  m.box(W + 0.2, 0.18, 0.05, 'anthracite', T(0, H - 0.1, D / 2), { front: 'anthracite' });
  if (m.detail()) m.box(W + 0.1, 0.04, D, 'p:grisClair', T(0, H - 0.04, -0.05)); // sous-face
  // vitrages : fond et côté gauche (verre) ; côté droit : caisson d'affiche double face
  m.box(W - 0.15, 2.0, 0.02, 'p:grisClair', T(0, 0.2, zb), { mat: 'verre' });
  m.box(zf - zb - 0.08, 2.0, 0.02, 'p:grisClair', chain(T(-W / 2 + 0.06, 0.2, (zb + zf) / 2), Ry(PI / 2)), { mat: 'verre' });
  m.box(1.22, 1.82, 0.14, 'anthracite', chain(T(W / 2 - 0.06, 0.3, (zb + zf) / 2), Ry(PI / 2)), { front: 'affiche', back: 'affiche' });
  if (m.detail()) for (const y of [0.15, 2.2]) m.box(W - 0.15, 0.05, 0.05, 'anthracite', T(0, y, zb)); // lisses
  // banc
  m.box(1.7, 0.05, 0.36, 'bois', T(-0.6, 0.45, zb + 0.25));
  if (m.detail()) for (const x of [-1.35, 0.15]) m.box(0.05, 0.45, 0.3, 'anthracite', T(x, 0, zb + 0.22));
  // fiche horaire et plan
  m.box(0.7, 0.9, 0.04, 'anthracite', T(1.1, 0.95, zb + 0.04), { front: 'horaires' });
  // pictogramme d'arrêt en rive de toiture
  m.plate(shapes.rect(0.4, 0.4), 0.03, 'arret', 'anthracite', T(-W / 2 + 0.35, H + 0.3, D / 2 - 0.05));
  if (m.detail()) m.box(0.04, 0.12, 0.04, 'anthracite', T(-W / 2 + 0.35, H + 0.06, D / 2 - 0.05));
}

function totemArret(m: Model): void {
  pole(m, 2.95, 0.04, I, 'anthracite');
  m.plate(shapes.rect(0.45, 0.45), 0.03, 'arret', 'anthracite', T(0, 2.6, 0.06));
  if (m.detail()) m.plate(shapes.rect(0.45, 0.45), 0.03, 'arret', 'anthracite', chain(T(0, 2.6, -0.06), Ry(PI)));
  m.box(0.42, 0.62, 0.05, 'anthracite', T(0, 1.15, 0.07), { front: 'horaires' });
  if (m.detail()) m.cyl(0.1, 0.03, m.seg(12), 'anthracite');
}

function abriTram(m: Model): void {
  const W = 6.0, H = 2.75, zb = -0.85;
  // deux portiques (poteau + console) et toiture en porte-à-faux
  for (const x of [-1.9, 1.9]) {
    m.box(0.16, H, 0.16, 'anthracite', T(x, 0, zb));
    m.box(0.12, 0.2, 1.8, 'anthracite', T(x, H - 0.2, zb + 0.82));
  }
  m.box(W, 0.1, 2.0, 'anthracite', T(0, H, 0.05));
  m.box(W - 0.1, 0.06, 1.9, 'p:grisClair', T(0, H - 0.05, 0.05), { mat: 'verre' });
  m.box(W, 0.22, 0.05, 'anthracite', T(0, H - 0.12, 1.05));
  // paroi vitrée du fond en trois travées
  for (const x of [-1.95, 0, 1.95]) m.box(1.85, 2.1, 0.02, 'p:grisClair', T(x, 0.2, zb), { mat: 'verre' });
  if (m.detail()) for (const y of [0.15, 2.32]) m.box(W - 0.2, 0.05, 0.05, 'anthracite', T(0, y, zb));
  // banc long et appuis ischiatiques
  m.box(2.6, 0.05, 0.38, 'bois', T(0, 0.46, zb + 0.28));
  if (m.detail()) for (const x of [-1.1, 0, 1.1]) m.box(0.05, 0.46, 0.3, 'anthracite', T(x, 0, zb + 0.24));
  // distributeur de titres
  m.box(0.55, 1.6, 0.38, 'anthracite', T(-2.55, 0, zb + 0.35), { front: 'ecran' });
  // totem intégré : poteau + pictogramme + fiche horaire
  pole(m, 3.0, 0.04, T(2.75, 0, 0.75), 'anthracite');
  m.plate(shapes.rect(0.45, 0.45), 0.04, 'arret', 'anthracite', T(2.75, 3.0, 0.75));
  m.box(0.9, 1.1, 0.04, 'anthracite', T(1.0, 0.9, zb + 0.04), { front: 'horaires' });
}

// ---------------------------------------------------------------------------
// Signalisation verticale générique (convention de Vienne, sans marque)
// ---------------------------------------------------------------------------
const triSide = 0.9, triH = (triSide * Math.sqrt(3)) / 2;
function panneauDanger(m: Model): void {
  sign(m, [[-triSide / 2, -triH / 3], [triSide / 2, -triH / 3], [0, (2 * triH) / 3]], 'danger', 2.25);
}
function panneauSensInterdit(m: Model): void { sign(m, shapes.regular(m.seg(32), 0.35, PI / 2), 'sensInterdit', 2.2); }
function panneauStop(m: Model): void { sign(m, shapes.regular(8, 0.4 / Math.cos(PI / 8), PI / 8), 'stop', 2.2); }
function panneauPassagePieton(m: Model): void { sign(m, shapes.rect(0.7, 0.7), 'passagePieton', 2.25); }

// ---------------------------------------------------------------------------
// Vélos
// ---------------------------------------------------------------------------
/** Arceau « Sheffield » (U renversé) dans le plan YZ, centré en x. */
function arceau(m: Model, x: number): void {
  const L = 0.8, Hh = 0.75, rc = 0.16, n = m.seg(8);
  const pts: V3[] = [[-L / 2, -0.02, 0], ...Model.arc(-L / 2 + rc, Hh - rc, rc, PI, PI / 2, n), ...Model.arc(L / 2 - rc, Hh - rc, rc, PI / 2, 0, n), [L / 2, -0.02, 0]];
  m.tube(pts, 0.024, m.seg(10), 'acier', chain(T(x, 0, 0), Ry(PI / 2)), { caps: true });
  if (m.detail(0)) for (const z of [-L / 2, L / 2]) m.cyl(0.05, 0.015, m.seg(10), 'acier', T(x, 0, z));
}
function arceauxVelo(m: Model): void { for (const x of [-0.9, 0, 0.9]) arceau(m, x); }

function velo(m: Model): void {
  const R = 0.335, rear: V3 = [-0.52, R, 0], front: V3 = [0.53, R, 0];
  const bb: V3 = [0, 0.3, 0], seat: V3 = [-0.14, 0.86, 0], headTop: V3 = [0.4, 0.9, 0], headBot: V3 = [0.44, 0.74, 0];
  const frame: Skin = 'p:bleu';
  const n = m.seg(8);
  for (const c of [rear, front]) {
    m.tube(Model.arc(0, 0, R - 0.017, 0, 2 * PI, m.seg(32)).slice(0, -1), 0.019, m.seg(8), 'noir', T(c[0], c[1], 0), { closed: true });
    if (m.detail()) m.tube(Model.arc(0, 0, R - 0.045, 0, 2 * PI, m.seg(32)).slice(0, -1), 0.008, 4, 'acier', T(c[0], c[1], 0), { closed: true });
    if (m.detail(0)) for (let k = 0; k < 8; k++) m.box(0.006, R - 0.06, 0.006, 'acier', chain(T(c[0], c[1], 0), Rz((k * PI) / 4), T(0, 0.02, 0)));
    m.cyl(0.03, 0.1, n, 'acier', chain(T(c[0], c[1], 0), Rx(PI / 2), T(0, -0.05, 0)));
  }
  const t = (a: V3, b: V3, r = 0.017, z = 0): void => m.tube([[a[0], a[1], a[2] + z], [b[0], b[1], b[2] + z]], r, n, frame);
  t(bb, seat); t(seat, headTop); t(bb, headBot, 0.02); t(headBot, headTop, 0.022);
  for (const z of [-0.055, 0.055]) { t(bb, rear, 0.011, z); t([seat[0] + 0.02, seat[1] - 0.05, 0], rear, 0.01, z); t(headBot, front, 0.012, z * 0.8); }
  // tige de selle, selle, potence, cintre
  m.tube([seat, [seat[0] - 0.03, seat[1] + 0.1, 0]], 0.012, n, 'acier');
  m.box(0.24, 0.05, 0.13, 'noir', T(seat[0] - 0.04, seat[1] + 0.1, 0));
  m.tube([headTop, [0.38, 1.0, 0]], 0.014, n, 'acier');
  m.tube([[0.34, 1.0, -0.28], [0.38, 1.0, -0.2], [0.38, 1.0, 0.2], [0.34, 1.0, 0.28]], 0.012, n, 'acier');
  if (m.detail()) for (const z of [-0.26, 0.26]) m.cyl(0.018, 0.1, n, 'noir', chain(T(0.345, 1.0, z), Rx(PI / 2), T(0, -0.05, 0)));
  // pédalier, garde-boue, béquille
  if (m.detail()) {
    m.cyl(0.09, 0.012, m.seg(16), 'acier', chain(T(bb[0], bb[1], 0.07), Rx(PI / 2)));
    for (const s of [1, -1]) m.box(0.1, 0.02, 0.03, 'noir', T(s * 0.16, bb[1] - s * 0.1 - 0.01, s * 0.12));
    for (const c of [rear, front]) m.tube(Model.arc(c[0], c[1], R + 0.03, c === rear ? 0.2 : 0.4, c === rear ? 2.2 : 2.6, m.seg(12)), 0.025, 4, frame);
  }
  m.tube([[-0.2, 0.3, -0.06], [-0.26, 0.0, -0.16]], 0.008, 4, 'acier');
}

// ---------------------------------------------------------------------------
// Assises, propreté, protection, végétal
// ---------------------------------------------------------------------------
function bancBeton(m: Model): void {
  m.box(2.0, 0.38, 0.5, 'beton');
  if (m.lod < 2) {
    const n = m.lod === 0 ? 5 : 2;
    for (let i = 0; i < n; i++) m.box(1.96, 0.05, 0.46 / n - 0.012, 'bois', T(0, 0.38, -0.23 + (i + 0.5) * (0.46 / n)));
  } else m.box(1.96, 0.05, 0.46, 'bois', T(0, 0.38, 0));
  if (m.detail(0)) for (const x of [-0.9, 0.9]) m.box(0.06, 0.06, 0.48, 'acier', T(x, 0.37, 0));
}

function poubellesTri(m: Model): void {
  const n = m.seg(20);
  const cols: Skin[] = ['p:jaune', 'p:vertTri', 'p:bleu'];
  m.box(1.56, 0.04, 0.5, 'anthracite'); // socle
  cols.forEach((c, i) => {
    const x = (i - 1) * 0.5;
    m.lathe([[0.2, 0.04], [0.22, 0.9], [0.225, 0.92]], n, c, T(x, 0, 0), { capTop: false });
    m.lathe([[0.235, 0.9], [0.235, 0.96], [0.12, 1.02], [0.0, 1.03]], n, c, T(x, 0, 0)); // couvercle
    m.box(0.16, 0.035, 0.08, 'noir', T(x, 0.985, 0.12)); // ouverture
    if (m.detail()) m.box(0.12, 0.12, 0.01, 'p:blanc', T(x, 0.62, 0.218)); // étiquette de tri
  });
  for (const z of [-0.23, 0.23]) m.tube([[-0.78, 0.04, z], [-0.78, 0.8, z], [0.78, 0.8, z], [0.78, 0.04, z]], 0.02, m.seg(8), 'anthracite');
}

function potelet(m: Model): void {
  const n = m.seg(16);
  m.lathe([[0.07, 0], [0.075, 0.04], [0.06, 0.1], [0.05, 0.16], [0.048, 0.86], [0.058, 0.88], [0.058, 0.92], [0.035, 0.95], [0.03, 0.98]], n, 'anthracite');
  m.sphere(0.04, n, 'anthracite', T(0, 1.0, 0));
  m.cyl(0.052, 0.06, n, 'p:blanc', T(0, 0.72, 0), { capTop: false }); // bande réfléchissante
}

function barriereVauban(m: Model): void {
  const W = 2.2, H = 1.1, n = m.seg(8);
  m.tube([[-W / 2, 0.12, 0], [-W / 2, H, 0], [W / 2, H, 0], [W / 2, 0.12, 0]], 0.02, n, 'acier', I, { caps: true });
  m.tube([[-W / 2, 0.22, 0], [W / 2, 0.22, 0]], 0.015, n, 'acier');
  const bars = m.lod === 0 ? 16 : m.lod === 1 ? 8 : 4;
  for (let i = 1; i <= bars; i++) {
    const x = -W / 2 + (i * W) / (bars + 1);
    if (m.lod === 2) m.box(0.025, H - 0.22, 0.025, 'acier', T(x, 0.22, 0));
    else m.cyl(0.009, H - 0.22, m.seg(6), 'acier', T(x, 0.22, 0), { capTop: false });
  }
  for (const x of [-W / 2, W / 2]) m.box(0.05, 0.04, 0.62, 'acier', T(x, 0, 0)); // pieds plats
  if (m.detail()) for (const x of [-W / 2 - 0.03, W / 2 + 0.03]) m.box(0.04, 0.08, 0.03, 'acier', T(x, H - 0.25, 0)); // crochets
}

function jardiniereBeton(m: Model): void {
  const sq = Ry(PI / 4); // tour à 4 côtés tourné de 45° = jardinière carrée
  const k = Math.SQRT2;
  m.lathe([[0.55 * k, 0], [0.6 * k, 0.04], [0.6 * k, 0.58], [0.6 * k, 0.6], [0.52 * k, 0.6], [0.52 * k, 0.52]], 4, 'beton', sq, { capTop: false });
  m.cyl(0.52 * k, 0.5, 4, 'p:terre', sq);
  // arbuste taillé : touffes irrégulières (sphères aplaties de tailles et teintes variées)
  m.sphere(0.42, m.seg(14), 'p:feuillage', T(0, 0.88, 0), { squashY: 0.9 });
  const tufts: [number, number, number, number, Skin][] = [[0.3, 0.86, 0.2, 0.28, 'p:feuillageClair'], [-0.28, 0.82, -0.18, 0.27, 'p:feuillageClair'],
    [0.22, 0.8, -0.3, 0.25, 'p:feuillage'], [-0.25, 0.85, 0.27, 0.26, 'p:feuillage'], [0.05, 1.14, 0.05, 0.24, 'p:feuillageClair'], [0.38, 0.7, -0.05, 0.2, 'p:vertTri']];
  const k2 = m.lod === 0 ? tufts.length : m.lod === 1 ? 3 : 0;
  for (const [x, y, z, r, c] of tufts.slice(0, k2)) m.sphere(r, m.seg(10), c, T(x, y, z), { squashY: 0.85 });
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------
function fontaineEau(m: Model): void {
  const n = m.seg(16);
  m.lathe([[0.2, 0], [0.2, 0.06], [0.14, 0.12], [0.11, 0.2], [0.09, 0.75], [0.12, 0.8]], n, 'vert', I, { capTop: false });
  // vasque
  m.lathe([[0.12, 0.8], [0.22, 0.86], [0.27, 0.93], [0.25, 0.94], [0.2, 0.88], [0.0, 0.86]], n, 'vert', I, { capTop: false });
  m.lathe([[0.07, 0.86], [0.06, 1.05], [0.075, 1.08], [0.05, 1.12], [0.0, 1.13]], n, 'vert');
  m.tube([[0, 1.0, 0.05], [0, 1.02, 0.14], [0, 0.98, 0.18]], 0.012, m.seg(8), 'acier', I, { caps: true }); // bec
  if (m.detail()) m.cyl(0.025, 0.02, m.seg(8), 'acier', chain(T(0.07, 1.0, 0), Rz(-PI / 2))); // bouton-poussoir
}

function colonneMorris(m: Model): void {
  const n = m.seg(24);
  m.lathe([[0.72, 0], [0.72, 0.18], [0.66, 0.24], [0.62, 0.3]], n, 'vert', I, { capTop: false });
  m.cyl(0.61, 2.4, n, 'affichesMorris', T(0, 0.3, 0), { capTop: false });
  m.lathe([[0.62, 2.7], [0.7, 2.76], [0.7, 2.86], [0.64, 2.9]], n, 'vert', I, { capTop: false });
  m.sphere(0.64, n, 'vert', T(0, 2.9, 0), { phiMax: PI, squashY: 0.55 });
  m.lathe([[0.1, 3.22], [0.06, 3.35], [0.08, 3.42], [0.02, 3.55], [0, 3.58]], m.seg(10), 'vert');
  if (m.detail()) m.lathe([[0.615, 1.5], [0.64, 1.52], [0.64, 1.56], [0.615, 1.58]], n, 'vert', I, { capTop: false }); // jonc
}

function kiosque(m: Model): void {
  const W = 2.4, D = 1.8, H = 2.3;
  // parois : fond, côtés (affiches), avant : allège + montants ; intérieur sombre
  m.box(W, H, 0.08, 'vert', T(0, 0, -D / 2 + 0.04));
  for (const s of [-1, 1]) m.box(D, H, 0.08, 'vert', chain(T(s * (W / 2 - 0.04), 0, 0), Ry(PI / 2)), { front: s > 0 ? 'affiche' : 'vert', back: s > 0 ? 'vert' : 'affiche' });
  m.box(W - 0.16, 0.95, 0.1, 'vert', T(0, 0, D / 2 - 0.05)); // allège
  m.box(W - 0.1, 0.06, 0.45, 'vert', T(0, 0.95, D / 2 - 0.05)); // comptoir
  m.box(W - 0.16, H - 0.1, 0.02, 'noir', T(0, 0.05, -D / 2 + 0.1)); // fond intérieur
  for (const x of [-W / 2 + 0.08, W / 2 - 0.08]) m.box(0.1, H, 0.1, 'vert', T(x, 0, D / 2 - 0.05));
  m.box(W, 0.35, 0.1, 'vert', T(0, H - 0.35, D / 2 - 0.05), { front: 'affichesMorris' }); // fronton
  // présentoir de journaux incliné (aplats colorés)
  const cols: Skin[] = ['p:rouge', 'p:blanc', 'p:jaune', 'p:bleuCiel', 'p:rose', 'p:blanc', 'p:orange', 'p:vertVif'];
  const per = m.lod === 0 ? 8 : m.lod === 1 ? 4 : 0;
  for (let i = 0; i < per; i++) {
    const r = Math.floor(i / 4), c = i % 4;
    m.box(0.4, 0.42, 0.015, cols[i]!, chain(T(-0.75 + c * 0.5, 1.05 + r * 0.46, -0.25 - r * 0.12), Rx(-0.2)));
  }
  // toiture : débord + pavillon à 4 pans + épi
  m.box(W + 0.4, 0.12, D + 0.4, 'vert', T(0, H, 0));
  m.lathe([[(W / 2 + 0.25) * Math.SQRT2, H + 0.12], [0.15, H + 0.62]], 4, 'vert', Ry(PI / 4));
  if (m.detail()) m.lathe([[0.06, H + 0.6], [0.03, H + 0.8], [0, H + 0.85]], m.seg(8), 'vert');
}

function borneRecharge(m: Model): void {
  m.box(0.5, 0.08, 0.3, 'anthracite'); // socle
  m.box(0.42, 1.35, 0.24, 'p:blanc', T(0, 0.08, 0), { front: 'p:blanc' });
  m.box(0.34, 0.5, 0.02, 'anthracite', T(0, 0.85, 0.12), { front: 'ecran' });
  m.box(0.44, 0.05, 0.26, 'anthracite', T(0, 1.43, 0)); // chapeau
  m.box(0.42, 0.03, 0.005, 'p:vertVif', T(0, 1.36, 0.121)); // bandeau lumineux
  for (const x of [-0.11, 0.11]) m.cyl(0.04, 0.03, m.seg(12), 'noir', chain(T(x, 0.65, 0.12), Rx(PI / 2)));
  // câble enroulé sur le flanc + support
  m.box(0.04, 0.12, 0.1, 'anthracite', T(0.23, 1.0, 0));
  if (m.lod < 2) m.tube([[0.25, 1.05, 0], [0.27, 0.6, 0.02], [0.3, 0.35, 0.06], [0.28, 0.7, 0.1], [0.25, 1.0, 0.04]], 0.015, m.seg(8), 'noir');
}

function horodateur(m: Model): void {
  m.box(0.22, 0.85, 0.2, 'anthracite'); // fût
  m.box(0.34, 0.72, 0.28, 'anthracite', T(0, 0.85, 0), { front: 'ecran' });
  m.box(0.38, 0.06, 0.32, 'anthracite', T(0, 1.57, 0)); // casquette
  m.box(0.2, 0.2, 0.02, 'p:bleu', T(0, 1.63, 0)); // plaque d'information
  if (m.detail()) {
    m.box(0.36, 0.06, 0.3, 'anthracite', T(0, 0.82, 0)); // bague
    m.box(0.06, 0.12, 0.02, 'p:gris', T(0.1, 1.05, 0.145)); // lecteur de carte
    m.cyl(0.12, 0.02, m.seg(12), 'beton');
  }
}

export const PROPS: PropDef[] = [
  { id: 'abribus', nameFr: 'Abribus vitré', cost: 600, tags: ['transport', 'bus', 'arrêt', 'trottoir'], lodDistances: BIG, build: abribus },
  { id: 'abri_tram', nameFr: 'Abri de station de tram', cost: 1200, tags: ['transport', 'tram', 'arrêt', 'quai'], lodDistances: BIG, build: abriTram },
  { id: 'totem_arret', nameFr: 'Poteau d’arrêt (bus/tram)', cost: 120, tags: ['transport', 'arrêt', 'trottoir'], lodDistances: PROP, build: totemArret },
  { id: 'panneau_danger', nameFr: 'Panneau « autres dangers »', cost: 60, tags: ['signalisation', 'voirie'], lodDistances: PROP, build: panneauDanger },
  { id: 'panneau_sens_interdit', nameFr: 'Panneau « sens interdit »', cost: 60, tags: ['signalisation', 'voirie'], lodDistances: PROP, build: panneauSensInterdit },
  { id: 'panneau_stop', nameFr: 'Panneau STOP', cost: 60, tags: ['signalisation', 'voirie', 'carrefour'], lodDistances: PROP, build: panneauStop },
  { id: 'panneau_passage_pieton', nameFr: 'Panneau « passage pour piétons »', cost: 60, tags: ['signalisation', 'voirie', 'piétons'], lodDistances: PROP, build: panneauPassagePieton },
  { id: 'arceaux_velo', nameFr: 'Arceaux de stationnement vélo (×3)', cost: 90, tags: ['vélo', 'stationnement', 'trottoir'], lodDistances: PROP, build: arceauxVelo },
  { id: 'velo', nameFr: 'Vélo de ville stationné', cost: 0, tags: ['vélo', 'décor'], lodDistances: PROP, build: velo },
  { id: 'banc_beton', nameFr: 'Banc bloc béton à assise bois', cost: 70, tags: ['assise', 'place', 'parc'], lodDistances: PROP, build: bancBeton },
  { id: 'poubelles_tri', nameFr: 'Corbeilles de tri sélectif (×3)', cost: 90, tags: ['propreté', 'tri', 'trottoir'], lodDistances: PROP, build: poubellesTri },
  { id: 'potelet', nameFr: 'Potelet anti-stationnement', cost: 15, tags: ['protection', 'trottoir', 'carrefour'], lodDistances: [30, 80], build: potelet },
  { id: 'barriere_vauban', nameFr: 'Barrière de police (type Vauban)', cost: 25, tags: ['protection', 'chantier', 'événement'], lodDistances: PROP, build: barriereVauban },
  { id: 'jardiniere_beton', nameFr: 'Jardinière béton plantée', cost: 80, tags: ['jardinière', 'végétal', 'place', 'protection'], lodDistances: PROP, build: jardiniereBeton },
  { id: 'fontaine_eau', nameFr: 'Fontaine à boire', cost: 150, tags: ['eau', 'parc', 'place'], lodDistances: PROP, build: fontaineEau },
  { id: 'colonne_morris', nameFr: 'Colonne d’affichage (colonne Morris)', cost: 300, tags: ['affichage', 'place', 'centre'], lodDistances: BIG, build: colonneMorris },
  { id: 'kiosque_journaux', nameFr: 'Kiosque à journaux', cost: 800, tags: ['commerce', 'place', 'centre'], lodDistances: BIG, build: kiosque },
  { id: 'borne_recharge', nameFr: 'Borne de recharge pour véhicules électriques', cost: 400, tags: ['énergie', 'stationnement', 'trottoir'], lodDistances: PROP, build: borneRecharge },
  { id: 'horodateur', nameFr: 'Horodateur de stationnement', cost: 200, tags: ['stationnement', 'trottoir'], lodDistances: PROP, build: horodateur },
];
