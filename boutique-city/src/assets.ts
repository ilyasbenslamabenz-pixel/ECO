/**
 * CONFIG puis ASSETS : modèles 3D (Kenney, CC0 — voir models/CREDITS.txt).
 * Chargement unique par GLTFLoader + LoadingManager (barre de progression), puis clones : SkeletonUtils.clone pour
 * les personnages animés, clone simple sinon ; géométrie fusionnée pour les bâtiments instanciés. Mise à l'échelle
 * automatique par boîte englobante (Box3). Un modèle absent ou en erreur n'empêche rien : le jeu garde alors la
 * forme faite en code (chaque appel rend null). Dépend de three.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MODEL_FILES } from './model-files';

/* ------------------------------ CONFIG ------------------------------ */

export const CONFIG = {
  /** Dossier des modèles, relatif à la page. */
  modelsDir: 'models/',
  /** Taille d'un personnage non joueur (m) : modèles « mini » à grosse tête, plus petits que le joueur pour garder
   * une largeur d'épaules réaliste (≈ 0,5 m). */
  npcHeight: 1.0,
  /** Délai maximal du chargement avant de jouer avec les formes faites en code (ms). */
  loadTimeoutMs: 25000,
} as const;

/* ------------------------------ ASSETS ------------------------------ */

export type AssetKind = 'batiment' | 'meuble' | 'personnage' | 'vehicule' | 'produit';
export interface AssetDef {
  file: string;
  kind: AssetKind;
  /** Facteur d'échelle appliqué après l'ajustement automatique. */
  scale: number;
  /** Rotation (quarts de tour) pour que la face avant regarde vers +z (meubles, bâtiments) ou −z (personnages). */
  rot: number;
}

const def = (file: string, kind: AssetKind, rot = 0, scale = 1): AssetDef => ({ file, kind, scale, rot });
/** Ajoute une série de modèles : `prefix + nom` → fichier `filePrefix + nom + .glb`. */
function series(out: Record<string, AssetDef>, prefix: string, filePrefix: string, names: string[], kind: AssetKind, rot = 0): void {
  for (const n of names) {
    const [key, file] = n.includes('=') ? n.split('=') as [string, string] : [n, n];
    out[prefix + key] = def(`${filePrefix}${file}.glb`, kind, rot);
  }
}

