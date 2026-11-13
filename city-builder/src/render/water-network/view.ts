/**
 * État de la vue « eau » partagé entre le calque 3D (src/render/water-network/overlay.ts) et le panneau
 * « Eau & égouts » (src/ui/panels/eau.ts). Aucun import de three : utilisable par l'interface.
 */
export type WaterViewMode = 'off' | 'desserte' | 'pression' | 'pollution';

export const WATER_VIEW_MODES: readonly { id: WaterViewMode; label: string; tip: string }[] = [
  { id: 'off', label: 'Surface', tip: 'Vue normale (canalisations masquées)' },
  { id: 'desserte', label: 'Desserte', tip: 'Calque souterrain : canalisations alimentées et bâtiments desservis' },
  { id: 'pression', label: 'Pression', tip: 'Calque souterrain : pression de service dans les canalisations' },
  { id: 'pollution', label: 'Pollution', tip: 'Pollution des cours d\'eau (propagée vers l\'aval) et charge des égouts' },
];

type Listener = (mode: WaterViewMode) => void;

class WaterViewState {
  private current: WaterViewMode = 'off';
  private readonly listeners = new Set<Listener>();
  get mode(): WaterViewMode { return this.current; }
  set(mode: WaterViewMode): void {
    if (mode === this.current) return;
    this.current = mode;
    for (const l of [...this.listeners]) l(mode);
  }
  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  }
}

/** Instance unique de la page. */
export const waterView = new WaterViewState();

/** Légendes (couleurs CSS identiques à celles du calque 3D). */
export const WATER_LEGEND: Record<Exclude<WaterViewMode, 'off'>, { color: string; label: string }[]> = {
  desserte: [
    { color: '#5fd39a', label: 'Desservi' }, { color: '#f2c230', label: 'Partiel' }, { color: '#ff6b6b', label: 'Non desservi' },
    { color: '#4fb3ff', label: 'Conduite alimentée' }, { color: '#596270', label: 'Conduite à sec' }, { color: '#b07a45', label: 'Égout' },
  ],
  pression: [
    { color: '#ff6b6b', label: '< 0,5 bar' }, { color: '#ff9f43', label: '0,5–1,5 bar' }, { color: '#5fd39a', label: '1,5–3 bar' }, { color: '#4fb3ff', label: '> 3 bar' },
  ],
  pollution: [
    { color: '#3d8fd6', label: 'Eau propre' }, { color: '#9a8f3a', label: 'Pollution modérée' }, { color: '#8b4a22', label: 'Forte pollution' },
    { color: '#b07a45', label: 'Égout (épaisseur = charge)' },
  ],
};
