// État de l'interface (Zustand). Les données de simulation viennent exclusivement du serveur.
import { create } from 'zustand';
import type { Snapshot } from '../../shared/sim/engine';
import type { CountryDef, Notice, Policy } from '../../shared/sim/types';

export type Panel = null | 'besoins' | 'finances' | 'fiscalite' | 'travail' | 'economie' | 'population' | 'stats' | 'notifications' | 'settings' | 'help'
  | 'politique' | 'international' | 'evenements' | 'objectifs' | 'energie' | 'environnement'
  | 'transports' | 'industrie' | 'agriculture' | 'dechets'

  // --- modules services publics/recherche/construction ---
  | 'sante' | 'education' | 'logement' | 'securite' | 'recherche' | 'construction'
  | 'missions' // --- missions et trophées (ui/Missions.tsx) ---
  | 'climat'; // --- plan climat --- (ui/Climat.tsx)
export type Quality = 'low' | 'medium' | 'high';
export type Selection = null | { kind: 'city'; id: number } | { kind: 'infra'; id: number };

export interface Toast { id: number; text: string; kind: 'info' | 'good' | 'warn' | 'bad' }

export type TimeMode = 'golden' | 'cycle' | 'day' | 'night';

const SETTINGS_KEY = 'eco_settings';
const loadSettings = () => {
  const d = { quality: 'medium' as Quality, volume: 0.5, labels: true, dayLength: 180, timeMode: 'golden' as TimeMode };
  try { return { ...d, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return d; }
};

interface State {
  screen: 'menu' | 'game';
  connected: boolean;
  gameId: string | null;
  country: CountryDef | null;
  history: Record<string, number[]>;
  snap: Snapshot | null;
  speed: number;
  notices: Notice[];
  unread: number;
  panel: Panel;
  selection: Selection;
  draft: Policy | null; // politique en cours d'édition
  toasts: Toast[];
  settings: { quality: Quality; volume: number; labels: boolean; dayLength: number; timeMode: TimeMode };
  tutorialStep: number;
  minimizedEvents: number[]; // événements dont la fenêtre de décision a été réduite (ils restent dans le panneau Événements)
  set: (p: Partial<State>) => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  setSettings: (p: Partial<State['settings']>) => void;
  editDraft: (f: (p: Policy) => void) => void;
}

let uid = 1;
export const useStore = create<State>((set, get) => ({
  screen: 'menu', connected: false, gameId: null, country: null, history: {}, snap: null, speed: 0, notices: [], unread: 0,
  panel: null, selection: null, draft: null, toasts: [], settings: loadSettings(), tutorialStep: -1, minimizedEvents: [],
  set: (p) => set(p),
  toast: (text, kind = 'info') => {
    const id = uid++;
    set({ toasts: [...get().toasts.slice(-4), { id, text, kind }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 4500);
  },
  setSettings: (p) => {
    const settings = { ...get().settings, ...p };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    set({ settings });
  },
  editDraft: (f) => {
    const base = get().draft ?? (get().snap ? structuredClone(get().snap!.pending?.policy ?? get().snap!.policy) : null);
    if (!base) return;
    const next = structuredClone(base);
    f(next);
    set({ draft: next });
  },
}));
