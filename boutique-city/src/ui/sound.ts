/**
 * Sons synthétisés (Web Audio, aucun fichier) : vente vue en magasin, palier de ventes du jour (« ka-ching »),
 * carillon de porte, notifications selon leur gravité, objectif atteint, fanfares (palier, récapitulatif), taxi.
 * Tout passe par un bus commun (gain puis compresseur) : des sons simultanés ne saturent pas. Démarrés au premier
 * geste du joueur (règle des navigateurs). Coupure mémorisée.
 */
const KEY = 'boutique-city.son';
let ctx: AudioContext | null = null;
let bus: AudioNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let muted = (() => { try { return localStorage.getItem(KEY) === '0'; } catch { return false; } })();
let lastDing = 0;

function ac(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    try { ctx = new AudioContext(); } catch { return null; }
    // Bus : gain général puis compresseur doux (plusieurs sons à la fois restent propres).
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
    const g = ctx.createGain();
    g.gain.value = 0.9;
    g.connect(comp).connect(ctx.destination);
    bus = g;
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}
window.addEventListener('pointerdown', () => { if (!muted) ac(); }, { once: true });

/** Note : attaque (s), filtre passe-bas (Hz) et glissement de hauteur (facteur atteint en fin de note) facultatifs. */
function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', gain = 0.12, opt: { attack?: number; filter?: number; slide?: number } = {}): void {
  const c = ac();
  if (!c || !bus) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.value = freq;
  const t = c.currentTime + start;
  if (opt.slide) o.frequency.exponentialRampToValueAtTime(freq * opt.slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + (opt.attack ?? 0.01));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  let out: AudioNode = g;
  if (opt.filter) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = opt.filter; g.connect(f); out = f; }
  out.connect(bus);
  o.start(t); o.stop(t + dur + 0.02);
}

/** Bruit filtré (claquement, frottement) : tampon de bruit blanc partagé. */
function noise(start: number, dur: number, gain: number, freq: number, type: BiquadFilterType = 'bandpass', q = 1): void {
  const c = ac();
  if (!c || !bus) return;
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, Math.floor(c.sampleRate * 0.6), c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  s.buffer = noiseBuf;
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  const t = c.currentTime + start;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(bus);
  s.start(t, Math.random() * 0.3); s.stop(t + dur + 0.02);
}

/** Cuivres doux (deux dents de scie légèrement désaccordées, filtrées). */
function brass(freq: number, start: number, dur: number, gain = 0.045): void {
  tone(freq, start, dur, 'sawtooth', gain, { attack: 0.03, filter: 2400 });
  tone(freq * 1.004, start, dur, 'sawtooth', gain * 0.6, { attack: 0.04, filter: 1700 });
}

export type NotifyLevel = 'info' | 'ok' | 'warn' | 'error';

export const sound = {
  get muted(): boolean { return muted; },
  toggle(): boolean { muted = !muted; try { localStorage.setItem(KEY, muted ? '0' : '1'); } catch { /* */ } if (muted) void ctx?.suspend(); else ac(); return muted; },
  /** Vente encaissée sous les yeux du joueur (au plus 4 par seconde). */
  ding(): void { const n = performance.now(); if (n - lastDing < 250) return; lastDing = n; tone(1318, 0, 0.18, 'triangle', 0.06); tone(1760, 0.07, 0.22, 'triangle', 0.05); },
  /**
   * Palier de ventes du jour : tiroir-caisse complet, claquement du tiroir, cloche (trois partiels) et pièces qui
   * tintent.
   */
  kaching(): void {
    noise(0, 0.05, 0.2, 3200, 'bandpass', 0.8);
    noise(0.02, 0.16, 0.05, 900, 'lowpass');
    tone(2093, 0.05, 0.75, 'sine', 0.07); tone(2637, 0.05, 0.6, 'sine', 0.05); tone(4186, 0.05, 0.28, 'sine', 0.022);
    for (let k = 0; k < 6; k++) tone(3000 + Math.random() * 2600, 0.17 + k * 0.045 + Math.random() * 0.02, 0.07, 'sine', 0.022);
  },
  chime(): void { tone(880, 0, 0.35, 'sine', 0.08); tone(659, 0.16, 0.45, 'sine', 0.07); },
  /** Ancien bip d'alerte (préférer notify). */
  blip(): void { tone(660, 0, 0.12, 'square', 0.03); },
  /**
   * Notification, un son par gravité : info (tic léger), ok (deux notes montantes), avertissement (deux notes
   * descendantes), erreur (deux pulsations graves). Le regroupement (un son par seconde au plus) est fait par
   * l'appelant.
   */
  notify(level: NotifyLevel): void {
    if (level === 'info') tone(1175, 0, 0.09, 'sine', 0.03);
    else if (level === 'ok') { tone(880, 0, 0.12, 'sine', 0.04); tone(1318, 0.08, 0.16, 'sine', 0.04); }
    else if (level === 'warn') { tone(988, 0, 0.13, 'triangle', 0.055); tone(740, 0.12, 0.2, 'triangle', 0.055); }
    else { tone(220, 0, 0.11, 'square', 0.035, { filter: 1400 }); tone(185, 0.14, 0.2, 'square', 0.035, { filter: 1200 }); }
  },
  success(): void { [523, 659, 784, 1046].forEach((f, k) => tone(f, k * 0.09, 0.3, 'triangle', 0.08)); },
  /** Palier franchi, victoire : fanfare plus longue, accord final tenu. */
  fanfare(): void {
    [392, 523, 659, 784].forEach((f, k) => tone(f, k * 0.11, 0.28, 'triangle', 0.08));
    [523, 659, 784, 1046].forEach((f) => tone(f, 0.5, 0.9, 'triangle', 0.06));
  },
  /** Bonne journée (récapitulatif) : courte fanfare de cuivres, accord tenu et scintillement. */
  celebrate(): void {
    brass(392, 0, 0.14); brass(523, 0.14, 0.14); brass(659, 0.28, 0.14); brass(784, 0.42, 0.42);
    [523, 659, 784, 1046].forEach((f) => brass(f, 0.64, 1.0, 0.03));
    tone(2093, 0.66, 0.5, 'triangle', 0.025); tone(2637, 0.74, 0.45, 'triangle', 0.02);
  },
  /** Taxi : deux coups de klaxon, puis la portière. */
  taxi(): void {
    for (const s of [0, 0.2]) { tone(440, s, 0.13, 'square', 0.03, { filter: 1600 }); tone(554, s, 0.13, 'square', 0.025, { filter: 1600 }); }
    noise(0.5, 0.09, 0.12, 500, 'lowpass');
  },
};
