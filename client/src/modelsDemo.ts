// Page de démonstration / vérification de la bibliothèque de modèles (client/modeles.html).
// Charge tous les GLB, les aligne par catégorie en instances fines, anime rotors et chariots,
// et publie dans window.__modeles les mesures utilisées par tools/verifier_modeles.cjs.

import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  Matrix,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
  VertexBuffer,
} from '@babylonjs/core';
import { createThinInstances, loadModelLibrary, partMatrix, type ModelTemplate } from './game/modelLibrary';

interface Mesure {
  mesure: [number, number, number];
  attendu: [number, number, number];
  triangles: number;
  /** z moyen des phares (code 1) et des feux arrière (code 2), en m. */
  zPhares: number | null;
  zFeux: number | null;
  /** Part des triangles dont l'ordre des sommets concorde avec la normale (orientation cohérente). */
  accordNormales: number;
}

declare global {
  interface Window {
    __modeles?: { pret: boolean; erreurs: Record<string, string>; mesures: Record<string, Mesure>; total: number };
  }
}

const canvas = document.getElementById('rendu') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(0.55, 0.68, 0.85, 1);
const cam = new ArcRotateCamera('cam', -2.2, 1.05, 0.45, new Vector3(0.12, 0, 0.05), scene);
cam.minZ = 0.0005;
cam.maxZ = 50;
cam.wheelPrecision = 2000;
cam.attachControl(canvas, true);
const hemi = new HemisphericLight('ciel', new Vector3(0, 1, 0), scene);
hemi.intensity = 0.55;
hemi.groundColor = new Color3(0.3, 0.28, 0.25);
const soleil = new DirectionalLight('soleil', new Vector3(-0.6, -0.5, 0.4), scene);
soleil.intensity = 1.1;
soleil.diffuse = new Color3(1.0, 0.85, 0.65);
const sol = MeshBuilder.CreateGround('sol', { width: 2, height: 2 }, scene);
const matSol = new StandardMaterial('sol', scene);
matSol.diffuseColor = new Color3(0.32, 0.36, 0.3);
matSol.specularColor = Color3.Black();
sol.material = matSol;
sol.position.y = -0.00002;

const etat = document.getElementById('etat') as HTMLSpanElement;

function mesurer(t: ModelTemplate): Mesure {
  const lo = new Vector3(Infinity, Infinity, Infinity);
  const hi = new Vector3(-Infinity, -Infinity, -Infinity);
  const add = (pos: ArrayLike<number> | null, off: Vector3) => {
    if (!pos) return;
    for (let i = 0; i < pos.length; i += 3) {
      const v = new Vector3(pos[i] + off.x, pos[i + 1] + off.y, pos[i + 2] + off.z);
      lo.minimizeInPlace(v);
      hi.maximizeInPlace(v);
    }
  };
  add(t.mesh.getVerticesData(VertexBuffer.PositionKind), Vector3.Zero());
  for (const p of Object.values(t.parts)) add(p.mesh.getVerticesData(VertexBuffer.PositionKind), p.pivot);
  const size = hi.subtract(lo).scale(1000);
  // Position moyenne des phares et feux (repère avant/arrière)
  const pos = t.mesh.getVerticesData(VertexBuffer.PositionKind) ?? [];
  const uv = t.mesh.getVerticesData(VertexBuffer.UVKind) ?? [];
  const z: Record<number, number[]> = { 1: [], 2: [] };
  for (let i = 0; i < uv.length / 2; i++) {
    const c = Math.round(uv[i * 2]);
    if (c === 1 || c === 2) z[c].push(pos[i * 3 + 2] * 1000);
  }
  // Orientation : produit vectoriel des arêtes comparé à la normale de sommet (repère gauche de Babylon :
  // une face avant a l'ordre horaire, donc (v1 - v0) × (v2 - v0) opposé à la normale sortante).
  const nor = t.mesh.getVerticesData(VertexBuffer.NormalKind) ?? [];
  const ind = t.mesh.getIndices() ?? [];
  let accord = 0;
  for (let i = 0; i < ind.length; i += 3) {
    const [a, b, c] = [ind[i], ind[i + 1], ind[i + 2]];
    const e1 = new Vector3(pos[b * 3] - pos[a * 3], pos[b * 3 + 1] - pos[a * 3 + 1], pos[b * 3 + 2] - pos[a * 3 + 2]);
    const e2 = new Vector3(pos[c * 3] - pos[a * 3], pos[c * 3 + 1] - pos[a * 3 + 1], pos[c * 3 + 2] - pos[a * 3 + 2]);
    const n = new Vector3(nor[a * 3] + nor[b * 3] + nor[c * 3], nor[a * 3 + 1] + nor[b * 3 + 1] + nor[c * 3 + 1],
      nor[a * 3 + 2] + nor[b * 3 + 2] + nor[c * 3 + 2]);
    if (Vector3.Dot(Vector3.Cross(e1, e2), n) < 0) accord++;
  }
  const moy = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const d = t.info.dimensions_m;
  return {
    mesure: [size.x, size.y, size.z],
    attendu: [d.largeur, d.hauteur, d.longueur],
    triangles: (t.mesh.getTotalIndices() + Object.values(t.parts).reduce((s, p) => s + p.mesh.getTotalIndices(), 0)) / 3,
    zPhares: moy(z[1]),
    zFeux: moy(z[2]),
    accordNormales: ind.length ? accord / (ind.length / 3) : 1,
  };
}

