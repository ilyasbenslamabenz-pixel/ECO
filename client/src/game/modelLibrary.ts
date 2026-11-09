// Bibliothèque de modèles 3D (GLB générés par Blender, cf. eco-nation/tools/blender/).
//
// loadModelLibrary(scene) charge chaque GLB listé dans /assets/models/manifest.json et renvoie, par modèle,
// un mesh gabarit UNIQUE fusionné (km, masqué, non cliquable), prêt pour les instances fines :
//   - `mesh`   : corps fusionné, un seul matériau partagé (couleurs de sommets) ;
//   - `lights` : faces émissives (phares, feux, vitrages…) en couleurs « nuit », à n'afficher que la nuit ;
//   - `parts`  : sous-parties animées restées séparées (rotor, nacelle, chariot), avec leur pivot ;
//   - `lods`   : niveaux de détail lointains (arbres : `lod1`).
// createThinInstances(gabarit, n) crée un tampon d'instances fines partagé par le corps et ses feux.
//
// Ce module ne touche à aucun autre module de la carte : l'intégration est laissée à world.ts & co.

import '@babylonjs/loaders/glTF';
import {
  Color3,
  Matrix,
  Mesh,
  SceneLoader,
  StandardMaterial,
  Vector3,
  VertexBuffer,
  VertexData,
  type AbstractMesh,
  type Scene,
} from '@babylonjs/core';
import {
  DEFAULT_NIGHT_CODES,
  EMISSIVE_COLORS,
  METRES_EN_KM,
  colorsLinearToSrgb,
  extractEmissiveTriangles,
  writeInstanceMatrix,
  type Manifest,
  type ManifestEntry,
  type ManifestPart,
} from './modelLibraryUtils';
import { setThinCount } from './thin';

export * from './modelLibraryUtils';

export interface ModelPart {
  name: string;
  /** Géométrie de la partie, centrée sur son pivot (km). Masquée, comme le gabarit. */
  mesh: Mesh;
  /** Position du pivot dans le repère du modèle (km). */
  pivot: Vector3;
  info: ManifestPart | null;
}

export interface ModelTemplate {
  id: string;
  /** Gabarit fusionné : masqué, non cliquable, géométrie en km. */
  mesh: Mesh;
  /** Faces émissives (couleurs de nuit), ou null. Même repère que `mesh`. */
  lights: Mesh | null;
  parts: Record<string, ModelPart>;
  /** Niveaux de détail supplémentaires (du plus détaillé au plus simple), même repère. */
  lods: Mesh[];
  /** Dimensions en km (largeur X, hauteur Y, longueur Z). */
  sizeKm: Vector3;
  info: ManifestEntry;
}

export interface ModelLibrary {
  templates: Map<string, ModelTemplate>;
  get(id: string): ModelTemplate | undefined;
  /** Matériau partagé des corps (StandardMaterial, couleurs de sommets). */
  bodyMaterial: StandardMaterial;
  /** Matériau partagé des faces émissives. */
  lightsMaterial: StandardMaterial;
  /** 0 = jour (feux masqués), 1 = pleine nuit. Affiche/masque les meshes de feux créés par createThinInstances. */
  setNightLevel(level: number): void;
  /** Erreurs de chargement (modèle → message) ; les modèles en erreur sont absents de `templates`. */
  errors: Map<string, string>;
  dispose(): void;
}

export interface LoadModelLibraryOptions {
  /** URL du dossier des modèles (défaut : `/assets/models/`). */
  baseUrl?: string;
  /** Ne charger que ces modèles. */
  ids?: string[];
  /** Codes émissifs inclus dans les meshes `lights` (défaut : tous sauf 9, vitrage sombre). */
  nightCodes?: number[];
  /** Facteur d'échelle mètres → unités de jeu (défaut 0,001 : km). */
  scale?: number;
  onProgress?: (loaded: number, total: number) => void;
}

const lightsMeshes = new Set<Mesh>();
let currentNight = 0;

