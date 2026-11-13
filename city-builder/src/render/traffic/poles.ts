/**
 * Position au sol des mâts de feux tricolores, extraite de la trame `signals.layout` envoyée par la
 * simulation (`SIGNAL_HEAD_STRIDE` flottants par bras : pied du poteau x/y/z, cap, portée, voies,
 * rayon du carrefour, index du carrefour — voir docs/ARCHITECTURE.md §4).
 *
 * Sert au décor des rues : aucun lampadaire ne doit être planté contre un mât de feu (défaut relevé en QA).
 * Le module ROUTES possède `src/render/roads/builder.ts` : la demande d'intégration est décrite dans
 * docs/requests/circulation.md §5 ; cette fonction lui fournit l'entrée attendue.
 */
import { SIGNAL_HEAD_STRIDE } from '../../shared/protocol';

/** Distance minimale (m) entre un lampadaire et le pied d'un mât de feu. */
export const LAMP_SIGNAL_CLEARANCE = 4;

export interface PolePosition { x: number; y: number; z: number }

/** Pieds des mâts de feux de la trame de disposition. */
export function signalPolePositions(heads: Float32Array): PolePosition[] {
  const out: PolePosition[] = [];
  const n = Math.floor(heads.length / SIGNAL_HEAD_STRIDE);
  for (let i = 0; i < n; i++) {
    const o = i * SIGNAL_HEAD_STRIDE;
    out.push({ x: heads[o]!, y: heads[o + 1]!, z: heads[o + 2]! });
  }
  return out;
}

/** Vrai si (x, z) est trop proche d'un mât de feu pour y planter un lampadaire. */
export function tooCloseToSignalPole(x: number, z: number, poles: readonly PolePosition[], clearance = LAMP_SIGNAL_CLEARANCE): boolean {
  const r2 = clearance * clearance;
  for (const p of poles) {
    const dx = p.x - x, dz = p.z - z;
    if (dx * dx + dz * dz < r2) return true;
  }
  return false;
}
