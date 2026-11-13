/**
 * Validation des pôles de transport par la simulation (aperçu vert / rouge de l'outil de pose) :
 *  - port : terre-plein sec et peu accidenté, front de quai sur le littoral ou un cours d'eau navigable
 *    (bassin en eau devant le quai, chenal d'approche le long du quai, profondeur en mer) ;
 *  - aéroport : grand terrain sec et plat, servitudes aéronautiques respectées par les bâtiments existants ;
 *  - les deux : dans la carte, sans bâtiment, route ni autre pôle sur l'emprise.
 * Contrôle des bâtiments ordinaires vis-à-vis des servitudes (hauteur dans l'axe des pistes).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { TILE_SIZE, WATER_LEVEL } from '../../shared/constants';
import { footprintObb, obbAabb, obbCorners, obbOverlap, obbToWorld, pointInObb, type Obb } from '../../shared/footprint';
import { BASIN_DEPTH, BERTH_OFFSET, CHANNEL_REACH, QUAY_DEPTH, easementLimit, hubLayout, hubObb } from '../../shared/hubs/layout';
import { HUB_SPECS, type HubRecord, type HubType } from '../../shared/hubs/types';
import type { PluginContext } from '../plugins/types';
import { evalCubic } from '../roads/bezier';

export type PlaceCheck =
  | { ok: true; y: number; waterY: number }
  | { ok: false; code: string; message: string };

/** Dénivelé maximal du terre-plein portuaire et de l'emprise de l'aéroport (m). */
export const PORT_MAX_RELIEF = 8;
export const AIRPORT_MAX_RELIEF = 6;
/** Parts minimales d'échantillons en eau : bassin devant le quai, chenal d'approche. */
export const BASIN_WET_MIN = 0.75;
export const CHANNEL_WET_MIN = 0.75;
/** Part maximale du terre-plein en eau (anses comblées par la dalle portuaire). */
export const LAND_WET_MAX = 0.12;
/** Profondeur médiane minimale du bassin en mer (m). */
export const SEA_MIN_DEPTH = 3;

const fail = (code: string, message: string): PlaceCheck => ({ ok: false, code, message });
const fmt1 = (n: number): string => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 });

/** Échantillonne une zone locale [x0,x1]×[z0,z1] d'un repère orienté (pas `step` m). */
function sampleZone(o: Obb, x0: number, x1: number, z0: number, z1: number, step: number, fn: (wx: number, wz: number) => void): void {
  const nx = Math.max(1, Math.round((x1 - x0) / step)), nz = Math.max(1, Math.round((z1 - z0) / step));
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const [wx, wz] = obbToWorld(o, x0 + ((x1 - x0) * i) / nx, z0 + ((z1 - z0) * j) / nz);
      fn(wx, wz);
    }
  }
}

function insideMap(ctx: PluginContext, o: Obb): boolean {
  const b = ctx.terrain.bounds();
  if (!b) return false;
  const bb = obbAabb(o);
  return bb.minX >= b.minX && bb.minZ >= b.minZ && bb.maxX <= b.maxX && bb.maxZ <= b.maxZ;
}

/** Collisions avec bâtiments, routes et autres pôles. */
function collisions(ctx: PluginContext, o: Obb, hubs: readonly HubRecord[], ignore = -1): string | null {
  const bb = obbAabb(o);
  const ids: number[] = [];
  ctx.buildings.query(bb.minX, bb.minZ, bb.maxX, bb.maxZ, ids);
  const s = ctx.buildings.store;
  for (const id of ids) {
    const i = ctx.buildings.indexOf(id);
    if (i < 0) continue;
    const bo = footprintObb(s.tilesX[i]!, s.tilesZ[i]!, s.x[i]!, s.z[i]!, s.rot[i]!);
    if (obbOverlap(o, bo)) return `Emplacement occupé par un bâtiment (${ctx.buildings.assetOf(id)?.nameFr ?? `n° ${id}`})`;
  }
  const segs: number[] = [];
  ctx.roads.segmentsIn(bb.minX - 8, bb.minZ - 8, bb.maxX + 8, bb.maxZ + 8, segs);
  const p = [0, 0];
  for (const sid of segs) {
    const c = ctx.roads.curve(sid);
    for (let k = 0; k <= 16; k++) {
      evalCubic(c, k / 16, p);
      if (pointInObb(o, p[0]!, p[1]!, 4)) return 'Une route traverse l\'emprise';
    }
  }
  for (const h of hubs) {
    if (h.id === ignore) continue;
    if (obbOverlap(o, hubObb(h.type, h.x, h.z, h.rot))) return `Emplacement occupé par ${HUB_SPECS[h.type].nameFr.toLowerCase()}`;
  }
  return null;
}

function percentile(v: number[], q: number): number {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]!;
}

