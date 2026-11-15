/**
 * Direction artistique du rendu : TOUS les réglages de couleur et de lumière en un seul endroit.
 *
 * Deux palettes :
 *  - « vives » (par défaut) : lumière naturelle chaude, ciel bleu profond, herbe verte vivante, roche et terre
 *    variées, brume bleutée légère (perspective aérienne) au lieu d'un voile blanc, étalonnage final léger ;
 *  - « naturelles » : valeurs exactes de l'ancien rendu (option « Couleurs : Naturelles », src/ui/options.ts).
 *
 * Coût : aucun passage plein écran. L'étalonnage final (balance des blancs, saturation, contraste) est intégré à
 * la fonction de tone mapping que three insère déjà dans chaque shader (`CustomToneMapping`) : quelques
 * opérations par pixel, pas de cible de rendu ni d'appel de rendu en plus. Les autres réglages sont des uniformes
 * ou des constantes déjà lues par les shaders existants.
 *
 * Abonnés (appliquent la palette courante et suivent ses changements) : SkySystem (soleil, ambiance, ciel,
 * brouillard, exposition), matériau du terrain, végétation, mini-carte, renderer (tone mapping).
 */
import * as THREE from 'three';

export type ColorMode = 'vives' | 'naturelles';
type RGB = readonly [number, number, number];

export interface Palette {
  readonly mode: ColorMode;
  /** Étalonnage final dans le tone mapping (null = ACES de three, sans étalonnage : ancien rendu). */
  readonly grade: null | {
    /** Balance des blancs (multiplicateur linéaire, avant la courbe). */
    readonly whiteBalance: RGB;
    /** Saturation (1 = neutre), appliquée en linéaire avant la courbe filmique. */
    readonly saturation: number;
    /** Contraste (exposant autour du gris moyen 0,18 ; 1 = neutre). */
    readonly contrast: number;
  };
  /** Exposition de base (SkySystem.baseExposure ; multipliée la nuit et au crépuscule). */
  readonly exposure: number;
  readonly sun: {
    /** Intensité du soleil haut (lux relatifs three). */
    readonly intensity: number;
    /** Couleur du soleil haut dans le ciel (linéaire). */
    readonly colorHigh: RGB;
    /** Couleur du soleil rasant (lever / coucher). */
    readonly colorLow: RGB;
  };
  readonly hemi: {
    /** Couleur du ciel de jour de la lumière hémisphérique (linéaire). */
    readonly skyDay: RGB;
    /** Couleur renvoyée par le sol (lumière de rebond). */
    readonly ground: RGB;
    /** Multiplicateur de son intensité. */
    readonly intensity: number;
  };
  readonly sky: {
    /** Teinte du ciel vers le zénith (multiplicateur : < 1 en rouge / vert = bleu plus profond). */
    readonly zenithTint: RGB;
    /** Mélange de l'horizon du dôme vers la couleur du brouillard (0..1). */
    readonly horizonFog: number;
  };
  readonly fog: {
    /** Densité du brouillard exp² de jour. */
    readonly density: number;
    /** Part de bleu du zénith mêlée à la couleur d'horizon (perspective aérienne, 0 = horizon seul). */
    readonly blueMix: number;
    /** Luminance maximale de la couleur du brouillard (un brouillard trop clair délave le lointain). */
    readonly maxLum: number;
    /** Désaturation de la brume au crépuscule (0..1) : l'horizon rose du ciel ne teinte plus tout le paysage. */
    readonly duskDesat: number;
  };
  readonly terrain: {
    /** Herbe sèche / grasse (selon l'humidité) : teinte multiplicative (remap 0) ou couleur absolue (remap 1). */
    readonly grassDry: RGB;
    readonly grassLush: RGB;
    /** 0 = herbe = texture × teinte (ancien) ; 1 = couleur absolue de la palette, la texture ne donne que le détail. */
    readonly grassRemap: number;
    /** Herbe sur pente (plus sèche, plus jaune), couleur absolue mêlée selon la pente. */
    readonly grassSlope: RGB;
    /** Désaturation de la roche (0..1) et sa teinte. */
    readonly rockDesat: number;
    readonly rockTint: RGB;
    /** Teintes multiplicatives de la terre, du sable et du gravier. */
    readonly dirtTint: RGB;
    readonly sandTint: RGB;
    readonly gravelTint: RGB;
    /** Taches de terre dans l'herbe (part maximale, 0..1). */
    readonly dirtPatch: number;
    /** Variation macroscopique de luminosité (uMacroStrength). */
    readonly macroStrength: number;
  };
  /** Teinte du feuillage (multiplie la teinte par arbre ; rochers exclus). */
  readonly foliage: RGB;
  /** Mini-carte (couleurs sRGB 0..255). */
  readonly minimap: {
    readonly plain: RGB;
    readonly hill: RGB;
    readonly beach: RGB;
    readonly forest: RGB;
    readonly forestMax: number;
    readonly waterShallow: RGB;
    readonly waterDeep: RGB;
    /** Force de l'ombrage du relief. */
    readonly shade: number;
  };
}