export const ASSETS: Record<string, AssetDef> = {};
{
  const A = ASSETS;
  // City Kit (Commercial) : immeubles du quartier (choisis selon la hauteur), tours, auvents et parasols.
  series(A, 'bat.', 'building-', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n'], 'batiment');
  series(A, 'bat.tour-', 'building-skyscraper-', ['a', 'b', 'c', 'd', 'e'], 'batiment');
  series(A, 'rue.', 'com-', ['auvent=detail-awning', 'auvent-large=detail-awning-wide', 'marquise=detail-overhang', 'parasol-a=detail-parasol-a', 'parasol-b=detail-parasol-b'], 'meuble');
  // City Kit Suburban : petits immeubles d'habitation, arbres, jardinières, clôtures.
  series(A, 'maison.', 'house-', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'k', 'l', 'm', 'o'], 'batiment');
  series(A, 'rue.', 'sub-', ['arbre-grand=tree-large', 'arbre-petit=tree-small', 'jardiniere=planter', 'cloture=fence-low'], 'meuble');
  // City Kit Industrial : entrepôts (grossiste, garage) et citerne.
  series(A, 'ind.', 'ind-', ['a=building-a', 'c=building-c', 'e=building-e', 'h=building-h', 'citerne=detail-tank'], 'batiment');
  // Retro Urban Kit : mobilier urbain, arbres de parc, camions.
  series(A, 'rue.', 'urb-', ['banc=detail-bench', 'benne=detail-dumpster-closed', 'feu=detail-light-traffic', 'arbre-parc=tree-park-large', 'buisson=tree-shrub', 'palette=pallet', 'barriere=detail-barrier-type-a'], 'meuble');
  series(A, 'auto.', 'urb-', ['camion-vert=truck-green-cargo', 'camion-gris=truck-grey'], 'vehicule', 2);
  // City Kit Roads : lampadaire, chantier.
  A['rue.lampadaire'] = def('streetlight.glb', 'meuble');
  series(A, 'rue.', 'road-', ['chantier-barriere=construction-barrier', 'chantier-cone=construction-cone', 'chantier-lampe=construction-light'], 'meuble');
  // Car Kit : circulation, véhicules du joueur, cônes et cartons.
  series(A, 'auto.', 'car-', ['berline=sedan', 'taxi', 'camionnette=van', 'suv', 'livraison=delivery', 'ambulance', 'police', 'pompiers=firetruck',
    'poubelles=garbage-truck', 'citadine=hatchback-sports', 'sport=sedan-sports', 'suv-luxe=suv-luxury', 'camion=truck', 'plateau=truck-flat',
    'livraison-plateau=delivery-flat'], 'vehicule', 2);
  series(A, 'rue.', 'car-', ['cone', 'carton=box'], 'meuble');
  // Mini Characters (+ employé du Mini Market) : clients et employés animés.
  series(A, 'perso.', 'character-', ['f-a=female-a', 'f-b=female-b', 'f-c=female-c', 'f-d=female-d', 'f-e=female-e', 'f-f=female-f',
    'h-a=male-a', 'h-b=male-b', 'h-c=male-c', 'h-d=male-d', 'h-e=male-e', 'h-f=male-f'], 'personnage', 2);
  A['perso.employe'] = def('mm-character-employee.glb', 'personnage', 2);
  // Mini Market : mobilier d'épicerie (les articles du modèle sont montrés selon le stock).
  series(A, 'mm.', 'mm-', ['consigne=bottle-return', 'caisse=cash-register', 'presentoir-pain=display-bread', 'etal-fruits=display-fruit',
    'congelateur=freezer', 'congelateurs=freezers-standing', 'rayon-sacs=shelf-bags', 'rayon-cartons=shelf-boxes', 'rayon-bout=shelf-end',
    'panier=shopping-basket', 'caddie=shopping-cart', 'colonne=column'], 'meuble', 2);
  // Furniture Kit : mobilier des commerces et du logement.
  series(A, 'meuble.', '', ['bureau=desk', 'ecran=computerScreen', 'bibliotheque=bookcaseOpen', 'bar=kitchenBar', 'placard=kitchenCabinet',
    'cafetiere=kitchenCoffeeMachine', 'chaise=chair', 'lit=bedDouble', 'canape=loungeSofa', 'frigo=kitchenFridgeLarge',
    'lit-simple=bedSingle', 'lavabo=bathroomSink', 'miroir=bathroomMirror', 'wc=toilet', 'douche=shower', 'baignoire=bathtub',
    'cuisiniere=kitchenStove', 'evier=kitchenSink', 'frigo-petit=kitchenFridge', 'micro-ondes=kitchenMicrowave', 'placard-haut=kitchenCabinetUpper',
    'tele=televisionModern', 'meuble-tele=cabinetTelevision', 'fauteuil=loungeChair', 'canape-design=loungeDesignSofa', 'table-basse=tableCoffee',
    'chevet=sideTable', 'lampe-chevet=lampSquareTable', 'bibliotheque-fermee=bookcaseClosedWide', 'livres=books', 'portemanteau=coatRackStanding',
    'tabouret=stoolBar', 'chaise-moderne=chairModernCushion', 'table=table', 'chaise-coussin=chairCushion', 'tapis-rond=rugRound',
    'paillasson=rugDoormat', 'plante-1=plantSmall1', 'plante-2=plantSmall2', 'plante-3=plantSmall3', 'carton=cardboardBoxClosed',
    'carton-ouvert=cardboardBoxOpen', 'poubelle=trashcan', 'portable=laptop', 'enceinte=speaker', 'radio', 'lave-linge=washer',
    'applique=lampWall', 'chaise-bureau=chairDesk', 'mixeur=kitchenBlender', 'grille-pain=toaster', 'coussin=pillowBlue'], 'meuble', 2);
  series(A, 'meuble.', '', ['table-ronde=tableRound', 'plante=pottedPlant', 'lampe=lampRoundFloor', 'tapis=rugRectangle'], 'meuble');
  // Nature Kit : fleurs, plantes en pot, buissons et arbres.
  series(A, 'nat.', 'nat-', ['fleur-rouge-a=flower_redA', 'fleur-rouge-b=flower_redB', 'fleur-rouge-c=flower_redC', 'fleur-jaune-a=flower_yellowA',
    'fleur-jaune-b=flower_yellowB', 'fleur-violette-a=flower_purpleA', 'fleur-violette-b=flower_purpleB', 'buisson=plant_bush',
    'buisson-grand=plant_bushLarge', 'buisson-fin=plant_bushDetailed', 'pot-grand=pot_large', 'pot-petit=pot_small', 'arbre=tree_default',
    'chene=tree_oak', 'arbre-fin=tree_detailed'], 'meuble');
  // Food Kit : marchandise visible (plusieurs modèles par produit : « produit.<id> », « produit.<id>.2 »…).
  const goods: Record<string, string[]> = {
    pain: ['food-loaf', 'food-loaf-baguette', 'food-loaf-round', 'food-bread'],
    lait: ['food-carton', 'food-carton-small', 'food-egg', 'food-egg-cup', 'food-cheese-cut', 'food-whipped-cream', 'food-pudding'],
    fruits: ['food-apple', 'food-banana', 'food-orange', 'food-pear', 'food-grapes', 'food-pineapple', 'food-watermelon', 'food-tomato', 'food-carrot', 'food-broccoli', 'food-cabbage', 'food-strawberry', 'food-cherries', 'food-lemon'],
    boissons: ['food-soda', 'food-soda-bottle', 'food-soda-can', 'food-wine-red', 'food-wine-white', 'food-glass-wine', 'food-soda-glass'],
    conserves: ['food-can', 'food-can-small', 'food-bottle-oil', 'food-bottle-ketchup', 'food-bottle-musterd', 'food-honey', 'food-peanut-butter', 'food-soy', 'food-can-open', 'food-shaker-salt', 'food-shaker-pepper', 'food-pepper-mill'],
    snacks: ['food-cheese', 'food-chocolate', 'food-candy-bar', 'food-cookie', 'food-chocolate-wrapper', 'food-candy-bar-wrapper', 'food-cookie-chocolate', 'food-lollypop', 'food-bag', 'food-bag-flat'],
    cafe: ['food-cup', 'food-cup-coffee', 'food-cup-saucer', 'food-frappe'],
    the: ['food-mug', 'food-cup-tea', 'food-glass'],
    croissant: ['food-croissant', 'food-donut', 'food-donut-chocolate', 'food-donut-sprinkles', 'food-muffin', 'food-cupcake', 'food-cake', 'food-pie', 'food-waffle', 'food-pancakes'],
    sandwich: ['food-sandwich', 'food-sub', 'food-burger', 'food-hot-dog', 'food-pizza', 'food-taco', 'food-salad', 'food-rice-ball'],
    jus: ['food-lemon', 'food-orange', 'food-coconut', 'food-lemon-half', 'food-cocktail'],
    plantes: ['pottedPlant', 'plantSmall1', 'plantSmall2', 'plantSmall3', 'nat-pot_large', 'nat-pot_small', 'nat-plant_bush', 'nat-plant_flatTall'],
    roses: ['nat-flower_redA', 'nat-flower_redB', 'nat-flower_redC'],
    bouquet: ['nat-flower_purpleA', 'nat-flower_yellowA', 'nat-flower_purpleB', 'nat-flower_yellowB', 'nat-flower_purpleC', 'nat-flower_yellowC'],
    cartes: ['books'],
    baguette: ['food-loaf-baguette', 'food-loaf', 'food-bread'],
    campagne: ['food-loaf-round', 'food-bread', 'food-loaf', 'food-ginger-bread'],
    viennoiseries: ['food-croissant', 'food-muffin', 'food-donut-sprinkles', 'food-pancakes', 'food-waffle'],
    patisseries: ['food-cake', 'food-cake-birthday', 'food-cupcake', 'food-pie', 'food-mincemeat-pie', 'food-donut-chocolate', 'food-sundae'],
    eau: ['food-soda-bottle', 'food-glass', 'food-carton-small'],
    burger: ['food-burger', 'food-burger-cheese', 'food-burger-double', 'food-burger-cheese-double'],
    frites: ['food-fries', 'food-corn-dog', 'food-frikandel-speciaal', 'food-skewer'],
    hotdog: ['food-hot-dog', 'food-sausage', 'food-meat-sausage', 'food-corn-dog'],
    pizza: ['food-pizza', 'food-pizza-box', 'food-taco'],
    soda: ['food-soda-can', 'food-soda', 'food-soda-bottle', 'food-soda-glass'],
    glace: ['food-ice-cream', 'food-ice-cream-cup', 'food-ice-cream-cne', 'food-popsicle', 'food-popsicle-chocolate', 'food-sundae', 'food-ice-cream-scoop-mint', 'food-ice-cream-scoop-chocolate'],
    legumes: ['food-carrot', 'food-broccoli', 'food-cabbage', 'food-cauliflower', 'food-eggplant', 'food-leek', 'food-onion', 'food-paprika', 'food-pepper', 'food-pumpkin', 'food-radish', 'food-tomato', 'food-corn', 'food-beet', 'food-celery-stick'],
    fruitsfrais: ['food-apple', 'food-pear', 'food-orange', 'food-grapes', 'food-strawberry', 'food-cherries', 'food-banana', 'food-lemon', 'food-watermelon'],
    exotiques: ['food-pineapple', 'food-coconut', 'food-avocado', 'food-advocado-half', 'food-coconut-half'],
    herbes: ['food-mushroom', 'food-mushroom-half', 'food-onion-half', 'food-paprika-slice', 'nat-mushroom_red', 'nat-mushroom_tan', 'nat-mushroom_redGroup'],
    jusfrais: ['food-glass', 'food-cocktail', 'food-lemon-half', 'food-orange'],
  };
  for (const [id, files] of Object.entries(goods)) files.forEach((f, i) => { A[`produit.${id}${i ? '.' + (i + 1) : ''}`] = def(`${f}.glb`, 'produit'); });
}

