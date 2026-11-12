/** État local de l'interface (thread principal). Aucune logique de simulation ici. */
import type { CameraMode, SimStats, ToolId } from '../shared/contracts';

export interface ClientState {
  stats: SimStats | null;
  cityName: string;
  cameraMode: CameraMode;
  tool: ToolId;
  inGame: boolean;
  demo: boolean;
}

export function createClientState(): ClientState {
  return { stats: null, cityName: '', cameraMode: 'aerial', tool: 'select', inGame: false, demo: false };
}
