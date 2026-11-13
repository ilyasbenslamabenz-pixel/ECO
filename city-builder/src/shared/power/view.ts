/**
 * Électricité — état d'affichage partagé (thread principal) entre le panneau Énergie (src/ui/panels/electricite.ts)
 * et le rendu (src/render/power) : calque « réseau électrique » affiché ou non, dernier état reçu de la simulation.
 * Pur TypeScript (aucun DOM, aucun three) : un simple émetteur d'événements.
 */
import type { ElectriciteDelta } from './types';

type Listener = () => void;

class PowerViewState {
  /** Calque « réseau électrique » (couverture / coupures) affiché. */
  overlay = false;
  /** Dernier état complet connu (fusion des deltas). */
  state: ElectriciteDelta = {};
  private listeners = new Set<Listener>();

  on(l: Listener): () => void { this.listeners.add(l); return () => { this.listeners.delete(l); }; }
  private emit(): void { for (const l of this.listeners) { try { l(); } catch (e) { console.error(e); } } }

  setOverlay(v: boolean): void { if (this.overlay !== v) { this.overlay = v; this.emit(); } }

  /** Instantané : l'état repart de zéro. */
  reset(s: ElectriciteDelta | undefined): void { this.state = s ? { ...s, events: [...(s.events ?? [])] } : {}; this.emit(); }

  /** Delta : les champs présents remplacent les précédents ; les événements s'ajoutent (40 derniers). */
  merge(d: ElectriciteDelta): void {
    const events = [...(this.state.events ?? []), ...(d.events ?? [])].slice(-40);
    this.state = { ...this.state, ...d, events };
    this.emit();
  }
}

/** Instance unique du thread principal. */
export const powerView = new PowerViewState();
