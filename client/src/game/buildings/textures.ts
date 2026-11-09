// Textures des façades : photos CC0 ambientCG (servies sous /assets/acg) et façades procédurales
// dessinées une seule fois sur canvas (pierre haussmannienne, habitat moderne, pavillon).
import { DynamicTexture, Texture, type Scene } from '@babylonjs/core';

const cache = new Map<string, Texture>();

/** Texture photo ambientCG, répétée, avec mipmaps et filtrage anisotrope. */
export function acg(scene: Scene, id: string, map: 'color' | 'normal' = 'color') {
  const key = `${id}/${map}`;
  let t = cache.get(key);
  if (!t || t.getScene() !== scene) {
    t = new Texture(`/assets/acg/${id}/${map}.jpg`, scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
    t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE;
    t.anisotropicFilteringLevel = 4;
    cache.set(key, t);
  }
  return t;
}

type Ctx = CanvasRenderingContext2D;

function canvasTex(scene: Scene, name: string, w: number, h: number, draw: (c: Ctx, rnd: () => number) => void) {
  const t = new DynamicTexture(name, { width: w, height: h }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  const c = t.getContext() as Ctx;
  let s = 1234567;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  draw(c, rnd);
  t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE;
  t.anisotropicFilteringLevel = 4;
  t.update(true);
  return t;
}

/** Grain léger (pierre, enduit). */
function grain(c: Ctx, w: number, h: number, rnd: () => number, n: number, alpha: number) {
  for (let i = 0; i < n; i++) {
    const v = rnd() < 0.5 ? 0 : 255;
    c.fillStyle = `rgba(${v},${v},${v},${alpha * rnd()})`;
    c.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1 + rnd() * 2);
  }
}

/** Vitre : verre sombre bleuté avec reflet dégradé (reconnu comme vitrage par le shader). */
function pane(c: Ctx, x: number, y: number, w: number, h: number, rnd: () => number) {
  const g = c.createLinearGradient(x, y, x + w * 0.4, y + h);
  const k = 0.85 + rnd() * 0.3;
  g.addColorStop(0, `rgb(${Math.round(70 * k)},${Math.round(84 * k)},${Math.round(98 * k)})`);
  g.addColorStop(1, `rgb(${Math.round(38 * k)},${Math.round(46 * k)},${Math.round(56 * k)})`);
  c.fillStyle = g;
  c.fillRect(x, y, w, h);
}

/** Garde-corps en fer forgé (noir, barreaux). */
function railing(c: Ctx, x: number, y: number, w: number, h: number) {
  c.fillStyle = 'rgba(25,25,28,0.9)';
  c.fillRect(x, y, w, 3);
  c.fillRect(x, y + h - 3, w, 3);
  for (let i = x; i < x + w; i += 5) c.fillRect(i, y, 1.6, h);
  c.strokeStyle = 'rgba(25,25,28,0.85)';
  c.lineWidth = 1.4;
  for (let i = x; i < x + w - 10; i += 20) { c.beginPath(); c.arc(i + 10, y + h / 2, h * 0.3, 0, Math.PI * 2); c.stroke(); }
}

/**
 * Façade haussmannienne : 3 travées, rez-de-chaussée commercial à refends, 5 étages, balcons filants
 * aux 2e et 5e étages, corniche. Couvre toute la hauteur du mur (mode « ajusté »).
 */
export function haussmannTexture(scene: Scene) {
  return canvasTex(scene, 'facadeHaussmann', 512, 1024, (c, rnd) => {
    const W = 512, H = 1024;
    c.fillStyle = '#ece4d3';
    c.fillRect(0, 0, W, H);
    grain(c, W, H, rnd, 9000, 0.05);
    // assises de pierre
    c.fillStyle = 'rgba(120,105,80,0.10)';
    for (let y = 0; y < H; y += 22) c.fillRect(0, y, W, 1);
    const ground = 200; // hauteur du rez-de-chaussée (px)
    const fh = (H - ground - 40) / 5; // étages courants
    // rez-de-chaussée : refends et devantures
    c.fillStyle = '#ddd3bf';
    c.fillRect(0, H - ground, W, ground);
    c.fillStyle = 'rgba(90,75,55,0.35)';
    for (let y = H - ground; y < H; y += 26) c.fillRect(0, y, W, 3);
    const bay = W / 3;
    for (let b = 0; b < 3; b++) {
      const x = b * bay + bay * 0.12;
      const w = bay * 0.76;
      pane(c, x, H - ground + 46, w, ground - 52, rnd);
      c.fillStyle = 'rgba(35,30,25,0.9)';
      c.fillRect(x - 4, H - ground + 38, w + 8, 10); // bandeau d'enseigne
      // store banne (couleurs sourdes)
      const aw = ['#6d2e2a', '#2f4a3a', '#3a3f55', '#7a6a4a', '#5a5a5a'][Math.floor(rnd() * 5)];
      if (rnd() < 0.7) { c.fillStyle = aw; c.fillRect(x - 2, H - ground + 48, w + 4, 22); c.fillStyle = 'rgba(255,255,255,0.15)'; for (let i = x; i < x + w; i += 16) c.fillRect(i, H - ground + 48, 8, 22); }
      c.fillStyle = 'rgba(230,225,215,0.8)';
      c.fillRect(x + w / 2 - 1, H - ground + 70, 2, ground - 76);
    }
    // bandeau au-dessus du rez-de-chaussée
    c.fillStyle = '#d5cab4';
    c.fillRect(0, H - ground - 14, W, 14);
    c.fillStyle = 'rgba(60,50,35,0.35)';
    c.fillRect(0, H - ground - 2, W, 4);
    // étages courants
    for (let f = 0; f < 5; f++) {
      const y0 = H - ground - 14 - (f + 1) * fh;
      for (let b = 0; b < 3; b++) {
        const ww = bay * 0.42;
        const x = b * bay + (bay - ww) / 2;
        const wy = y0 + fh * 0.16;
        const wh = fh * (f === 4 ? 0.6 : 0.7);
        // encadrement mouluré
        c.fillStyle = 'rgba(255,252,245,0.7)';
        c.fillRect(x - 7, wy - 7, ww + 14, wh + 10);
        c.fillStyle = 'rgba(90,75,55,0.3)';
        c.fillRect(x - 7, wy + wh + 2, ww + 14, 3);
        // fronton ou linteau
        if (f === 0 || f === 1) { c.fillStyle = 'rgba(120,100,75,0.35)'; c.fillRect(x - 10, wy - 16, ww + 20, 8); }
        pane(c, x, wy, ww, wh, rnd);
        // croisée blanche
        c.fillStyle = '#f2efe8';
        c.fillRect(x + ww / 2 - 2, wy, 4, wh);
        c.fillRect(x, wy + wh * 0.32, ww, 3);
        c.fillRect(x, wy, ww, 3); c.fillRect(x, wy, 3, wh); c.fillRect(x + ww - 3, wy, 3, wh);
        // rideaux clairs dans certaines fenêtres
        if (rnd() < 0.4) { c.fillStyle = 'rgba(225,215,195,0.35)'; c.fillRect(x + 3, wy + 3, ww * 0.18, wh - 6); c.fillRect(x + ww * 0.82 - 3, wy + 3, ww * 0.18, wh - 6); }
        // balconnets
        if (f !== 1 && f !== 4) railing(c, x - 2, wy + wh - fh * 0.24, ww + 4, fh * 0.2);
      }
      // balcons filants (2e et 5e étages)
      if (f === 1 || f === 4) {
        const by = y0 + fh * 0.16 + fh * (f === 4 ? 0.6 : 0.7) - fh * 0.24;
        c.fillStyle = 'rgba(70,58,42,0.45)';
        c.fillRect(0, by + fh * 0.2, W, 7); // dalle et ombre portée
        railing(c, 0, by, W, fh * 0.2);
      }
      // cordon d'étage
      c.fillStyle = 'rgba(110,95,70,0.18)';
      c.fillRect(0, y0 + fh - 3, W, 3);
    }
    // corniche
    c.fillStyle = '#e6dcc6';
    c.fillRect(0, 0, W, 40);
    c.fillStyle = 'rgba(70,58,42,0.5)';
    c.fillRect(0, 36, W, 6);
    c.fillStyle = 'rgba(70,58,42,0.25)';
    for (let x = 0; x < W; x += 16) c.fillRect(x, 26, 8, 10);
  });
}

/**
 * Habitat collectif moderne : 4 étages × 4 travées, enduit clair, baies, loggias et garde-corps.
 * Mode « métrique » (3 m par étage, 3,6 m par travée).
 */
export function residTexture(scene: Scene) {
  return canvasTex(scene, 'facadeResid', 512, 512, (c, rnd) => {
    const W = 512, H = 512;
    c.fillStyle = '#ebe8e1';
    c.fillRect(0, 0, W, H);
    grain(c, W, H, rnd, 5000, 0.05);
    const fh = H / 4, bw = W / 4;
    for (let f = 0; f < 4; f++) {
      const y0 = f * fh;
      // nez de dalle
      c.fillStyle = 'rgba(150,145,135,0.6)';
      c.fillRect(0, y0 + fh - 8, W, 8);
      for (let b = 0; b < 4; b++) {
        const x0 = b * bw;
        const loggia = b === 1 || b === 2;
        if (loggia) {
          // loggia : renfoncement ombré, porte-fenêtre, garde-corps vitré
          c.fillStyle = '#9c978d';
          c.fillRect(x0 + 6, y0 + 10, bw - 12, fh - 18);
          pane(c, x0 + 16, y0 + 18, bw - 32, fh - 34, rnd);
          c.fillStyle = '#ddd';
          c.fillRect(x0 + bw / 2 - 2, y0 + 18, 3, fh - 34);
          c.fillStyle = 'rgba(200,210,215,0.55)';
          c.fillRect(x0 + 6, y0 + fh * 0.6, bw - 12, fh * 0.32);
          c.fillStyle = 'rgba(60,60,60,0.9)';
          c.fillRect(x0 + 6, y0 + fh * 0.6, bw - 12, 3);
        } else {
          pane(c, x0 + bw * 0.2, y0 + fh * 0.22, bw * 0.6, fh * 0.5, rnd);
          c.fillStyle = '#f4f4f2';
          c.fillRect(x0 + bw * 0.2, y0 + fh * 0.22, bw * 0.6, 3);
          c.fillRect(x0 + bw * 0.5 - 1, y0 + fh * 0.22, 3, fh * 0.5);
          c.fillStyle = 'rgba(80,80,80,0.35)';
          c.fillRect(x0 + bw * 0.18, y0 + fh * 0.72, bw * 0.64, 4);
          if (rnd() < 0.5) { c.fillStyle = 'rgba(70,72,75,0.85)'; c.fillRect(x0 + bw * 0.2, y0 + fh * 0.22, bw * 0.6, fh * (0.1 + rnd() * 0.3)); } // volet roulant
        }
      }
    }
  });
}

/** Pavillon : 2 niveaux × 3 travées, enduit, volets, porte d'entrée, soubassement. */
export function houseTexture(scene: Scene) {
  return canvasTex(scene, 'facadeHouse', 512, 256, (c, rnd) => {
    const W = 512, H = 256;
    c.fillStyle = '#efe9dc';
    c.fillRect(0, 0, W, H);
    grain(c, W, H, rnd, 3000, 0.06);
    c.fillStyle = '#b9b3a6';
    c.fillRect(0, H - 14, W, 14);
    const bw = W / 3, fh = H / 2;
    for (let f = 0; f < 2; f++) {
      for (let b = 0; b < 3; b++) {
        const x0 = b * bw, y0 = f * fh;
        if (f === 1 && b === 1) {
          // porte
          c.fillStyle = '#5b4636';
          c.fillRect(x0 + bw * 0.36, y0 + fh * 0.18, bw * 0.28, fh * 0.82 - 14);
          c.fillStyle = 'rgba(255,255,255,0.25)';
          c.fillRect(x0 + bw * 0.4, y0 + fh * 0.24, bw * 0.2, fh * 0.2);
          continue;
        }
        const wx = x0 + bw * 0.32, wy = y0 + fh * 0.22, ww = bw * 0.36, wh = fh * 0.5;
        // volets
        c.fillStyle = '#7f8a80';
        c.fillRect(wx - ww * 0.48, wy, ww * 0.46, wh);
        c.fillRect(wx + ww * 1.02, wy, ww * 0.46, wh);
        c.fillStyle = 'rgba(0,0,0,0.18)';
        for (let i = 0; i < wh; i += 6) { c.fillRect(wx - ww * 0.48, wy + i, ww * 0.46, 1); c.fillRect(wx + ww * 1.02, wy + i, ww * 0.46, 1); }
        pane(c, wx, wy, ww, wh, rnd);
        c.fillStyle = '#f5f5f2';
        c.fillRect(wx, wy, ww, 3); c.fillRect(wx + ww / 2 - 1, wy, 3, wh); c.fillRect(wx, wy + wh * 0.5, ww, 2);
        c.fillStyle = 'rgba(200,195,185,0.9)';
        c.fillRect(wx - 4, wy + wh, ww + 8, 6);
      }
    }
  });
}
