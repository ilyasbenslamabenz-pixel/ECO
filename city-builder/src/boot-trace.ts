/**
 * Journal de plantage (téléphone) : la dernière étape atteinte est écrite dans localStorage à chaque
 * étape du chargement et à chaque action de jeu importante. Si Safari ferme l'onglet, le prochain
 * démarrage affiche où le jeu s'était arrêté (diagnostic sur un vrai appareil, sans outils).
 */
const TRACE_KEY = 'meknes:trace';
const PLAYING_KEY = 'meknes:en-jeu';

interface Trace { steps: string[]; t0: number }
let trace: Trace = { steps: [], t0: Date.now() };

function save(): void { try { localStorage.setItem(TRACE_KEY, JSON.stringify(trace)); } catch { /* navigation privée */ } }

/** Lit le journal du lancement précédent (avant de commencer le nouveau). */
export function previousTrace(): { steps: string[]; seconds: number; playing: boolean } | null {
  try {
    const raw = localStorage.getItem(TRACE_KEY);
    const playing = localStorage.getItem(PLAYING_KEY) === '1';
    if (!raw) return null;
    const t = JSON.parse(raw) as Trace;
    return { steps: t.steps ?? [], seconds: Math.round((Date.now() - (t.t0 ?? Date.now())) / 1000), playing };
  } catch { return null; }
}

/** Démarre un nouveau journal. */
export function traceStart(): void { trace = { steps: [], t0: Date.now() }; save(); }

/** Ajoute une étape (les 8 dernières sont gardées), avec l'heure depuis le lancement. */
export function traceStep(label: string): void {
  const s = Math.round((Date.now() - trace.t0) / 1000);
  trace.steps.push(`${s}s ${label}`);
  if (trace.steps.length > 8) trace.steps.shift();
  save();
}

/** Partie en cours : drapeau retiré à la fermeture normale de la page (pagehide). */
export function tracePlaying(on: boolean): void { try { if (on) localStorage.setItem(PLAYING_KEY, '1'); else localStorage.removeItem(PLAYING_KEY); } catch { /* */ } }

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => tracePlaying(false));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') tracePlaying(false); });
}
