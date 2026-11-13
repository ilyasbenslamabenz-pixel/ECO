/**
 * Atlas de textures PARTAGÉ par tout le mobilier urbain généré (tools/props) : une seule image albedo,
 * une normale et une carte rugosité/métal, rastérisées ici depuis des dessins vectoriels (SVG -> sharp)
 * + bruit déterministe. Aucune source externe : œuvre originale du projet (CC0).
 *
 * Grille 4 × 4 cellules (128 px au LOD0 ; atlas 512 px, 256 px au LOD1, 128 px au LOD2).
 * Les panneaux de signalisation sont des pictogrammes GÉNÉRIQUES (convention de Vienne), sans marque ni texte
 * autre que « STOP » (tracé à la main, sans police).
 */
import sharp from 'sharp';

export const ATLAS_SIZE = 512;
export const GRID = 4;
const C = ATLAS_SIZE / GRID; // 128 px

/** Cellules de l'atlas (index = ligne * 4 + colonne). */
export const CELLS = {
  anthracite: 0, // peinture gris anthracite (RAL 7016), mobilier métallique
  vert: 1, // vert sapin (colonne, kiosque, fontaine)
  acier: 2, // acier galvanisé / inox brossé
  bois: 3, // lattes de bois
  beton: 4, // béton
  noir: 5, // caoutchouc, plastique noir
  palette: 6, // 16 aplats de couleur (petites pièces)
  affiche: 7, // affiche abstraite (sans texte ni marque)
  danger: 8, // panneau triangulaire « autres dangers »
  sensInterdit: 9, // panneau « sens interdit »
  stop: 10, // panneau octogonal STOP
  passagePieton: 11, // panneau carré bleu « passage pour piétons »
  horaires: 12, // plan / fiche horaire (lignes grises)
  ecran: 13, // façade de borne : écran, voyant, clavier
  affichesMorris: 14, // bandeau d'affiches de colonne
  arret: 15, // panneau carré bleu pictogramme tram/bus (générique)
} as const;
export type CellName = keyof typeof CELLS;

/** Aplats de la cellule « palette » (4 × 4 sous-cellules de 32 px). */
export const PALETTE = {
  rouge: 0, jaune: 1, bleu: 2, blanc: 3,
  vertTri: 4, orange: 5, brun: 6, grisClair: 7,
  bleuCiel: 8, vertVif: 9, rose: 10, terre: 11,
  feuillage: 12, feuillageClair: 13, gris: 14, ecran: 15,
} as const;
export type PaletteName = keyof typeof PALETTE;
const PALETTE_HEX = ['#b3261e', '#e9b824', '#1f5fa8', '#ecebe6', '#2f7d3a', '#d9682b', '#6b4a2f', '#b9bcbf',
  '#5aa7d6', '#4fae3c', '#c9577f', '#4a3626', '#3d6b2a', '#5e8c3a', '#7d8185', '#123b44'];

/** Rugosité (0-1) et métal (0-1) par cellule. */
const MR: Record<CellName, [number, number]> = {
  anthracite: [0.45, 0.6], vert: [0.5, 0.45], acier: [0.35, 0.9], bois: [0.75, 0], beton: [0.9, 0], noir: [0.8, 0],
  palette: [0.55, 0.1], affiche: [0.35, 0], danger: [0.3, 0.2], sensInterdit: [0.3, 0.2], stop: [0.3, 0.2],
  passagePieton: [0.3, 0.2], horaires: [0.3, 0], ecran: [0.25, 0.3], affichesMorris: [0.5, 0], arret: [0.3, 0.2],
};

/** Rectangle UV (u0, v0, u1, v1) d'une cellule, rentré de `inset` px (anti-débordement des mipmaps). */
export function cellRect(cell: CellName, inset = 3): [number, number, number, number] {
  const i = CELLS[cell];
  const x = (i % GRID) * C, y = Math.floor(i / GRID) * C;
  return [(x + inset) / ATLAS_SIZE, (y + inset) / ATLAS_SIZE, (x + C - inset) / ATLAS_SIZE, (y + C - inset) / ATLAS_SIZE];
}

