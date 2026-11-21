/**
 * Quartier généré : quadrillage de rues, immeubles en bordure d'îlot (logements, bureaux, commerces en rez-de-
 * chaussée), un parc. Chaque local commercial a une surface, un loyer et un passage piéton estimé (habitants et
 * employés proches, avenue centrale). Une partie des locaux est déjà occupée par des concurrents. TypeScript pur.
 */
import { ECONOMY, HOMES, SHOP_TYPES, type ServiceKind, type ShopType } from './catalog';
import { Rng } from './rng';

/** Largeur d'une rue (chaussée et trottoirs, m) et taille intérieure d'un îlot (m). */
export const STREET_W = 14;
export const SIDEWALK_W = 3;
export const BLOCK = 64;
export const PITCH = BLOCK + STREET_W;

export type BuildingKind = 'logement' | 'bureaux' | 'commerce';

export interface Building {
  id: number;
  kind: BuildingKind;
  /** Centre de l'emprise (m). */
  x: number;
  z: number;
  /** Façade (le long de la rue) et profondeur (m). */
  w: number;
  d: number;
  /** Direction de la façade sur rue : 0 = +z, 1 = +x, 2 = −z, 3 = −x. */
  face: number;
  floors: number;
  residents: number;
  workers: number;
  /** Teinte de façade (0..1, choisie par le rendu dans sa palette). */
  tint: number;
  premise: Premise | null;
  /** Service du quartier (grossiste, banque…) installé au rez-de-chaussée, ou null. */
  service: ServiceKind | null;
  /** Logement à louer dans l'immeuble, ou null. */
  home: Home | null;
  /** Porte : point du trottoir devant le milieu de la façade (m). */
  doorX: number;
  doorZ: number;
}

export interface Home {
  id: number;
  buildingId: number;
  /** Type de logement (HOMES). */
  def: string;
  doorX: number;
  doorZ: number;
}

export interface Premise {
  id: number;
  buildingId: number;
  /** Surface de vente (m²) et grille intérieure (cases de 1 m). */
  area: number;
  gridW: number;
  gridD: number;
  /** Loyer mensuel (CHF). */
  rent: number;
  /** Passants par heure à l'heure de pointe devant la vitrine. */
  footfall: number;
  /** Porte (point du trottoir devant la vitrine, m). */
  doorX: number;
  doorZ: number;
  /** Concurrent installé (type), ou null si libre ou loué par le joueur. */
  competitor: ShopType | null;
  competitorName: string | null;
}

export interface District {
  seed: number;
  nx: number;
  nz: number;
  /** Emprise totale (m), centrée sur l'origine. */
  size: { w: number; d: number };
  /** Index (dans la grille des rues verticales) de l'avenue centrale, plus fréquentée. */
  avenue: number;
  buildings: Building[];
  premises: Premise[];
  homes: Home[];
  /** Logement loué au début de la partie. */
  startHome: number;
  parkBlock: { i: number; j: number };
}

/** Services installés (le snack est présent deux fois). */
export const SERVICE_ORDER: readonly ServiceKind[] = ['grossiste', 'meubles', 'banque', 'emploi', 'garage', 'pub', 'snack', 'snack'];

const COMPETITOR_NAMES: Record<ShopType, string[]> = {
  epicerie: ['Épicerie du Coin', 'Chez Karim', 'Mini-Marché Zitoun', 'Épicerie Nour'],
  cafe: ['Café des Arts', 'Le Petit Noir', 'Café Lamrani', 'Brûlerie Hamria'],
  vetements: ['Mode Zahra', 'Atelier Textile', 'Jeans & Co', 'Boutique Riad'],
  fleuriste: ['Fleurs du Riad', 'Le Jardin de Lina', 'Rose & Jasmin'],
  boulangerie: ['Boulangerie Benali', 'Au Bon Pain', 'Le Fournil du Quartier'],
  fastfood: ['Burger Express', 'Tacos & Co', 'Snack Rapide'],
  primeur: ['Fruits du Souk', 'Le Panier Vert', 'Primeur Atlas'],
};

/** Centre d'un îlot (i, j). */
export function blockCenter(d: Pick<District, 'nx' | 'nz'>, i: number, j: number): { x: number; z: number } {
  return { x: (i - (d.nx - 1) / 2) * PITCH, z: (j - (d.nz - 1) / 2) * PITCH };
}

