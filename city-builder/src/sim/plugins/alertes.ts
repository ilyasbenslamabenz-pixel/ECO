/**
 * Module « alertes » : chaque heure de jeu, relève les problèmes visibles de chaque bâtiment (pas d'accès routier,
 * coupure d'électricité, pas d'eau, bacs pleins, installation de déchets sur une route isolée) d'après les services publiés par les autres modules. Lecture seule :
 * aucun effet sur la simulation, rien n'est sauvegardé (recalculé au chargement).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { isBuildingCategory, type CatalogAsset } from '../../shared/catalog';
import type { ElectriciteService } from '../../shared/power/types';
import { ALERT_BITS, ALERT_KINDS, type AlertesPayload, type AlertKind } from '../../shared/protocol-ext/alertes';
import { facilityKindOfTags } from '../../shared/waste/types';
import { ROAD_KINDS } from '../roads/types';
import { ATTACH_RADIUS } from '../waste/graph';
import type { PluginContext, SimPlugin } from './types';

interface EauLike { growthAllowed(id: number): boolean }
interface DechetsLike { binFull(id: number): boolean }

const emptyCounts = (): Record<AlertKind, number> => ({ road: 0, power: 0, water: 0, waste: 0, isolated: 0 });

/** Services techniques (énergie, déchets, eau) : ouvrages sans personnel permanent, sans besoin d'eau. */
const TECH_SERVICES = ['service:electricite', 'service:dechets', 'service:eau', 'service:assainissement'];
/** Effectif au-delà duquel un ouvrage technique est considéré comme occupé (sanitaires, process). */
const TECH_STAFF_WATER = 10;

/**
 * Le bâtiment a-t-il besoin d'eau ? Non pour les bâtiments sans occupants possibles ni pour les petits ouvrages
 * techniques (éolienne, ferme solaire, poste électrique, décharge, château d'eau…).
 */
export function needsWater(a: CatalogAsset): boolean {
  const res = a.capacity?.residents ?? 0, jobs = a.capacity?.jobs ?? 0;
  if (res <= 0 && jobs <= 0) return false;
  if (res <= 0 && jobs <= TECH_STAFF_WATER && a.tags.some((t) => TECH_SERVICES.includes(t))) return false;
  return true;
}

/**
 * Installations de déchets reliées à une portion de route isolée : un dépôt dont la composante routière ne
 * dessert aucun bâtiment occupé ou aucune filière de traitement (alors qu'il en existe ailleurs), ou une filière
 * de traitement sans dépôt joignable (alors qu'il en existe ailleurs). Renvoie leurs identifiants.
 */
export function isolatedWasteFacilities(ctx: PluginContext): Set<number> {
  const out = new Set<number>();
  const st = ctx.buildings.store, n = ctx.buildings.count;
  const kinds = new Map<number, string>();
  for (let i = 0; i < n; i++) {
    const k = facilityKindOfTags(ctx.buildings.assetOf(st.id[i]!)?.tags);
    if (k) kinds.set(st.id[i]!, k);
  }
  if (!kinds.size) return out;
  const roads = ctx.roads;
  const drivable = (sid: number): boolean => ROAD_KINDS[roads.kindOf(sid)].vehicles;
  // Composantes connexes de la voirie carrossable (union-find sur les nœuds).
  const parent = new Map<number, number>();
  const find = (x: number): number => { let r = x; while (parent.get(r) !== r) r = parent.get(r)!; let c = x; while (c !== r) { const p = parent.get(c)!; parent.set(c, r); c = p; } return r; };
  for (const id of roads.nodeIds()) parent.set(id, id);
  for (const sid of roads.segmentIds()) {
    if (!drivable(sid)) continue;
    const [a, b] = roads.endpoints(sid);
    if (!parent.has(a) || !parent.has(b)) continue;
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  const compOf = (x: number, z: number): number => {
    const s = roads.segmentNear(x, z, ATTACH_RADIUS, (sid) => !drivable(sid));
    if (!s) return -1;
    const a = roads.endpoints(s.segId)[0];
    return parent.has(a) ? find(a) : -1;
  };
  const producers = new Set<number>(), depots = new Set<number>(), treat = new Set<number>();
  const facComp = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const id = st.id[i]!;
    const k = kinds.get(id);
    const c = compOf(st.x[i]!, st.z[i]!);
    if (c < 0) continue;
    if (k) {
      facComp.set(id, c);
      if (k === 'depot') depots.add(c); else if (k === 'incinerateur' || k === 'decharge') treat.add(c);
    } else if (st.residents[i]! > 0 || st.workers[i]! > 0) producers.add(c);
  }
  for (const [id, c] of facComp) {
    const k = kinds.get(id)!;
    if (k === 'depot') {
      if (!producers.has(c) || (treat.size > 0 && !treat.has(c))) out.add(id);
    } else if (depots.size > 0 && !depots.has(c)) out.add(id);
  }
  return out;
}

