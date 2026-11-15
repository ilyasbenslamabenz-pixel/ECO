/**
 * Rendu du module « secteurs » : contour de chaque secteur posé sur le terrain, visible pendant que le panneau
 * Secteurs est ouvert ou avec le calque Quartiers (menu Calques).
 */
import * as THREE from 'three';
import type { SecteursState } from '../../shared/secteurs';
import type { RenderPlugin, RenderPluginContext } from './types';

let highlight = false, layer = false;
let groupRef: THREE.Group | null = null;
const sync = (): void => { if (groupRef) groupRef.visible = highlight || layer; };
/** Panneau Secteurs ouvert. */
export function setSecteursHighlight(v: boolean): void { highlight = v; sync(); }
/** Calque « Quartiers » du menu Calques. */
export function setSecteursLayer(v: boolean): void { layer = v; sync(); }

export function createSecteursRenderPlugin(): RenderPlugin {
  let ctx: RenderPluginContext | null = null;
  const group = new THREE.Group();
  group.name = 'secteurs';
  const mat = new THREE.LineBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.95, depthTest: false });
  const apply = (p: unknown): void => {
    for (const c of [...group.children]) { group.remove(c); (c as THREE.Line).geometry.dispose(); }
    const list = (p as SecteursState | undefined)?.secteurs ?? [];
    if (!ctx) return;
    for (const d of list) {
      const pts: THREE.Vector3[] = [];
      const edge = (ax: number, az: number, bx: number, bz: number): void => {
        const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / 16));
        for (let i = 0; i < n; i++) { const t = i / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t; pts.push(new THREE.Vector3(x, ctx!.heightAt(x, z) + 1.5, z)); }
      };
      edge(d.x0, d.z0, d.x1, d.z0); edge(d.x1, d.z0, d.x1, d.z1); edge(d.x1, d.z1, d.x0, d.z1); edge(d.x0, d.z1, d.x0, d.z0);
      const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), mat);
      line.renderOrder = 15;
      group.add(line);
    }
  };
  return {
    id: 'secteurs',
    init(c) { ctx = c; groupRef = group; group.visible = highlight || layer; c.scene.add(group); },
    applySnapshotExt(p) { apply(p); },
    applyDeltaExt(p) { apply(p); },
    dispose() { apply(undefined); group.removeFromParent(); mat.dispose(); },
  };
}

export const secteursRenderPlugin = createSecteursRenderPlugin();
