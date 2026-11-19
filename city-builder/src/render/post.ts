/**
 * Effets d'image (ordinateur) : occlusion ambiante en espace écran (GTAO, three/addons), comme dans les city-builders
 * récents — recoins, pieds de mur, dessous de toits et rues entre immeubles assombris : les volumes ressortent.
 *
 * Chaîne : rendu de la scène dans une cible HDR (demi-flottants, MSAA ×4, profondeur en texture) → GTAO lu depuis
 * CETTE profondeur (normales reconstruites : aucune seconde passe de la scène) → débruitage → copie à l'écran. Tone
 * mapping et étalonnage de la palette (src/render/palette.ts) restent appliqués dans les shaders, comme sans effets.
 *
 * Activé par l'option « Effets d'image » (src/ui/options.ts) ; « auto » = ordinateur à GPU dédié, jamais en rendu
 * logiciel ni sur téléphone. Les paliers de qualité automatiques le coupent quand la cadence décroche
 * (src/render/quality-tiers.ts, `ao`).
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { CopyShader } from 'three/addons/shaders/CopyShader.js';

/** Réglages de l'occlusion, à l'échelle de la ville (mètres). */
export const AO_PARAMS = {
  /** Rayon de recherche (m) : recoins de façade, rues étroites ; pas assez pour noircir une place. */
  radius: 4.5,
  distanceExponent: 1.6,
  /** Épaisseur supposée des objets (m) : un lampadaire n'assombrit pas toute la rue derrière lui. */
  thickness: 2.5,
  scale: 1.15,
  samples: 16,
  /** Atténuation avec la distance à la caméra (vue aérienne lointaine : effet discret). */
  distanceFallOff: 0.6,
  screenSpaceRadius: false,
} as const;
/** Intensité du mélange (0..1). */
export const AO_INTENSITY = 0.85;

export class PostEffects {
  private readonly composer: EffectComposer;
  private readonly gtao: GTAOPass;
  private readonly size = new THREE.Vector2();
  private w = 0;
  private h = 0;
  /** Effets voulus par le joueur (option) et autorisés par le palier courant. */
  wanted = false;
  allowedByTier = true;

  constructor(private readonly renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    renderer.getDrawingBufferSize(this.size);
    this.w = Math.max(1, this.size.x); this.h = Math.max(1, this.size.y);
    const depthTexture = new THREE.DepthTexture(this.w, this.h);
    depthTexture.type = THREE.UnsignedIntType;
    const target = new THREE.WebGLRenderTarget(this.w, this.h, { type: THREE.HalfFloatType, samples: 4, depthTexture });
    target.texture.name = 'effets-image';
    this.composer = new EffectComposer(renderer, target);
    // Couleurs identiques au rendu direct : three n'applique tone mapping, étalonnage et encodage sRGB DANS les
    // shaders (avant le brouillard, comme à l'écran) que pour l'écran ou une cible « XR ». Les deux cibles du
    // composeur sont marquées ainsi ; l'image finale est ensuite copiée telle quelle (aucune conversion de plus :
    // sans cela, brouillard et fond du ciel passaient par la courbe et l'image était délavée).
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      (rt as unknown as { isXRRenderTarget: boolean }).isXRRenderTarget = true;
      rt.texture.colorSpace = THREE.SRGBColorSpace;
    }
    // Taille en pixels réels gérée ici (getDrawingBufferSize) : le composeur ne multiplie pas une seconde fois.
    this.composer.setPixelRatio(1);
    this.composer.setSize(this.w, this.h);
    this.composer.addPass(new RenderPass(scene, camera));
    this.gtao = new GTAOPass(scene, camera, this.w, this.h, { depthTexture } as never);
    this.gtao.updateGtaoMaterial({ ...AO_PARAMS });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    // `?ao=0..1` : intensité imposée (mesures ; 0 = chaîne d'effets sans occlusion, image identique au rendu direct).
    const q = Number(new URLSearchParams(globalThis.location?.search ?? '').get('ao') ?? NaN);
    this.gtao.blendIntensity = Number.isFinite(q) ? Math.min(1, Math.max(0, q)) : AO_INTENSITY;
    this.composer.addPass(this.gtao);
    this.composer.addPass(new ShaderPass(CopyShader));
  }

  /** Effets réellement appliqués à cette image. */
  get active(): boolean { return this.wanted && this.allowedByTier; }

  /** Rendu de l'image avec effets (taille suivie de celle du canevas, résolution dynamique comprise). */
  render(): void {
    this.renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, this.size.x), h = Math.max(1, this.size.y);
    if (w !== this.w || h !== this.h) {
      this.w = w; this.h = h;
      this.composer.setSize(w, h);
    }
    // Le composeur alterne ses deux cibles d'une image à l'autre : l'occlusion lit la profondeur de celle où la scène
    // vient d'être rendue (cible de lecture au début de l'image).
    const depth = this.composer.readBuffer.depthTexture;
    const g = this.gtao as unknown as { gtaoMaterial: THREE.ShaderMaterial; pdMaterial: THREE.ShaderMaterial };
    if (depth && g.gtaoMaterial.uniforms['tDepth']!.value !== depth) {
      g.gtaoMaterial.uniforms['tDepth']!.value = depth;
      g.pdMaterial.uniforms['tDepth']!.value = depth;
    }
    this.composer.render();
  }

  dispose(): void {
    this.gtao.dispose();
    this.composer.dispose();
  }
}

export { isSoftwareRenderer } from './post-detect';