export function generateDistrict(seed: number, nx = 6, nz = 5): District {
  const rng = new Rng(seed);
  const buildings: Building[] = [];
  const premises: Premise[] = [];
  const avenue = Math.floor(nx / 2); // rue verticale entre les îlots avenue-1 et avenue
  const park = { i: rng.int(1, nx - 2), j: rng.int(1, nz - 2) };
  let nextId = 1;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      if (i === park.i && j === park.j) continue;
      const c = blockCenter({ nx, nz }, i, j);
      // Quartier d'affaires vers le centre, logements en périphérie.
      const centrality = 1 - Math.hypot(i - (nx - 1) / 2, j - (nz - 1) / 2) / Math.hypot(nx / 2, nz / 2);
      for (let face = 0; face < 4; face++) {
        // Le long de chaque côté : lots de 10 à 16 m de façade, sans les coins (pris par les côtés x).
        const along = face % 2 === 0 ? BLOCK : BLOCK - 2 * 16;
        let s = -along / 2;
        while (s < along / 2 - 8) {
          const w = Math.min(rng.int(10, 16), along / 2 - s);
          if (w < 8) break;
          const depth = face % 2 === 0 ? 16 : rng.int(12, 16);
          const mid = s + w / 2;
          const half = BLOCK / 2 - depth / 2;
          const pos = face === 0 ? { x: c.x + mid, z: c.z + half } : face === 2 ? { x: c.x - mid, z: c.z - half } : face === 1 ? { x: c.x + half, z: c.z - mid } : { x: c.x - half, z: c.z + mid };
          // Côtés x : dimensions échangées (façade selon z).
          const bw = face % 2 === 0 ? w : depth, bd = face % 2 === 0 ? depth : w;
          const r = rng.next();
          const onAvenue = (face === 3 && i === avenue) || (face === 1 && i === avenue - 1);
          const kind: BuildingKind = r < (onAvenue ? 0.65 : 0.32) ? 'commerce' : r < 0.32 + 0.35 * centrality ? 'bureaux' : 'logement';
          const floors = kind === 'bureaux' ? rng.int(4, 9) : rng.int(2, 5) + (centrality > 0.5 ? 1 : 0);
          const footprint = bw * bd;
          const upper = kind === 'commerce' ? floors - 1 : floors;
          const b: Building = {
            id: nextId++, kind, x: pos.x, z: pos.z, w: bw, d: bd, face, floors,
            residents: kind === 'bureaux' ? 0 : Math.round((footprint * upper) / 35),
            workers: kind === 'bureaux' ? Math.round((footprint * floors) / 14) : kind === 'commerce' ? 3 : 0,
            tint: rng.next(), premise: null, service: null, home: null, doorX: 0, doorZ: 0,
          };
          const fn = FACE_N[face]!, dep = face % 2 === 0 ? bd : bw;
          b.doorX = b.x + fn[0] * (dep / 2 + SIDEWALK_W / 2);
          b.doorZ = b.z + fn[1] * (dep / 2 + SIDEWALK_W / 2);
          buildings.push(b);
          s += w;
        }
      }
    }
  }
  // Locaux commerciaux : passage piéton, loyer, concurrents.
  for (const b of buildings) {
    if (b.kind !== 'commerce') continue;
    const frontW = b.face % 2 === 0 ? b.w : b.d;
    const depth = b.face % 2 === 0 ? b.d : b.w;
    // Surface de vente 60 à 120 m² (arrière-boutique et réserve non aménageables).
    const gridW = Math.max(8, Math.min(12, Math.floor(frontW)));
    const gridD = Math.max(7, Math.min(10, Math.floor(depth - 4)));
    const n = FACE_N[b.face]!;
    const doorX = b.x + n[0] * (depth / 2 + SIDEWALK_W / 2);
    const doorZ = b.z + n[1] * (depth / 2 + SIDEWALK_W / 2);
    const p: Premise = {
      id: premises.length + 1, buildingId: b.id, area: gridW * gridD, gridW, gridD, rent: 0, footfall: 0,
      doorX, doorZ, competitor: null, competitorName: null,
    };
    b.premise = p;
    premises.push(p);
  }
  for (const p of premises) p.footfall = footfallAt(buildings, p.doorX, p.doorZ, avenue, nx);
  const maxF = Math.max(1, ...premises.map((p) => p.footfall));
  for (const p of premises) {
    // Passants à l'heure de pointe : 180 (rue calme) à 1 100 (meilleur emplacement).
    p.footfall = Math.round(180 + 920 * (p.footfall / maxF));
    const location = 0.6 + 1.2 * ((p.footfall - 180) / 920);
    p.rent = Math.round((p.area * ECONOMY.rentPerM2 * location) / 10) * 10;
  }
  // Concurrents : environ 30 % des locaux, plutôt aux bons emplacements.
  for (const p of premises) {
    if (rng.next() < 0.18 + 0.25 * ((p.footfall - 180) / 920)) {
      const t = rng.pick(SHOP_TYPES).id;
      p.competitor = t;
      p.competitorName = rng.pick(COMPETITOR_NAMES[t]);
    }
  }
  // Services : locaux répartis dans tout le quartier (le plus éloigné des services déjà placés), retirés des locaux.
  const taken: Premise[] = [];
  for (const kind of SERVICE_ORDER) {
    let best: Premise | null = null, bestScore = -Infinity;
    for (const p of premises) {
      if (taken.includes(p)) continue;
      const score = taken.length === 0 ? -Math.hypot(p.doorX, p.doorZ) : Math.min(...taken.map((q) => Math.hypot(q.doorX - p.doorX, q.doorZ - p.doorZ))) - (p.competitor ? 40 : 0);
      if (score > bestScore) { bestScore = score; best = p; }
    }
    if (!best) break;
    taken.push(best);
    const b = buildings.find((x) => x.id === best!.buildingId)!;
    b.service = kind;
    b.premise = null;
  }
  const shopsLeft = premises.filter((p) => !taken.includes(p));
  shopsLeft.forEach((p, k) => { p.id = k + 1; });
  // Logements à louer : immeubles d'habitation répartis, du studio au loft.
  const homes: Home[] = [];
  const homePlan = [HOMES[0]!, HOMES[0]!, HOMES[1]!, HOMES[1]!, HOMES[2]!];
  const housing = buildings.filter((b) => b.kind === 'logement');
  for (const def of homePlan) {
    let best: Building | null = null, bestScore = -Infinity;
    for (const b of housing) {
      if (b.home) continue;
      const score = homes.length === 0 ? -Math.hypot(b.x, b.z) : Math.min(...homes.map((h) => Math.hypot(h.doorX - b.doorX, h.doorZ - b.doorZ))) + rng.next();
      if (score > bestScore) { bestScore = score; best = b; }
    }
    if (!best) break;
    const h: Home = { id: homes.length + 1, buildingId: best.id, def: def.id, doorX: best.doorX, doorZ: best.doorZ };
    best.home = h;
    homes.push(h);
  }
  return { seed, nx, nz, size: { w: nx * PITCH, d: nz * PITCH }, avenue, buildings, premises: shopsLeft, homes, startHome: homes[0]?.id ?? 0, parkBlock: park };
}

