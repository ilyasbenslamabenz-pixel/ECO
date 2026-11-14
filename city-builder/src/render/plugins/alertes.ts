/**
 * Rendu du module « alertes » : une pastille par problème au-dessus du bâtiment (route, électricité, eau, déchets),
 * empilées s'il y en a plusieurs, toujours visibles (dessinées par-dessus la ville), légère oscillation.
 * Un seul appel de rendu (points texturés, atlas dessiné au canevas) : coût négligeable même sur téléphone.
 */
import * as THREE from 'three';
import { ALERT_BITS, ALERT_KINDS, type AlertesPayload } from '../../shared/protocol-ext/alertes';
import type { RenderPlugin, RenderPluginContext } from './types';

const COLORS: Record<string, string> = { road: '#8a8f98', power: '#f2b01e', water: '#2f8de4', waste: '#7a9b3a' };

/** Glyphe blanc de chaque problème, dessiné dans une case de 64 px centrée en (32, 32). */
function glyph(g: CanvasRenderingContext2D, kind: string): void {
  g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineWidth = 5; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath();
  if (kind === 'power') { g.moveTo(36, 12); g.lineTo(22, 35); g.lineTo(32, 35); g.lineTo(27, 53); g.lineTo(43, 28); g.lineTo(33, 28); g.closePath(); g.fill(); return; }
  if (kind === 'water') { g.moveTo(32, 12); g.bezierCurveTo(40, 26, 46, 32, 46, 40); g.arc(32, 40, 14, 0, Math.PI); g.bezierCurveTo(18, 32, 24, 26, 32, 12); g.fill(); return; }
  if (kind === 'road') { g.moveTo(24, 14); g.lineTo(18, 50); g.moveTo(40, 14); g.lineTo(46, 50); g.stroke(); g.beginPath(); g.moveTo(32, 16); g.lineTo(32, 24); g.moveTo(32, 30); g.lineTo(32, 36); g.moveTo(32, 42); g.lineTo(32, 48); g.stroke(); return; }
  // Déchets : poubelle.
  g.fillRect(20, 22, 24, 28); g.fillRect(16, 16, 32, 5); g.fillRect(27, 11, 10, 5);
}

function atlas(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 64 * ALERT_KINDS.length; c.height = 64;
  const g = c.getContext('2d');
  if (!g) return null;
  ALERT_KINDS.forEach((k, i) => {
    g.save(); g.translate(i * 64, 0);
    g.beginPath(); g.arc(32, 32, 29, 0, Math.PI * 2); g.fillStyle = 'rgba(20,24,30,0.9)'; g.fill();
    g.beginPath(); g.arc(32, 32, 26, 0, Math.PI * 2); g.fillStyle = COLORS[k]!; g.fill();
    glyph(g, k);
    g.restore();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = false; t.minFilter = THREE.LinearFilter;
  return t;
}

/** Masque des problèmes de chaque bâtiment (dernière charge reçue) : lu par la fiche du bâtiment sélectionné. */
const masks = new Map<number, number>();
export const alertMaskOf = (id: number): number => masks.get(id) ?? 0;

export function createAlertesRenderPlugin(): RenderPlugin & { readonly count: () => number } {
  let ctx: RenderPluginContext | null = null;
  let points: THREE.Points | null = null;
  let mat: THREE.ShaderMaterial | null = null;
  let n = 0, time = 0;
  const geo = new THREE.BufferGeometry();

  const apply = (p: unknown): void => {
    const items = (p as AlertesPayload | undefined)?.items ?? [];
    const pos: number[] = [], kind: number[] = [], slot: number[] = [];
    masks.clear();
    for (let i = 0; i + 4 < items.length; i += 5) {
      const m = items[i + 1]!;
      masks.set(items[i]!, m);
      const ks = ALERT_KINDS.map((k, ki) => (m & ALERT_BITS[k] ? ki : -1)).filter((ki) => ki >= 0);
      // Pastilles côte à côte (décalage à l'écran, centré sur le bâtiment).
      ks.forEach((ki, j) => { pos.push(items[i + 2]!, items[i + 3]! + 6, items[i + 4]!); kind.push(ki); slot.push(j - (ks.length - 1) / 2); });
    }
    n = kind.length;
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('kind', new THREE.Float32BufferAttribute(kind, 1));
    geo.setAttribute('slot', new THREE.Float32BufferAttribute(slot, 1));
    geo.computeBoundingSphere();
    if (points) points.visible = n > 0;
  };

  return {
    id: 'alertes',
    count: () => n,
    init(c) {
      ctx = c;
      const map = atlas();
      mat = new THREE.ShaderMaterial({
        uniforms: { map: { value: map }, uTime: { value: 0 }, uPx: { value: c.renderer.getPixelRatio() }, uCells: { value: ALERT_KINDS.length }, uViewW: { value: 1000 } },
        vertexShader: `attribute float kind; attribute float slot; varying float vKind; uniform float uTime; uniform float uPx; uniform float uViewW;
          void main() { vKind = kind; vec3 p = position; p.y += sin(uTime * 2.2 + position.x * 0.07 + position.z * 0.05) * 0.8;
            vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
            gl_PointSize = clamp(12000.0 / max(1.0, -mv.z), 22.0, 40.0) * uPx;
            gl_Position.x += slot * gl_PointSize * 1.08 * 2.0 / uViewW * gl_Position.w; }`,
        fragmentShader: `uniform sampler2D map; uniform float uCells; varying float vKind;
          void main() { vec2 uv = vec2((gl_PointCoord.x + vKind) / uCells, 1.0 - gl_PointCoord.y); vec4 col = texture2D(map, uv);
            if (col.a < 0.2) discard; gl_FragColor = col; }`,
        transparent: true, depthTest: false, depthWrite: false,
      });
      points = new THREE.Points(geo, mat);
      points.name = 'alertes';
      points.frustumCulled = false;
      points.renderOrder = 20;
      points.visible = false;
      c.scene.add(points);
    },
    applySnapshotExt(p) { apply(p); },
    applyDeltaExt(p) { apply(p); },
    frame(dt) {
      if (!mat || !n) return;
      time += dt;
      mat.uniforms['uTime']!.value = time;
      mat.uniforms['uPx']!.value = ctx!.renderer.getPixelRatio();
      mat.uniforms['uViewW']!.value = ctx!.renderer.domElement.width || 1000;
    },
    dispose() { if (points) points.removeFromParent(); geo.dispose(); mat?.uniforms['map']?.value?.dispose?.(); mat?.dispose(); },
  };
}

export const alertesRenderPlugin = createAlertesRenderPlugin();
