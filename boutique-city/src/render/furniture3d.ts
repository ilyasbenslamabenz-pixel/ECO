/**
 * Modèles 3D des meubles (magasin et logement), faits de boîtes, cylindres et sphères. Chaque modèle occupe son
 * emprise (w × d cases, avant de rotation), centré sur l'origine, face avant vers +z. Les meubles de présentation
 * montrent leur remplissage : nombre d'articles visibles selon le stock (0..1). Dépend de three.
 */
import * as THREE from 'three';
import { FURNITURE_BY_ID } from '../sim/catalog';
import { assets } from '../assets';
import { box, cyl, hashRand, mat, sph } from './kit';

/** Couleur d'emballage de chaque produit. */
export const PRODUCT_COLORS: Record<string, string> = {
  pain: '#d9a55a', lait: '#f4f4f4', fruits: '#e0533a', boissons: '#3a8fe0', conserves: '#c9b03a', snacks: '#e07a2a',
  cafe: '#5a3a26', the: '#4f9a4a', croissant: '#e3b05a', sandwich: '#e6d6a8', jus: '#f2a02a',
  tshirt: '#4a7fd0', jean: '#2f4a7a', veste: '#7a4a3a', chaussures: '#3a3a3a',
  roses: '#d8344a', bouquet: '#e88ab0', plantes: '#3f8a45', cartes: '#f2d06b',
};

const WOOD = '#b98a5e', WOOD_D = '#7d5a3c', METAL = '#9aa3ad', DARK = '#3a3f46', WHITE = '#eef0f2';

/** Dimensions des meubles du logement (hors catalogue du magasin). */
export const HOME_FURNITURE: Record<string, { w: number; d: number; nameFr: string }> = {
  lit: { w: 2, d: 3, nameFr: 'Lit' },
  canape: { w: 3, d: 1, nameFr: 'Canapé' },
  cuisine: { w: 3, d: 1, nameFr: 'Cuisine' },
  armoire: { w: 2, d: 1, nameFr: 'Armoire' },
  tablebasse: { w: 2, d: 1, nameFr: 'Table basse' },
};

export function furnitureSize(id: string): { w: number; d: number } {
  const f = FURNITURE_BY_ID.get(id);
  if (f) return { w: f.w, d: f.d };
  return HOME_FURNITURE[id] ?? { w: 1, d: 1 };
}

/**
 * Modèle d'un meuble. `fill` : remplissage 0..1 des meubles de présentation ; `colors` : couleurs des produits
 * présentés (alternées).
 */