/** Bâtiment d'un service (le premier, ou le plus proche de (x, z)). */
export function serviceBuilding(d: District, kind: ServiceKind, x = 0, z = 0): Building | undefined {
  let best: Building | undefined, bd = Infinity;
  for (const b of d.buildings) {
    if (b.service !== kind) continue;
    const dist = Math.hypot(b.doorX - x, b.doorZ - z);
    if (dist < bd) { bd = dist; best = b; }
  }
  return best;
}

/** Normale extérieure de chaque façade. */
export const FACE_N: readonly [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];

/** Potentiel de passage en un point : habitants et employés proches (décroissance exponentielle), avenue centrale. */
export function footfallAt(buildings: readonly Building[], x: number, z: number, avenue: number, nx: number): number {
  let f = 0;
  for (const b of buildings) {
    const dist = Math.hypot(b.x - x, b.z - z);
    if (dist > 450) continue;
    f += (b.residents * 0.6 + b.workers * 1.0) * Math.exp(-dist / 160);
  }
  const avenueX = (avenue - nx / 2) * PITCH;
  if (Math.abs(x - avenueX) < STREET_W) f *= 1.5;
  return f;
}

/**
 * Pression concurrentielle d'un local pour un type de commerce : somme, sur les commerces du même type, d'un poids
 * décroissant avec la distance (1 porte à porte, ≈ 0,3 à 110 m, négligeable au-delà de 300 m).
 */
export function competitorsNear(d: District, p: Premise, type: ShopType, radius = 300, includePlayer?: (q: Premise) => ShopType | null): number {
  let n = 0;
  for (const q of d.premises) {
    if (q.id === p.id) continue;
    const t = q.competitor ?? includePlayer?.(q) ?? null;
    if (t !== type) continue;
    const dist = Math.hypot(q.doorX - p.doorX, q.doorZ - p.doorZ);
    if (dist < radius) n += Math.exp(-dist / 90);
  }
  return Math.round(n * 100) / 100;
}
