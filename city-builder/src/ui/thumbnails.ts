/**
 * Vignettes des VRAIS modèles du catalogue pour la barre de construction et les panneaux.
 * Chaque vignette est un rendu Three.js du GLB, éclairé par un environnement de studio (RoomEnvironment),
 * cadré automatiquement sur la boîte englobante en vue 3/4 ; file séquentielle, cache mémoire.
 *
 * Rendu avec le RENDERER PRINCIPAL dans une cible hors écran (jamais de second contexte WebGL) : sur iPhone,
 * un second contexte qui renvoyait au GPU, en pleine taille, les textures d'une soixantaine de modèles à
 * l'ouverture du menu Bâtiments faisait planter Safari. Les textures sont ainsi partagées avec la scène
 * principale (envoyées une seule fois). Sans renderer partagé (tests, outils), un contexte dédié est créé.
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

export interface ThumbnailOptions {
  /** Renderer principal à partager (recommandé : aucun contexte WebGL supplémentaire). */
  renderer?: THREE.WebGLRenderer | null;
  width?: number;
  height?: number;
  /** LOD demandé (le plus détaillé disponible ≤ lod) ; Infinity = le plus léger. */
  lod?: number;
  /**
   * Libère du GPU les textures et géométries du modèle juste après sa vignette (mode allégé) : three les
   * renverra si la scène s'en sert ensuite ; le modèle reste en cache côté CPU.
   */
  releaseAfter?: boolean;
}

export class ThumbnailRenderer implements ThumbnailSource {
  private cache = new Map<string, Promise<string>>();
  private queue: (() => Promise<void>)[] = [];
  private running = false;
  /** Renderer partagé (principal) ou dédié (créé à la demande, libéré après inactivité). */
  private readonly shared: THREE.WebGLRenderer | null;
  private own: THREE.WebGLRenderer | null = null;
  private target: THREE.WebGLRenderTarget | null = null;
  private scene: THREE.Scene | null = null;
  private camera = new THREE.PerspectiveCamera(30, 4 / 3, 0.1, 5000);
  private idleTimer = 0;
  private readonly width: number;
  private readonly height: number;
  private readonly lod: number;
  private readonly releaseAfter: boolean;
  rendered = 0;

  constructor(private models: ThumbModelSource, opts: ThumbnailOptions = {}) {
    this.shared = opts.renderer ?? null;
    this.width = opts.width ?? 256;
    this.height = opts.height ?? 192;
    this.lod = opts.lod ?? 1;
    this.releaseAfter = opts.releaseAfter ?? false;
  }

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
    let renderer = this.shared ?? this.own;
    if (!renderer) {
      const canvas = document.createElement('canvas');
      canvas.width = this.width; canvas.height = this.height;
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1);
      renderer.setSize(this.width, this.height, false);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.own = renderer;
    }
    if (!this.target) {
      this.target = new THREE.WebGLRenderTarget(this.width, this.height, { samples: 4, type: THREE.UnsignedByteType });
      this.target.texture.colorSpace = THREE.SRGBColorSpace;
    }
    if (!this.scene) {
      const scene = new THREE.Scene();
      const pm = new THREE.PMREMGenerator(renderer);
      scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      pm.dispose();
      const sun = new THREE.DirectionalLight(0xfff0dc, 1.6);
      sun.position.set(-3, 5, 4);
      scene.add(sun, new THREE.HemisphereLight(0xd9e6f5, 0x3a352c, 0.4));
      this.scene = scene;
    }
    return { renderer, scene: this.scene };
  }

  private release(): void {
    this.scene?.environment?.dispose();
    this.scene = null;
    this.target?.dispose();
    this.target = null;
    if (this.own) { this.own.dispose(); this.own.forceContextLoss(); this.own = null; }
  }

  private async renderOne(assetId: string): Promise<string> {
    const src = await this.models.load(assetId, this.lod);
    const { renderer, scene } = this.ensure();
    const target = this.target!;
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
    this.camera.aspect = this.width / this.height;
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.camera.near = dist / 100; this.camera.far = dist * 4;
    this.camera.lookAt(center.x, center.y - size.y * 0.04, center.z);
    this.camera.updateProjectionMatrix();
    // État du renderer partagé sauvegardé puis rétabli (cible, fond, exposition, ombres).
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const prevTone = renderer.toneMapping, prevExp = renderer.toneMappingExposure;
    const prevShadowAuto = renderer.shadowMap.autoUpdate;
    const px = new Uint8Array(this.width * this.height * 4);
    try {
      renderer.shadowMap.autoUpdate = false;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, true, true);
      renderer.render(scene, this.camera);
      renderer.readRenderTargetPixels(target, 0, 0, this.width, this.height, px);
    } finally {
      renderer.setRenderTarget(prevTarget);
      renderer.setClearColor(prevClear, prevAlpha);
      renderer.toneMapping = prevTone; renderer.toneMappingExposure = prevExp;
      renderer.shadowMap.autoUpdate = prevShadowAuto;
      scene.remove(obj);
    }
    if (this.releaseAfter) {
      src.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
          for (const v of Object.values(mat)) if ((v as THREE.Texture | null)?.isTexture) (v as THREE.Texture).dispose();
        }
      });
    }
    this.rendered++;
    // Pixels lus de bas en haut : retournement vertical dans un canevas 2D, puis image WebP (ou PNG).
    const canvas = document.createElement('canvas');
    canvas.width = this.width; canvas.height = this.height;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(this.width, this.height);
    const row = this.width * 4;
    for (let y = 0; y < this.height; y++) img.data.set(px.subarray((this.height - 1 - y) * row, (this.height - y) * row), y * row);
    ctx.putImageData(img, 0, 0);
    let url = canvas.toDataURL('image/webp', 0.86);
    if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/png');
    return url;
  }
}
