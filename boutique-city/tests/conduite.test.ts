/**
 * Conduite (retour de joueur : « je peux pas conduire de voiture ») : physique indépendante du nombre d'images par
 * seconde, véhicule qui glisse le long d'un mur au lieu d'y rester collé, choc de face puis dégagement, distance à la
 * carrosserie (invite « Conduire »), véhicules livrés au garage chacun à une place libre, message d'achat.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Collider } from '../src/world/collide';
import { VEHICLE_BODY, bodyDistance, drive, type DriveInput, type DriveState } from '../src/world/vehicle';
import { FACE_N, serviceBuilding } from '../src/sim/district';
import { Game } from '../src/sim/game';

const FAR = { minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 };
const open = new Collider([], FAR);
/** Mur parallèle à l'axe z, face ouest en x = 4. */
const wall = new Collider([{ minX: 4, maxX: 20, minZ: -500, maxZ: 500, h: 10 }], FAR);

function run(fps: number, col: Collider, s0: Partial<DriveState>, inp: DriveInput, seconds: number, maxSpeed = 16, radius = 1, span = 0): DriveState {
  const s: DriveState = { x: 0, z: 0, heading: 0, speed: 0, ...s0 };
  const dt = Math.min(0.1, 1 / fps);
  for (let t = 0; t < seconds - 1e-9; t += dt) drive(s, inp, dt, maxSpeed, col, radius, span);
  return s;
}

test('même conduite à 10, 30, 60 et 144 images par seconde (ligne droite, virage, freinage)', () => {
  const ref = { line: run(60, open, {}, { throttle: 1, steer: 0, brake: false }, 3), turn: run(60, open, {}, { throttle: 1, steer: 1, brake: false }, 3), stop: run(60, open, { speed: 16 }, { throttle: 0, steer: 0, brake: true }, 0.8) };
  for (const fps of [10, 30, 144]) {
    const line = run(fps, open, {}, { throttle: 1, steer: 0, brake: false }, 3);
    const turn = run(fps, open, {}, { throttle: 1, steer: 1, brake: false }, 3);
    const stop = run(fps, open, { speed: 16 }, { throttle: 0, steer: 0, brake: true }, 0.8);
    assert.ok(Math.hypot(line.x - ref.line.x, line.z - ref.line.z) < 0.3, `${fps} i/s : ligne droite`);
    assert.ok(Math.hypot(turn.x - ref.turn.x, turn.z - ref.turn.z) < 0.4, `${fps} i/s : virage ${JSON.stringify([turn, ref.turn])}`);
    assert.ok(Math.abs(stop.z - ref.stop.z) < 0.3, `${fps} i/s : freinage`);
  }
  assert.ok(ref.line.z < -25 && ref.line.speed === 16, 'pleine vitesse en moins de 3 s');
});

test('mur frôlé : le véhicule s’aligne et glisse le long, à toute cadence d’images (avant : collé à 0,1 m/s à 60 i/s)', () => {
  for (const fps of [10, 60, 144]) {
    // Cap −0,26 rad : avant vers +x (le mur) de 15°, en avançant vers −z.
    const s = run(fps, wall, { x: 2.5, heading: -0.26 }, { throttle: 1, steer: 0, brake: false }, 3);
    assert.ok(s.z < -20 && s.speed > 14, `${fps} i/s : ${JSON.stringify(s)}`);
    assert.ok(s.x <= 3.0 + 1e-6, 'jamais dans le mur');
  }
});

test('choc de face : arrêt, puis on se dégage en braquant (même à l’arrêt) ou en reculant', () => {
  const into = run(60, wall, { x: 1, heading: -Math.PI / 2 }, { throttle: 1, steer: 0, brake: false }, 2);
  assert.ok(into.speed < 0.5 && into.x <= 3.0 + 1e-6, `bloqué de face : ${JSON.stringify(into)}`);
  const turned = run(60, wall, into, { throttle: 1, steer: 1, brake: false }, 2.5);
  assert.ok(turned.speed > 4 && Math.hypot(turned.x - into.x, turned.z - into.z) > 4, `dégagé en braquant : ${JSON.stringify(turned)}`);
  const back = run(60, wall, into, { throttle: -1, steer: 0, brake: false }, 1.5);
  assert.ok(back.x < into.x - 2, `dégagé en reculant : ${JSON.stringify(back)}`);
});