/** Ancien rendu, valeur pour valeur (avant la refonte de la direction artistique). */
export const PALETTE_NATURELLES: Palette = {
  mode: 'naturelles',
  grade: null,
  exposure: 0.85,
  sun: { intensity: 3.1, colorHigh: [1.0, 0.95, 0.88], colorLow: [1.0, 0.48, 0.22] },
  hemi: { skyDay: [0.62, 0.72, 0.9], ground: [0.32, 0.28, 0.22], intensity: 1 },
  sky: { zenithTint: [1, 1, 1], horizonFog: 0.65 },
  fog: { density: 0.00022, blueMix: 0, maxLum: 0.9, duskDesat: 0 },
  terrain: {
    grassDry: [0.9, 0.9, 0.64], grassLush: [0.66, 0.88, 0.5], grassRemap: 0, grassSlope: [0.9, 0.9, 0.64],
    rockDesat: 0.78, rockTint: [1.02, 0.99, 0.94],
    dirtTint: [1, 1, 1], sandTint: [1, 1, 1], gravelTint: [1, 1, 1],
    dirtPatch: 0.35, macroStrength: 0.32,
  },
  foliage: [1, 1, 1],
  minimap: {
    plain: [92, 128, 72], hill: [182, 168, 142], beach: [196, 184, 140], forest: [38, 84, 44], forestMax: 0.75,
    waterShallow: [46, 104, 150], waterDeep: [24, 68, 120], shade: 0.35,
  },
};

/**
 * « Couleurs vives » : principes des city-builders récents (lumière chaude, ciel profond, herbe vivante, contrastes
 * clairs, brume bleutée). Couleurs d'herbe en albédo LINÉAIRE (texture d'herbe d'origine : paille sèche, ≈ 151/132/89
 * sRGB, d'où la teinte beige de l'ancien rendu ; elle ne sert plus qu'au détail).
 */
export const PALETTE_VIVES: Palette = {
  mode: 'vives',
  grade: { whiteBalance: [1.03, 1.0, 0.95], saturation: 1.14, contrast: 1.07 },
  exposure: 0.84,
  sun: { intensity: 3.3, colorHigh: [1.0, 0.93, 0.82], colorLow: [1.0, 0.45, 0.18] },
  hemi: { skyDay: [0.56, 0.7, 0.98], ground: [0.27, 0.3, 0.18], intensity: 1.05 },
  sky: { zenithTint: [0.8, 0.9, 1.06], horizonFog: 0.42 },
  fog: { density: 0.00015, blueMix: 0.4, maxLum: 0.6, duskDesat: 0.45 },
  terrain: {
    grassDry: [0.17, 0.175, 0.06], grassLush: [0.07, 0.155, 0.038], grassRemap: 0.82, grassSlope: [0.15, 0.15, 0.065],
    rockDesat: 0.55, rockTint: [1.08, 1.04, 0.98],
    dirtTint: [1.08, 0.98, 0.86], sandTint: [1.18, 1.1, 0.92], gravelTint: [0.86, 0.86, 0.84],
    dirtPatch: 0.12, macroStrength: 0.2,
  },
  foliage: [0.97, 1.04, 0.9],
  minimap: {
    plain: [104, 150, 70], hill: [168, 160, 120], beach: [222, 204, 150], forest: [40, 98, 46], forestMax: 0.85,
    waterShallow: [52, 132, 186], waterDeep: [22, 74, 138], shade: 0.42,
  },
};

