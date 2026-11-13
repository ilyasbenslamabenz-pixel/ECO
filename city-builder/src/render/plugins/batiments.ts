/**
 * Rendu du module « Bâtiments & quartiers » — propriété de la branche p2a-batiments.
 *
 * Affiche, QUAND L'OVERLAY EST ACTIF (commande `setOverlay` du module de simulation) :
 *  - le contour au sol de chaque quartier suivi, épousant le terrain (points tous les 4 m, 0,4 m au-dessus du
 *    sol pour éviter le z-fighting), une couleur par type de quartier ;
 *  - un petit repère vertical au-dessus de chaque bâtiment visé par une proposition d'évolution
 *    (jaune : valorisation, orange : densification).
 * Rien n'est affiché par défaut (aucun quartier, overlay éteint) et aucun objet n'est créé tant que le module
 * de simulation n'envoie rien. `dispose()` libère géométries et matériaux.
 */
import * as THREE from 'three';
import { deltaExt, snapshotExt, type BatimentsDelta } from '../../shared/protocol-ext';
import type { RenderPlugin, RenderPluginContext } from './types';

const COLORS: Record<string, number> = {
  centre_historique: 0xe8b65a,
  faubourg: 0x7fc4a0,
  pavillonnaire: 0x8fd16b,
  affaires: 0x6fa8ff,
  activites: 0xc98f5a,
  grands_ensembles: 0xc98ad8,
};
const DEFAULT_COLOR = 0xffffff;
/** Pas d'échantillonnage du contour sur le terrain (m). */
const STEP = 4;
const LIFT = 0.4;

let ctx: RenderPluginContext | null = null;
let group: THREE.Group | null = null;
let payload: BatimentsDelta | null = null;
const materials = new Map<number, THREE.LineBasicMaterial>();
let markerMat: THREE.MeshBasicMaterial | null = null;
let markerGeo: THREE.ConeGeometry | null = null;

function material(color: number): THREE.LineBasicMaterial {
  let m = materials.get(color);
  if (!m) { m = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85, depthTest: true }); materials.set(color, m); }
  return m;
}

function clear(): void {
  if (!group) return;
  for (const child of [...group.children]) {
    group.remove(child);
    const any = child as THREE.Mesh | THREE.Line;
    if (any.geometry && any.geometry !== markerGeo) any.geometry.dispose();
  }
}

/** Contour d'un rectangle, échantillonné et plaqué sur le terrain. */
function outline(minX: number, minZ: number, maxX: number, maxZ: number, heightAt: (x: number, z: number) => number): THREE.BufferGeometry {
  const pts: number[] = [];
  const edge = (x0: number, z0: number, x1: number, z1: number): void => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.ceil(len / STEP));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      const h = heightAt(x, z);
      pts.push(x, (Number.isFinite(h) ? h : 0) + LIFT, z);
    }
  };
  edge(minX, minZ, maxX, minZ);
  edge(maxX, minZ, maxX, maxZ);
  edge(maxX, maxZ, minX, maxZ);
  edge(minX, maxZ, minX, minZ);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

function rebuild(): void {
  if (!ctx || !group) return;
  clear();
  const p = payload;
  group.visible = !!p?.overlay;
  if (!p || !p.overlay) return;
  for (const d of p.districts) {
    const g = outline(d.bounds.minX, d.bounds.minZ, d.bounds.maxX, d.bounds.maxZ, ctx.heightAt);
    group.add(new THREE.Line(g, material(COLORS[d.type] ?? DEFAULT_COLOR)));
  }
  if (p.proposals.length > 0) {
    markerGeo ??= new THREE.ConeGeometry(1.2, 3.2, 6);
    markerMat ??= new THREE.MeshBasicMaterial({ color: 0xffc14d, transparent: true, opacity: 0.9 });
    for (const q of p.proposals) {
      const m = new THREE.Mesh(markerGeo, markerMat);
      const h = ctx.heightAt(q.x, q.z);
      m.position.set(q.x, (Number.isFinite(h) ? h : 0) + 14, q.z);
      m.rotation.z = Math.PI; // pointe vers le bas
      m.scale.setScalar(q.kind === 'densification' ? 1.3 : 1);
      group.add(m);
    }
  }
}

export const batimentsRenderPlugin: RenderPlugin = {
  id: 'batiments',

  init(c) {
    ctx = c;
    group = new THREE.Group();
    group.name = 'quartiers';
    group.visible = false;
    group.renderOrder = 2;
    c.scene.add(group);
  },

  applySnapshotExt(raw) {
    payload = snapshotExt(raw === undefined ? undefined : { batiments: raw }, 'batiments') ?? null;
    rebuild();
  },

  applyDeltaExt(raw) {
    payload = deltaExt({ batiments: raw }, 'batiments') ?? null;
    rebuild();
  },

  dispose() {
    clear();
    if (group) { group.parent?.remove(group); group = null; }
    for (const m of materials.values()) m.dispose();
    materials.clear();
    markerMat?.dispose();
    markerMat = null;
    markerGeo?.dispose();
    markerGeo = null;
    payload = null;
    ctx = null;
  },
};
