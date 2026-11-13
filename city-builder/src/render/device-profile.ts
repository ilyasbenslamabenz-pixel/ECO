/**
 * Profil de rendu selon l'appareil : mode ALLÉGÉ automatique sur téléphone / tablette ou navigateur à faible
 * mémoire. Sur iPhone, Safari ferme l'onglet (ou perd le contexte WebGL) au-delà de quelques centaines de Mo de
 * mémoire graphique : la démo complète en demandait ≈ 0,9 Go (mesures : docs/PERFORMANCE_MOBILE.md).
 * Le réglage « Qualité » choisit : auto (allégé si l'appareil le demande, sinon moyenne), basse, moyenne, haute.
 */

export type QualitySetting = 'auto' | 'basse' | 'moyenne' | 'haute';

export interface DeviceProfile {
  /** Mode allégé (téléphone / faible mémoire). */
  lite: boolean;
  /** Côté maximal des textures d'image envoyées au GPU (px) ; Infinity = taille d'origine. */
  textureCap: number;
  /** Plafond du rapport de pixels du rendu. */
  maxPixelRatio: number;
  /** Côté de la carte d'ombre du soleil (px). */
  shadowSize: number;
  /** Distances de bascule de la végétation (LOD0 → LOD1 → imposteur → masqué). */
  vegDistances: [number, number, number, number];
  /** Multiplicateur des distances de LOD des bâtiments. */
  buildingLodBias: number;
  /** Préchargement de tous les modèles (démo) ; sinon chargement à la demande. */
  preloadAll: boolean;
}

/** Vrai sur un appareil tactile à petit écran, un téléphone / une tablette, ou un navigateur à faible mémoire. */
export function isLiteDevice(): boolean {
  const g = globalThis as { navigator?: Navigator & { deviceMemory?: number }; matchMedia?: (q: string) => MediaQueryList; screen?: Screen };
  try {
    const params = new URLSearchParams(globalThis.location?.search ?? '');
    if (params.has('lite')) return params.get('lite') !== '0';
    const ua = g.navigator?.userAgent ?? '';
    if (/iPhone|iPad|iPod|Android|Mobile/i.test(ua)) return true;
    const mem = g.navigator?.deviceMemory;
    if (typeof mem === 'number' && mem > 0 && mem <= 4) return true;
    const coarse = g.matchMedia?.('(pointer: coarse)').matches ?? false;
    const small = Math.min(g.screen?.width ?? 1e4, g.screen?.height ?? 1e4) <= 900;
    return coarse && small;
  } catch { return false; }
}

const FULL: DeviceProfile = {
  lite: false, textureCap: Infinity, maxPixelRatio: 2, shadowSize: 2048,
  vegDistances: [50, 120, 240, 3800], buildingLodBias: 1, preloadAll: true,
};

/** Profil effectif d'un réglage de qualité (« auto » : allégé si l'appareil le demande). */
export function deviceProfile(quality: QualitySetting = 'auto', lite = isLiteDevice()): DeviceProfile {
  if (quality === 'haute' || ((quality === 'moyenne') && !lite) || (quality === 'auto' && !lite)) return { ...FULL };
  // Allégé (auto sur téléphone, basse, ou moyenne sur téléphone : textures et ombres réduites quand même).
  const basse = quality === 'basse';
  return {
    lite: true,
    // 256 px suffisent sur un écran de téléphone (façades tuilées au mètre) ; « moyenne » choisie à la main : 512.
    textureCap: quality === 'moyenne' ? 512 : 256,
    maxPixelRatio: basse ? 1 : 1.25,
    shadowSize: 1024,
    vegDistances: [35, 90, 200, 2600],
    buildingLodBias: basse ? 0.55 : 0.7,
    preloadAll: false,
  };
}
