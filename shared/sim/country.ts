// Génération déterministe de la cité-État : une mégapole littorale de 64 × 48 km avec ses quartiers,
// sa rivière, ses collines, ses périphériques, ses avenues, son métro et tous ses équipements.
// Les entrées de `cities` sont des quartiers : 'metropole' = grand quartier, 'ville' = arrondissement,
// 'commune' = quartier périphérique.
import { fbm, mulberry32, noise2, smoothstep } from '../noise';
import { SECTORS, SECTOR_INDEX, type SectorId } from './data';
import type { CityDef, CityKind, CountryConfig, CountryDef, Infra, InfraType, LakeDef, Link, RiverDef } from './types';

export const MAP_W = 64; // km
export const MAP_D = 48; // km
export const HALF_W = MAP_W / 2;
export const HALF_D = MAP_D / 2;

/** Abscisse du trait de côte (mer à l'ouest) pour une ordonnée z. */
export function coastX(seed: number, z: number) {
  return -HALF_W + 6.5 + noise2(z * 0.07 + seed * 0.01, 3.3) * 2.6 + noise2(z * 0.3, seed * 0.02) * 0.6;
}

function hillMask(seed: number, x: number, z: number) {
  const n = noise2(x * 0.05 + 11, z * 0.05 + seed * 0.001) * 5;
  return smoothstep(10, 30, x * 0.85 - z * 0.35 + n);
}

/** Relief de base (km), sans rivière ni lac : plaine littorale, collines à l'est. */
export function baseHeight(seed: number, x: number, z: number): number {
  const s = seed * 0.0007;
  let h = 0.035 + fbm(x * 0.05 + s, z * 0.05 - s, 4) * 0.03 + fbm(x * 0.2, z * 0.2 + s, 3) * 0.006;
  const m = hillMask(seed, x, z);
  if (m > 0) {
    const ridge = 1 - Math.abs(noise2(x * 0.12 + s, z * 0.12));
    h += m * (ridge * ridge * 0.28 + fbm(x * 0.09, z * 0.09, 3) * 0.08);
  }
  const cx = coastX(seed, z);
  const t = smoothstep(cx - 0.3, cx + 2.2, x);
  h = h * t + (1 - t) * (-0.03 - Math.max(0, cx - x) * 0.004);
  return h;
}

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx - px;
  const qz = az + t * dz - pz;
  return Math.sqrt(qx * qx + qz * qz);
}

export function distToRiver(r: RiverDef, x: number, z: number) {
  let d = Infinity;
  for (let i = 0; i < r.points.length - 1; i++) {
    const a = r.points[i];
    const b = r.points[i + 1];
    if (Math.abs(x - a[0]) > 2 && Math.abs(x - b[0]) > 2) continue;
    d = Math.min(d, distToSegment(x, z, a[0], a[1], b[0], b[1]));
  }
  return d;
}

/** Fonction de hauteur complète (avec rivières et lacs). */
export function makeHeightFn(country: Pick<CountryDef, 'seed' | 'rivers' | 'lakes'>) {
  const { seed, rivers, lakes } = country;
  return (x: number, z: number): number => {
    let h = baseHeight(seed, x, z);
    for (const r of rivers) {
      const d = distToRiver(r, x, z);
      if (d < r.width * 3) {
        const k = 1 - smoothstep(r.width * 0.5, r.width * 3, d);
        h = h * (1 - k) + (0.012 + Math.max(0, h - 0.04) * 0.2) * k;
      }
    }
    for (const l of lakes) {
      const d = Math.hypot(x - l.x, z - l.z);
      if (d < l.r * 1.5) {
        const k = 1 - smoothstep(l.r * 0.8, l.r * 1.5, d);
        h = h * (1 - k) + (l.level - 0.01) * k;
      }
    }
    return h;
  };
}