export function computeAlerts(ctx: PluginContext): AlertesPayload {
  const power = ctx.use<ElectriciteService>('electricite');
  const eau = ctx.use<EauLike>('eau');
  const dechets = ctx.use<DechetsLike>('dechets');
  const powerOn = !!power && (power.hasNetwork?.() ?? true);
  const st = ctx.buildings.store;
  const assets = ctx.catalog?.assets ?? [];
  const items: number[] = [];
  const counts = emptyCounts();
  // Bacs pleins : signalés seulement si un service de collecte existe (sinon le joueur n'y peut rien de précis
  // et toute la ville clignoterait). Installations isolées : seulement quand il y a des installations.
  let wasteService = false;
  for (let i = 0; i < ctx.buildings.count && !wasteService; i++) if (facilityKindOfTags(assets[st.assetIndex[i]!]?.tags) === 'depot') wasteService = true;
  const isolated = isolatedWasteFacilities(ctx);
  for (let i = 0; i < ctx.buildings.count; i++) {
    const id = st.id[i]!;
    const a = assets[st.assetIndex[i]!];
    // Bâtiments seulement (pas le décor ni les pièces des ports et aéroports).
    if (!a || !isBuildingCategory(a.category)) continue;
    let m = 0;
    if (!st.roadAccess[i]) m |= ALERT_BITS.road;
    if (powerOn && !power!.isPowered(id)) m |= ALERT_BITS.power;
    if (eau && needsWater(a) && !eau.growthAllowed(id)) m |= ALERT_BITS.water;
    if (wasteService && dechets?.binFull(id)) m |= ALERT_BITS.waste;
    if (isolated.has(id)) m |= ALERT_BITS.isolated;
    if (!m) continue;
    for (const k of ALERT_KINDS) if (m & ALERT_BITS[k]) counts[k]++;
    items.push(id, m, Math.round(st.x[i]! * 10) / 10, Math.round((st.y[i]! + (a.dimensions?.height ?? 10)) * 10) / 10, Math.round(st.z[i]! * 10) / 10);
  }
  return { items, counts };
}

export function createAlertesPlugin(): SimPlugin {
  let last: AlertesPayload = { items: [], counts: emptyCounts() };
  let key = '', sentKey = '', acc = 60;
  const refresh = (ctx: PluginContext): void => { last = computeAlerts(ctx); key = last.items.join(','); };
  return {
    id: 'alertes',
    onNewGame() { last = { items: [], counts: emptyCounts() }; key = ''; sentKey = ''; acc = 60; },
    onTick(ctx, minutes) {
      acc += minutes;
      if (acc < 60) return;
      acc = 0;
      refresh(ctx);
    },
    takeDelta() {
      if (key === sentKey) return undefined;
      sentKey = key;
      return last;
    },
    // Aucune alerte : rien d'émis (module inerte, simulation identique avec ou sans lui).
    snapshot(ctx) { refresh(ctx); sentKey = key; return last.items.length ? last : undefined; },
    command(ctx, name) {
      if (name === 'state') { refresh(ctx); return { ok: true, data: last }; }
      return { ok: false, code: 'INVALID_ARGS', message: `Commande inconnue : ${name}` };
    },
  };
}

export const alertesPlugin = createAlertesPlugin();