/**
 * Tous les fichiers du dossier models/ : clé générique « f:<nom> » (genre et rotation déduits du préfixe du pack),
 * pour les familles utilisées en série (décor, animaux, variantes de produits, véhicules garés…).
 */
export function kindOf(name: string): { kind: AssetKind; rot: number } {
  if (/^(character-|mm-character|arc-character|skt-character|blk-character)/.test(name)) return { kind: 'personnage', rot: 2 };
  if (/^(car-|urb-truck)/.test(name) && !/^car-(cone|box)/.test(name)) return { kind: 'vehicule', rot: 2 };
  if (/^(building-|house-|ind-building|com-low-detail)/.test(name)) return { kind: 'batiment', rot: 0 };
  if (/^food-/.test(name)) return { kind: 'produit', rot: 0 };
  if (/^[a-z]+[A-Z]/.test(name) || /^(mm-|arc-)/.test(name)) return { kind: 'meuble', rot: 2 };
  return { kind: 'meuble', rot: 0 };
}
for (const name of MODEL_FILES) { const k = kindOf(name); ASSETS[`f:${name}`] ??= def(`${name}.glb`, k.kind, k.rot); }
/** Clés génériques des fichiers dont le nom correspond au motif (chargés ou non). */
export function filesMatching(re: RegExp): string[] { return MODEL_FILES.filter((n) => re.test(n)).map((n) => `f:${n}`); }