/** Charge la bibliothèque. Ne lève pas d'exception pour un GLB manquant : voir `errors`. */
export async function loadModelLibrary(scene: Scene, options: LoadModelLibraryOptions = {}): Promise<ModelLibrary> {
  const baseUrl = options.baseUrl ?? '/assets/models/';
  const scale = options.scale ?? METRES_EN_KM;
  const nightCodes = options.nightCodes ?? DEFAULT_NIGHT_CODES;
  const manifest: Manifest = await (await fetch(baseUrl + 'manifest.json')).json();
  const entries = manifest.modeles.filter((m) => !options.ids || options.ids.includes(m.id));

  const bodyMaterial = new StandardMaterial('modeles_corps', scene);
  bodyMaterial.diffuseColor = Color3.White();
  bodyMaterial.specularColor = new Color3(0.08, 0.08, 0.08);
  bodyMaterial.specularPower = 32;
  const lightsMaterial = new StandardMaterial('modeles_feux', scene);
  // Couleur affichée = couleur émissive × couleur de sommet (code émissif) : indépendante de l'éclairage.
  lightsMaterial.disableLighting = true;
  lightsMaterial.diffuseColor = Color3.Black();
  lightsMaterial.specularColor = Color3.Black();
  lightsMaterial.emissiveColor = Color3.Black();
  lightsMaterial.zOffset = -2; // dessiné par-dessus les faces coplanaires du corps

  const templates = new Map<string, ModelTemplate>();
  const errors = new Map<string, string>();
  let loaded = 0;
  await Promise.all(
    entries.map(async (entry) => {
      try {
        templates.set(entry.id, await loadOne(scene, baseUrl, entry, scale, nightCodes, bodyMaterial, lightsMaterial));
      } catch (e) {
        errors.set(entry.id, e instanceof Error ? e.message : String(e));
      } finally {
        options.onProgress?.(++loaded, entries.length);
      }
    }),
  );

  return {
    templates,
    errors,
    get: (id) => templates.get(id),
    bodyMaterial,
    lightsMaterial,
    setNightLevel(level: number) {
      const night = Math.max(0, Math.min(1, level));
      currentNight = night;
      lightsMaterial.emissiveColor = new Color3(night, night, night);
      for (const m of lightsMeshes) {
        if (m.isDisposed()) lightsMeshes.delete(m);
        else if (m.material === lightsMaterial) m.setEnabled(night > 0.02);
      }
    },
    dispose() {
      for (const t of templates.values()) {
        t.mesh.dispose();
        t.lights?.dispose();
        for (const p of Object.values(t.parts)) p.mesh.dispose();
        for (const l of t.lods) l.dispose();
      }
      bodyMaterial.dispose();
      lightsMaterial.dispose();
    },
  };
}

