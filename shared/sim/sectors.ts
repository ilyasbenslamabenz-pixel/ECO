// Outils communs aux moteurs sectoriels (transports, industrie, agriculture, déchets) :
// chantiers (coût, durée, entretien), écritures budgétaires, facteurs technologiques appliqués aux secteurs.
import type { BudgetLine } from './data';
import type { Accounts, GameState, Link, RevenueKey, SectorState } from './types';

export function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

export const popOf = (S: GameState) => S.demography.cohorts.reduce((s, v) => s + v, 0);

// ---------- Chantiers ----------
export interface Project {
  id: number;
  kind: string; // type de chantier propre au module (ex. « tram », « incineration »)
  label: string; // libellé affiché
  size: number; // taille dans l'unité du type (km, unités, tranches…)
  cost: number; // coût total (€ courants à la commande)
  months: number; // durée des travaux (mois)
  elapsed: number; // mois écoulés
  maintenance: number; // entretien annuel une fois en service (€/an, prix de la commande)
  line: BudgetLine; // poste budgétaire imputé
  startMonth: number;
  siteId?: number; // élément géographique associé (placé automatiquement, « en construction » jusqu'à la mise en service)
}

export interface Built {
  kind: string;
  label: string;
  size: number;
  maintenance: number; // €/an (prix de mise en service, indexés ensuite sur le niveau des prix)
  priceLevel: number; // niveau des prix à la mise en service
  line: BudgetLine;
  month: number;
}

/** Crée un chantier : coût et entretien convertis en euros courants. */
export function newProject(S: GameState, seq: { projectSeq: number }, p: Omit<Project, 'id' | 'elapsed' | 'startMonth'>): Project {
  return { ...p, id: seq.projectSeq++, elapsed: 0, startMonth: S.month, cost: p.cost * S.macro.priceLevel, maintenance: p.maintenance * S.macro.priceLevel };
}

/**
 * Avance les chantiers d'un mois : paie la mensualité (coût / durée) sur le poste budgétaire,
 * renvoie les chantiers achevés ce mois-ci (à appliquer par le module).
 */
export function advanceProjects(S: GameState, list: Project[], built: Built[], sites?: Site[]): Project[] {
  const done: Project[] = [];
  for (const p of list) {
    addSpending(S, p.line, (p.cost / p.months) * 12);
    p.elapsed += 1;
    if (p.elapsed >= p.months) done.push(p);
  }
  for (const p of done) {
    list.splice(list.indexOf(p), 1);
    const site = sites?.find((x) => x.id === p.siteId);
    if (site) { site.status = 'service'; site.since = S.month; }
    for (const x of sites ?? []) if (x.projectId === p.id) { x.status = 'service'; x.since = S.month; }
    built.push({ kind: p.kind, label: p.label, size: p.size, maintenance: p.maintenance, priceLevel: S.macro.priceLevel, line: p.line, month: S.month });
  }
  // entretien des équipements en service, indexé sur les prix
  for (const b of built) if (b.maintenance > 0) addSpending(S, b.line, b.maintenance * (S.macro.priceLevel / Math.max(0.01, b.priceLevel)));
  if (built.length > 200) built.splice(0, built.length - 200);
  return done;
}

// ---------- Éléments géographiques (placement automatique et déterministe) ----------
export interface Site {
  id: number;
  kind: string; // type (ex. « tram », « tgv », « tri », « zone »)
  label: string;
  cityId: number | null;
  x: number; // km (position de référence)
  z: number;
  points?: [number, number][]; // tracé pour les lignes (km)
  size: number; // longueur (km) ou capacité dans l'unité du type
  status: 'construction' | 'service';
  since: number; // mois de mise en service (ou de lancement)
  projectId?: number; // chantier dont dépend la mise en service
}

/** Nombre pseudo-aléatoire déterministe dans [0, 1) dérivé d'entiers (placement reproductible). */
export function hash01(...k: number[]) {
  let h = 2166136261;
  for (const v of k) { h ^= Math.floor(v) + 0x9e3779b9; h = Math.imul(h, 16777619); h ^= h >>> 13; }
  return ((h >>> 0) % 100000) / 100000;
}

/** Positions déjà occupées : équipements du pays et éléments des modules sectoriels. */
export function occupied(S: GameState): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = S.country.infra.map((i) => ({ x: i.x, z: i.z }));
  for (const m of [S.transport, S.industry, S.agriculture, S.waste]) for (const s of m?.sites ?? []) if (!s.points) out.push({ x: s.x, z: s.z });
  return out;
}

