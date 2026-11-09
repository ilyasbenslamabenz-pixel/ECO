// Implantation automatique et déterministe des sites énergétiques (le joueur ne place rien) à l'échelle d'une
// cité-État : éolien en mer au large, solaire sur les toitures des quartiers, thermique et stockage en périphérie
// ou dans la zone portuaire, nucléaire sur le littoral (refroidissement à l'eau de mer), hydraulique sur la rivière
// dans les collines, éolien terrestre et géothermie sur les hauteurs périphériques. Les sites sont ajoutés à
// `country.infra` avec un statut (en construction → en service → fermé) que la carte peut afficher.
// Seules dépendances géographiques : `makeHeightFn(country)` (altitude en km, mer sous seaLevel + 0,02 km),
// les dimensions de la carte, les quartiers (`cities`), les rivières et les infrastructures existantes.
import { mulberry32 } from '../noise';
import { makeHeightFn } from './country';
import { TECHS, STORAGE, type BuildId, type TechId } from './energyData';
import type { CountryDef, GameState, Infra, InfraType } from './types';

export const TECH_INFRA: Record<BuildId, InfraType> = {
  charbon: 'centrale_charbon', gaz: 'centrale_gaz', petrole: 'centrale_fioul', nucleaire: 'centrale_nucleaire', solaire: 'parc_solaire',
  eolien: 'parc_eolien', eolienMer: 'parc_eolien_mer', hydraulique: 'barrage', geothermie: 'centrale_geothermique', biomasse: 'centrale_biomasse',
  batteries: 'stockage_batteries',
};
export const INFRA_TECH: Partial<Record<InfraType, BuildId>> = Object.fromEntries(Object.entries(TECH_INFRA).map(([k, v]) => [v, k])) as Partial<Record<InfraType, BuildId>>;

const SITE_NAMES: Record<BuildId, string> = {
  charbon: 'Centrale thermique', gaz: 'Centrale à gaz', petrole: 'Turbines de pointe', nucleaire: 'Centrale nucléaire', solaire: 'Solaire en toiture',
  eolien: 'Éoliennes', eolienMer: 'Parc éolien en mer', hydraulique: 'Centrale hydraulique', geothermie: 'Centrale géothermique', biomasse: 'Centrale biomasse',
  batteries: 'Stockage par batteries',
};

const heightCache = new WeakMap<CountryDef, (x: number, z: number) => number>();
/** Fonction d'altitude du pays (mise en cache par pays). */
export function terrain(C: CountryDef) {
  let h = heightCache.get(C);
  if (!h) { h = makeHeightFn(C); heightCache.set(C, h); }
  return h;
}
export const SEA_MARGIN = 0.02; // km au-dessus du niveau de la mer : en dessous, c'est la mer

/** Surfaces de terre ferme et de mer de la carte (km²), par échantillonnage du relief. */
export function measureLand(C: CountryDef): { land: number; sea: number } {
  const h = terrain(C);
  const nx = 48;
  const nz = 36;
  let landN = 0;
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const x = -C.width / 2 + ((i + 0.5) / nx) * C.width;
    const z = -C.depth / 2 + ((j + 0.5) / nz) * C.depth;
    if (h(x, z) >= C.seaLevel + SEA_MARGIN) landN++;
  }
  const area = C.width * C.depth;
  return { land: (area * landN) / (nx * nz), sea: (area * (nx * nz - landN)) / (nx * nz) };
}