/** Petit rectangle UV d'un aplat de la palette. */
export function paletteRect(p: PaletteName): [number, number, number, number] {
  const i = PALETTE[p];
  const [u0, v0] = cellRect('palette', 0);
  const s = C / 4 / ATLAS_SIZE;
  const u = u0 + (i % 4) * s, v = v0 + Math.floor(i / 4) * s;
  const k = 6 / ATLAS_SIZE;
  return [u + k, v + k, u + s - k, v + s - k];
}

// ---------------------------------------------------------------------------
// Dessins (SVG 128 × 128 par cellule)
// ---------------------------------------------------------------------------
const flat = (hex: string): string => `<rect width="128" height="128" fill="${hex}"/>`;
const stopLetters = (stroke: string, w: number): string => {
  // « STOP » tracé en lignes (aucune police) — lettres de 26 px de haut centrées.
  const y0 = 51, y1 = 77;
  const S = `M44 ${y0 + 3} Q40 ${y0} 34 ${y0} Q28 ${y0} 28 ${y0 + 6} Q28 ${y0 + 12} 36 ${y0 + 13} Q44 ${y0 + 14} 44 ${y0 + 20} Q44 ${y1} 36 ${y1} Q30 ${y1} 27 ${y1 - 3}`;
  const T = `M49 ${y0} L67 ${y0} M58 ${y0} L58 ${y1}`;
  const O = `M80 ${y0} Q71 ${y0} 71 ${(y0 + y1) / 2} Q71 ${y1} 80 ${y1} Q89 ${y1} 89 ${(y0 + y1) / 2} Q89 ${y0} 80 ${y0} Z`;
  const P = `M95 ${y1} L95 ${y0} L102 ${y0} Q108 ${y0} 108 ${y0 + 7} Q108 ${y0 + 14} 102 ${y0 + 14} L95 ${y0 + 14}`;
  return `<path d="${S} ${T} ${O} ${P}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
};
const octagon = (r: number): string => {
  const pts: string[] = [];
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i * Math.PI) / 4;
    pts.push(`${(64 + r * Math.cos(a)).toFixed(2)},${(64 + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
};

function albedoCell(name: CellName): string {
  switch (name) {
    case 'anthracite': return flat('#3b3f44');
    case 'vert': return flat('#24473a');
    case 'acier': return `${flat('#a7abae')}${Array.from({ length: 32 }, (_, i) => `<rect y="${i * 4}" width="128" height="1" fill="#${i % 3 ? 'b4b7ba' : '9a9ea2'}"/>`).join('')}`;
    case 'bois': return `${flat('#9a6a3f')}${Array.from({ length: 8 }, (_, i) => `<rect y="${i * 16}" width="128" height="15" fill="${['#a3713f', '#8f6038', '#9c6c3c', '#a8784a'][i % 4]}"/><rect y="${i * 16 + 15}" width="128" height="1" fill="#4e3420"/>`).join('')}`;
    case 'beton': return flat('#a19d95');
    case 'noir': return flat('#26282a');
    case 'palette': return PALETTE_HEX.map((h, i) => `<rect x="${(i % 4) * 32}" y="${Math.floor(i / 4) * 32}" width="32" height="32" fill="${h}"/>`).join('');
    case 'affiche': return `${flat('#f1e6cf')}<rect x="10" y="10" width="108" height="108" fill="#e07a3f"/><circle cx="74" cy="52" r="30" fill="#f5d04c"/><rect x="10" y="78" width="108" height="40" fill="#264e70"/><rect x="22" y="90" width="62" height="7" fill="#f1e6cf"/><rect x="22" y="102" width="40" height="5" fill="#f1e6cf"/><path d="M10 78 L44 40 L70 78 Z" fill="#7c2f2a"/>`;
    case 'danger': return `${flat('#a7abae')}<path d="M64 1 L127 127 L1 127 Z" fill="#c8102e"/><path d="M64 30 L108 116 L20 116 Z" fill="#f4f4f0"/><rect x="59" y="58" width="10" height="32" rx="4" fill="#111"/><circle cx="64" cy="102" r="5.5" fill="#111"/>`;
    case 'sensInterdit': return `${flat('#a7abae')}<circle cx="64" cy="64" r="62" fill="#c8102e"/><rect x="22" y="54" width="84" height="20" fill="#f4f4f0"/>`;
    case 'stop': return `${flat('#a7abae')}<polygon points="${octagon(67)}" fill="#f4f4f0"/><polygon points="${octagon(60)}" fill="#c8102e"/>${stopLetters('#f4f4f0', 6)}`;
    case 'passagePieton': return `${flat('#1f5fa8')}<rect x="3" y="3" width="122" height="122" fill="none" stroke="#f4f4f0" stroke-width="3"/><path d="M64 16 L112 108 L16 108 Z" fill="#f4f4f0"/><circle cx="66" cy="45" r="7" fill="#111"/><path d="M64 54 L58 76 L48 96 M58 76 L70 96 M64 58 L76 70 M62 58 L50 70" fill="none" stroke="#111" stroke-width="6" stroke-linecap="round"/><rect x="30" y="99" width="68" height="5" fill="#111"/>`;
    case 'horaires': return `${flat('#f4f4f2')}<rect width="128" height="20" fill="#1f5fa8"/>${Array.from({ length: 12 }, (_, i) => `<rect x="10" y="${28 + i * 8}" width="${50 + ((i * 37) % 50)}" height="3" fill="#7a7f86"/>`).join('')}<rect x="88" y="28" width="30" height="90" fill="#dfe3e8"/>`;
    case 'ecran': return `${flat('#2b2e31')}<rect x="20" y="12" width="88" height="44" rx="4" fill="#0f3540"/><rect x="26" y="18" width="50" height="5" fill="#5fd0c0"/><rect x="26" y="28" width="34" height="4" fill="#3e9c92"/><circle cx="64" cy="76" r="9" fill="#3ad16a"/>${Array.from({ length: 9 }, (_, i) => `<rect x="${40 + (i % 3) * 18}" y="${90 + Math.floor(i / 3) * 11}" width="12" height="7" rx="2" fill="#8d9296"/>`).join('')}`;
    case 'affichesMorris': return ['#d24b3e', '#2f6fa3', '#e7c14a', '#3c8a5a', '#f0ece2', '#7b4b8e', '#e98a3c', '#1d3557'].map((h, i) => `<rect x="${i * 16}" y="0" width="16" height="128" fill="${h}"/><rect x="${i * 16 + 3}" y="${18 + (i * 23) % 50}" width="10" height="${20 + (i * 13) % 30}" fill="${i % 2 ? '#f0ece2' : '#222'}" opacity="0.7"/><rect x="${i * 16}" y="0" width="1" height="128" fill="#555"/>`).join('');
    case 'arret': return `${flat('#1f5fa8')}<rect x="3" y="3" width="122" height="122" rx="10" fill="none" stroke="#f4f4f0" stroke-width="3"/><rect x="30" y="36" width="68" height="58" rx="12" fill="#f4f4f0"/><rect x="38" y="46" width="22" height="18" rx="3" fill="#1f5fa8"/><rect x="68" y="46" width="22" height="18" rx="3" fill="#1f5fa8"/><circle cx="44" cy="102" r="6" fill="#f4f4f0"/><circle cx="84" cy="102" r="6" fill="#f4f4f0"/><path d="M52 36 L64 22 L76 36 M50 22 L78 22" fill="none" stroke="#f4f4f0" stroke-width="4"/>`;
  }
}

/** Relief (gris : 128 = plan) pour la normale. */
function heightCell(name: CellName): string {
  const base = flat('#808080');
  switch (name) {
    case 'bois': return `${base}${Array.from({ length: 8 }, (_, i) => `<rect y="${i * 16 + 14}" width="128" height="3" fill="#404040"/>`).join('')}`;
    case 'acier': return `${base}${Array.from({ length: 32 }, (_, i) => `<rect y="${i * 4}" width="128" height="1" fill="#8c8c8c"/>`).join('')}`;
    case 'danger': return `${base}<path d="M64 1 L127 127 L1 127 Z" fill="#a0a0a0"/><path d="M64 30 L108 116 L20 116 Z" fill="#909090"/>`;
    case 'sensInterdit': return `${base}<circle cx="64" cy="64" r="62" fill="#a0a0a0"/><rect x="22" y="54" width="84" height="20" fill="#909090"/>`;
    case 'stop': return `${base}<polygon points="${octagon(67)}" fill="#a0a0a0"/><polygon points="${octagon(60)}" fill="#909090"/>`;
    case 'passagePieton': case 'arret': return `${base}<rect x="3" y="3" width="122" height="122" fill="none" stroke="#a8a8a8" stroke-width="4"/>`;
    case 'ecran': return `${base}<rect x="20" y="12" width="88" height="44" rx="4" fill="#606060"/>${Array.from({ length: 9 }, (_, i) => `<rect x="${40 + (i % 3) * 18}" y="${90 + Math.floor(i / 3) * 11}" width="12" height="7" rx="2" fill="#b0b0b0"/>`).join('')}`;
    case 'affichesMorris': return `${base}${Array.from({ length: 8 }, (_, i) => `<rect x="${i * 16}" y="0" width="1" height="128" fill="#606060"/>`).join('')}`;
    case 'palette': return `${base}${Array.from({ length: 16 }, (_, i) => `<rect x="${(i % 4) * 32}" y="${Math.floor(i / 4) * 32}" width="32" height="32" fill="none" stroke="#707070" stroke-width="1"/>`).join('')}`;
    default: return base;
  }
}

/** Amplitude du bruit (albedo ±, relief ±) par cellule. */
const NOISE: Record<CellName, [number, number]> = {
  anthracite: [6, 6], vert: [6, 6], acier: [5, 4], bois: [10, 10], beton: [16, 24], noir: [4, 8], palette: [3, 2],
  affiche: [5, 3], danger: [3, 2], sensInterdit: [3, 2], stop: [3, 2], passagePieton: [3, 2], horaires: [2, 1], ecran: [3, 2],
  affichesMorris: [8, 6], arret: [3, 2],
};

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const names = Object.keys(CELLS) as CellName[];
async function rasterize(cell: (n: CellName) => string, channels: 3 | 1): Promise<Buffer> {
  const parts = names.map((n) => `<g transform="translate(${(CELLS[n] % GRID) * C} ${Math.floor(CELLS[n] / GRID) * C})"><svg width="128" height="128" viewBox="0 0 128 128">${cell(n)}</svg></g>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ATLAS_SIZE}" height="${ATLAS_SIZE}">${parts}</svg>`;
  const img = sharp(Buffer.from(svg)).removeAlpha();
  return (channels === 1 ? img.greyscale().toColourspace('b-w') : img).raw().toBuffer();
}

const cellAt = (x: number, y: number): CellName => names.find((n) => CELLS[n] === Math.floor(y / C) * GRID + Math.floor(x / C))!;

export interface AtlasImages { albedo: Buffer; normal: Buffer; mr: Buffer }

/** Rastérise l'atlas (PNG sans perte, 512 px ; mr 64 px). Déterministe. */
export async function renderAtlas(): Promise<AtlasImages> {
  const S = ATLAS_SIZE;
  const rgb = await rasterize(albedoCell, 3);
  const h = await rasterize(heightCell, 1);
  const r = rng(20261113);
  // Bruit basse fréquence (grille 16 px interpolée) + grain.
  const G = S / 16 + 1;
  const lowA = Float32Array.from({ length: G * G }, () => r() * 2 - 1);
  const lowH = Float32Array.from({ length: G * G }, () => r() * 2 - 1);
  const sample = (g: Float32Array, x: number, y: number): number => {
    const fx = x / 16, fy = y / 16, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const at = (i: number, j: number): number => g[Math.min(G - 1, j) * G + Math.min(G - 1, i)]!;
    return (at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx) * (1 - ty) + (at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx) * ty;
  };
  const height = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const [na, nh] = NOISE[cellAt(x, y)];
    const i = y * S + x;
    const n = sample(lowA, x, y) * 0.6 + (r() * 2 - 1) * 0.4;
    for (let c = 0; c < 3; c++) rgb[i * 3 + c] = Math.max(0, Math.min(255, rgb[i * 3 + c]! + n * na));
    height[i] = h[i]! + (sample(lowH, x, y) * 0.5 + (r() * 2 - 1) * 0.5) * nh;
  }
  // Normale (convention glTF / OpenGL, Y vers le haut) par différences centrées, sans débordement entre cellules.
  const nrm = Buffer.alloc(S * S * 3);
  const k = 1 / 40;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const cx0 = Math.floor(x / C) * C, cy0 = Math.floor(y / C) * C;
    const hx = (xx: number): number => height[y * S + Math.max(cx0, Math.min(cx0 + C - 1, xx))]!;
    const hy = (yy: number): number => height[Math.max(cy0, Math.min(cy0 + C - 1, yy)) * S + x]!;
    const dx = (hx(x + 1) - hx(x - 1)) * k, dy = (hy(y + 1) - hy(y - 1)) * k;
    const l = Math.hypot(dx, dy, 1);
    const i = (y * S + x) * 3;
    nrm[i] = Math.round((-dx / l * 0.5 + 0.5) * 255);
    nrm[i + 1] = Math.round((dy / l * 0.5 + 0.5) * 255);
    nrm[i + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
  }
  // Rugosité (G) / métal (B), 64 px.
  const M = 64, mc = M / GRID;
  const mr = Buffer.alloc(M * M * 3);
  for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) {
    const n = names.find((nm) => CELLS[nm] === Math.floor(y / mc) * GRID + Math.floor(x / mc))!;
    const i = (y * M + x) * 3;
    mr[i] = 255; mr[i + 1] = Math.round(MR[n][0] * 255); mr[i + 2] = Math.round(MR[n][1] * 255);
  }
  const png = (buf: Buffer, size: number): Promise<Buffer> => sharp(buf, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
  return { albedo: await png(rgb, S), normal: await png(nrm, S), mr: await png(mr, M) };
}

/** Atlas encodé en WebP à la taille d'un LOD (512 / 256 / 128 ; rugosité-métal 64 px). */
export async function encodeAtlas(a: AtlasImages, lod: number): Promise<{ albedo: Uint8Array; normal: Uint8Array; mr: Uint8Array }> {
  const size = Math.max(128, ATLAS_SIZE >> lod);
  const q = lod === 0 ? 86 : 80;
  const enc = async (b: Buffer, s: number, quality: number): Promise<Uint8Array> => new Uint8Array(await sharp(b).resize(s, s, { kernel: 'lanczos3' }).webp({ quality, effort: 6 }).toBuffer());
  // Normale à demi-résolution (relief de faible amplitude) : ~4× moins lourd, écart visuel négligeable.
  return { albedo: await enc(a.albedo, size, q), normal: await enc(a.normal, Math.max(128, size >> 1), q), mr: await enc(a.mr, 64, 90) };
}