const MIN_GAP = 0.25; // km entre deux équipements
const MAX_ROAD_DIST = 0.45; // km au plus d'une voie (avenue, voie rapide ou ligne)

/**
 * Emplacement déterministe et valide pour un équipement d'un quartier : le long d'une voie du quartier
 * (décalage latéral de 0,15 à 0,45 km), à au moins 0,25 km des autres équipements, dans les limites de la carte.
 * `kinds` restreint les voies candidates (ex. ['autoroute'] pour une zone logistique).
 */
export function placeSite(S: GameState, cityId: number, salt: number, kinds?: Link['kind'][], extra: { x: number; z: number }[] = []): [number, number] {
  const C = S.country;
  const c = C.cities[cityId];
  const taken = [...occupied(S), ...extra];
  const cand: [number, number, number, number][] = []; // point + direction
  const consider = (links: Link[]) => {
    for (const l of links) {
      if (kinds && !kinds.includes(l.kind)) continue;
      for (let i = 0; i < l.points.length - 1; i++) {
        const p = l.points[i];
        const q = l.points[i + 1];
        if (Math.hypot(p[0] - c.x, p[1] - c.z) <= c.radius * 1.2 || ((l.a === cityId || l.b === cityId) && l.a !== l.b)) cand.push([p[0], p[1], q[0] - p[0], q[1] - p[1]]);
      }
    }
  };
  consider(C.links);
  if (!cand.length && kinds) { kinds = undefined; consider(C.links); }
  const hw = C.width / 2 - 0.2;
  const hd = C.depth / 2 - 0.2;
  const ok = (x: number, z: number) => Math.abs(x) <= hw && Math.abs(z) <= hd && taken.every((t) => Math.hypot(t.x - x, t.z - z) >= MIN_GAP);
  for (let i = 0; i < 60 && cand.length; i++) {
    const k = cand[Math.floor(hash01(C.seed, cityId, salt, i) * cand.length)];
    const len = Math.hypot(k[2], k[3]) || 1;
    const t = hash01(C.seed, salt, i, 3);
    const off = (0.15 + 0.3 * hash01(C.seed, salt, i, 5)) * (hash01(C.seed, salt, i, 9) < 0.5 ? -1 : 1);
    const x = k[0] + k[2] * t - (k[3] / len) * off;
    const z = k[1] + k[3] * t + (k[2] / len) * off;
    if (ok(x, z)) return [x, z];
  }
  // repli : spirale autour du centre du quartier (pas de voie connue)
  for (let i = 0; i < 80; i++) {
    const a = hash01(C.seed, cityId, salt, i, 11) * Math.PI * 2;
    const d = Math.min(c.radius, 0.3 + 0.1 * i);
    const x = c.x + Math.cos(a) * d;
    const z = c.z + Math.sin(a) * d;
    if (ok(x, z)) return [x, z];
  }
  return [c.x, c.z];
}

/**
 * Tracé d'une ligne urbaine de `km` kilomètres desservant un quartier : suit une voie existante qui le traverse
 * (avenues pour le tramway, lignes ferrées puis avenues pour le métro), à partir du point le plus proche de son centre.
 * À défaut de voie, ligne droite traversant le quartier.
 */
export function urbanLine(S: GameState, cityId: number, km: number, salt: number, kinds: Link['kind'][]): [number, number][] {
  const C = S.country;
  const c = C.cities[cityId];
  const near = (l: Link) => l.points.reduce((m, p, i) => { const d = Math.hypot(p[0] - c.x, p[1] - c.z); return d < m.d ? { d, i } : m; }, { d: Infinity, i: 0 });
  for (const kind of kinds) {
    const links = C.links.filter((l) => l.kind === kind && l.points.length > 1 && near(l).d <= c.radius * 1.2);
    if (!links.length) continue;
    const l = links[Math.floor(hash01(C.seed, cityId, salt) * links.length)];
    const { i } = near(l);
    const fwd = l.points.slice(i);
    const bwd = l.points.slice(0, i + 1).reverse();
    const lenOf = (pts: [number, number][]) => pts.reduce((s, p, j) => (j ? s + Math.hypot(p[0] - pts[j - 1][0], p[1] - pts[j - 1][1]) : 0), 0);
    const path = lenOf(fwd) >= lenOf(bwd) ? fwd : bwd;
    const out: [number, number][] = [[path[0][0], path[0][1]]];
    let acc = 0;
    for (let j = 1; j < path.length && acc < km; j++) {
      const seg = Math.hypot(path[j][0] - path[j - 1][0], path[j][1] - path[j - 1][1]);
      if (acc + seg > km && seg > 0) {
        const t = (km - acc) / seg;
        out.push([path[j - 1][0] + (path[j][0] - path[j - 1][0]) * t, path[j - 1][1] + (path[j][1] - path[j - 1][1]) * t]);
        acc = km;
      } else { out.push([path[j][0], path[j][1]]); acc += seg; }
    }
    if (out.length > 1) return out;
  }
  const a = hash01(C.seed, cityId, salt, 7) * Math.PI;
  const half = Math.min(km / 2, c.radius);
  return Array.from({ length: 7 }, (_, j) => { const t = -half + (2 * half * j) / 6; return [c.x + Math.cos(a) * t, c.z + Math.sin(a) * t] as [number, number]; });
}

