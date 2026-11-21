/**
 * Modèles 3D des meubles (magasin et logement), faits de boîtes, cylindres et sphères. Chaque modèle occupe son
 * emprise (w × d cases, avant de rotation), centré sur l'origine, face avant vers +z. Les meubles de présentation
 * montrent leur remplissage : nombre d'articles visibles selon le stock (0..1). Dépend de three.
 */
import * as THREE from 'three';
import { FURNITURE_BY_ID } from '../sim/catalog';
import { assets, productKeys } from '../assets';
import { box, cyl, hashRand, mat, sph } from './kit';

/** Couleur d'emballage de chaque produit. */
export const PRODUCT_COLORS: Record<string, string> = {
  pain: '#d9a55a', lait: '#f4f4f4', fruits: '#e0533a', boissons: '#3a8fe0', conserves: '#c9b03a', snacks: '#e07a2a',
  cafe: '#5a3a26', the: '#4f9a4a', croissant: '#e3b05a', sandwich: '#e6d6a8', jus: '#f2a02a',
  tshirt: '#4a7fd0', jean: '#2f4a7a', veste: '#7a4a3a', chaussures: '#3a3a3a',
  roses: '#d8344a', bouquet: '#e88ab0', plantes: '#3f8a45', cartes: '#f2d06b',
  baguette: '#d9a55a', campagne: '#b9803a', viennoiseries: '#e3b05a', patisseries: '#e88ab0', eau: '#9fd0f0',
  burger: '#c0773a', frites: '#f2c84a', hotdog: '#d0603a', pizza: '#e0533a', soda: '#d02a2a', glace: '#f4d0e0',
  legumes: '#4f9a4a', fruitsfrais: '#e0533a', exotiques: '#f2c84a', herbes: '#6aa83a', jusfrais: '#f2a02a',
};

const WOOD = '#b98a5e', WOOD_D = '#7d5a3c', METAL = '#9aa3ad', DARK = '#3a3f46', WHITE = '#eef0f2';

/** Dimensions des meubles du logement (hors catalogue du magasin). */
export const HOME_FURNITURE: Record<string, { w: number; d: number; nameFr: string }> = {
  lit: { w: 2, d: 3, nameFr: 'Lit' },
  canape: { w: 3, d: 1, nameFr: 'Canapé' },
  cuisine: { w: 3, d: 1, nameFr: 'Cuisine' },
  armoire: { w: 2, d: 1, nameFr: 'Armoire' },
  tablebasse: { w: 2, d: 1, nameFr: 'Table basse' },
  'bureau-perso': { w: 2, d: 1, nameFr: 'Bureau' },
  tele: { w: 2, d: 1, nameFr: 'Télévision' },
  'salle-de-bain': { w: 2, d: 1, nameFr: 'Salle de bain' },
  baignoire: { w: 2, d: 1, nameFr: 'Baignoire' },
  buanderie: { w: 1, d: 1, nameFr: 'Buanderie' },
};

/**
 * Décorations à modèle unique : [clé du modèle, largeur, hauteur, profondeur (m), rotation] puis éléments ajoutés
 * [clé, l, h, p, x, y, z] ; `y` : hauteur de pose (sur un guéridon). Repli : plante faite en code.
 */