/** Clés d'un produit : « produit.<id> » puis ses variantes « produit.<id>.2 »… (toutes, chargées ou non). */
export function productKeys(id: string): string[] {
  const out: string[] = [];
  for (let i = 1; ASSETS[`produit.${id}${i > 1 ? '.' + i : ''}`]; i++) out.push(`produit.${id}${i > 1 ? '.' + i : ''}`);
  return out;
}
/** Clés dont le nom commence par `prefix` (ex. « perso. », « auto. »). */
export function keysWith(prefix: string): string[] { return Object.keys(ASSETS).filter((k) => k.startsWith(prefix)); }

/* ------------------------------ Bibliothèque ------------------------------ */

interface Loaded { scene: THREE.Object3D; animations: THREE.AnimationClip[]; skinned: boolean }

export class AssetLib {
  private readonly loaded = new Map<string, Loaded>();
  private readonly parsedByFile = new Map<string, { scene: THREE.Object3D; animations: THREE.AnimationClip[] }>();
  readonly failed: string[] = [];
  private readonly mergedCache = new Map<string, { geo: THREE.BufferGeometry; mat: THREE.Material | THREE.Material[] } | null>();
  done = false;

  has(key: string): boolean { return this.loaded.has(key); }
  count(kind?: AssetKind): number { return [...this.loaded.keys()].filter((k) => !kind || ASSETS[k]!.kind === kind).length; }

