/**
 * Vignettes des VRAIS modèles du catalogue pour la barre de construction et les panneaux.
 * Chaque vignette est un rendu Three.js du GLB (LOD le plus détaillé disponible ≤ `lod`), éclairé
 * par un environnement de studio (RoomEnvironment), cadré automatiquement sur la boîte
 * englobante en vue 3/4. Rendu dans un contexte WebGL hors écran dédié (créé à la demande,
 * libéré après inactivité) pour ne pas perturber le rendu principal ; file séquentielle, cache mémoire.
 * Propriétaire : agent construction/caméra/UI.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export interface ThumbModelSource { load(assetId: string, lod?: number): Promise<THREE.Group> }

export interface ThumbnailSource {
  /** URL (data:) de la vignette d'un asset ; rejetée si le modèle ne charge pas. */
  get(assetId: string): Promise<string>;
  /** Nombre de vignettes réellement rendues (diagnostic). */
  readonly rendered: number;
}

export class ThumbnailRenderer implements ThumbnailSource {
  private cache = new Map<string, Promise<string>>();
  private queue: (() => Promise<void>)[] = [];
  private running = false;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera = new THREE.PerspectiveCamera(30, 4 / 3, 0.1, 5000);
  private idleTimer = 0;
  rendered = 0;

  constructor(private models: ThumbModelSource, private width = 256, private height = 192, private lod = 1) {}

  get(assetId: string): Promise<string> {
    let p = this.cache.get(assetId);
    if (!p) {
      p = new Promise<string>((resolve, reject) => {
        this.queue.push(async () => {
          try { resolve(await this.renderOne(assetId)); } catch (e) { reject(e); }
        });
        void this.pump();
      });
      p.catch(() => this.cache.delete(assetId));
      this.cache.set(assetId, p);
    }
    return p;
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    window.clearTimeout(this.idleTimer);
    while (this.queue.length) {
      const job = this.queue.shift()!;
      await job();
      // Laisse respirer la boucle de rendu principale entre deux vignettes.
      await new Promise((r) => setTimeout(r, 0));
    }
    this.running = false;
    this.idleTimer = window.setTimeout(() => this.release(), 8000);
  }

  private ensure(): { renderer: THREE.WebGLRenderer; scene: THREE.Scene } {
    if (this.renderer && this.scene) return { renderer: this.renderer, scene: this.scene };
    const canvas = document.createElement('canvas');
    canvas.width = this.width; canvas.height = this.height;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(this.width, this.height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    const scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    const sun = new THREE.DirectionalLight(0xfff0dc, 1.6);
    sun.position.set(-3, 5, 4);
    scene.add(sun, new THREE.HemisphereLight(0xd9e6f5, 0x3a352c, 0.4));
    this.renderer = renderer; this.scene = scene;
    return { renderer, scene };
  }

  private release(): void {
    if (!this.renderer) return;
    this.scene?.environment?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer = null; this.scene = null;
  }

  private async renderOne(assetId: string): Promise<string> {
    const src = await this.models.load(assetId, this.lod);
    const { renderer, scene } = this.ensure();
    const obj = src.clone(true);
    scene.add(obj);
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    // Cadrage 3/4 : la sphère englobante remplit l'image.
    const radius = Math.max(0.5, size.length() / 2);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const dist = (radius / Math.sin(fov / 2)) * 0.92;
    const dir = new THREE.Vector3(0.62, 0.48, 0.92).normalize();
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.camera.near = dist / 100; this.camera.far = dist * 4;
    this.camera.lookAt(center.x, center.y - size.y * 0.04, center.z);
    this.camera.updateProjectionMatrix();
    renderer.setClearColor(0x000000, 0);
    renderer.render(scene, this.camera);
    scene.remove(obj);
    this.rendered++;
    const canvas = renderer.domElement;
    let url = canvas.toDataURL('image/webp', 0.86);
    if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/png');
    return url;
  }
}
