/**
 * Panneaux de carrefour : « Stop » (octogone rouge) et « Cédez le passage » (triangle blanc bordé de rouge),
 * posés au trottoir de droite à la ligne d'arrêt, face aux véhicules qui arrivent. Données : module circulation
 * (`panneaux` = [x, y, z, cap, type] × n). Trois appels de rendu au plus (poteaux, plaques stop, plaques cédez).
 */
import * as THREE from 'three';

const POST_H = 2.1, PLATE = 0.78;

function plateTexture(kind: 1 | 2): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (!g) return null;
  if (kind === 1) {
    g.beginPath();
    for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + (i * Math.PI) / 4; g.lineTo(64 + Math.cos(a) * 62, 64 + Math.sin(a) * 62); }
    g.closePath(); g.fillStyle = '#ffffff'; g.fill();
    g.beginPath();
    for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + (i * Math.PI) / 4; g.lineTo(64 + Math.cos(a) * 56, 64 + Math.sin(a) * 56); }
    g.closePath(); g.fillStyle = '#c8102e'; g.fill();
    g.fillStyle = '#ffffff'; g.font = 'bold 34px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('STOP', 64, 66);
  } else {
    const tri = (r: number): void => { g.beginPath(); g.moveTo(64 - r, 64 - r * 0.62); g.lineTo(64 + r, 64 - r * 0.62); g.lineTo(64, 64 + r * 1.1); g.closePath(); };
    tri(60); g.fillStyle = '#c8102e'; g.fill();
    tri(42); g.fillStyle = '#ffffff'; g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Masque de forme (blanc sur noir) pour le dos des plaques : octogone ou triangle, sans motif. */
function plateMask(kind: 1 | 2): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#000'; g.fillRect(0, 0, 128, 128); g.fillStyle = '#fff'; g.beginPath();
  if (kind === 1) for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + (i * Math.PI) / 4; g.lineTo(64 + Math.cos(a) * 62, 64 + Math.sin(a) * 62); }
  else { g.moveTo(4, 64 - 37); g.lineTo(124, 64 - 37); g.lineTo(64, 64 + 66); }
  g.closePath(); g.fill();
  return new THREE.CanvasTexture(c);
}

export class JunctionSigns {
  readonly group = new THREE.Group();
  private posts: THREE.InstancedMesh | null = null;
  private plates: THREE.InstancedMesh[] = [];
  private readonly postGeo = new THREE.CylinderGeometry(0.045, 0.045, POST_H, 6).translate(0, POST_H / 2, 0);
  private readonly plateGeo = new THREE.PlaneGeometry(PLATE, PLATE);
  private readonly postMat = new THREE.MeshStandardMaterial({ color: 0x8a9099, metalness: 0.6, roughness: 0.4 });
  private readonly plateMats: THREE.MeshStandardMaterial[] = [];
  private readonly backMats: THREE.MeshStandardMaterial[] = [];
  private backs: THREE.InstancedMesh[] = [];

  constructor() {
    this.group.name = 'panneaux_carrefours';
    for (const k of [1, 2] as const) this.plateMats.push(new THREE.MeshStandardMaterial({ map: plateTexture(k), transparent: true, alphaTest: 0.5, side: THREE.FrontSide, roughness: 0.6 }));
    // Dos des plaques : gris métal uni, même découpe (octogone, triangle).
    for (const k of [1, 2] as const) this.backMats.push(new THREE.MeshStandardMaterial({ color: 0x9aa1a9, alphaMap: plateMask(k), transparent: true, alphaTest: 0.5, side: THREE.BackSide, metalness: 0.5, roughness: 0.5 }));
  }

  set(data: readonly number[] | undefined): void {
    this.clear();
    const n = data ? Math.floor(data.length / 5) : 0;
    if (!n || !data) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    this.posts = new THREE.InstancedMesh(this.postGeo, this.postMat, n);
    const counts = [0, 0];
    for (let i = 0; i < n; i++) counts[data[i * 5 + 4] === 1 ? 0 : 1]!++;
    const plates = [0, 1].map((k) => new THREE.InstancedMesh(this.plateGeo, this.plateMats[k]!, Math.max(1, counts[k]!)));
    const fill = [0, 0];
    for (let i = 0; i < n; i++) {
      const x = data[i * 5]!, y = data[i * 5 + 1]!, z = data[i * 5 + 2]!, head = data[i * 5 + 3]!, k = data[i * 5 + 4] === 1 ? 0 : 1;
      m.makeTranslation(x, y, z);
      this.posts.setMatrixAt(i, m);
      // Plaque face aux véhicules qui arrivent (cap = direction de leur marche).
      q.setFromAxisAngle(up, head + Math.PI);
      m.compose(new THREE.Vector3(x, y + POST_H - PLATE / 2 + 0.05, z), q, one);
      plates[k]!.setMatrixAt(fill[k]!++, m);
    }
    plates.forEach((p, k) => { p.count = counts[k]!; p.instanceMatrix.needsUpdate = true; });
    this.backs = plates.map((p, k) => { const b = new THREE.InstancedMesh(this.plateGeo, this.backMats[k]!, p.instanceMatrix.count); b.instanceMatrix = p.instanceMatrix; b.count = p.count; return b; });
    this.posts.instanceMatrix.needsUpdate = true;
    this.posts.castShadow = true;
    this.plates = plates;
    this.group.add(this.posts, ...plates, ...this.backs);
  }

  private clear(): void {
    for (const o of this.backs) o.removeFromParent();
    for (const o of [this.posts, ...this.plates]) if (o) { o.removeFromParent(); o.dispose(); }
    this.posts = null; this.plates = []; this.backs = [];
  }

  dispose(): void {
    this.clear();
    this.postGeo.dispose(); this.plateGeo.dispose(); this.postMat.dispose();
    for (const m of this.plateMats) { m.map?.dispose(); m.dispose(); }
    for (const m of this.backMats) { m.alphaMap?.dispose(); m.dispose(); }
  }
}
