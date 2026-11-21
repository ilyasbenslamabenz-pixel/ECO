/**
 * Galerie de contrôle des modèles (?galerie) : chaque modèle ajusté dans une case, caméra placée côté +z.
 * Sert à vérifier l'orientation (face avant vers la caméra) et l'échelle. Dépend de three.
 */
import * as THREE from 'three';
import { ASSETS, assets } from './assets';
import { textPlane } from './render/kit';
import { makePerson } from './render/humanoid';

export function gallery(canvas: HTMLCanvasElement): void {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true });
  r.setSize(canvas.clientWidth, canvas.clientHeight, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fb8cc);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 2.2));
  // ?galerie=N : page N de 40 modèles (8 colonnes).
  const page = Math.max(0, Number(new URLSearchParams(location.search).get('galerie')) || 0);
  // &filtre=<motif> : seulement les clés qui correspondent (ex. « f:pet- »).
  const filtre = new URLSearchParams(location.search).get('filtre');
  const keys = Object.keys(ASSETS).filter((k) => !filtre || k.includes(filtre)).slice(page * 40, page * 40 + 40);
  const cols = 8;
  keys.forEach((k, i) => {
    const x = (i % cols) * 3.4 - 11.9, z = Math.floor(i / cols) * 3.4 - 8;
    const o = assets.fitted(k, 2, 2, 2) ?? new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
    o.position.set(x, 0, z);
    scene.add(o);
    const t = textPlane(k, 0.3, '#22303c');
    t.position.set(x, 0.05, z + 1.3); t.rotation.x = -Math.PI / 2;
    scene.add(t);
    const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(x - 1, 0.05, z), 0.8, 0xff3300);
    scene.add(arrow);
  });
  // Personnages animés : immobile, marche, à côté d'une chaise (échelle).
  const people = [makePerson(1), makePerson(2), makePerson(3, '#c0773a')];
  people.forEach((p, i) => { p.group.position.set(-3 + i * 1.2, 0, 11); scene.add(p.group); });
  for (let k = 0; k < 30; k++) { people[0]!.update(0.05, 0); people[1]!.update(0.05, 1.4); people[2]!.update(0.05, 3.5); }
  (window as unknown as { __people: unknown }).__people = people.map((p) => p.constructor.name);
  const cam = new THREE.PerspectiveCamera(40, canvas.clientWidth / canvas.clientHeight, 0.1, 200);
  cam.position.set(0, 26, 22); cam.lookAt(0, 0, 0);
  r.render(scene, cam);
}