async function loadOne(
  scene: Scene,
  baseUrl: string,
  entry: ManifestEntry,
  scale: number,
  nightCodes: number[],
  bodyMaterial: StandardMaterial,
  lightsMaterial: StandardMaterial,
): Promise<ModelTemplate> {
  const res = await SceneLoader.ImportMeshAsync('', baseUrl, entry.fichier, scene);
  const partNames = new Set(entry.parties_animees.filter((p) => p.type !== 'emissif').map((p) => p.nom));
  const lodNames = entry.lods.map((l) => l.noeud);
  const groups = new Map<string, AbstractMesh[]>();
  for (const m of res.meshes) {
    if (!m.getTotalVertices()) continue;
    m.computeWorldMatrix(true);
    // Nom du nœud glTF : le mesh porte le nom du nœud (suffixe _primitiveN si plusieurs primitives).
    const node = m.name.replace(/_primitive\d+$/, '');
    const key = partNames.has(node) ? node : lodNames.length && lodNames.indexOf(node) > 0 ? node : '__corps__';
    const list = groups.get(key) ?? [];
    list.push(m);
    groups.set(key, list);
  }
  const build = (name: string, meshes: AbstractMesh[], pivotM: Vector3 | null): Mesh => {
    const datas = meshes.map((m) => {
      const vd = VertexData.ExtractFromMesh(m as Mesh, true, true);
      vd.transform(m.getWorldMatrix());
      return vd;
    });
    const vd = datas[0];
    if (datas.length > 1) vd.merge(datas.slice(1), true);
    const p = vd.positions as Float32Array | number[];
    const off = pivotM ?? Vector3.Zero();
    for (let i = 0; i < p.length; i += 3) {
      p[i] = (p[i] - off.x) * scale;
      p[i + 1] = (p[i + 1] - off.y) * scale;
      p[i + 2] = (p[i + 2] - off.z) * scale;
    }
    if (vd.colors) colorsLinearToSrgb(vd.colors as Float32Array);
    // Le nœud racine glTF (échelle z = -1) a un déterminant négatif : VertexData.transform a inversé
    // l'ordre des sommets, alors que le rendu Babylon suppose l'ordre glTF d'origine une fois la matrice
    // « cuite » (sinon les faces avant seraient éliminées). On rétablit l'ordre glTF.
    const idx = vd.indices as number[] | Uint32Array | Uint16Array;
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
    const mesh = new Mesh(name, scene);
    vd.applyToMesh(mesh, false);
    mesh.material = bodyMaterial;
    hideTemplate(mesh);
    return mesh;
  };

  const corps = groups.get('__corps__') ?? [];
  if (!corps.length) throw new Error(`${entry.fichier} : aucune géométrie`);
  const mesh = build(`gabarit_${entry.id}`, corps, null);

  // Feux : faces émissives du corps.
  let lights: Mesh | null = null;
  const lg = extractEmissiveTriangles(
    {
      positions: mesh.getVerticesData(VertexBuffer.PositionKind) ?? [],
      normals: mesh.getVerticesData(VertexBuffer.NormalKind) ?? [],
      uvs: mesh.getVerticesData(VertexBuffer.UVKind),
      indices: mesh.getIndices() ?? [],
    },
    nightCodes,
    EMISSIVE_COLORS,
  );
  if (lg) {
    lights = new Mesh(`feux_${entry.id}`, scene);
    const vd = new VertexData();
    vd.positions = lg.positions;
    vd.normals = lg.normals;
    vd.colors = lg.colors;
    vd.indices = lg.indices;
    vd.applyToMesh(lights, false);
    lights.material = lightsMaterial;
    hideTemplate(lights);
  }

  const parts: Record<string, ModelPart> = {};
  for (const name of partNames) {
    const ms = groups.get(name);
    if (!ms?.length) continue;
    const pivotM = ms[0].getAbsolutePosition().clone();
    const pm = build(`gabarit_${entry.id}_${name}`, ms, pivotM);
    parts[name] = {
      name,
      mesh: pm,
      pivot: pivotM.scale(scale),
      info: entry.parties_animees.find((p) => p.nom === name) ?? null,
    };
  }
  const lods: Mesh[] = [];
  for (const name of lodNames.slice(1)) {
    const ms = groups.get(name);
    if (ms?.length) lods.push(build(`gabarit_${entry.id}_${name}`, ms, null));
  }

  // Nettoyage des nœuds et matériaux importés.
  const imported = new Set(res.meshes.map((m) => m.material).filter((m) => !!m));
  for (const m of res.meshes) m.dispose(false, false);
  for (const tn of res.transformNodes) tn.dispose();
  for (const mat of imported) mat?.dispose(true, true);

  const d = entry.dimensions_m;
  return {
    id: entry.id,
    mesh,
    lights,
    parts,
    lods,
    sizeKm: new Vector3(d.largeur * scale, d.hauteur * scale, d.longueur * scale),
    info: entry,
  };
}

function hideTemplate(m: Mesh): void {
  m.isPickable = false;
  m.isVisible = false;
  m.setEnabled(false);
  m.doNotSyncBoundingInfo = true;
  m.freezeWorldMatrix();
}

// ---------------------------------------------------------------------------
// Instances fines
// ---------------------------------------------------------------------------

/**
 * Matrice monde d'une sous-partie animée : transformation locale autour du pivot
 * (ex. Matrix.RotationZ(angle) pour un rotor), puis pivot, puis matrice monde du modèle.
 */
export function partMatrix(part: ModelPart, local: Matrix, modelWorld: Matrix): Matrix {
  return local.multiply(Matrix.Translation(part.pivot.x, part.pivot.y, part.pivot.z)).multiply(modelWorld);
}

export interface ThinInstanceBuffer {
  /** Meshes dessinés (clone du corps, et clone des feux si présents). */
  meshes: Mesh[];
  body: Mesh;
  lights: Mesh | null;
  capacity: number;
  /** Matrices (16 flottants par instance), partagées par le corps et les feux. */
  matrices: Float32Array;
  /** Couleurs d'instance RGBA (si `colors: true`), multipliées par les couleurs de sommets du corps. */
  colors: Float32Array | null;
  /** Nombre d'instances dessinées (≤ capacity). */
  count: number;
  /** Place l'instance i : position (km), lacet (radians, 0 = avant vers +Z), échelle uniforme. */
  set(i: number, x: number, y: number, z: number, yaw?: number, scale?: number): void;
  setColor(i: number, r: number, g: number, b: number): void;
  /** Envoie les tampons modifiés au GPU (à appeler après une série de set). */
  commit(): void;
  dispose(): void;
}

