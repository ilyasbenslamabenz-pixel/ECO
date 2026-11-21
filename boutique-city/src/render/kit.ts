/**
 * Petits outils de modélisation : géométries unitaires partagées (boîte, cylindre, sphère) mises à l'échelle,
 * matériaux mis en cache par couleur. Tous les modèles du jeu (personnages, meubles, véhicules) en sont faits :
 * aucune texture ni fichier à charger. Dépend de three.
 */
import * as THREE from 'three';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
const SPH = new THREE.SphereGeometry(0.5, 14, 10);
const mats = new Map<string, THREE.Material>();

export interface MatOpts { rough?: number; metal?: number; emissive?: number; opacity?: number }

export function mat(color: string | number, o: MatOpts = {}): THREE.Material {
  const key = `${color}|${o.rough ?? 0.75}|${o.metal ?? 0}|${o.emissive ?? 0}|${o.opacity ?? 1}`;
  let m = mats.get(key);
  if (!m) {
    const c = new THREE.Color(color);
    const sm = new THREE.MeshStandardMaterial({ color: c, roughness: o.rough ?? 0.75, metalness: o.metal ?? 0 });
    if (o.emissive) { sm.emissive = c.clone(); sm.emissiveIntensity = o.emissive; }
    if (o.opacity !== undefined && o.opacity < 1) { sm.transparent = true; sm.opacity = o.opacity; sm.depthWrite = false; }
    m = sm;
    mats.set(key, m);
  }
  return m;
}

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, shadow: boolean): THREE.Mesh {
  const me = new THREE.Mesh(geo, m);
  me.scale.set(sx, sy, sz);
  me.position.set(x, y, z);
  me.castShadow = shadow;
  me.receiveShadow = true;
  return me;
}

/** Boîte de taille (w, h, d) dont la base est en y (centrée en x, z). */
export function box(parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, shadow = true): THREE.Mesh {
  const me = mesh(BOX, m, w, h, d, x, y + h / 2, z, shadow);
  parent.add(me);
  return me;
}
/** Cylindre vertical de diamètre `dia`, base en y. */
export function cyl(parent: THREE.Object3D, dia: number, h: number, x: number, y: number, z: number, m: THREE.Material, shadow = true): THREE.Mesh {
  const me = mesh(CYL, m, dia, h, dia, x, y + h / 2, z, shadow);
  parent.add(me);
  return me;
}
/** Sphère (ellipsoïde) centrée. */
export function sph(parent: THREE.Object3D, sx: number, sy: number, sz: number, x: number, y: number, z: number, m: THREE.Material, shadow = true): THREE.Mesh {
  const me = mesh(SPH, m, sx, sy, sz, x, y, z, shadow);
  parent.add(me);
  return me;
}

/** Libère les matériaux propres d'un groupe (les matériaux du cache sont partagés et conservés). */
export function disposeOwn(o: THREE.Object3D): void {
  o.traverse((c) => {
    const raw = (c as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    for (const m of Array.isArray(raw) ? raw : raw ? [raw] : []) if (m?.userData?.['own']) { (m as THREE.MeshBasicMaterial).map?.dispose(); m.dispose(); }
  });
}

/** Petit générateur déterministe (couleurs des personnages, variations). */
export function hashRand(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/** Panneau texte (canevas → plan), largeur adaptée au texte, hauteur `h` mètres. */
export function textPlane(text: string, h: number, bg: string, fg = '#ffffff', maxW = 12): THREE.Mesh {
  const font = '700 64px system-ui, -apple-system, Segoe UI, sans-serif';
  const cv = document.createElement('canvas');
  const g = cv.getContext('2d')!;
  g.font = font;
  const tw = Math.ceil(g.measureText(text).width) + 56;
  cv.width = Math.min(2048, tw); cv.height = 96;
  g.font = font;
  g.fillStyle = bg;
  g.beginPath(); g.roundRect(0, 0, cv.width, 96, 18); g.fill();
  g.fillStyle = fg; g.textBaseline = 'middle'; g.textAlign = 'center';
  g.fillText(text, cv.width / 2, 50, cv.width - 30);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
  m.userData['own'] = true;
  const w = Math.min(maxW, (h * cv.width) / 96);
  const me = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
  return me;
}