  /**
   * Charge tous les modèles (progression 0..1). D'abord le paquet models/pack.json (tous les GLB en base64 : la page
   * publiée ne sert pas les .glb), sinon chaque fichier .glb. Ne rejette jamais : les échecs sont listés dans `failed`.
   */
  async load(onProgress: (p: number, label: string) => void, disabled = false): Promise<void> {
    const keys = Object.keys(ASSETS);
    if (disabled) { this.failed.push(...keys); this.done = true; return; }
    const files = await loadPack(CONFIG.modelsDir, (p) => onProgress(p * 0.7, 'paquet de modèles'));
    if (files) {
      const loader = new GLTFLoader();
      let n = 0;
      for (const key of keys) {
        const def = ASSETS[key]!;
        try {
          const bin = files(def.file);
          if (!bin) throw new Error('absent du paquet');
          // Un même fichier peut servir à plusieurs clés : analysé une fois.
          let parsed = this.parsedByFile.get(def.file);
          if (!parsed) { parsed = await loader.parseAsync(bin, ''); this.parsedByFile.set(def.file, parsed); }
          this.register(key, parsed.scene, parsed.animations);
        } catch { this.failed.push(key); }
        if (++n % 8 === 0 || n === keys.length) {
          onProgress(0.7 + (0.3 * n) / keys.length, def.file);
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      this.parsedByFile.clear();
      this.done = true;
      return;
    }
    return this.loadFiles(keys, onProgress);
  }

  private register(key: string, scene: THREE.Object3D, animations: THREE.AnimationClip[]): void {
    let skinned = false;
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true; m.receiveShadow = true; m.geometry.userData['shared'] = true;
        // Packs sans « metallicFactor » (Nature Kit) : métal par défaut du glTF, noir sans carte d'environnement.
        // Rugosité par défaut du glTF (1, mat absolu) : un peu moins rugueux, pour un léger lustré sous le soleil et
        // dans les reflets de l'environnement (plus encore pour les modèles à palette : peinture, plastique).
        for (const mt of (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[]) {
          if (mt.isMeshStandardMaterial && mt.metalness > 0.5 && !mt.metalnessMap) mt.metalness = 0;
          if (mt.isMeshStandardMaterial && mt.roughness > 0.99 && !mt.roughnessMap) mt.roughness = mt.map ? 0.78 : 0.88;
        }
      }
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = true;
    });
    this.loaded.set(key, { scene, animations, skinned });
  }

  /** Chargement fichier par fichier (GLTFLoader + LoadingManager). */
  private loadFiles(keys: string[], onProgress: (p: number, label: string) => void): Promise<void> {
    return new Promise((resolve) => {
      const manager = new THREE.LoadingManager();
      let finished = false;
      const end = (): void => { if (finished) return; finished = true; this.done = true; resolve(); };
      manager.onProgress = (url, n, total) => onProgress(n / Math.max(1, total), url.split('/').pop() ?? '');
      manager.onLoad = end;
      manager.onError = (url) => onProgress(0, `erreur : ${url}`);
      const loader = new GLTFLoader(manager);
      let pending = keys.length;
      for (const key of keys) {
        const def = ASSETS[key]!;
        loader.load(CONFIG.modelsDir + def.file, (gltf) => {
          this.register(key, gltf.scene, gltf.animations);
          if (--pending === 0) end();
        }, undefined, () => { this.failed.push(key); if (--pending === 0) end(); });
      }
      setTimeout(end, CONFIG.loadTimeoutMs);
    });
  }

  /** Clone d'un modèle (personnage animé : squelette cloné), tourné selon ASSETS, ou null. */
  clone(key: string): { obj: THREE.Object3D; animations: THREE.AnimationClip[] } | null {
    const l = this.loaded.get(key);
    if (!l) return null;
    const inner = l.skinned ? SkeletonUtils.clone(l.scene) : l.scene.clone(true);
    inner.rotation.y = (ASSETS[key]!.rot * Math.PI) / 2;
    const wrap = new THREE.Group();
    wrap.add(inner);
    return { obj: wrap, animations: l.animations };
  }

  /**
   * Clone ajusté dans une boîte w × h × d (m), posé au sol (y = 0) et centré. `stretch` : déformation pour remplir
   * exactement la boîte ; sinon échelle uniforme (la plus grande qui tient). `h` nul : hauteur libre.
   */
  fitted(key: string, w: number, h: number | null, d: number, stretch = false): THREE.Object3D | null {
    const c = this.clone(key);
    if (!c) return null;
    return fitInto(c.obj, w, h, d, stretch, ASSETS[key]!.scale);
  }

