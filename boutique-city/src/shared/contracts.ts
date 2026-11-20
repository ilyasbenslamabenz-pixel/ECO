/** Types de la caméra (repris de Meknes City, city-builder/src/shared/contracts.ts). */
export interface CameraPose {
  /** Point visé au sol (m). */
  targetX: number;
  targetY: number;
  targetZ: number;
  /** Distance caméra -> cible (m), mode aérien. */
  distance: number;
  /** Cap (rad), 0 = regarde vers -Z. */
  yaw: number;
  /** Inclinaison (rad), 0 = horizontal, PI/2 = vue de dessus. */
  pitch: number;
}

export type CameraMode = 'aerial' | 'street';

export interface ICameraController {
  readonly mode: CameraMode;
  setMode(mode: CameraMode): void;
  getPose(): CameraPose;
  setPose(pose: Partial<CameraPose>): void;
  /** Appelé à chaque frame. */
  update(dtSeconds: number): void;
  dispose(): void;
}
