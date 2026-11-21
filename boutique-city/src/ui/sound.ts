/**
 * Sons synthétisés (Web Audio, aucun fichier) : tiroir-caisse à chaque vente vue en magasin, carillon de porte,
 * notification, objectif atteint. Démarrés au premier geste du joueur (règle des navigateurs). Coupure mémorisée.
 */
const KEY = 'boutique-city.son';
let ctx: AudioContext | null = null;
let muted = (() => { try { return localStorage.getItem(KEY) === '0'; } catch { return false; } })();
let lastDing = 0;

function ac(): AudioContext | null {
  if (muted) return null;
  if (!ctx) { try { ctx = new AudioContext(); } catch { return null; } }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}
window.addEventListener('pointerdown', () => { if (!muted) ac(); }, { once: true });

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', gain = 0.12): void {
  const c = ac();
  if (!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.value = freq;
  const t = c.currentTime + start;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

export const sound = {
  get muted(): boolean { return muted; },
  toggle(): boolean { muted = !muted; try { localStorage.setItem(KEY, muted ? '0' : '1'); } catch { /* */ } if (muted) void ctx?.suspend(); else ac(); return muted; },
  /** Vente encaissée (au plus 4 par seconde). */
  ding(): void { const n = performance.now(); if (n - lastDing < 250) return; lastDing = n; tone(1318, 0, 0.18, 'triangle', 0.07); tone(1760, 0.07, 0.22, 'triangle', 0.06); },
  chime(): void { tone(880, 0, 0.35, 'sine', 0.08); tone(659, 0.16, 0.45, 'sine', 0.07); },
  blip(): void { tone(660, 0, 0.12, 'square', 0.03); },
  success(): void { [523, 659, 784, 1046].forEach((f, k) => tone(f, k * 0.09, 0.3, 'triangle', 0.08)); },
};