const DECO: Record<string, { k: string; w: number; h: number; d: number; y?: number; ry?: number; more?: [string, number, number, number, number, number, number][] }> = {
  arcade: { k: 'f:arc-arcade-machine', w: 0.8, h: 1.9, d: 0.8 }, flipper: { k: 'f:arc-pinball', w: 0.8, h: 1.5, d: 1.7 },
  pince: { k: 'f:arc-claw-machine', w: 0.9, h: 2, d: 0.9 }, airhockey: { k: 'f:arc-air-hockey', w: 1.9, h: 1, d: 0.95 },
  danse: { k: 'f:arc-dance-machine', w: 1.9, h: 2, d: 0.95 }, basket: { k: 'f:arc-basketball-game', w: 0.9, h: 2.1, d: 1.9 },
  distributeur: { k: 'f:arc-vending-machine', w: 0.9, h: 1.9, d: 0.8 }, roue: { k: 'f:arc-prize-wheel', w: 0.9, h: 1.9, d: 0.6 },
  tickets: { k: 'f:arc-ticket-machine', w: 0.6, h: 1.5, d: 0.6 }, jackpot: { k: 'f:arc-gambling-machine', w: 0.8, h: 1.8, d: 0.8 },
  lots: { k: 'f:arc-prizes', w: 0.9, h: 1.6, d: 0.7 },
  sapin: { k: 'f:hol-tree-decorated', w: 1, h: 2.3, d: 1, more: [['f:hol-present-a-cube', 0.3, 0.3, 0.3, 0.3, 0, 0.35], ['f:hol-present-b-round', 0.3, 0.3, 0.3, -0.3, 0, 0.3]] },
  bonhomme: { k: 'f:hol-snowman-hat', w: 0.8, h: 1.5, d: 0.8 },
  cadeaux: { k: 'f:hol-present-a-rectangle', w: 0.5, h: 0.35, d: 0.4, more: [['f:hol-present-b-cube', 0.35, 0.35, 0.35, 0.25, 0, 0.2], ['f:hol-present-a-round', 0.3, 0.3, 0.3, -0.25, 0, 0.25], ['f:hol-present-b-rectangle', 0.4, 0.25, 0.3, 0.05, 0.35, -0.02]] },
  cassenoisette: { k: 'f:hol-nutcracker', w: 0.5, h: 1.4, d: 0.5 }, lanterne: { k: 'f:hol-lantern', w: 0.4, h: 0.9, d: 0.4 },
  renne: { k: 'f:hol-reindeer', w: 0.8, h: 1.3, d: 0.8 }, traineau: { k: 'f:hol-sled', w: 1.8, h: 0.8, d: 0.8 },
  guirlande: { k: 'f:hol-lights-colored', w: 1.9, h: 0.6, d: 0.3, more: [['f:hol-wreath-decorated', 0.5, 0.5, 0.15, 0, 0.7, 0]] },
  menorah: { k: 'f:hol-hanukkah-menorah-candles', w: 0.6, h: 0.6, d: 0.3, y: 0.55, more: [['f:sideTable', 0.7, 0.55, 0.5, 0, 0, 0]] },
  nounours: { k: 'f:bear', w: 0.6, h: 0.7, d: 0.5 }, 'tele-vintage': { k: 'f:televisionVintage', w: 0.7, h: 0.6, d: 0.5, y: 0.6, more: [['f:sideTableDrawers', 0.8, 0.6, 0.55, 0, 0, 0]] },
  'canape-angle': { k: 'f:loungeSofaCorner', w: 1.9, h: 0.9, d: 1.9 }, 'fauteuil-design': { k: 'f:loungeDesignChair', w: 0.85, h: 0.9, d: 0.85 },
  'lampadaire-carre': { k: 'f:lampSquareFloor', w: 0.5, h: 1.7, d: 0.5 }, 'plante-grande': { k: 'f:nat-plant_bushLarge', w: 0.8, h: 1.1, d: 0.8, more: [['f:nat-pot_large', 0.7, 0.5, 0.7, 0, 0, 0]] },
  palmier: { k: 'f:nat-tree_palmShort', w: 0.9, h: 2.4, d: 0.9 }, statue: { k: 'f:nat-statue_head', w: 0.8, h: 1.6, d: 0.8 },
  defibrillateur: { k: 'f:aid-defibrillator-red', w: 0.4, h: 0.45, d: 0.2, y: 1.1, more: [['f:sideTable', 0.5, 1.1, 0.35, 0, 0, -0.25]] },
  banc: { k: 'f:benchCushion', w: 1.8, h: 0.6, d: 0.6 }, 'tapis-carre': { k: 'f:rugSquare', w: 1.9, h: 0.03, d: 1.9 },
  'tapis-arrondi': { k: 'f:rugRounded', w: 1.9, h: 0.03, d: 1.9 }, radio: { k: 'f:radio', w: 0.4, h: 0.25, d: 0.25, y: 0.55, more: [['f:sideTable', 0.6, 0.55, 0.45, 0, 0, 0]] },
  accueil: { k: 'f:deskCorner', w: 1.9, h: 0.8, d: 1.9, more: [['f:computerScreen', 0.5, 0.4, 0.15, -0.3, 0.8, -0.6], ['f:computerKeyboard', 0.4, 0.05, 0.15, -0.3, 0.8, -0.35], ['f:computerMouse', 0.06, 0.04, 0.1, 0, 0.8, -0.35], ['f:chairDesk', 0.55, 1, 0.55, -0.3, 0, 0.2]] },
  tonneau: { k: 'f:srv-barrel', w: 0.6, h: 0.9, d: 0.6 }, coffre: { k: 'f:srv-chest', w: 0.8, h: 0.6, d: 0.6 },
};