export interface ThinInstanceOptions {
  name?: string;
  /** Activer une couleur par instance (carrosseries « peignables »). */
  colors?: boolean;
  /**
   * Tampon mis à jour souvent (véhicules en mouvement) : tampon GPU dynamique mis à jour en place.
   * Sinon (défaut) le tampon GPU est statique et recréé à chaque commit (placements figés : arbres, mobilier).
   */
  dynamic?: boolean;
  /** Ne pas dessiner les feux (même la nuit). */
  noLights?: boolean;
  /** Mesh à instancier à la place du corps (ex. `template.lods[0]` ou `template.parts.rotor.mesh`). */
  source?: Mesh;
}

/**
 * Crée un tampon d'instances fines à partir d'un gabarit. Le gabarit reste masqué : on dessine des
 * clones qui partagent sa géométrie. Les feux (si présents) partagent les mêmes matrices et ne
 * s'affichent que la nuit (ModelLibrary.setNightLevel).
 */
export function createThinInstances(
  template: ModelTemplate | Mesh,
  capacity: number,
  opts: ThinInstanceOptions = {},
): ThinInstanceBuffer {
  const isTpl = !(template instanceof Mesh);
  const src = opts.source ?? (isTpl ? (template as ModelTemplate).mesh : (template as Mesh));
  const name = opts.name ?? `${src.name}_instances`;
  const show = (m: Mesh, nm: string): Mesh => {
    const c = m.clone(nm, null, true, false);
    // Les tampons d'instances fines sont attachés à la géométrie : deux tampons créés depuis le même gabarit
    // (ex. deux classes d'avions dessinées avec le même modèle) se les disputeraient. Géométrie propre au clone.
    c.makeGeometryUnique();
    c.isPickable = false;
    c.isVisible = true;
    c.setEnabled(true);
    c.alwaysSelectAsActiveMesh = true;
    c.doNotSyncBoundingInfo = true;
    return c;
  };
  const body = show(src, name);
  const lightsSrc = !opts.noLights && isTpl && !opts.source ? (template as ModelTemplate).lights : null;
  const lights = lightsSrc ? show(lightsSrc, `${name}_feux`) : null;
  const matrices = new Float32Array(capacity * 16);
  const colors = opts.colors ? new Float32Array(capacity * 4).fill(1) : null;
  const dynamic = !!opts.dynamic;
  const meshes = lights ? [body, lights] : [body];
  const upload = () => {
    for (const m of meshes) m.thinInstanceSetBuffer('matrix', matrices, 16, !dynamic);
    if (colors) body.thinInstanceSetBuffer('color', colors, 4, !dynamic);
  };
  upload();
  for (const m of meshes) setThinCount(m, 0);
  if (lights) {
    lightsMeshes.add(lights);
    lights.setEnabled(currentNight > 0.02);
  }
  const buf: ThinInstanceBuffer = {
    meshes,
    body,
    lights,
    capacity,
    matrices,
    colors,
    count: 0,
    set(i, x, y, z, yaw = 0, scale = 1) {
      writeInstanceMatrix(matrices, i, x, y, z, yaw, scale);
      if (i >= buf.count) buf.count = i + 1;
    },
    setColor(i, r, g, b) {
      if (!colors) return;
      colors[i * 4] = r;
      colors[i * 4 + 1] = g;
      colors[i * 4 + 2] = b;
      colors[i * 4 + 3] = 1;
    },
    commit() {
      if (dynamic) {
        for (const m of meshes) m.thinInstanceBufferUpdated('matrix');
        if (colors) body.thinInstanceBufferUpdated('color');
      } else {
        upload(); // un tampon GPU statique ne se met pas à jour en place
      }
      for (const m of meshes) setThinCount(m, buf.count);
    },
    dispose() {
      for (const m of meshes) {
        lightsMeshes.delete(m);
        m.dispose();
      }
    },
  };
  return buf;
}