async function main(): Promise<void> {
  const lib = await loadModelLibrary(scene, { onProgress: (n, tot) => (etat.textContent = `${n} / ${tot}`) });
  const mesures: Record<string, Mesure> = {};
  // Disposition : une rangée par catégorie, espacée selon la plus grande longueur de la rangée.
  const ordre = ['vehicule', 'rail', 'mobilier_urbain', 'toiture', 'arbre', 'avion', 'navire', 'port', 'energie'];
  const parCat = new Map<string, ModelTemplate[]>();
  for (const t of lib.templates.values()) {
    const l = parCat.get(t.info.categorie) ?? [];
    l.push(t);
    parCat.set(t.info.categorie, l);
  }
  const places = new Map<string, Vector3>();
  let zc = 0;
  for (const cat of [...ordre, ...[...parCat.keys()].filter((c) => !ordre.includes(c))]) {
    const l = (parCat.get(cat) ?? []).sort((a, b) => a.id.localeCompare(b.id));
    if (!l.length) continue;
    const lmax = Math.max(...l.map((t) => t.sizeKm.z));
    const marge = Math.max(0.004, lmax * 0.15);
    let x = 0;
    for (const t of l) {
      const larg = Math.max(t.sizeKm.x, 0.002);
      places.set(t.id, new Vector3(x + larg / 2, 0, zc + lmax / 2));
      x += larg + marge;
    }
    zc += lmax + marge;
  }
  const focus = (id: string, k = 2.2) => {
    const t = lib.templates.get(id);
    const pl = places.get(id);
    if (!t || !pl) return;
    cam.target.copyFrom(pl.add(new Vector3(0, t.sizeKm.y / 2, 0)));
    cam.radius = k * Math.max(t.sizeKm.x, t.sizeKm.y, t.sizeKm.z);
  };
  const animes: (() => void)[] = [];
  const ids = [...lib.templates.keys()].sort();
  for (const id of ids) {
    const t = lib.templates.get(id)!;
    mesures[id] = mesurer(t);
    const pl = places.get(id)!;
    const px = pl.x;
    const pz = pl.z;
    const buf = createThinInstances(t, 1, { colors: t.info.peignable });
    buf.set(0, px, 0, pz, 0);
    if (t.info.peignable) buf.setColor(0, 0.55 + 0.4 * Math.random(), 0.2 + 0.5 * Math.random(), 0.25);
    buf.commit();
    if (t.lods.length) {
      const lod = createThinInstances(t, 1, { source: t.lods[0] });
      lod.set(0, px, 0, pz + t.sizeKm.z * 1.1 + 0.004, 0);
      lod.commit();
    }
    const monde = Matrix.Translation(px, 0, pz);
    for (const p of Object.values(t.parts)) {
      const pb = createThinInstances(t, 1, { source: p.mesh });
      const info = p.info;
      animes.push(() => {
        const s = performance.now() / 1000;
        let local = Matrix.Identity();
        if (info?.type === 'rotation' && info.axe === 'z') local = Matrix.RotationZ(s * 1.2);
        else if (info?.type === 'rotation' && info.axe === 'y') local = Matrix.RotationY(Math.sin(s * 0.2) * 0.6);
        else if (info?.type === 'translation' && info.course_m) {
          const [a, b] = info.course_m;
          const k = (Math.sin(s * 0.5) * 0.5 + 0.5) * (b - a) + a;
          const pv = info.pivot_m ?? [0, 0, 0];
          const d = (k - (info.axe === 'z' ? pv[2] : pv[0])) * 0.001;
          local = info.axe === 'z' ? Matrix.Translation(0, 0, d) : Matrix.Translation(d, 0, 0);
        }
        partMatrix(p, local, monde).copyToArray(pb.matrices, 0);
        pb.count = 1;
        pb.commit();
      });
    }
  }
  scene.onBeforeRenderObservable.add(() => animes.forEach((f) => f()));
  const nuit = (n: number) => {
    lib.setNightLevel(n);
    hemi.intensity = n ? 0.08 : 0.55;
    soleil.intensity = n ? 0.05 : 1.1;
    scene.clearColor = n ? new Color4(0.02, 0.03, 0.06, 1) : new Color4(0.55, 0.68, 0.85, 1);
  };
  (document.getElementById('jour') as HTMLButtonElement).onclick = () => nuit(0);
  (document.getElementById('nuit') as HTMLButtonElement).onclick = () => nuit(1);
  const erreurs = Object.fromEntries(lib.errors);
  etat.textContent = `${lib.templates.size} modèles, ${lib.errors.size} erreur(s)`;
  window.__modeles = { pret: true, erreurs, mesures, total: ids.length };
  (window as unknown as { __nuit: (n: number) => void; __cam: ArcRotateCamera }).__nuit = nuit;
  (window as unknown as { __cam: ArcRotateCamera }).__cam = cam;
  (window as unknown as { __focus: typeof focus }).__focus = focus;
  cam.target.set(0.06, 0, 0.02);
  cam.radius = 0.12;
}

main().catch((e) => {
  etat.textContent = 'erreur : ' + (e instanceof Error ? e.message : String(e));
  window.__modeles = { pret: true, erreurs: { _global: String(e) }, mesures: {}, total: 0 };
});
engine.runRenderLoop(() => scene.render());
window.addEventListener('resize', () => engine.resize());