const PALETTES: Record<ColorMode, Palette> = { vives: PALETTE_VIVES, naturelles: PALETTE_NATURELLES };

let current: Palette = PALETTE_VIVES;
const listeners = new Set<(p: Palette) => void>();

/** Palette courante. */
export function palette(): Palette { return current; }

/** Change de palette (option « Couleurs ») et prévient les abonnés. Sans effet si elle ne change pas. */
export function setColorMode(mode: ColorMode): void {
  const p = PALETTES[mode] ?? PALETTE_VIVES;
  if (p === current) return;
  current = p;
  for (const f of listeners) f(p);
}

/** S'abonne aux changements de palette ; renvoie la fonction de désabonnement. */
export function onPaletteChange(f: (p: Palette) => void): () => void {
  listeners.add(f);
  return () => { listeners.delete(f); };
}

/** Copie une couleur de palette dans une THREE.Color (composantes linéaires). */
export function setRGB(c: THREE.Color, v: RGB): THREE.Color { return c.setRGB(v[0], v[1], v[2]); }

const f = (x: number): string => x.toFixed(4);

/**
 * Remplace `CustomToneMapping` (fonction vide de three) par l'ACES de three précédé de l'étalonnage « vives ».
 * Le renderer passe en `CustomToneMapping` pour la palette vive et revient à `ACESFilmicToneMapping` pour
 * l'ancienne : three recompile alors lui-même les programmes (variante de tone mapping), aucune autre action.
 */
function installGradeChunk(): void {
  const g = PALETTE_VIVES.grade!;
  const chunk = THREE.ShaderChunk.tonemapping_pars_fragment;
  const empty = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
  if (!chunk.includes(empty)) return;
  THREE.ShaderChunk.tonemapping_pars_fragment = chunk.replace(empty, /* glsl */ `
// Étalonnage « Couleurs vives » (src/render/palette.ts) puis ACES (même courbe que ACESFilmicToneMapping).
vec3 CustomToneMapping( vec3 color ) {
	color *= toneMappingExposure / 0.6;
	color *= vec3( ${f(g.whiteBalance[0])}, ${f(g.whiteBalance[1])}, ${f(g.whiteBalance[2])} );
	float aubeLum = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
	color = max( vec3( aubeLum ) + ( color - aubeLum ) * ${f(g.saturation)}, vec3( 0.0 ) );
	color = 0.18 * pow( max( color / 0.18, vec3( 1e-6 ) ), vec3( ${f(g.contrast)} ) );
	const mat3 aubeIn = mat3( vec3( 0.59719, 0.07600, 0.02840 ), vec3( 0.35458, 0.90834, 0.13383 ), vec3( 0.04823, 0.01566, 0.83777 ) );
	const mat3 aubeOut = mat3( vec3( 1.60475, -0.10208, -0.00327 ), vec3( -0.53108, 1.10813, -0.07276 ), vec3( -0.07367, -0.00605, 1.07602 ) );
	color = aubeIn * color;
	color = RRTAndODTFit( color );
	color = aubeOut * color;
	return saturate( color );
}`);
}
installGradeChunk();

/** Tone mapping du renderer selon la palette (appelé à la création du rendu et à chaque changement). */
export function applyToneMapping(renderer: THREE.WebGLRenderer, p: Palette = current): void {
  renderer.toneMapping = p.grade ? THREE.CustomToneMapping : THREE.ACESFilmicToneMapping;
}