export function buildFurniture(id: string, fill = 0, colors: string[] = ['#cccccc'], seed = 1, products: string[] = []): THREE.Group {
  PRODUCTS_NOW = products;
  const fromKit = kitFurniture(id, fill, colors, seed);
  if (fromKit) return fromKit;
  const g = new THREE.Group();
  g.name = id;
  const { w, d } = furnitureSize(id);
  const r = hashRand(seed);
  const col = (k: number): THREE.Material => mat(colors[k % colors.length]!, { rough: 0.6 });
  const count = (slots: number): number => Math.round(Math.max(0, Math.min(1, fill)) * slots);
  switch (id) {
    case 'caisse': {
      box(g, w, 0.95, 0.75, 0, 0, 0.05, mat('#e4dccd'));
      box(g, w + 0.04, 0.05, 0.8, 0, 0.95, 0.05, mat(WOOD_D));
      box(g, w, 0.4, 0.04, 0, 0.3, 0.44, mat('#d8a03a'));
      box(g, 0.36, 0.12, 0.3, -0.45, 1.0, -0.05, mat(DARK));
      const screen = box(g, 0.32, 0.24, 0.03, -0.45, 1.12, -0.12, mat('#1d2a38', { emissive: 0.15 }));
      screen.rotation.x = -0.25;
      box(g, 0.3, 0.02, 0.18, 0.35, 0.98, 0.1, mat(METAL, { metal: 0.6, rough: 0.3 }));
      break;
    }
    case 'rayon':
    case 'etagere': {
      const depth = id === 'rayon' ? 0.6 : 0.4, z0 = -d / 2 + depth / 2 + 0.05;
      const levels = id === 'rayon' ? [0.12, 0.6, 1.08, 1.56] : [0.5, 1.0, 1.5];
      const top = id === 'rayon' ? 1.95 : 1.85;
      box(g, 0.05, top, depth, -w / 2 + 0.05, 0, z0, mat(METAL, { metal: 0.4, rough: 0.4 }));
      box(g, 0.05, top, depth, w / 2 - 0.05, 0, z0, mat(METAL, { metal: 0.4, rough: 0.4 }));
      box(g, w - 0.1, top, 0.03, 0, 0, z0 - depth / 2 + 0.02, mat('#d6dbe0'));
      const per = Math.round((w - 0.2) / 0.38);
      const slots = per * levels.length;
      let n = count(slots);
      const spots: Slot[] = [];
      for (const y of levels) {
        box(g, w - 0.1, 0.03, depth, 0, y - 0.03, z0, mat('#c7ccd2'));
        for (let i = 0; i < per; i++) if (n-- > 0) spots.push([-w / 2 + 0.2 + (i + 0.5) * ((w - 0.4) / per), y, z0 + 0.02]);
      }
      goods(g, spots, [0.3, 0.28, depth * 0.7], (p, k) => box(g, 0.28, 0.18 + r() * 0.16, depth * 0.75, p[0], p[1], p[2], col(k)));
      break;
    }
    case 'frigo': {
      const z0 = -0.1, body = mat(WHITE, { rough: 0.4 });
      // Caisson creux : fond, côtés, socle, chapeau ; porte vitrée devant.
      box(g, w, 2.0, 0.05, 0, 0, z0 - 0.35, body);
      box(g, 0.06, 2.0, 0.75, -w / 2 + 0.03, 0, z0, body);
      box(g, 0.06, 2.0, 0.75, w / 2 - 0.03, 0, z0, body);
      box(g, w, 0.18, 0.75, 0, 0, z0, mat('#3a3f46'));
      box(g, w, 0.2, 0.75, 0, 1.8, z0, body);
      box(g, w - 0.12, 1.62, 0.02, 0, 0.18, z0 + 0.37, mat('#bfe6f5', { opacity: 0.22, rough: 0.05 }), false);
      box(g, 0.04, 1.62, 0.05, 0, 0.18, z0 + 0.37, mat('#9aa3ad', { metal: 0.5 }), false);
      box(g, w - 0.14, 0.04, 0.62, 0, 1.86, z0, mat('#ffffff', { emissive: 0.8 }), false);
      const levels = [0.22, 0.62, 1.02, 1.42];
      const per = Math.round((w - 0.2) / 0.16);
      let n = count(per * levels.length);
      const slots: Slot[] = [];
      for (const y of levels) {
        box(g, w - 0.14, 0.02, 0.6, 0, y - 0.02, z0, mat('#dfe6ea'));
        for (let i = 0; i < per; i++) if (n-- > 0) slots.push([-w / 2 + 0.14 + (i + 0.5) * ((w - 0.28) / per), y, z0 + 0.12]);
      }
      goods(g, slots, [0.14, 0.3, 0.22], (p, k) => cyl(g, 0.09, 0.28, p[0], p[1], p[2], col(k), false));
      break;
    }
    case 'comptoir': {
      box(g, w, 1.0, 0.8, 0, 0, 0, mat(WOOD));
      box(g, w + 0.06, 0.06, 0.88, 0, 1.0, 0, mat('#3b3b3b', { rough: 0.3 }));
      const slots: Slot[] = [];
      for (let i = 0, n = count(10); i < 10 && n > 0; i++, n--) slots.push([-w / 2 + 0.2 + (i % 5) * 0.36, 1.06, -0.2 + Math.floor(i / 5) * 0.2]);
      goods(g, slots, [0.18, 0.16, 0.18], (p, i) => cyl(g, 0.09, 0.11, p[0], p[1], p[2], mat(i % 2 ? '#f4f4f4' : '#d8c8a8'), false));
      break;
    }
    case 'vitrine': {
      box(g, w, 0.85, 0.8, 0, 0, 0, mat(WOOD_D));
      box(g, w - 0.06, 0.45, 0.74, 0, 0.85, 0, mat('#d8f0ff', { opacity: 0.3, rough: 0.05 }), false);
      box(g, w - 0.1, 0.03, 0.7, 0, 0.86, 0, mat('#f6efe4'));
      const slots: Slot[] = [];
      for (let i = 0, n = count(12); i < 12 && n > 0; i++, n--) slots.push([-w / 2 + 0.22 + (i % 6) * 0.3, 0.89, -0.18 + Math.floor(i / 6) * 0.32]);
      goods(g, slots, [0.24, 0.14, 0.26], (p, i) => sph(g, 0.16, 0.08, 0.1, p[0], p[1] + 0.05, p[2], col(i), false));
      break;
    }
    case 'portant': {
      cyl(g, 0.05, 1.7, -w / 2 + 0.1, 0, 0, mat(METAL, { metal: 0.6, rough: 0.3 }));
      cyl(g, 0.05, 1.7, w / 2 - 0.1, 0, 0, mat(METAL, { metal: 0.6, rough: 0.3 }));
      const bar = cyl(g, 0.04, w - 0.2, 0, 1.6, 0, mat(METAL, { metal: 0.6, rough: 0.3 }));
      bar.rotation.z = Math.PI / 2; bar.position.y = 1.6;
      box(g, w, 0.04, 0.5, 0, 0, 0, mat(DARK));
      let n = count(12);
      for (let i = 0; i < 12 && n > 0; i++, n--) {
        const x = -w / 2 + 0.25 + i * ((w - 0.5) / 11);
        const cloth = box(g, 0.05, 0.75, 0.45, x, 0.82, 0, col(i));
        cloth.rotation.y = (r() - 0.5) * 0.15;
      }
      break;
    }
    case 'machine': {
      box(g, 0.8, 0.9, 0.6, 0, 0, -0.1, mat(WOOD_D));
      box(g, 0.55, 0.55, 0.45, 0, 0.9, -0.12, mat('#c0c4c8', { metal: 0.7, rough: 0.25 }));
      box(g, 0.5, 0.1, 0.12, 0, 1.2, 0.12, mat(DARK));
      cyl(g, 0.08, 0.08, 0, 0.92, 0.1, mat('#f4f4f4'));
      break;
    }
    case 'table': {
      cyl(g, 0.9, 0.04, 0, 0.74, 0, mat(WOOD));
      cyl(g, 0.08, 0.74, 0, 0, 0, mat(DARK));
      for (const [cx, cz, ry] of [[0, -0.72, 0], [0, 0.72, Math.PI], [-0.72, 0, Math.PI / 2], [0.72, 0, -Math.PI / 2]] as const) {
        const ch = new THREE.Group();
        ch.position.set(cx, 0, cz); ch.rotation.y = ry;
        box(ch, 0.42, 0.05, 0.42, 0, 0.44, 0, mat(WOOD_D));
        box(ch, 0.42, 0.45, 0.05, 0, 0.47, -0.2, mat(WOOD_D));
        for (const [lx, lz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]] as const) box(ch, 0.04, 0.44, 0.04, lx, 0, lz, mat(DARK), false);
        g.add(ch);
      }
      break;
    }
    case 'plante': {
      cyl(g, 0.42, 0.42, 0, 0, 0, mat('#b8653a'));
      sph(g, 0.6, 0.7, 0.6, 0, 0.85, 0, mat('#3f8a45', { rough: 0.9 }));
      sph(g, 0.4, 0.5, 0.4, 0.15, 1.2, 0.05, mat('#4f9a4f', { rough: 0.9 }));
      break;
    }
    case 'lampe': {
      cyl(g, 0.3, 0.04, 0, 0, 0, mat(DARK));
      cyl(g, 0.04, 1.6, 0, 0, 0, mat(DARK));
      cyl(g, 0.4, 0.3, 0, 1.55, 0, mat('#fff2c8', { emissive: 0.9 }), false);
      break;
    }
    case 'tapis': {
      box(g, w - 0.1, 0.015, d - 0.1, 0, 0, 0, mat('#b5523f', { rough: 1 }), false);
      box(g, w - 0.5, 0.02, d - 0.5, 0, 0, 0, mat('#e0c08a', { rough: 1 }), false);
      break;
    }
    case 'tableau': {
      box(g, 0.9, 0.7, 0.05, 0, 1.3, -0.45, mat(WOOD_D));
      box(g, 0.78, 0.58, 0.02, 0, 1.36, -0.42, mat(['#3a7ab0', '#c0563a', '#5aa05a'][seed % 3]!));
      box(g, 0.3, 0.9, 0.3, 0, 0, -0.3, mat('#d8d8d8'));
      break;
    }
    case 'lit': {
      box(g, w, 0.35, d, 0, 0, 0, mat(WOOD_D));
      box(g, w - 0.1, 0.22, d - 0.3, 0, 0.35, 0.1, mat('#f2f0ea'));
      box(g, w - 0.1, 0.06, d * 0.6, 0, 0.56, 0.45, mat('#4a6fa8'));
      box(g, 0.7, 0.14, 0.4, -0.45, 0.57, -d / 2 + 0.45, mat('#ffffff'));
      box(g, 0.7, 0.14, 0.4, 0.45, 0.57, -d / 2 + 0.45, mat('#ffffff'));
      box(g, w, 0.9, 0.08, 0, 0, -d / 2 + 0.04, mat(WOOD_D));
      break;
    }
    case 'canape': {
      box(g, w, 0.42, 0.85, 0, 0, 0, mat('#5a6a7a'));
      box(g, w, 0.45, 0.2, 0, 0.42, -0.32, mat('#5a6a7a'));
      box(g, 0.2, 0.25, 0.85, -w / 2 + 0.1, 0.42, 0, mat('#4d5c6b'));
      box(g, 0.2, 0.25, 0.85, w / 2 - 0.1, 0.42, 0, mat('#4d5c6b'));
      break;
    }
    case 'cuisine': {
      box(g, w, 0.9, 0.65, 0, 0, -0.15, mat('#e8e2d8'));
      box(g, w, 0.05, 0.68, 0, 0.9, -0.15, mat('#4a4a4a', { rough: 0.3 }));
      box(g, 0.5, 0.02, 0.4, 0.6, 0.95, -0.15, mat(METAL, { metal: 0.7, rough: 0.2 }));
      box(g, w, 0.6, 0.35, 0, 1.55, -0.3, mat('#e8e2d8'));
      break;
    }
    case 'armoire': {
      box(g, w, 2.0, 0.6, 0, 0, -0.15, mat(WOOD));
      box(g, 0.02, 1.9, 0.01, 0, 0.05, 0.16, mat(WOOD_D));
      break;
    }
    case 'tablebasse': {
      box(g, 1.2, 0.05, 0.6, 0, 0.38, 0, mat(WOOD));
      for (const [lx, lz] of [[-0.5, -0.22], [0.5, -0.22], [-0.5, 0.22], [0.5, 0.22]] as const) box(g, 0.05, 0.38, 0.05, lx, 0, lz, mat(DARK), false);
      break;
    }
    default:
      box(g, w * 0.9, 0.8, d * 0.9, 0, 0, 0, mat('#999999'));
  }
  return g;
}