  /**
   * Comme `fitted`, et renvoie aussi les sous-objets dont le nom commence par l'un des préfixes (articles intégrés à
   * un modèle : pains d'un présentoir, cartons d'un rayon…), que l'appelant montre ou cache selon le stock.
   */
  fittedParts(key: string, w: number, h: number | null, d: number, prefixes: string[], stretch = false): { obj: THREE.Object3D; parts: THREE.Object3D[] } | null {
    const c = this.clone(key);
    if (!c) return null;
    const parts: THREE.Object3D[] = [];
    c.obj.traverse((o) => { if (o !== c.obj && prefixes.some((p) => o.name.startsWith(p)) && !parts.some((q) => isAncestor(q, o))) parts.push(o); });
    return { obj: fitInto(c.obj, w, h, d, stretch, ASSETS[key]!.scale), parts };
  }

  /**
   * Géométrie fusionnée (unité : boîte 1 × 1 × 1, base en y = 0, centrée) et matériau(x), pour l'instanciation des
   * bâtiments. Null si le modèle manque.
   */
  merged(key: string): { geo: THREE.BufferGeometry; mat: THREE.Material | THREE.Material[] } | null {
    if (this.mergedCache.has(key)) return this.mergedCache.get(key)!;
    const l = this.loaded.get(key);
    let out: { geo: THREE.BufferGeometry; mat: THREE.Material | THREE.Material[] } | null = null;
    if (l) {
      const root = l.scene.clone(true);
      root.rotation.y = (ASSETS[key]!.rot * Math.PI) / 2;
      root.updateMatrixWorld(true);
      const geos: THREE.BufferGeometry[] = [];
      const mats: THREE.Material[] = [];
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
        for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
        geos.push(g.index ? g.toNonIndexed() : g);
        mats.push(Array.isArray(m.material) ? m.material[0]! : m.material);
      });
      // Parties partageant le même matériau (souvent toutes : un seul « colormap » par modèle Kenney) fusionnées
      // en un seul groupe : un appel de dessin par matériau au lieu d'un par partie (carrosserie, roues…).
      const uniq = [...new Set(mats)];
      const byMat = uniq.map((mt) => geos.filter((_, i) => mats[i] === mt));
      const parts = byMat.map((gs) => (gs.length === 1 ? gs[0]! : mergeGeometries(gs, false)));
      const geo = parts.some((g) => !g) ? null : parts.length === 1 ? parts[0]! : mergeGeometries(parts as THREE.BufferGeometry[], true);
      mats.splice(0, mats.length, ...uniq);
      if (geo) {
        geo.computeBoundingBox();
        const b = geo.boundingBox!, size = b.getSize(new THREE.Vector3());
        geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
        geo.scale(1 / size.x, 1 / size.y, 1 / size.z);
        geo.computeBoundingSphere();
        geo.userData['shared'] = true;
        out = { geo, mat: mats.length === 1 ? mats[0]! : mats };
      }
    }
    this.mergedCache.set(key, out);
    return out;
  }

  /** Dimensions d'origine d'un modèle (après sa rotation d'ASSETS), ou null. */
  size(key: string): THREE.Vector3 | null {
    const c = this.sizeCache.get(key);
    if (c) return c;
    const l = this.loaded.get(key);
    if (!l) return null;
    const root = l.scene.clone(true);
    root.rotation.y = (ASSETS[key]!.rot * Math.PI) / 2;
    root.updateMatrixWorld(true);
    const v = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
    this.sizeCache.set(key, v);
    return v;
  }
  private readonly sizeCache = new Map<string, THREE.Vector3>();

  /**
   * InstancedMesh d'un modèle (géométrie fusionnée) pour `mats` positions ; chaque instance garde les proportions
   * du modèle et tient dans la boîte w × h × d. Null si le modèle manque.
   */
  instances(key: string, at: THREE.Matrix4[], w: number, h: number, d: number): THREE.InstancedMesh | null {
    const mg = this.merged(key), sz = this.size(key);
    if (!mg || !sz || !at.length) return null;
    const k = Math.min(w / sz.x, h / sz.y, d / sz.z);
    const scale = new THREE.Matrix4().makeScale(sz.x * k, sz.y * k, sz.z * k);
    const m = new THREE.InstancedMesh(mg.geo, mg.mat as THREE.Material, at.length);
    at.forEach((a, i) => m.setMatrixAt(i, a.clone().multiply(scale)));
    m.castShadow = false;
    m.receiveShadow = true;
    m.computeBoundingSphere();
    return m;
  }

  /** Proportions d'origine (hauteur / largeur moyenne) d'un modèle, ou 0. */
  aspect(key: string): number {
    const l = this.loaded.get(key);
    if (!l) return 0;
    const s = new THREE.Box3().setFromObject(l.scene).getSize(new THREE.Vector3());
    return s.y / ((s.x + s.z) / 2);
  }
}

