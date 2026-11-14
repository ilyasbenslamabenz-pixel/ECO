/**
 * Profil de rendu selon l'appareil : mode ALLÉGÉ automatique sur téléphone / tablette ou navigateur à faible
 * mémoire. Sur iPhone, Safari ferme l'onglet (ou perd le contexte WebGL) au-delà de quelques centaines de Mo de
 * mémoire graphique : la démo complète en demandait ≈ 0,9 Go (mesures : docs/PERFORMANCE_MOBILE.md).
 * Le réglage « Qualité » choisit : auto (allégé si l'appareil le demande, sinon moyenne), basse, moyenne, haute.
 */

export type QualitySetting = 'auto' | 'basse' | 'moyenne' | 'haute';

/** Posé au début du chargement, retiré quand le jeu est prêt : présent au démarrage suivant = chargement planté. */
export const BOOT_PENDING_KEY = 'meknes:chargement-en-cours';
/** Mode sûr (allégé forcé, qualité basse), activé après un chargement planté. */
export const SAFE_MODE_KEY = 'meknes:mode-sur';

function storageGet(k: string): string | null { try { return globalThis.localStorage?.getItem(k) ?? null; } catch { return null; } }
function storageSet(k: string, v: string | null): void {
  try { if (v === null) globalThis.localStorage?.removeItem(k); else globalThis.localStorage?.setItem(k, v); } catch { /* navigation privée */ }
}

/** Mode sûr actif (après un chargement planté ; désactivé en choisissant une autre qualité dans les réglages). */
export function isSafeMode(): boolean { return storageGet(SAFE_MODE_KEY) === '1'; }
export function setSafeMode(on: boolean): void { storageSet(SAFE_MODE_KEY, on ? '1' : null); }

/**
 * Début du chargement. Renvoie vrai si le chargement PRÉCÉDENT ne s'est pas terminé (Safari a tué l'onglet) :
 * l'appelant bascule alors en mode sûr. `bootDone` retire le drapeau une fois le jeu prêt.
 */
export function bootStarted(): boolean {
  const crashed = storageGet(BOOT_PENDING_KEY) === '1';
  storageSet(BOOT_PENDING_KEY, '1');
  return crashed;
}
export function bootDone(): void { storageSet(BOOT_PENDING_KEY, null); }

export interface DeviceProfile {
  /** Mode allégé (téléphone / faible mémoire). */
  lite: boolean;
  /** Côté maximal des images des MODÈLES (bâtiments, accessoires) réduites au chargement (px) ; Infinity = origine. */
  textureCap: number;
  /** Côté maximal des images d'arbres (feuillage alpha : trop réduit, il devient granuleux, imposteurs compris). */
  treeTextureCap: number;
  /** Côté maximal de toute image envoyée au GPU (terrain, ciel…) ; Infinity = taille d'origine. */
  gpuTextureCap: number;
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
  /** Modèles GLB chargés en parallèle au plus (1 = un par un : pic mémoire du chargement borné). */
  maxConcurrentModels: number;
}

/** Vrai sur un appareil tactile à petit écran, un téléphone / une tablette, ou un navigateur à faible mémoire. */
export function isLiteDevice(): boolean {
  const g = globalThis as { navigator?: Navigator & { deviceMemory?: number }; matchMedia?: (q: string) => MediaQueryList; screen?: Screen };
  try {
    const params = new URLSearchParams(globalThis.location?.search ?? '');
    if (params.has('lite')) return params.get('lite') !== '0';
    if (isSafeMode()) return true;
    const ua = g.navigator?.userAgent ?? '';
    if (/iPhone|iPad|iPod|Android|Mobile/i.test(ua)) return true;
    // iPadOS (et Safari en « version ordinateur » sur iPhone) se présente comme un Mac : écran tactile = mobile.
    const nav = g.navigator as (Navigator & { maxTouchPoints?: number }) | undefined;
    if ((nav?.platform === 'MacIntel' || /Macintosh/.test(ua)) && (nav?.maxTouchPoints ?? 0) > 1) return true;
    const mem = g.navigator?.deviceMemory;
    if (typeof mem === 'number' && mem > 0 && mem <= 4) return true;
    const coarse = g.matchMedia?.('(pointer: coarse)').matches ?? false;
    const small = Math.min(g.screen?.width ?? 1e4, g.screen?.height ?? 1e4) <= 900;
    return coarse && small;
  } catch { return false; }
}

const FULL: DeviceProfile = {
  lite: false, textureCap: Infinity, treeTextureCap: Infinity, gpuTextureCap: Infinity, maxPixelRatio: 2, shadowSize: 2048,
  vegDistances: [50, 120, 240, 3800], buildingLodBias: 1, preloadAll: true, maxConcurrentModels: Infinity,
};

/** Profil effectif d'un réglage de qualité (« auto » : allégé si l'appareil le demande). */
export function deviceProfile(quality: QualitySetting = 'auto', lite = isLiteDevice()): DeviceProfile {
  if (isSafeMode() && quality === 'auto') quality = 'basse';
  // Téléphone en « auto » : niveau Basse. Mesure réelle sur iPhone 17 Pro (14/11) : l'allégé à 1,5× et LOD
  // plus détaillés faisait fermer la page à la pose de certaines maisons ; en Basse, la partie tient.
  if (quality === 'auto' && lite) quality = 'basse';
  if (quality === 'haute' || ((quality === 'moyenne') && !lite) || (quality === 'auto' && !lite)) return { ...FULL };
  // Allégé (auto sur téléphone, basse, ou moyenne sur téléphone : textures et ombres réduites quand même).
  const basse = quality === 'basse';
  return {
    lite: true,
    // 256 px suffisent sur un écran de téléphone (façades tuilées au mètre) ; « moyenne » choisie à la main : 512.
    textureCap: quality === 'moyenne' ? 512 : 256,
    treeTextureCap: 512,
    // Terrain et ciel : 512 px (à 256 px, le sol paraissait granuleux sur iPhone).
    gpuTextureCap: 512,
    // 1,5× : à 1,25× le sol et les arbres paraissaient granuleux sur un écran 3× ; « basse » : 1×.
    maxPixelRatio: basse ? 1 : 1.5,
    shadowSize: 1024,
    vegDistances: [35, 90, 200, 2600],
    buildingLodBias: basse ? 0.55 : 0.7,
    preloadAll: false,
    maxConcurrentModels: 1,
  };
}