/** Choisit un emplacement valide pour une filière (déterministe : graine du pays et numéro de site). */
export function chooseSite(S: GameState, tech: BuildId, salt: number): { x: number; z: number; cityId: number | null; label: string } {
  const C = S.country;
  const rnd = mulberry32(C.seed * 131 + salt * 7919 + tech.length * 17);
  const h = terrain(C);
  const sea = C.seaLevel + SEA_MARGIN;
  const W = C.width;
  const D = C.depth;
  const cities = C.cities;
  const spacing = Math.max(0.4, Math.min(W, D) * 0.012); // ~0,6 km sur une carte de 64 × 48 km
  const occupied = (x: number, z: number, d = spacing) => C.infra.some((i) => (i.status ?? 'active') !== 'closed' && Math.hypot(i.x - x, i.z - z) < d);
  const outsideQuarters = (x: number, z: number, extra: number) => !cities.some((c) => Math.hypot(c.x - x, c.z - z) < c.radius + extra);
  const nearest = (x: number, z: number) => cities.reduce<typeof cities[number] | undefined>((b, c) => (!b || Math.hypot(c.x - x, c.z - z) < Math.hypot(b.x - x, b.z - z) ? c : b), undefined);
  const inMap = (x: number, z: number) => Math.abs(x) < W / 2 - 0.5 && Math.abs(z) < D / 2 - 0.5;
  const nearSea = (x: number, z: number, r: number) => [0, 1, 2, 3, 4, 5, 6, 7].some((k) => h(x + Math.cos(k * Math.PI / 4) * r, z + Math.sin(k * Math.PI / 4) * r) < sea);
  const randPoint = () => [-W / 2 + rnd() * W, -D / 2 + rnd() * D] as const;
  const riverPoints = C.rivers.flatMap((r) => r.points);
  const ports = C.infra.filter((i) => i.type === 'port' || i.type === 'zone_industrielle');
  for (let attempt = 0; attempt < 600; attempt++) {
    let x: number;
    let z: number;
    let ok = false;
    if (tech === 'eolienMer') {
      [x, z] = randPoint();
      // au large : en mer, à plus de ~3 km de la côte
      ok = inMap(x, z) && h(x, z) < sea - 0.005 && ![0, 1, 2, 3, 4, 5, 6, 7].some((k) => h(x + Math.cos(k * Math.PI / 4) * 3, z + Math.sin(k * Math.PI / 4) * 3) >= sea) && !occupied(x, z, spacing * 3);
    } else if (tech === 'solaire') {
      // toitures d'un quartier
      const c = cities[Math.floor(rnd() * cities.length)];
      if (!c) break;
      const a = rnd() * Math.PI * 2;
      const r = rnd() * c.radius * 0.8;
      x = c.x + Math.cos(a) * r;
      z = c.z + Math.sin(a) * r;
      ok = inMap(x, z) && h(x, z) >= sea && !occupied(x, z, spacing * 0.6);
    } else if (tech === 'hydraulique') {
      const p = riverPoints[Math.floor(rnd() * Math.max(1, riverPoints.length))];
      if (p) { x = p[0] + (rnd() - 0.5) * 0.6; z = p[1] + (rnd() - 0.5) * 0.6; } else [x, z] = randPoint();
      const hh = h(x, z);
      const hills = hh > sea + 0.08; // collines (amont de la rivière)
      ok = inMap(x, z) && (p ? hills : hh > sea + 0.15) && !occupied(x, z) && outsideQuarters(x, z, 0.3);
    } else if (tech === 'nucleaire') {
      [x, z] = randPoint();
      const hh = h(x, z);
      ok = inMap(x, z) && hh >= sea && hh < sea + 0.1 && nearSea(x, z, 1.2) && outsideQuarters(x, z, 1.5) && !occupied(x, z, spacing * 2);
    } else if (tech === 'eolien' || tech === 'geothermie') {
      [x, z] = randPoint();
      const hh = h(x, z);
      ok = inMap(x, z) && hh > sea + (tech === 'eolien' ? 0.15 : 0.05) && outsideQuarters(x, z, tech === 'eolien' ? 0.8 : 0.3) && !occupied(x, z);
    } else {
      // thermique et stockage : zone portuaire ou industrielle, sinon périphérie d'un quartier
      const anchor = ports.length && rnd() < 0.6 ? ports[Math.floor(rnd() * ports.length)] : undefined;
      if (anchor) {
        const a = rnd() * Math.PI * 2;
        const d = 0.4 + rnd() * 1.6;
        x = anchor.x + Math.cos(a) * d;
        z = anchor.z + Math.sin(a) * d;
        ok = inMap(x, z) && h(x, z) >= sea && !occupied(x, z);
      } else {
        const c = cities[Math.floor(rnd() * cities.length)];
        if (!c) break;
        const a = rnd() * Math.PI * 2;
        const d = c.radius + 0.3 + rnd() * 1.2;
        x = c.x + Math.cos(a) * d;
        z = c.z + Math.sin(a) * d;
        const hh = h(x, z);
        ok = inMap(x, z) && hh >= sea && hh < sea + 0.3 && outsideQuarters(x, z, 0.2) && !occupied(x, z);
      }
    }
    if (ok) {
      const nc = nearest(x!, z!);
      return { x: x!, z: z!, cityId: tech === 'solaire' || tech === 'batteries' || tech === 'petrole' || tech === 'gaz' || tech === 'biomasse' || tech === 'charbon' ? nc?.id ?? null : null, label: nc ? nc.name : C.name };
    }
  }
  // repli déterministe : bord ouest de la carte pour l'éolien en mer, sinon en périphérie de la capitale
  if (tech === 'eolienMer') return { x: -W / 2 + 1 + (salt % 5) * 0.8, z: -D / 4 + (salt % 7) * 1.5, cityId: null, label: C.name };
  const cap = cities.find((c) => c.capital) ?? cities[0];
  return { x: (cap?.x ?? 0) + (cap?.radius ?? 1) + 0.5 + (salt % 7) * 0.3, z: (cap?.z ?? 0) + (salt % 5) * 0.3, cityId: cap?.id ?? null, label: cap?.name ?? C.name };
}