test('carrosserie en deux cercles : l’avant s’arrête au mur au lieu de s’y enfoncer, le véhicule glisse toujours', () => {
  for (const type of ['scooter', 'citadine', 'camionnette', 'camion'] as const) {
    const b = VEHICLE_BODY[type];
    // Face au mur (avant vers +x), pleins gaz : le centre s'arrête à une demi-longueur du mur, à quelques cm près.
    const s = run(60, wall, { x: -6, heading: -Math.PI / 2 }, { throttle: 1, steer: 0, brake: false }, 3, 14, b.radius, b.span);
    assert.ok(Math.abs(4 - s.x - (b.span + b.radius)) < 0.05 && s.speed < 0.5, `${type} : ${JSON.stringify(s)}`);
    assert.ok(Math.abs(b.span + b.radius - b.l / 2) < 0.1, `${type} : cercles au bout de la carrosserie`);
    const slide = run(60, wall, { x: 4 - b.radius - 0.2, heading: -0.26 }, { throttle: 1, steer: 0, brake: false }, 3, 14, b.radius, b.span);
    assert.ok(slide.z < -18 && slide.x <= 4 - b.radius + 1e-6, `${type} glisse : ${JSON.stringify(slide)}`);
  }
});

test('invite « Conduire » : distance à la carrosserie (rectangle orienté), pas au centre', () => {
  const v = { type: 'camion' as const, x: 0, z: 0, heading: 0 };
  const b = VEHICLE_BODY.camion;
  assert.equal(bodyDistance(v, 0, 0), 0);
  assert.ok(Math.abs(bodyDistance(v, b.w / 2 + 1, 0) - 1) < 1e-9, 'à 1 m du flanc');
  assert.ok(Math.abs(bodyDistance(v, 0, -(b.l / 2 + 1)) - 1) < 1e-9, 'à 1 m de l’avant');
  assert.ok(Math.abs(bodyDistance({ ...v, heading: Math.PI / 2 }, -(b.l / 2 + 1), 0) - 1) < 1e-9, 'véhicule tourné');
});

test('garage : chaque véhicule livré à une place libre, jamais sur un autre (même après une revente ou un créneau)', () => {
  const g = new Game(7);
  g.cash = 1e6;
  const gb = serviceBuilding(g.district, 'garage')!;
  g.setPlace({ kind: 'service', service: 'garage', buildingId: gb.id });
  const apart = (): number => Math.min(...g.vehicles.flatMap((a, i) => g.vehicles.slice(i + 1).map((b) => Math.hypot(a.x - b.x, a.z - b.z))));
  for (const t of ['scooter', 'citadine', 'sportive', 'suv', 'camionnette'] as const) assert.ok(g.buyVehicle(t).ok);
  assert.ok(apart() >= 5.5, `cinq véhicules : ${apart().toFixed(1)} m`);
  // Avant : la place se déduisait du nombre de véhicules ; après une revente, le suivant arrivait sur un autre.
  assert.ok(g.sellVehicle(g.vehicles[0]!.id).ok);
  assert.ok(g.buyVehicle('camion').ok);
  assert.ok(apart() >= 5.5, `après revente : ${apart().toFixed(1)} m`);
  // Tous sur la chaussée devant le garage (à moins de 26 m de la porte, où il n'y a pas de voiture garée du décor).
  for (const v of g.vehicles) assert.ok(Math.hypot(v.x - gb.doorX, v.z - gb.doorZ) < 26);
  // Le joueur a garé un véhicule sur une place de livraison : le suivant va à une autre, libre.
  const h = new Game(7);
  h.cash = 1e6;
  h.setPlace({ kind: 'service', service: 'garage', buildingId: gb.id });
  const n = FACE_N[gb.face]!, spot = (s: number): { x: number; z: number } => ({ x: gb.doorX + n[0] * 3.7 + n[1] * s, z: gb.doorZ + n[1] * 3.7 - n[0] * s });
  const a = h.buyVehicle('citadine');
  assert.ok(a.ok && Math.hypot(a.data.x - spot(-6).x, a.data.z - spot(-6).z) < 1e-6, 'première place : 6 m à côté de la porte');
  if (!a.ok) return;
  h.setVehiclePose(a.data.id, spot(6).x, spot(6).z, a.data.heading);
  const b = h.buyVehicle('camion');
  assert.ok(b.ok && Math.hypot(b.data.x - spot(-6).x, b.data.z - spot(-6).z) < 1e-6, 'place libérée reprise');
  const c = h.buyVehicle('scooter');
  assert.ok(c.ok && Math.hypot(c.data.x - spot(-12).x, c.data.z - spot(-12).z) < 1e-6, 'places prises évitées');
});

test('achat : message qui dit où est le véhicule et quoi faire (accord correct, sigles gardés)', () => {
  const g = new Game(7);
  g.cash = 1e6;
  const gb = serviceBuilding(g.district, 'garage')!;
  g.setPlace({ kind: 'service', service: 'garage', buildingId: gb.id });
  const texts = (): string[] => g.notices.map((n) => n.text);
  g.buyVehicle('scooter');
  g.buyVehicle('suv');
  assert.ok(texts().includes('Votre scooter utilitaire vous attend devant le garage : approchez-vous et appuyez sur E pour conduire.'), texts().join(' | '));
  assert.ok(texts().includes('Votre SUV de luxe vous attend devant le garage : approchez-vous et appuyez sur E pour conduire.'), texts().join(' | '));
});
