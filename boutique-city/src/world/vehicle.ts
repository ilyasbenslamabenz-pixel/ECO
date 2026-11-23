/**
 * Conduite d'un véhicule (modèle bicyclette simplifié) : accélération, freinage, marche arrière, direction qui
 * dépend de la vitesse, frottement. Le pas de temps est découpé (≤ 1/60 s) : même conduite à 30, 60 ou 144 images
 * par seconde. Collision : cercle repoussé par les obstacles (Collider de la rue, autres véhicules du joueur) ; la
 * vitesse qui entre dans l'obstacle est perdue et, s'il
 * est frôlé, le véhicule s'aligne dessus et glisse le long (un choc de face l'arrête) au lieu d'y rester collé.
 * Gabarits des véhicules du joueur (invite « Conduire » mesurée depuis la carrosserie). TypeScript pur.
 */
import type { VehicleType } from '../sim/catalog';

export interface DriveState { x: number; z: number; heading: number; speed: number }
export interface DriveInput { throttle: number; steer: number; brake: boolean }
/** Obstacles de la conduite : le Collider de la rue, ou une composition (rue et autres véhicules du joueur). */
export interface Obstacles { resolve(x: number, z: number, radius: number): { x: number; z: number; hit: boolean } }

/** Cap 0 : vers −z ; la position avance de (−sin cap, −cos cap). Convention partagée avec le personnage. */
export function forward(heading: number): [number, number] { return [-Math.sin(heading), -Math.cos(heading)]; }

/**
 * Gabarit de chaque véhicule du joueur (m) : largeur et longueur de la carrosserie (modèles de vehicles3d.ts à
 * l'échelle) ; collision par deux cercles de rayon `radius`, centrés à ± `span` le long de l'axe (l'avant ne
 * s'enfonce plus dans les murs) ; distance de la caméra de conduite.
 */
export const VEHICLE_BODY: Record<VehicleType, { w: number; l: number; radius: number; span: number; cam: number }> = {
  scooter: { w: 0.7, l: 1.8, radius: 0.45, span: 0.45, cam: 8 },
  citadine: { w: 1.8, l: 3.95, radius: 0.95, span: 1.0, cam: 10 },
  sportive: { w: 1.9, l: 3.75, radius: 1.0, span: 0.85, cam: 12 },
  suv: { w: 2.0, l: 3.8, radius: 1.05, span: 0.85, cam: 12 },
  camionnette: { w: 2.1, l: 3.9, radius: 1.1, span: 0.85, cam: 13 },
  camion: { w: 2.4, l: 5.2, radius: 1.25, span: 1.35, cam: 16 },
};
/** Portée de l'invite « Conduire » : distance (m) entre le personnage et la carrosserie. */
export const VEHICLE_REACH = 1.8;

/** Distance (m) d'un point à la carrosserie d'un véhicule (rectangle orienté ; 0 à l'intérieur). */
export function bodyDistance(v: { type: VehicleType; x: number; z: number; heading: number }, x: number, z: number): number {
  const b = VEHICLE_BODY[v.type];
  const [fx, fz] = forward(v.heading);
  const dx = x - v.x, dz = z - v.z;
  const along = Math.abs(dx * fx + dz * fz) - b.l / 2, side = Math.abs(dx * fz - dz * fx) - b.w / 2;
  return Math.hypot(Math.max(0, along), Math.max(0, side));
}

/** Pas de temps maximal de la simulation de conduite (s). */
export const DRIVE_STEP = 1 / 60;
/** Vitesse (rad/s) à laquelle un véhicule qui frôle un obstacle s'aligne dessus. */
const ALIGN = 6;

/**
 * Fait avancer la conduite de `dt` secondes (découpées en pas ≤ DRIVE_STEP). Carrosserie : cercle de rayon `radius`,
 * ou deux cercles à ± `span` le long de l'axe. Vrai si un obstacle a été touché.
 */
export function drive(s: DriveState, inp: DriveInput, dt: number, maxSpeed: number, col: Obstacles, radius: number, span = 0): boolean {
  const n = Math.max(1, Math.ceil(dt / DRIVE_STEP - 1e-9));
  let hit = false;
  for (let k = 0; k < n; k++) if (step(s, inp, dt / n, maxSpeed, col, radius, span)) hit = true;
  return hit;
}

function step(s: DriveState, inp: DriveInput, dt: number, maxSpeed: number, col: Obstacles, radius: number, span: number): boolean {
  const accel = 6, brake = 14, drag = 2.4;
  if (inp.brake) s.speed -= Math.sign(s.speed) * Math.min(Math.abs(s.speed), brake * dt);
  else if (inp.throttle !== 0) {
    // Freine d'abord si l'on change de sens.
    if (Math.sign(inp.throttle) !== Math.sign(s.speed) && Math.abs(s.speed) > 0.3) s.speed += inp.throttle * brake * dt;
    else s.speed += inp.throttle * accel * dt;
  } else s.speed -= Math.sign(s.speed) * Math.min(Math.abs(s.speed), drag * dt);
  s.speed = Math.max(-maxSpeed * 0.35, Math.min(maxSpeed, s.speed));
  // Braquage : plus vif à basse vitesse, inversé en marche arrière ; à l'arrêt, seulement en accélérant (on peut
  // ainsi pivoter pour se dégager d'un mur).
  const v = Math.abs(s.speed), push = inp.brake ? 0 : Math.abs(inp.throttle);
  const grip = Math.min(1, Math.max(v, push * 1.2) / 3);
  const dir = Math.sign(s.speed) || (inp.brake ? 0 : Math.sign(inp.throttle)) || 1;
  s.heading += inp.steer * grip * (1.9 - Math.min(1, v / maxSpeed) * 0.9) * dt * dir;
  const [fx, fz] = forward(s.heading);
  const tx = s.x + fx * s.speed * dt, tz = s.z + fz * s.speed * dt;
  // Cercles avant et arrière repoussés tour à tour (deux fois) : le véhicule se décale d'un bloc.
  let cx = tx, cz = tz, hit = false;
  for (const k of span > 0 ? [span, -span, span, -span] : [0]) {
    const ox = fx * k, oz = fz * k, r = col.resolve(cx + ox, cz + oz, radius);
    if (r.hit) { hit = true; cx = r.x - ox; cz = r.z - oz; }
  }
  if (hit) {
    // Normale de l'obstacle : du point visé vers le point corrigé. `into` : sinus de l'angle d'attaque (0 = frôle,
    // 1 = de face), dans le sens de la marche.
    const nx = cx - tx, nz = cz - tz, nl = Math.hypot(nx, nz);
    if (nl > 1e-9) {
      const ux = nx / nl, uz = nz / nl, mx = fx * dir, mz = fz * dir;
      const into = -(mx * ux + mz * uz);
      if (into > 0) {
        // Perte de la vitesse qui entre dans l'obstacle (cos de l'angle), rapportée au temps : indépendante du pas.
        s.speed *= Math.pow(Math.sqrt(Math.max(0, 1 - into * into)), dt / DRIVE_STEP);
        // Frôlement : l'avant (ou l'arrière en marche arrière) pivote vers la tangente et le véhicule glisse le long.
        if (into < 0.8) s.heading = turnToward(s.heading, Math.atan2(-(mx + into * ux) * dir, -(mz + into * uz) * dir), Math.min(1, ALIGN * dt));
      }
    }
  }
  s.x = cx; s.z = cz;
  return hit;
}

/** Angle `a` rapproché de `b` d'une fraction `k` de l'écart (par le plus court chemin). */
function turnToward(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * k;
}