function checkPort(ctx: PluginContext, type: 'port_commerce' | 'port_passagers', o: Obb): PlaceCheck {
  const l = hubLayout(type);
  // 1. Terre-plein : sec, dans la carte, peu accidenté.
  const land: number[] = [];
  let wetLand = 0;
  sampleZone(o, -l.hx, l.hx, -l.hz, l.hz - QUAY_DEPTH, TILE_SIZE, (x, z) => {
    if (ctx.terrain.isWet(x, z)) wetLand++;
    else land.push(ctx.terrain.heightAt(x, z));
  });
  if (wetLand > LAND_WET_MAX * (wetLand + land.length)) return fail('UNDER_WATER', `Le terre-plein du port doit être sur la terre ferme (${Math.round((100 * wetLand) / (wetLand + land.length))} % en eau > ${Math.round(100 * LAND_WET_MAX)} % ; seul le front de quai borde l'eau)`);
  const lMin = Math.min(...land), lMax = Math.max(...land);
  if (!(lMax - lMin <= PORT_MAX_RELIEF)) return fail('TOO_STEEP', `Terre-plein trop accidenté (dénivelé ${fmt1(lMax - lMin)} m > ${PORT_MAX_RELIEF} m)`);
  // 2. Bassin devant le quai : en eau sur 64 m de profondeur.
  let wet = 0, n = 0;
  const depths: number[] = [];
  const b = ctx.terrain.bounds()!;
  sampleZone(o, -l.hx, l.hx, l.hz + 6, l.hz + BASIN_DEPTH, TILE_SIZE, (x, z) => {
    n++;
    if (x < b.minX || z < b.minZ || x > b.maxX || z > b.maxZ) return;
    if (ctx.terrain.isWet(x, z)) { wet++; depths.push(WATER_LEVEL - ctx.terrain.heightAt(x, z)); }
  });
  if (wet / n < BASIN_WET_MIN) {
    return fail('NOT_COASTAL', `Un port se construit sur le littoral ou un cours d'eau navigable : le front de quai (côté flèche) doit donner sur l'eau (bassin en eau à ${Math.round((100 * wet) / n)} % < ${Math.round(100 * BASIN_WET_MIN)} %)`);
  }
  // 3. Chenal d'approche le long du quai (hors carte = mer ouverte).
  let cw = 0, cn = 0;
  for (const berth of l.berths) {
    sampleZone(o, -l.hx - CHANNEL_REACH, l.hx + CHANNEL_REACH, berth.z, berth.z, TILE_SIZE, (x, z) => {
      cn++;
      if (x < b.minX || z < b.minZ || x > b.maxX || z > b.maxZ || ctx.terrain.isWet(x, z)) cw++;
    });
  }
  if (cw / cn < CHANNEL_WET_MIN) {
    return fail('NOT_NAVIGABLE', `Cours d'eau non navigable ici : chenal d'approche le long du quai en eau à ${Math.round((100 * cw) / cn)} % (< ${Math.round(100 * CHANNEL_WET_MIN)} %)`);
  }
  // 4. Profondeur : en mer (fond sous le niveau de la mer), médiane ≥ 3 m ; en rivière la surface n'est pas
  //    exposée aux modules (docs/requests/hubs.md) : la largeur du chenal fait foi.
  const seaSamples = depths.filter((d) => d > 0);
  const atSea = seaSamples.length >= depths.length * 0.6;
  if (atSea && percentile(depths, 0.5) < SEA_MIN_DEPTH) return fail('NOT_NAVIGABLE', `Eaux trop peu profondes pour les navires (${fmt1(percentile(depths, 0.5))} m < ${SEA_MIN_DEPTH} m)`);
  const waterY = atSea ? WATER_LEVEL : lMin - 1.2;
  // Sol fini = point haut du terre-plein (rien n'est enterré) ; la dalle et le mur de quai descendent sous l'eau (rendu).
  const y = Math.max(lMax, waterY + 2);
  return { ok: true, y, waterY };
}

function checkAirport(ctx: PluginContext, o: Obb, hubs: readonly HubRecord[], probe: Pick<HubRecord, 'type' | 'x' | 'z' | 'rot'>): PlaceCheck {
  const l = hubLayout('aeroport');
  const hs: number[] = [];
  let wetN = 0;
  sampleZone(o, -l.hx, l.hx, -l.hz, l.hz, 16, (x, z) => {
    if (ctx.terrain.isWet(x, z)) wetN++;
    else hs.push(ctx.terrain.heightAt(x, z));
  });
  if (wetN > 0) return fail('UNDER_WATER', 'L\'aéroport exige un terrain entièrement hors d\'eau');
  const mn = Math.min(...hs), mx = Math.max(...hs);
  if (!(mx - mn <= AIRPORT_MAX_RELIEF)) return fail('TOO_STEEP', `L'aéroport exige un grand terrain plat (dénivelé ${fmt1(mx - mn)} m > ${AIRPORT_MAX_RELIEF} m)`);
  // Servitudes : aucun bâtiment existant ne doit dépasser la hauteur autorisée.
  const v = easementViolations(ctx, [...hubs, { ...probe, id: -1, y: 0, waterY: NaN, builtAt: 0 }], -2);
  if (v.length) {
    const w = v[0]!;
    return fail('EASEMENT', `Servitude aéronautique : ${v.length} bâtiment(s) trop haut(s) dans l'axe des pistes (${w.name} : ${fmt1(w.height)} m > ${fmt1(w.limit)} m autorisés)`);
  }
  return { ok: true, y: hs.reduce((s, h) => s + h, 0) / hs.length, waterY: NaN };
}