/** Meubles faits en code utilisés à la place d'un meuble à modèles quand un modèle manque. */
const CODE_ALIAS: Record<string, string> = {
  gondole: 'rayon', 'presentoir-pain': 'etagere', etal: 'etagere', congelateur: 'frigo', bar: 'table', salon: 'table', bistrot: 'table',
  caddies: 'plante', consigne: 'plante', portemanteau: 'lampe', enceintes: 'lampe', ecran: 'tableau', fleurs: 'plante', bibliotheque: 'armoire',
  'bureau-perso': 'tablebasse', tele: 'tablebasse', 'salle-de-bain': 'armoire', baignoire: 'tablebasse', buanderie: 'armoire',
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
  switch (CODE_ALIAS[id] ?? (DECO[id] ? 'plante' : id)) {
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
    caisse: ['meuble.bureau'], rayon: ['meuble.bibliotheque'], etagere: ['meuble.bibliotheque'], comptoir: ['meuble.bar'],
    gondole: ['mm.rayon-cartons'], 'presentoir-pain': ['mm.presentoir-pain'], etal: ['mm.etal-fruits'], congelateur: ['mm.congelateur'],
    bar: ['meuble.bar', 'meuble.tabouret'], salon: ['meuble.canape-design', 'meuble.fauteuil', 'meuble.table-basse'],
    bistrot: ['meuble.table', 'meuble.chaise-moderne'], caddies: ['mm.caddie'], consigne: ['mm.consigne'], portemanteau: ['meuble.portemanteau'],
    enceintes: ['meuble.enceinte'], ecran: ['meuble.meuble-tele', 'meuble.tele'], fleurs: ['nat.fleur-rouge-a'],
    bibliotheque: ['meuble.bibliotheque-fermee'], 'salle-de-bain': ['f:toilet', 'f:bathroomSink'], baignoire: ['f:bathtub'], buanderie: ['f:washerDryerStacked'], 'bureau-perso': ['meuble.bureau', 'meuble.chaise-bureau'], tele: ['meuble.meuble-tele', 'meuble.tele'],
    machine: ['meuble.placard', 'meuble.cafetiere'], table: ['meuble.table-ronde', 'meuble.chaise'], plante: ['meuble.plante'], lampe: ['meuble.lampe'],
    tapis: ['meuble.tapis'], lit: ['meuble.lit'], canape: ['meuble.canape'], cuisine: ['meuble.placard', 'meuble.frigo'],
  };
  const deco = DECO[id];
  if (deco) {
    if (!assets.has(deco.k)) return null;
    const g = new THREE.Group();
    g.name = id;
    put(g, deco.k, deco.w, deco.h, deco.d, 0, deco.y ?? 0, deco.y ? -0.1 : 0, false, deco.ry ?? 0);
    for (const [k, w, h, d, x, y, z] of deco.more ?? []) put(g, k, w, h, d, x, y, z, false);
    return g;
  }
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
      // Caisse enregistreuse du Mini Market (sinon écran d'ordinateur) et tapis de caisse.
      if (!put(g, 'mm.caisse', 0.62, 0.45, 0.6, -0.45, 0.95, -0.05, false, Math.PI)) put(g, 'meuble.ecran', 0.5, 0.42, 0.18, -0.45, 0.95, -0.15, false);
      box(g, 0.7, 0.03, 0.5, 0.38, 0.95, 0.05, mat('#2b2f36'));
      put(g, 'mm.panier', 0.34, 0.25, 0.36, w / 2 - 0.25, 0, 0.6, false);
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
      if (!put(g, 'meuble.cuisiniere', 0.98, 0.92, 0.65, -1, 0, -0.15)) put(g, 'meuble.placard', 0.98, 0.92, 0.65, -1, 0, -0.15);
      if (!put(g, 'meuble.evier', 0.98, 0.92, 0.65, 0, 0, -0.15)) put(g, 'meuble.placard', 0.98, 0.92, 0.65, 0, 0, -0.15);
      put(g, 'meuble.frigo', 0.95, 2.0, 0.7, 1, 0, -0.12, false);
      if (!put(g, 'meuble.placard-haut', 0.98, 0.6, 0.35, -1, 1.5, -0.3) || !put(g, 'meuble.placard-haut', 0.98, 0.6, 0.35, 0, 1.5, -0.3)) box(g, 2, 0.6, 0.35, -0.5, 1.55, -0.3, mat('#e8e2d8'));
      put(g, 'meuble.micro-ondes', 0.45, 0.3, 0.35, 0.2, 0.92, -0.25, false);
      put(g, 'meuble.grille-pain', 0.25, 0.2, 0.18, -0.7, 0.92, -0.2, false);
      put(g, 'f:food-frying-pan', 0.35, 0.08, 0.25, -1.15, 0.92, -0.1, false);
      put(g, 'f:food-pot-stew', 0.25, 0.22, 0.25, -0.85, 0.92, -0.05, false);
      put(g, 'f:food-knife-block', 0.15, 0.25, 0.12, -0.3, 0.92, -0.32, false);
      put(g, 'f:food-cutting-board', 0.35, 0.03, 0.25, -0.15, 0.92, -0.1, false);
      put(g, 'f:hoodModern', 0.9, 0.5, 0.5, -1, 1.65, -0.25, false);
      break;
    case 'salle-de-bain':
      put(g, 'f:toilet', 0.55, 0.8, 0.75, -0.5, 0, -0.1, false);
      put(g, 'f:bathroomSink', 0.6, 0.95, 0.5, 0.5, 0, -0.22, false);
      put(g, 'f:bathroomMirror', 0.5, 0.65, 0.08, 0.5, 1.2, -0.46, false);
      put(g, 'f:bathroomCabinet', 0.45, 0.5, 0.25, -0.5, 1.4, -0.4, false);
      put(g, 'f:rugDoormat', 0.7, null, 0.45, 0.5, 0.005, 0.2, true);
      break;
    case 'baignoire':
      put(g, 'f:bathtub', w - 0.15, 0.65, 0.85, 0, 0, 0);
      put(g, 'f:pillowBlueLong', 0.5, 0.12, 0.2, 0.7, 0.62, -0.25, false);
      break;
    case 'buanderie':
      put(g, 'f:washerDryerStacked', 0.75, 1.8, 0.7, 0, 0, -0.1, false);
      break;
    case 'bureau-perso':
      put(g, 'meuble.bureau', w - 0.2, 0.78, 0.7, 0, 0, -0.1);
      put(g, 'meuble.portable', 0.38, 0.25, 0.3, -0.2, 0.78, -0.15, false);
      put(g, 'meuble.lampe-chevet', 0.25, 0.45, 0.25, 0.6, 0.78, -0.25, false);
      put(g, 'meuble.chaise-bureau', 0.55, 1.0, 0.55, 0, 0, 0.35, false, Math.PI);
      break;
    case 'tele':
    case 'ecran':
      put(g, 'meuble.meuble-tele', w - 0.3, 0.55, 0.5, 0, 0, -0.15);
      put(g, 'meuble.tele', 1.3, 0.85, 0.15, 0, 0.55, -0.2, false);
      if (id === 'tele') { put(g, 'meuble.radio', 0.3, 0.2, 0.18, 0.75, 0.55, -0.2, false); put(g, 'meuble.plante-2', 0.3, 0.5, 0.3, -0.8, 0.55, -0.2, false); }
      break;
    case 'gondole': {
      // Gondole du Mini Market : un module par mètre ; ses cartons servent d'emplacements à la marchandise.
      const slots: Slot[] = [], sizes: [number, number, number][] = [];
      const n = Math.max(1, Math.round(w));
      for (let i = 0; i < n; i++) {
        const fp = assets.fittedParts('mm.rayon-cartons', w / n - 0.02, 1.55, d - 0.1, ['carton', 'box'], true);
        if (!fp) break;
        fp.obj.position.x = -w / 2 + (i + 0.5) * (w / n);
        g.add(fp.obj);
        g.updateMatrixWorld(true);
        for (const part of fp.parts) {
          const b = new THREE.Box3().setFromObject(part), c = b.getCenter(new THREE.Vector3()), sz = b.getSize(new THREE.Vector3());
          part.visible = false;
          // Deux articles côte à côte par emplacement.
          for (const dx of [-0.25, 0.25]) { slots.push([c.x + dx * sz.x, b.min.y, c.z]); sizes.push([sz.x * 0.48, sz.y * 0.95, sz.z * 0.9]); }
        }
      }
      const k = count(slots.length);
      slots.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
      const sz = sizes[0] ?? [0.2, 0.25, 0.3];
      goods(g, slots.slice(0, k), sz, (p, i) => box(g, sz[0], sz[1], sz[2], p[0], p[1], p[2], col(i)));
      break;
    }
    case 'presentoir-pain':
    case 'etal': {
      const key = id === 'etal' ? 'mm.etal-fruits' : 'mm.presentoir-pain';
      const slots: Slot[] = [];
      for (let i = 0; i < 2; i++) {
        const fp = assets.fittedParts(key, w / 2 - 0.05, 0.95, d - 0.1, ['bread'], true);
        if (!fp) break;
        const x0 = -w / 2 + (i + 0.5) * (w / 2);
        fp.obj.position.x = x0;
        g.add(fp.obj);
        g.updateMatrixWorld(true);
        // Étal : les fruits du modèle seulement s'il reste du stock ; présentoir : pains remplacés par la marchandise.
        if (id === 'etal') {
          // Fruits intégrés au modèle : étal vide (cagettes) quand le stock est épuisé.
          if (fill <= 0.02) { g.remove(fp.obj); box(g, w / 2 - 0.15, 0.7, d - 0.25, x0, 0, 0, mat(WOOD)); box(g, w / 2 - 0.25, 0.04, d - 0.35, x0, 0.7, 0, mat(WOOD_D), false); }
        } else {
          const top = fp.parts.length ? new THREE.Box3().setFromObject(fp.parts[0]!).min.y : 0.45;
          for (const part of fp.parts) part.visible = false;
          for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) slots.push([x0 - 0.33 + c * 0.22, top, -0.12 + r * 0.26]);
        }
      }
      if (id === 'etal') {
        const tops: Slot[] = [];
        for (let i = 0; i < 6; i++) tops.push([-w / 2 + 0.25 + i * ((w - 0.5) / 5), 0.97, 0.18]);
        goods(g, tops.slice(0, count(6)), [0.16, 0.16, 0.16], () => undefined);
      } else goods(g, slots.slice(0, count(slots.length)), [0.2, 0.14, 0.22], (p, i) => box(g, 0.18, 0.1, 0.2, p[0], p[1], p[2], col(i)));
      break;
    }
    case 'congelateur': {
      put(g, 'mm.congelateur', w - 0.1, 0.9, d - 0.15, 0, 0, 0);
      const slots: Slot[] = [];
      for (let r = 0; r < 2; r++) for (let c = 0; c < 7; c++) slots.push([-w / 2 + 0.25 + c * ((w - 0.5) / 6), 0.62, -0.18 + r * 0.32]);
      goods(g, slots.slice(0, count(slots.length)), [0.2, 0.2, 0.22], (p, i) => box(g, 0.18, 0.12, 0.22, p[0], p[1], p[2], col(i)));
      break;
    }
    case 'bar':
      for (let i = 0; i < 3; i++) put(g, 'meuble.bar', w / 3, 1.05, 0.6, -w / 2 + (i + 0.5) * (w / 3), 0, -d / 2 + 0.35);
      for (let i = 0; i < 3; i++) put(g, 'meuble.tabouret', 0.42, 0.8, 0.42, -w / 2 + (i + 0.5) * (w / 3), 0, 0.25, false);
      put(g, 'meuble.cafetiere', 0.35, 0.35, 0.3, w / 2 - 0.4, 1.05, -d / 2 + 0.35, false);
      break;
    case 'salon':
      put(g, 'meuble.tapis-rond', 2.2, null, 1.8, 0, 0.005, 0.1);
      put(g, 'meuble.canape-design', 2.0, 0.85, 0.8, -0.3, 0, -d / 2 + 0.45);
      put(g, 'meuble.fauteuil', 0.85, 0.95, 0.8, w / 2 - 0.5, 0, 0.2, false, -Math.PI / 2);
      put(g, 'meuble.table-basse', 1.0, 0.42, 0.6, -0.3, 0, 0.35, false);
      put(g, 'meuble.lampe', 0.4, 1.6, 0.4, -w / 2 + 0.25, 0, -d / 2 + 0.3, false);
      break;
    case 'bistrot':
      put(g, 'meuble.table', 0.8, 0.75, 0.8, 0, 0, 0, false);
      put(g, 'meuble.chaise-moderne', 0.45, 0.9, 0.45, -0.7, 0, 0, false, faceTo(1, 0));
      put(g, 'meuble.chaise-moderne', 0.45, 0.9, 0.45, 0.7, 0, 0, false, faceTo(-1, 0));
      break;
    case 'caddies':
      put(g, 'mm.caddie', 0.55, 0.95, 0.85, 0, 0, 0, false);
      put(g, 'mm.panier', 0.36, 0.26, 0.38, 0.3, 0, 0.3, false);
      put(g, 'mm.panier', 0.36, 0.26, 0.38, 0.3, 0.2, 0.3, false);
      break;
    case 'consigne':
      put(g, 'mm.consigne', 0.75, 1.7, 0.75, 0, 0, -0.1, false);
      break;
    case 'portemanteau':
      put(g, 'meuble.portemanteau', 0.6, 1.8, 0.6, 0, 0, 0, false);
      break;
    case 'enceintes':
      put(g, 'meuble.enceinte', 0.32, 1.2, 0.32, -0.22, 0, -0.1, false);
      put(g, 'meuble.enceinte', 0.32, 1.2, 0.32, 0.22, 0, -0.1, false);
      break;
    case 'fleurs': {
      box(g, 0.85, 0.35, 0.85, 0, 0, 0, mat('#8a5a3a'));
      box(g, 0.75, 0.02, 0.75, 0, 0.35, 0, mat('#5a3d2a'), false);
      const fl = ['nat.fleur-rouge-a', 'nat.fleur-jaune-a', 'nat.fleur-violette-a', 'nat.fleur-rouge-b', 'nat.buisson-fin'];
      [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2], [0, 0]].forEach(([x, z], i) => put(g, fl[(i + seed) % fl.length]!, 0.4, 0.5, 0.4, x!, 0.36, z!, false, r() * 6));
      break;
    }
    case 'bibliotheque':
      put(g, 'meuble.bibliotheque-fermee', w - 0.1, 1.6, 0.5, 0, 0, -0.2);
      put(g, 'meuble.livres', 0.35, 0.25, 0.22, -0.4, 1.6, -0.2, false);
      put(g, 'meuble.plante-1', 0.3, 0.45, 0.3, 0.5, 1.6, -0.2, false);
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
    // Plusieurs modèles par produit (pains, fruits, boissons…) : variante choisie selon l'emplacement.
    const keys = productKeys(id).filter((key) => assets.has(key));
    if (!keys.length) { fallback(p, k); return; }
    const key = keys[(k * 7 + Math.floor(k / ids.length)) % keys.length]!;
    const m = new THREE.Matrix4().makeRotationY(((k * 47) % 11 - 5) * 0.06).setPosition(p[0], p[1], p[2]);
    if (!by.has(key)) by.set(key, []);
    by.get(key)!.push(m);
  });
  for (const [key, ms] of by) { const im = assets.instances(key, ms, size[0], size[1], size[2]); if (im) g.add(im); }
}