/* ------------------------------ Modèles Kenney (Furniture Kit) ------------------------------ */

/** Pose un modèle ajusté dans une boîte, à une position ; faux si le modèle manque. */
function put(g: THREE.Group, key: string, w: number, h: number | null, d: number, x: number, y: number, z: number, stretch = true, ry = 0): boolean {
  const o = assets.fitted(key, w, h, d, stretch);
  if (!o) return false;
  o.position.set(x, y, z);
  o.rotation.y = ry;
  g.add(o);
  return true;
}

/** Cap pour qu'un objet dont l'avant regarde vers −z (convention des chaises) regarde vers (dx, dz). */
const faceTo = (dx: number, dz: number): number => Math.atan2(-dx, -dz);

/**
 * Meuble fait des modèles du Furniture Kit, avec la marchandise ajoutée par le jeu (remplissage), ou null si un
 * modèle manque (le meuble fait en code est alors utilisé). Vitrines réfrigérées, vitrines à pâtisseries, portants,
 * tableaux, armoires et tables basses restent faits en code : leur contenu visible fait partie du jeu.
 */
function kitFurniture(id: string, fill: number, colors: string[], seed: number): THREE.Group | null {
  const need: Record<string, string[]> = {
    caisse: ['meuble.bureau', 'meuble.ecran'], rayon: ['meuble.bibliotheque'], etagere: ['meuble.bibliotheque'], comptoir: ['meuble.bar'],
    machine: ['meuble.placard', 'meuble.cafetiere'], table: ['meuble.table-ronde', 'meuble.chaise'], plante: ['meuble.plante'], lampe: ['meuble.lampe'],
    tapis: ['meuble.tapis'], lit: ['meuble.lit'], canape: ['meuble.canape'], cuisine: ['meuble.placard', 'meuble.frigo'],
  };
  const keys = need[id];
  if (!keys || !keys.every((k) => assets.has(k))) return null;
  const g = new THREE.Group();
  g.name = id;
  const { w, d } = furnitureSize(id);
  const r = hashRand(seed);
  const col = (k: number): THREE.Material => mat(colors[k % colors.length]!, { rough: 0.6 });
  const count = (slots: number): number => Math.round(Math.max(0, Math.min(1, fill)) * slots);
  switch (id) {
    case 'caisse':
      put(g, 'meuble.bureau', w - 0.1, 0.95, 0.75, 0, 0, 0.05);
      put(g, 'meuble.ecran', 0.5, 0.42, 0.18, -0.45, 0.95, -0.15, false);
      box(g, 0.18, 0.05, 0.26, 0.4, 0.95, 0.05, mat('#2b2f36'));
      box(g, w - 0.1, 0.06, 0.04, 0, 0.55, 0.43, mat('#d8a03a'), false);
      break;
    case 'rayon':
    case 'etagere': {
      const depth = id === 'rayon' ? 0.6 : 0.42, h = id === 'rayon' ? 1.95 : 1.8, z0 = -d / 2 + depth / 2 + 0.05;
      put(g, 'meuble.bibliotheque', w - 0.08, h, depth, 0, 0, z0);
      // Planches du modèle : marchandise posée sur chacune, sauf le dessus.
      const levels = [0.035, 0.36, 0.68].map((f) => f * h + 0.02);
      const per = Math.round((w - 0.2) / 0.38);
      let n = count(per * levels.length);
      const spots: Slot[] = [];
      for (const y of levels) for (let i = 0; i < per; i++) if (n-- > 0) spots.push([-w / 2 + 0.2 + (i + 0.5) * ((w - 0.4) / per), y, z0 + 0.02]);
      goods(g, spots, [0.3, 0.26, depth * 0.62], (p, k) => box(g, 0.28, 0.16 + r() * 0.12, depth * 0.62, p[0], p[1], p[2], col(k)));
      break;
    }
    case 'comptoir': {
      put(g, 'meuble.bar', w, 1.0, 0.8, 0, 0, 0);
      const slots: Slot[] = [];
      for (let i = 0, n = count(10); i < 10 && n > 0; i++, n--) slots.push([-w / 2 + 0.2 + (i % 5) * 0.36, 1.0, -0.2 + Math.floor(i / 5) * 0.2]);
      goods(g, slots, [0.18, 0.16, 0.18], (p, i) => cyl(g, 0.09, 0.11, p[0], p[1], p[2], mat(i % 2 ? '#f4f4f4' : '#d8c8a8'), false));
      break;
    }
    case 'machine':
      put(g, 'meuble.placard', 0.85, 0.9, 0.65, 0, 0, -0.1);
      put(g, 'meuble.cafetiere', 0.5, 0.5, 0.45, 0, 0.9, -0.12, false);
      break;
    case 'table':
      put(g, 'meuble.table-ronde', 1.05, 0.75, 1.05, 0, 0, 0);
      for (const [cx, cz] of [[0, -0.75], [0, 0.75], [-0.75, 0], [0.75, 0]] as const) put(g, 'meuble.chaise', 0.45, 0.95, 0.45, cx, 0, cz, false, faceTo(-cx, -cz));
      break;
    case 'plante':
      put(g, 'meuble.plante', 0.8, 1.4, 0.8, 0, 0, 0, false);
      break;
    case 'lampe':
      put(g, 'meuble.lampe', 0.5, 1.75, 0.5, 0, 0, 0, false);
      break;
    case 'tapis':
      put(g, 'meuble.tapis', w - 0.1, null, d - 0.1, 0, 0.005, 0);
      break;
    case 'lit':
      put(g, 'meuble.lit', w - 0.05, null, d - 0.05, 0, 0, 0);
      break;
    case 'canape':
      put(g, 'meuble.canape', w - 0.1, 0.9, 0.9, 0, 0, 0);
      break;
    case 'cuisine':
      put(g, 'meuble.placard', 0.98, 0.92, 0.65, -1, 0, -0.15);
      put(g, 'meuble.placard', 0.98, 0.92, 0.65, 0, 0, -0.15);
      put(g, 'meuble.frigo', 0.95, 2.0, 0.7, 1, 0, -0.12, false);
      box(g, 2, 0.6, 0.35, -0.5, 1.55, -0.3, mat('#e8e2d8'));
      break;
    default:
      return null;
  }
  return g;
}