/** Contrôle complet d'un emplacement de pôle. */
export function checkHubPlacement(ctx: PluginContext, hubs: readonly HubRecord[], type: HubType, x: number, z: number, rot: number): PlaceCheck {
  if (!ctx.inGame) return fail('NO_GAME', 'Aucune partie en cours');
  if (![x, z, rot].every(Number.isFinite)) return fail('INVALID_ARGS', 'Position ou rotation invalide');
  const o = hubObb(type, x, z, rot);
  if (!insideMap(ctx, o)) return fail('OUT_OF_BOUNDS', 'Emplacement hors de la carte');
  const c = collisions(ctx, o, hubs);
  if (c) return fail('COLLISION', c);
  if (type === 'aeroport') {
    if (hubs.some((h) => h.type === 'aeroport')) return fail('LIMIT', 'Un seul aéroport par ville');
    return checkAirport(ctx, o, hubs, { type, x, z, rot });
  }
  return checkPort(ctx, type, o);
}

/** Hauteur minimale autorisée sur l'emprise d'un rectangle (coins, milieux, centre) pour tous les aéroports. */
export function easementLimitOver(hubs: readonly HubRecord[], o: Obb): number {
  let lim = Infinity;
  const pts = obbCorners(o);
  pts.push(o.cx, o.cz);
  for (let k = 0; k < 4; k++) {
    const a = k * 2, b = ((k + 1) % 4) * 2;
    pts.push((pts[a]! + pts[b]!) / 2, (pts[a + 1]! + pts[b + 1]!) / 2);
  }
  for (const h of hubs) {
    if (h.type !== 'aeroport') continue;
    for (let i = 0; i < pts.length; i += 2) lim = Math.min(lim, easementLimit(h, pts[i]!, pts[i + 1]!));
  }
  return lim;
}

/** Hauteur d'un modèle (m) : boîte du catalogue × échelle verticale de la variante. */
export function assetHeight(ctx: PluginContext, assetId: string, variant = -1): number {
  const a = ctx.getAsset(assetId);
  if (!a) return 0;
  const v = variant >= 0 ? a.variants[variant] : undefined;
  return a.dimensions.height * (v?.heightScale ?? 1);
}

/** Contrôle d'un bâtiment ordinaire vis-à-vis des servitudes : null si autorisé, sinon message. */
export function checkBuildingEasement(ctx: PluginContext, hubs: readonly HubRecord[], assetId: string, x: number, z: number, rot: number, heightM?: number): string | null {
  if (!hubs.some((h) => h.type === 'aeroport')) return null;
  const a = ctx.getAsset(assetId);
  if (!a) return null;
  const o = footprintObb(a.footprint.tilesX, a.footprint.tilesZ, x, z, rot);
  const lim = easementLimitOver(hubs, o);
  const h = heightM ?? a.dimensions.height;
  if (h <= lim) return null;
  return `Servitude aéronautique : ${a.nameFr} (${fmt1(h)} m) dépasse la hauteur autorisée dans l'axe des pistes (${fmt1(Math.max(0, lim))} m)`;
}

/** Bâtiments existants qui violent les servitudes des aéroports (`hubs`). */
export function easementViolations(ctx: PluginContext, hubs: readonly HubRecord[], ignore: number): { id: number; name: string; height: number; limit: number }[] {
  const airports = hubs.filter((h) => h.type === 'aeroport' && h.id !== ignore);
  if (!airports.length) return [];
  const out: { id: number; name: string; height: number; limit: number }[] = [];
  const s = ctx.buildings.store;
  for (let i = 0; i < ctx.buildings.count; i++) {
    const id = s.id[i]!;
    const o = footprintObb(s.tilesX[i]!, s.tilesZ[i]!, s.x[i]!, s.z[i]!, s.rot[i]!);
    const lim = easementLimitOver(airports, o);
    if (!Number.isFinite(lim)) continue;
    const a = ctx.buildings.assetOf(id);
    if (!a) continue;
    const v = s.variant[i]! >= 0 ? a.variants[s.variant[i]!] : undefined;
    const h = a.dimensions.height * (v?.heightScale ?? 1);
    if (h > lim) out.push({ id, name: a.nameFr, height: h, limit: Math.max(0, lim) });
  }
  return out.sort((p, q) => (q.height - q.limit) - (p.height - p.limit));
}

/** Point d'amarrage (pour les tests et l'aperçu) : centre du poste `slot` en coordonnées monde. */
export function berthWorld(h: Pick<HubRecord, 'type' | 'x' | 'z' | 'rot'>, slot = 0): [number, number] {
  const l = hubLayout(h.type);
  const b = l.berths[slot] ?? { x: 0, z: l.hz + BERTH_OFFSET };
  return obbToWorld(hubObb(h.type, h.x, h.z, h.rot), b.x, b.z);
}