/** Densité urbaine 0..1 (tissu continu autour du centre + noyaux des quartiers). */
export function urbanDensity(country: Pick<CountryDef, 'cities'>, x: number, z: number): number {
  const center = country.cities.find((c) => c.capital) ?? country.cities[0];
  let d = center ? 0.95 * (1 - smoothstep(8, 23, Math.hypot((x - center.x) / 1.25, z - center.z))) : 0;
  for (const c of country.cities) {
    const k = 1 - smoothstep(c.radius * 0.4, c.radius * 1.5, Math.hypot(x - c.x, z - c.z));
    const w = c.kind === 'metropole' ? 1 : c.kind === 'ville' ? 0.9 : 0.75;
    if (k * w > d) d = k * w;
  }
  return d;
}

/** Parcs et espaces verts urbains (0..1). */
export function parkMask(seed: number, x: number, z: number) {
  return smoothstep(0.6, 0.68, fbm(x * 0.35 + seed * 0.01, z * 0.35 - 7, 3));
}

// ---------- Noms ----------
const PREFIX = ['Val', 'Mont', 'Beau', 'Clair', 'Roche', 'Haut', 'Bel', 'Pré', 'Fontaine', 'Mir', 'Aur', 'Lor', 'Bris', 'Cor', 'Sel', 'Ver', 'Tal', 'Mar', 'Gran', 'Lune', 'Or', 'Riv'];
const SUFFIX = ['ande', 'elle', 'ville', 'mont', 'bourg', 'court', 'lac', 'gard', 'ac', 'ieu', 'ence', 'ois', 'ar', 'erre', 'ine', 'eau', 'ian', 'oval', 'enne', 'issac', 'ole', 'ades', 'ignan', 'aurel'];

function makeNames(seed: number, n: number): string[] {
  const rnd = mulberry32(seed * 7 + 3);
  const word = () => {
    const p = PREFIX[Math.floor(rnd() * PREFIX.length)];
    let s = SUFFIX[Math.floor(rnd() * SUFFIX.length)];
    if (/[aeiouy]$/i.test(p) && /^[aeiouy]/i.test(s)) s = s.slice(1);
    return p + s;
  };
  const set = new Set<string>();
  let guard = 0;
  while (set.size < n && guard++ < 5000) {
    const r = rnd();
    set.add(r < 0.12 ? `Saint-${word()}` : r < 0.2 ? `Les Hauts-de-${word()}` : r < 0.26 ? `${word()}-les-Bains` : word());
  }
  return [...set];
}

export const DEFAULT_CONFIG: CountryConfig = { name: "République d'Ilyas", seed: 2030, metropoles: 5, villes: 12, communes: 30, population: 9_600_000 };

function sectorWeights(kind: CityKind, port: boolean, industrial: boolean, capital: boolean, rnd: () => number): number[] {
  const w = SECTORS.map((s) => s.employmentShare);
  const mul = (id: SectorId, k: number) => { w[SECTOR_INDEX[id]] *= k; };
  if (capital) { mul('finance', 3); mul('technologie', 2.2); mul('services', 1.4); mul('tourisme', 1.5); mul('industrie', 0.3); mul('agriculture', 0.02); }
  if (kind === 'metropole' && !capital) { mul('technologie', 1.6); mul('services', 1.2); mul('sante', 1.3); mul('education', 1.4); mul('agriculture', 0.05); }
  if (kind === 'ville') { mul('commerce', 1.2); mul('agriculture', 0.2); mul('construction', 1.2); }
  if (kind === 'commune') { mul('agriculture', 4); mul('construction', 1.4); mul('finance', 0.3); mul('technologie', 0.4); mul('commerce', 1.1); }
  if (industrial) { mul('industrie', 2.6); mul('energie', 2); mul('transport', 1.5); }
  if (port) { mul('transport', 3); mul('industrie', 1.6); mul('tourisme', 1.3); }
  return w.map((v) => v * (0.85 + rnd() * 0.3));
}