// ---------- Écritures budgétaires ----------
/** Ajoute une dépense annualisée (€/an) au compte du mois et la paie sur la trésorerie (1/12). */
export function addSpending(S: GameState, line: BudgetLine, annual: number) {
  if (!annual) return;
  const A = S.accounts;
  A.spending[line] = (A.spending[line] ?? 0) + annual;
  A.spendingTotal += annual;
  A.balance -= annual;
  A.primaryBalance -= annual;
  S.finance.cash -= annual / 12;
}

/** Ajoute une recette annualisée (€/an) au compte du mois et l'encaisse (1/12). */
export function addRevenue(S: GameState, key: RevenueKey, annual: number) {
  if (!annual) return;
  const A = S.accounts;
  A.revenue[key] = (A.revenue[key] ?? 0) + annual;
  A.revenueTotal += annual;
  A.balance += annual;
  A.primaryBalance += annual;
  S.finance.cash += annual / 12;
}

/** Corrige les émissions du mois (tCO2e/an) sans casser la cohérence de `accounts.emissions`. */
export function addEmissions(A: Accounts, delta: number, sectorIdx?: number, households = false) {
  A.emissions += delta;
  if (sectorIdx !== undefined) A.emissionsBySector[sectorIdx] = (A.emissionsBySector[sectorIdx] ?? 0) + delta;
  if (households) A.emissionsHouseholds += delta;
}

// ---------- Facteurs technologiques appliqués aux secteurs ----------
// economy.ts fait converger chaque mois l'intensité d'émission vers une cible (prix du carbone) à la vitesse
// ECON_DECARB_RATE. Pour qu'un facteur technologique propre à un module ne soit pas « effacé » par cette convergence,
// on suit l'intensité sous-jacente (sans le facteur) : si l'économie a reçu I = base·f, elle renvoie
// I' = (1−k)·I + k·T ; l'intensité sous-jacente vaut alors base' = (1−k)·base + k·T = I' + (1−k)·base·(1−f).
export const ECON_DECARB_RATE = 0.012;

export interface TechFactor {
  base: number; // intensité d'émission sous-jacente (tCO2/M€), hors facteur du module
  emission: number; // facteur multiplicatif appliqué à l'intensité (1 = neutre)
  productivity: number; // facteur multiplicatif appliqué à la productivité (1 = neutre)
  exports: number; // facteur multiplicatif appliqué aux exportations de référence (1 = neutre)
}

export function newTechFactor(s: SectorState): TechFactor {
  return { base: s.emissionIntensity, emission: 1, productivity: 1, exports: 1 };
}

/** À appeler une fois par mois, juste après economyStep. */
export function applyTechFactor(s: SectorState, t: TechFactor, emission: number, productivity: number, exports = t.exports) {
  const base = s.emissionIntensity + (1 - ECON_DECARB_RATE) * t.base * (1 - t.emission);
  t.base = base;
  t.emission = clamp(emission, 0.02, 3);
  s.emissionIntensity = base * t.emission;
  const pf = clamp(productivity, 0.3, 3);
  s.productivity *= pf / t.productivity;
  t.productivity = pf;
  const xf = clamp(exports, 0.3, 3);
  s.baseExport *= xf / t.exports;
  t.exports = xf;
}

/** Ajustement exponentiel d'une grandeur vers sa cible. */
export const approach = (v: number, target: number, rate: number) => v + (target - v) * rate;
