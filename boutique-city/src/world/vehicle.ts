/**
 * Conduite d'un véhicule (modèle bicyclette simplifié) : accélération, freinage, marche arrière, direction qui
 * dépend de la vitesse, frottement. Collision : cercle repoussé par le Collider, vitesse fortement réduite au choc.
 * TypeScript pur.
 */
import type { Collider } from './collide';

export interface DriveState { x: number; z: number; heading: number; speed: number }
export interface DriveInput { throttle: number; steer: number; brake: boolean }

/** Cap 0 : vers −z ; la position avance de (−sin cap, −cos cap). Convention partagée avec le personnage. */
export function forward(heading: number): [number, number] { return [-Math.sin(heading), -Math.cos(heading)]; }

export function drive(s: DriveState, inp: DriveInput, dt: number, maxSpeed: number, col: Collider, radius: number): boolean {
  const accel = 6, brake = 14, drag = 1.6;
  if (inp.brake) s.speed -= Math.sign(s.speed) * Math.min(Math.abs(s.speed), brake * dt);
  else if (inp.throttle !== 0) {
    // Freine d'abord si l'on change de sens.
    if (Math.sign(inp.throttle) !== Math.sign(s.speed) && Math.abs(s.speed) > 0.3) s.speed += inp.throttle * brake * dt;
    else s.speed += inp.throttle * accel * dt;
  } else s.speed -= Math.sign(s.speed) * Math.min(Math.abs(s.speed), drag * dt);
  s.speed = Math.max(-maxSpeed * 0.35, Math.min(maxSpeed, s.speed));
  // Braquage : plus vif à basse vitesse, nul à l'arrêt ; inversé en marche arrière.
  const turn = inp.steer * Math.min(1, Math.abs(s.speed) / 3) * (1.9 - Math.min(1, Math.abs(s.speed) / maxSpeed) * 0.9);
  s.heading += turn * dt * Math.sign(s.speed || 1);
  const [fx, fz] = forward(s.heading);
  const r = col.resolve(s.x + fx * s.speed * dt, s.z + fz * s.speed * dt, radius);
  s.x = r.x; s.z = r.z;
  if (r.hit) s.speed *= 0.5;
  return r.hit;
}