export function generateCountry(cfg: CountryConfig): CountryDef {
  const seed = cfg.seed;
  const rnd = mulberry32(seed);
  const country: CountryDef = { name: cfg.name, seed, width: MAP_W, depth: MAP_D, seaLevel: 0, cities: [], links: [], rivers: [], lakes: [], infra: [] };

  // Rivière principale : des collines de l'est vers la mer en traversant la ville, et un affluent
  const riverFrom = (x0: number, z0: number, zDrift: number, width: number): RiverDef => {
    const pts: [number, number][] = [];
    let x = x0;
    let z = z0;
    for (let i = 0; i < 300; i++) {
      pts.push([x, z]);
      if (x < coastX(seed, z) - 1.2) break;
      x -= 0.35;
      z += noise2(i * 0.08, seed * 0.01 + zDrift) * 0.45 + (zDrift - z) * 0.01;
      z = Math.max(-HALF_D + 1, Math.min(HALF_D - 1, z));
    }
    return { points: pts, width };
  };
  country.rivers.push(riverFrom(HALF_W - 1, -6 + rnd() * 4, 1.5, 0.16));
  country.rivers.push(riverFrom(HALF_W - 3, 14 + rnd() * 4, 6, 0.09));
  // Lacs : réservoir dans les collines et lac urbain
  country.lakes.push({ x: 22 + rnd() * 4, z: -14 + rnd() * 4, r: 1.1, level: 0 });
  country.lakes.push({ x: -3 + rnd() * 4, z: 7 + rnd() * 3, r: 0.6, level: 0 });
  for (const l of country.lakes) l.level = baseHeight(seed, l.x, l.z) - 0.005;
  const height = makeHeightFn(country);
  const land = (x: number, z: number, margin = 0.4) =>
    x > coastX(seed, z) + margin && height(x, z) > 0.03 &&
    !country.lakes.some((l) => Math.hypot(l.x - x, l.z - z) < l.r + 0.4) &&
    !country.rivers.some((r) => distToRiver(r, x, z) < r.width * 2);

  // Quartiers
  const names = makeNames(seed, cfg.metropoles + cfg.villes + cfg.communes + 10);
  let nameIdx = 0;
  let ccx = 1.5 + rnd() * 2;
  let ccz = 1 + rnd() * 2;
  for (let t = 0; t < 50 && !land(ccx, ccz, 1); t++) { ccx += 0.7; ccz += (rnd() - 0.5) * 2; }
  const addCity = (kind: CityKind, x: number, z: number, capital = false) => {
    const id = country.cities.length;
    const coastal = x - coastX(seed, z) < 3;
    const port = kind === 'metropole' && coastal;
    const industrial = (kind === 'ville' && rnd() < 0.3) || port;
    const name = capital ? 'Ilyas-Centre' : port ? `Port-${names[nameIdx++]}` : names[nameIdx++] ?? `Quartier ${id}`;
    country.cities.push({
      id, name, kind, x, z,
      radius: kind === 'metropole' ? (capital ? 3.6 : 2.8 + rnd() * 0.6) : kind === 'ville' ? 2.1 + rnd() * 0.5 : 1.3 + rnd() * 0.4,
      coastal, capital, sectorWeights: sectorWeights(kind, port, industrial, capital, rnd),
    });
  };
  addCity(cfg.metropoles > 0 ? 'metropole' : 'ville', ccx, ccz, true);
  const ring = (kind: CityKind, count: number, rMin: number, rMax: number, minDist: number) => {
    let placed = 0;
    let tries = 0;
    while (placed < count && tries++ < 8000) {
      const relax = tries > 4000 ? 0.75 : 1;
      const a = rnd() * Math.PI * 2;
      const r = rMin * relax + rnd() * (rMax - rMin * relax);
      const x = ccx + Math.cos(a) * r * 1.25;
      const z = ccz + Math.sin(a) * r;
      if (Math.abs(x) > HALF_W - 1.5 || Math.abs(z) > HALF_D - 1.5) continue;
      if (!land(x, z, kind === 'metropole' ? 0.8 : 0.5)) continue;
      if (hillMask(seed, x, z) > (kind === 'commune' ? 0.9 : 0.5)) continue;
      if (country.cities.some((c) => Math.hypot(c.x - x, c.z - z) < Math.max(minDist, c.radius + 1.2) * relax)) continue;
      addCity(kind, x, z);
      placed++;
    }
  };
  // le premier grand quartier secondaire est le quartier portuaire, sur le littoral
  if (cfg.metropoles > 1) {
    for (let t = 0; t < 300; t++) {
      const z = ccz - 5 + rnd() * 10;
      const x = coastX(seed, z) + 2.4;
      if (land(x, z, 0.5) && country.cities.every((c) => Math.hypot(c.x - x, c.z - z) > c.radius + 2.8)) { addCity('metropole', x, z); break; }
    }
  }
  ring('metropole', Math.max(0, cfg.metropoles - country.cities.length), 6, 11, 6);
  ring('ville', cfg.villes, 7, 16, 4.2);
  ring('commune', cfg.communes, 13, 25, 2.9);

  // Réseau urbain
  const cap = country.cities.find((c) => c.capital) ?? country.cities[0];
  const pieces = (pts: [number, number][]) => {
    const out: [number, number][][] = [];
    let cur: [number, number][] = [];
    for (const p of pts) {
      const ok = Math.abs(p[0]) < HALF_W - 0.3 && Math.abs(p[1]) < HALF_D - 0.3 && p[0] > coastX(seed, p[1]) + 0.3 && !country.lakes.some((l) => Math.hypot(l.x - p[0], l.z - p[1]) < l.r + 0.2);
      if (ok) cur.push(p);
      else { if (cur.length > 3) out.push(cur); cur = []; }
    }
    if (cur.length > 3) out.push(cur);
    return out;
  };
  const ringRoad = (r: number) => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 200; i++) {
      const a = (i / 200) * Math.PI * 2;
      const wob = 1 + noise2(Math.cos(a) * 2 + r, Math.sin(a) * 2) * 0.06;
      pts.push([cap.x + Math.cos(a) * r * 1.25 * wob, cap.z + Math.sin(a) * r * wob]);
    }
    for (const p of pieces(pts)) country.links.push({ a: cap.id, b: cap.id, kind: 'autoroute', points: p });
  };
  ringRoad(5.5);
  ringRoad(12);
  ringRoad(20);
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + 0.3;
    const pts: [number, number][] = [];
    for (let d = 3.5; d < 40; d += 0.5) pts.push([cap.x + Math.cos(a) * d * 1.25 + noise2(d * 0.1, k) * 0.6, cap.z + Math.sin(a) * d + noise2(k, d * 0.1) * 0.6]);
    for (const p of pieces(pts)) country.links.push({ a: cap.id, b: cap.id, kind: 'autoroute', points: p });
  }
  const linkPoints = (a: CityDef, b: CityDef, wobble: number): [number, number][] => {
    const d = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const n = Math.max(2, Math.ceil(d / 0.4));
    const nx = -(b.z - a.z) / d;
    const nz = (b.x - a.x) / d;
    const pts: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const off = Math.sin(t * Math.PI) * wobble * d * 0.06;
      pts.push([a.x + (b.x - a.x) * t + nx * off, a.z + (b.z - a.z) * t + nz * off]);
    }
    return pts;
  };
  const byDist = (c: CityDef, list: CityDef[]) => list.filter((q) => q.id !== c.id).sort((p, q) => Math.hypot(p.x - c.x, p.z - c.z) - Math.hypot(q.x - c.x, q.z - c.z));
  const metros = country.cities.filter((c) => c.kind === 'metropole');
  const villes = country.cities.filter((c) => c.kind === 'ville');
  const communes = country.cities.filter((c) => c.kind === 'commune');
  // grandes avenues radiales : seulement vers les pôles majeurs (les autres quartiers se raccordent à leurs voisins),
  // pour éviter une « étoile » d'une vingtaine d'avenues convergeant sur la place centrale
  for (const c of metros) {
    if (c.capital) continue;
    for (const p of pieces(linkPoints(cap, c, 0.4))) country.links.push({ a: cap.id, b: c.id, kind: 'nationale', points: p });
  }
  for (const c of [...villes, ...communes]) {
    for (const t of byDist(c, [...metros, ...villes]).slice(0, 2)) {
      if (country.links.some((l) => (l.a === t.id && l.b === c.id) || (l.a === c.id && l.b === t.id))) continue;
      for (const p of pieces(linkPoints(t, c, 0.6))) country.links.push({ a: t.id, b: c.id, kind: 'nationale', points: p });
    }
  }
  // Métro / RER : lignes traversant le centre d'un quartier à l'autre
  const hubs = [...metros, ...villes].filter((c) => !c.capital).sort((p, q) => Math.atan2(p.z - cap.z, p.x - cap.x) - Math.atan2(q.z - cap.z, q.x - cap.x));
  const nLines = Math.min(5, Math.floor(hubs.length / 2));
  for (let k = 0; k < nLines; k++) {
    const a = hubs[k];
    const b = hubs[(k + Math.floor(hubs.length / 2)) % hubs.length];
    const pts = [...linkPoints(a, cap, 0.2), ...linkPoints(cap, b, 0.2).slice(1)];
    for (const p of pieces(pts)) country.links.push({ a: a.id, b: b.id, kind: 'rail', points: p });
  }
  for (const c of communes.filter((_, i) => i % 3 === 0)) {
    const t = byDist(c, villes)[0];
    if (t) for (const p of pieces(linkPoints(t, c, 0.3))) country.links.push({ a: t.id, b: c.id, kind: 'rail', points: p });
  }

  // Équipements (échelle urbaine)
  let infraId = 0;
  const add = (type: InfraType, name: string, cityId: number | null, x: number, z: number, o: Partial<Infra>) => {
    country.infra.push({ id: infraId++, type, name, cityId, x, z, rot: rnd() * Math.PI * 2, capacity: 0, capacityUnit: '', employees: 0, maintenance: 0, energyMWh: 0, emissions: 0, level: 1, builtYear: 1960 + Math.floor(rnd() * 60), ...o });
  };
  const near = (c: CityDef, kMin: number, kMax: number): [number, number] => {
    for (let t = 0; t < 40; t++) {
      const a = rnd() * Math.PI * 2;
      const d = c.radius * (kMin + rnd() * (kMax - kMin));
      const x = c.x + Math.cos(a) * d;
      const z = c.z + Math.sin(a) * d;
      if (land(x, z, 0.3) && !country.infra.some((i) => Math.hypot(i.x - x, i.z - z) < 0.35)) return [x, z];
    }
    return [c.x + (rnd() - 0.5) * c.radius * 0.5, c.z + (rnd() - 0.5) * c.radius * 0.5];
  };
  const site = (test: (x: number, z: number) => boolean, gen: () => [number, number]): [number, number] => {
    for (let t = 0; t < 400; t++) { const p = gen(); if (test(p[0], p[1])) return p; }
    return gen();
  };
  const farFromCities = (x: number, z: number, d: number) => country.cities.every((c) => Math.hypot(c.x - x, c.z - z) > c.radius + d);
  const port = metros.find((c) => c.coastal && !c.capital) ?? metros[1] ?? cap;
  for (const c of metros) {
    const nH = c.capital ? 4 : 2;
    for (let h = 0; h < nH; h++) { const [x, z] = near(c, 0.2, 0.8); add('hopital', `${h === 0 ? 'CHU' : 'Hôpital'} de ${c.name}${h > 1 ? ' ' + h : ''}`, c.id, x, z, { capacity: 1100 - h * 200, capacityUnit: 'lits', employees: 5000 - h * 900, maintenance: 5e8 - h * 9e7, energyMWh: 35000, emissions: 5000 }); }
    { const [x, z] = near(c, 0.3, 0.9); add('universite', `Université de ${c.name}`, c.id, x, z, { capacity: c.capital ? 60000 : 35000, capacityUnit: 'étudiants', employees: c.capital ? 6000 : 3500, maintenance: 3e8, energyMWh: 25000, emissions: 3000 }); }
    { const [x, z] = near(c, 0, 0.3); add('gare', `Gare centrale de ${c.name}`, c.id, x, z, { capacity: c.capital ? 400000 : 120000, capacityUnit: 'voyageurs/jour', employees: 900, maintenance: 4e7, energyMWh: 12000, emissions: 500 }); }
    { const [x, z] = near(c, 0.4, 0.9); add('zone_commerciale', `Centre commercial de ${c.name}`, c.id, x, z, { capacity: 220, capacityUnit: 'commerces', employees: 4000, maintenance: 2e6, energyMWh: 45000, emissions: 5000 }); }
    { const [x, z] = near(c, 0.5, 1); add('stade', `Stade de ${c.name}`, c.id, x, z, { capacity: c.capital ? 80000 : 40000, capacityUnit: 'places', employees: 200, maintenance: 9e6, energyMWh: 3500, emissions: 300 }); }
    { const [x, z] = near(c, 0.1, 0.5); add('commissariat', `Hôtel de police de ${c.name}`, c.id, x, z, { capacity: 1500, capacityUnit: 'agents', employees: 1500, maintenance: 9e7, energyMWh: 3000, emissions: 300 }); }
    { const [x, z] = near(c, 0.2, 0.7); add('caserne', `Centre de secours de ${c.name}`, c.id, x, z, { capacity: 320, capacityUnit: 'pompiers', employees: 320, maintenance: 3e7, energyMWh: 1000, emissions: 150 }); }
    for (let k = 0; k < 5; k++) { const [x, z] = near(c, 0.15, 1); add('ecole', `Groupe scolaire de ${c.name}${k ? ' ' + (k + 1) : ''}`, c.id, x, z, { capacity: 1800, capacityUnit: 'élèves', employees: 140, maintenance: 1.2e7, energyMWh: 1600, emissions: 200 }); }
  }
  for (const c of villes) {
    { const [x, z] = near(c, 0.2, 0.7); add('hopital', `Hôpital de ${c.name}`, c.id, x, z, { capacity: 450, capacityUnit: 'lits', employees: 1800, maintenance: 1.8e8, energyMWh: 14000, emissions: 2000 }); }
    { const [x, z] = near(c, 0.1, 0.5); add('commissariat', `Commissariat de ${c.name}`, c.id, x, z, { capacity: 260, capacityUnit: 'agents', employees: 260, maintenance: 1.6e7, energyMWh: 700, emissions: 90 }); }
    { const [x, z] = near(c, 0.2, 0.7); add('caserne', `Caserne de ${c.name}`, c.id, x, z, { capacity: 90, capacityUnit: 'pompiers', employees: 90, maintenance: 8e6, energyMWh: 500, emissions: 80 }); }
    for (let k = 0; k < 3; k++) { const [x, z] = near(c, 0.15, 1); add('ecole', `${k ? 'Collège' : 'Lycée'} de ${c.name}${k > 1 ? ' ' + k : ''}`, c.id, x, z, { capacity: 1100, capacityUnit: 'élèves', employees: 85, maintenance: 7e6, energyMWh: 1200, emissions: 150 }); }
    if (country.links.some((l) => l.kind === 'rail' && (l.a === c.id || l.b === c.id))) { const [x, z] = near(c, 0, 0.3); add('gare', `Gare de ${c.name}`, c.id, x, z, { capacity: 30000, capacityUnit: 'voyageurs/jour', employees: 120, maintenance: 7e6, energyMWh: 1600, emissions: 80 }); }
    { const [x, z] = near(c, 0.3, 0.9); add('zone_commerciale', `Galerie marchande de ${c.name}`, c.id, x, z, { capacity: 90, capacityUnit: 'commerces', employees: 1200, maintenance: 1e6, energyMWh: 12000, emissions: 1500 }); }
  }
  for (const c of communes) {
    { const [x, z] = near(c, 0.1, 0.6); add('ecole', `École de ${c.name}`, c.id, x, z, { capacity: 450, capacityUnit: 'élèves', employees: 32, maintenance: 2.8e6, energyMWh: 400, emissions: 50 }); }
    if (Math.hypot(c.x - cap.x, c.z - cap.z) > 17) for (let k = 0; k < 2; k++) { const [x, z] = near(c, 1.2, 2.2); add('ferme', `Exploitation maraîchère de ${c.name}${k ? ' ' + (k + 1) : ''}`, c.id, x, z, { capacity: 120, capacityUnit: 'ha', employees: 8, maintenance: 0, energyMWh: 200, emissions: 500 }); }
  }
  // Zones industrielles et usines : port + arrondissements industriels
  const industrialHubs = [port, ...villes.filter((v) => v.sectorWeights[SECTOR_INDEX.industrie] > SECTORS[SECTOR_INDEX.industrie].employmentShare * 2)];
  for (const c of industrialHubs) {
    const [x, z] = near(c, 0.7, 1.3);
    add('zone_industrielle', `Zone industrielle de ${c.name}`, c.id, x, z, { capacity: 140, capacityUnit: 'entreprises', employees: 11000, maintenance: 6e6, energyMWh: 500000, emissions: 180000 });
    for (let k = 0; k < 4; k++) {
      const a = rnd() * Math.PI * 2;
      add('usine', `Usine ${['métallurgique', 'chimique', 'agroalimentaire', 'automobile', 'électronique', 'pharmaceutique'][Math.floor(rnd() * 6)]} de ${c.name}`, c.id, x + Math.cos(a) * 0.6, z + Math.sin(a) * 0.6, { capacity: 800 + Math.floor(rnd() * 1600), capacityUnit: 'salariés', employees: 800 + Math.floor(rnd() * 1600), maintenance: 0, energyMWh: 140000, emissions: 70000 });
    }
  }
  // Port et aéroport
  { const z = port.z + 0.8; add('port', `Grand port de ${port.name}`, port.id, coastX(seed, z) - 0.25, z, { capacity: 90e6, capacityUnit: 't/an', employees: 12000, maintenance: 2e8, energyMWh: 120000, emissions: 90000, rot: 0 }); }
  {
    const [x, z] = site((x, z) => land(x, z, 1) && farFromCities(x, z, 1.5) && hillMask(seed, x, z) < 0.3, () => { const a = rnd() * Math.PI * 2; const r = 14 + rnd() * 9; return [cap.x + Math.cos(a) * r * 1.2, cap.z + Math.sin(a) * r]; });
    add('aeroport', "Aéroport international d'Ilyas", null, x, z, { capacity: 45e6, capacityUnit: 'passagers/an', employees: 25000, maintenance: 3e8, energyMWh: 150000, emissions: 60000, rot: rnd() * Math.PI });
  }
  // Production d'électricité
  const ind = country.infra.find((i) => i.type === 'zone_industrielle');
  { const [x, z] = site((x, z) => land(x, z) && farFromCities(x, z, 0.3), () => [(ind?.x ?? port.x) + (rnd() - 0.5) * 3, (ind?.z ?? port.z) + (rnd() - 0.5) * 3]); add('centrale_charbon', 'Centrale thermique du port', null, x, z, { capacity: 1200, capacityUnit: 'MW', employees: 450, maintenance: 6e7, energyMWh: -6.6e6, emissions: 6.3e6 }); }
  for (let i = 0; i < 2; i++) { const [x, z] = site((x, z) => land(x, z) && farFromCities(x, z, 0.5), () => { const a = rnd() * Math.PI * 2; const r = 15 + rnd() * 8; return [cap.x + Math.cos(a) * r * 1.2, cap.z + Math.sin(a) * r]; }); add('centrale_gaz', `Centrale à cycle combiné n°${i + 1}`, null, x, z, { capacity: 900, capacityUnit: 'MW', employees: 130, maintenance: 3e7, energyMWh: -3.9e6, emissions: 1.45e6 }); }
  { const z0 = (rnd() < 0.5 ? -1 : 1) * (HALF_D - 4); const [x, z] = site((x, z) => land(x, z, 0.6) && farFromCities(x, z, 1.5), () => [coastX(seed, z0) + 1 + rnd() * 2, z0 + (rnd() - 0.5) * 4]); add('centrale_nucleaire', 'Centrale nucléaire du Littoral', null, x, z, { capacity: 3600, capacityUnit: 'MW', employees: 1800, maintenance: 4e8, energyMWh: -2.6e7, emissions: 0 }); }
  { const l = country.lakes[0]; add('barrage', 'Barrage des Collines', null, l.x - l.r - 0.15, l.z, { capacity: 250, capacityUnit: 'MW', employees: 40, maintenance: 8e6, energyMWh: -7e5, emissions: 0, rot: Math.PI / 2 }); }
  for (let i = 0; i < 3; i++) { const z = -HALF_D + 8 + i * ((MAP_D - 16) / 2); add('parc_eolien_mer', `Parc éolien en mer n°${i + 1}`, null, coastX(seed, z) - 3.5, z, { capacity: 500, capacityUnit: 'MW', employees: 40, maintenance: 2e7, energyMWh: -1.8e6, emissions: 0 }); }
  for (let i = 0; i < 2; i++) { const [x, z] = site((x, z) => land(x, z) && hillMask(seed, x, z) > 0.5 && farFromCities(x, z, 0.5), () => [15 + rnd() * 15, -HALF_D + 3 + rnd() * (MAP_D - 6)]); add('parc_eolien', `Parc éolien des collines n°${i + 1}`, null, x, z, { capacity: 120, capacityUnit: 'MW', employees: 12, maintenance: 5e6, energyMWh: -2.6e5, emissions: 0 }); }
  for (let i = 0; i < 4; i++) { const [x, z] = site((x, z) => land(x, z) && farFromCities(x, z, 0.4) && urbanDensity(country, x, z) < 0.3, () => [-10 + rnd() * 36, -HALF_D + 2 + rnd() * (MAP_D - 4)]); add('parc_solaire', `Centrale solaire n°${i + 1}`, null, x, z, { capacity: 90, capacityUnit: 'MW', employees: 8, maintenance: 1.5e6, energyMWh: -1.25e5, emissions: 0 }); }
  return country;
}