/** Ajoute un site énergétique à la carte. */
export function addSite(S: GameState, tech: BuildId, mw: number, status: 'construction' | 'active', serviceMonth: number): Infra {
  const C = S.country;
  const id = C.infra.reduce((m, i) => Math.max(m, i.id), -1) + 1;
  const site = chooseSite(S, tech, id);
  const def = tech === 'batteries' ? null : TECHS[tech as TechId];
  const sameKind = C.infra.filter((i) => i.type === TECH_INFRA[tech]).length;
  const prefix = SITE_NAMES[tech];
  const name = tech === 'eolienMer' ? `${prefix} n°${sameKind + 1}` : `${prefix} — ${site.label}${sameKind ? ` ${sameKind + 1}` : ''}`;
  const infra: Infra = {
    id, type: TECH_INFRA[tech], name, cityId: site.cityId, x: site.x, z: site.z, rot: (id * 2.399) % (Math.PI * 2),
    capacity: Math.round(mw), capacityUnit: 'MW',
    employees: Math.round(mw * (def ? def.jobsOp : STORAGE.jobsOp)),
    maintenance: Math.round(mw * 1000 * (def ? def.fixedOM : STORAGE.fixedOM)),
    energyMWh: def ? -Math.round(mw * def.cf * 8760) : 0,
    emissions: def ? Math.round(mw * def.cf * 8760 * def.co2) : 0,
    level: 1, builtYear: S.startYear + Math.floor(serviceMonth / 12), status, serviceMonth,
  };
  C.infra.push(infra);
  return infra;
}

/** Sites en service d'une filière, du plus ancien au plus récent. */
export function activeSites(S: GameState, tech: BuildId): Infra[] {
  return S.country.infra.filter((i) => i.type === TECH_INFRA[tech] && (i.status ?? 'active') === 'active').sort((a, b) => a.builtYear - b.builtYear || a.id - b.id);
}

/** Retire `mw` de la carte pour une filière : sites entiers fermés (le site désigné puis les plus anciens), le dernier éventuellement réduit. */
export function closeSites(S: GameState, tech: BuildId, mw: number, infraId?: number) {
  let left = mw;
  const list = activeSites(S, tech);
  if (infraId !== undefined) list.sort((a, b) => (a.id === infraId ? -1 : b.id === infraId ? 1 : 0));
  for (const i of list) {
    if (left <= 0.5) break;
    if (i.capacity <= left + 0.5) {
      left -= i.capacity;
      i.status = 'closed';
      i.employees = 0;
      i.energyMWh = 0;
      i.emissions = 0;
    } else {
      const k = (i.capacity - left) / i.capacity;
      i.capacity = Math.round(i.capacity - left);
      i.employees = Math.round(i.employees * k);
      i.energyMWh = Math.round(i.energyMWh * k);
      i.emissions = Math.round(i.emissions * k);
      left = 0;
    }
  }
}