/* ------------------------------ Marchandise (Food Kit) ------------------------------ */

type Slot = [number, number, number];
/** Produits présentés par le meuble en cours de construction (ordre d'affichage). */
let PRODUCTS_NOW: string[] = [];

/**
 * Pose la marchandise sur des emplacements : modèles du Food Kit instanciés (un appel de dessin par produit), en
 * alternant les produits présentés ; sinon formes simples (`fallback`) si un modèle manque ou pour les vêtements.
 */
function goods(g: THREE.Group, slots: Slot[], size: [number, number, number], fallback: (p: Slot, k: number) => void): void {
  const ids = PRODUCTS_NOW;
  if (!slots.length) return;
  if (!ids.length) { slots.forEach(fallback); return; }
  // Produit avec modèle : instances ; sans modèle (vêtements, fleurs coupées…) : forme simple à sa place.
  const by = new Map<string, THREE.Matrix4[]>();
  slots.forEach((p, k) => {
    const id = ids[k % ids.length]!;
    if (!assets.has(`produit.${id}`)) { fallback(p, k); return; }
    const m = new THREE.Matrix4().makeRotationY(((k * 47) % 11 - 5) * 0.06).setPosition(p[0], p[1], p[2]);
    if (!by.has(id)) by.set(id, []);
    by.get(id)!.push(m);
  });
  for (const [id, ms] of by) { const im = assets.instances(`produit.${id}`, ms, size[0], size[1], size[2]); if (im) g.add(im); }
}