/** Répartition initiale de la population entre les quartiers (somme = 1). */
export function initialPopShares(country: CountryDef): number[] {
  const metros = country.cities.filter((c) => c.kind === 'metropole');
  const villes = country.cities.filter((c) => c.kind === 'ville');
  const communes = country.cities.filter((c) => c.kind === 'commune');
  const rnd = mulberry32(country.seed + 99);
  const shares = new Array(country.cities.length).fill(0);
  const metroW = metros.map((c) => (c.capital ? 1.5 : 1) * (0.8 + rnd() * 0.4));
  const mw = metroW.reduce((s, v) => s + v, 0) || 1;
  metros.forEach((c, i) => (shares[c.id] = (0.36 * metroW[i]) / mw));
  const vw = villes.map(() => 0.7 + rnd() * 0.8);
  const vs = vw.reduce((s, v) => s + v, 0) || 1;
  villes.forEach((c, i) => (shares[c.id] = (0.38 * vw[i]) / vs));
  const cw = communes.map(() => 0.6 + rnd() * 0.8);
  const cs = cw.reduce((s, v) => s + v, 0) || 1;
  communes.forEach((c, i) => (shares[c.id] = (0.26 * cw[i]) / cs));
  const tot = shares.reduce((s, v) => s + v, 0) || 1;
  return shares.map((v) => v / tot);
}

export type { RiverDef, LakeDef, Link };