type PackJson = Record<string, string> | { v: 3; index: Record<string, [number, number]>; gz: string } | { v: 4; parts: string[] };
type Files = (file: string) => ArrayBuffer | null;

/**
 * Paquet des modèles : format 4 = liste de parties (chacune au format 3), téléchargées en parallèle ; formats 3 et
 * ancien acceptés. Null si absent ou illisible.
 */
async function loadPack(dir: string, onProgress: (p: number) => void): Promise<Files | null> {
  const head = await fetchPack(dir + 'pack.json', () => undefined);
  if (!head) return null;
  if ('v' in head && (head as { v: unknown }).v === 4) {
    const parts = (head as { parts: string[] }).parts;
    const prog = parts.map(() => 0);
    const got = await Promise.all(parts.map((name, i) => fetchPack(dir + name, (p) => { prog[i] = p; onProgress(prog.reduce((a, b) => a + b, 0) / parts.length); })
      .then((pk) => (pk ? unpack(pk) : null))));
    if (got.some((g) => !g)) return null;
    return (file) => { for (const g of got) { const b = g!(file); if (b) return b; } return null; };
  }
  onProgress(1);
  return unpack(head);
}

/**
 * Accès aux fichiers du paquet. Format 3 : GLB bout à bout compressés (gzip, base64) avec index ; ancien format :
 * un base64 par fichier. Null si le paquet est illisible (le jeu charge alors les fichiers .glb).
 */
async function unpack(pack: PackJson): Promise<Files | null> {
  const b64 = (t: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
  if ('gz' in pack && typeof (pack as { gz: unknown }).gz === 'string') {
    const p = pack as { index: Record<string, [number, number]>; gz: string };
    if (typeof DecompressionStream === 'undefined') return null;
    try {
      const stream = new Blob([b64(p.gz)]).stream().pipeThrough(new DecompressionStream('gzip'));
      const all = new Uint8Array(await new Response(stream).arrayBuffer());
      return (file) => { const e = p.index[file]; return e ? all.slice(e[0], e[0] + e[1]).buffer : null; };
    } catch { return null; }
  }
  const old = pack as Record<string, string>;
  return (file) => (old[file] ? b64(old[file]!).buffer as ArrayBuffer : null);
}

/** Télécharge le paquet de modèles avec progression ; null s'il est absent ou illisible. */
async function fetchPack(url: string, onProgress: (p: number) => void): Promise<PackJson | null> {
  try {
    const res = await fetch(url);
    if (!res.ok || !res.body) return null;
    const total = Number(res.headers.get('content-length')) || 0;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      onProgress(total ? Math.min(1, got / total) : 0.5);
    }
    const all = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) { all.set(c, o); o += c.length; }
    return JSON.parse(new TextDecoder().decode(all)) as PackJson;
  } catch { return null; }
}

function isAncestor(a: THREE.Object3D, o: THREE.Object3D): boolean { for (let p = o.parent; p; p = p.parent) if (p === a) return true; return false; }

/** Ajuste un objet dans une boîte (voir AssetLib.fitted). */
export function fitInto(obj: THREE.Object3D, w: number, h: number | null, d: number, stretch: boolean, extra = 1): THREE.Object3D {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj, true);
  const s = box.getSize(new THREE.Vector3());
  let sx: number, sy: number, sz: number;
  if (stretch) { sx = w / s.x; sz = d / s.z; sy = h ? h / s.y : (sx + sz) / 2; }
  else { const k = Math.min(w / s.x, d / s.z, h ? h / s.y : Infinity); sx = sy = sz = k; }
  obj.scale.set(sx * extra, sy * extra, sz * extra);
  obj.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(obj, true);
  obj.position.x -= (b2.min.x + b2.max.x) / 2;
  obj.position.z -= (b2.min.z + b2.max.z) / 2;
  obj.position.y -= b2.min.y;
  const g = new THREE.Group();
  g.add(obj);
  return g;
}

export const assets = new AssetLib();
