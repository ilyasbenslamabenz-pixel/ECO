// Bruit procédural déterministe, partagé entre client et serveur.

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const PERM = new Uint8Array(512);
const GRAD: [number, number][] = [];
{
  const rnd = mulberry32(1969);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
  for (let i = 0; i < 256; i++) {
    const a = rnd() * Math.PI * 2;
    GRAD.push([Math.cos(a), Math.sin(a)]);
  }
}

function fade(t: number) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Bruit de gradient 2D, sortie ~[-1, 1] */
export function noise2(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const X = xi & 255;
  const Y = yi & 255;
  const g = (ix: number, iy: number, dx: number, dy: number) => {
    const gr = GRAD[PERM[ix + PERM[iy]]];
    return gr[0] * dx + gr[1] * dy;
  };
  const n00 = g(X, Y, xf, yf);
  const n10 = g(X + 1, Y, xf - 1, yf);
  const n01 = g(X, Y + 1, xf, yf - 1);
  const n11 = g(X + 1, Y + 1, xf - 1, yf - 1);
  const u = fade(xf);
  const v = fade(yf);
  const a = n00 + u * (n10 - n00);
  const b = n01 + u * (n11 - n01);
  return (a + v * (b - a)) * 1.4;
}

export function fbm(x: number, y: number, octaves = 4): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise2(x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

export function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
