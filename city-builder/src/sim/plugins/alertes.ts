/**
 * Module « alertes » : chaque heure de jeu, relève les problèmes visibles de chaque bâtiment (pas d'accès routier,
 * coupure d'électricité, pas d'eau, bacs pleins, installation de déchets sur une route isolée) d'après les services publiés par les autres modules. Lecture seule :
 * aucun effet sur la simulation, rien n'est sauvegardé (recalculé au chargement).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { isBuildingCategory, type CatalogAsset } from '../../shared/catalog';
import type { ElectriciteService } from '../../shared/power/types';
import { ALERT_BITS, ALERT_KINDS, POWER_RESERVE_WARN, type AlertesPayload, type AlertKind } from '../../shared/protocol-ext/alertes';
import { IMPORT_SPEC } from '../../shared/power/model';
import { facilityKindOfTags } from '../../shared/waste/types';
import { isUnstaffedUtility } from '../../shared/utility-buildings';
import { ROAD_KINDS } from '../roads/types';
import { ATTACH_RADIUS } from '../waste/graph';
import type { PluginContext, SimPlugin } from './types';

interface EauLike { growthAllowed(id: number): boolean }
interface DechetsLike { binFull(id: number): boolean }
interface ServicesLike { burning(id: number): boolean; ruined(id: number): boolean; crimeHigh(id: number): boolean }

const emptyCounts = (): Record<AlertKind, number> => ({ road: 0, power: 0, water: 0, waste: 0, isolated: 0, fire: 0, ruin: 0, crime: 0 });

/**
 * Le bâtiment a-t-il besoin d'eau ? Non pour les bâtiments sans occupants possibles ni pour les petits ouvrages
 * techniques (éolienne, ferme solaire, poste électrique, décharge, château d'eau…).
 */
export function needsWater(a: CatalogAsset): boolean {
  return !isUnstaffedUtility(a);
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
  const services = ctx.use<ServicesLike>('services');
  const powerOn = !!power && (power.hasNetwork?.() ?? true);
  const st = ctx.buildings.store;
  const assets = ctx.catalog?.assets ?? [];
  const items: number[] = [];
  const counts = emptyCounts();
  // Sans aucun dépôt de camions-bennes : pas d'icône sur chaque bâtiment (toute la ville clignoterait), mais une
  // alerte globale « aucune collecte » dès que des bacs sont pleins (`noCollection`).
  let noCollection = 0;
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
    // Une centrale reliée au réseau (éolienne au milieu des champs, raccordée par ligne haute tension) fonctionne
    // sans route : pas d'icône « accès routier », qui laissait croire qu'elle ne produisait pas.
    if (!st.roadAccess[i] && !power?.isConnectedFacility?.(id)) m |= ALERT_BITS.road;
    if (powerOn && !power!.isPowered(id)) m |= ALERT_BITS.power;
    if (eau && needsWater(a) && !eau.growthAllowed(id)) m |= ALERT_BITS.water;
    // Ouvrages techniques sans occupants (éoliennes, pylônes, pompes, postes…) : aucun déchet, aucune icône.
    if (dechets && !isUnstaffedUtility(a) && dechets.binFull(id)) {
      if (wasteService) m |= ALERT_BITS.waste; else noCollection++;
    }
    if (isolated.has(id)) m |= ALERT_BITS.isolated;
    if (services) {
      if (services.burning(id)) m |= ALERT_BITS.fire;
      else if (services.ruined(id)) m |= ALERT_BITS.ruin;
      else if (services.crimeHigh(id)) m |= ALERT_BITS.crime;
    }
    if (!m) continue;
    for (const k of ALERT_KINDS) if (m & ALERT_BITS[k]) counts[k]++;
    items.push(id, m, Math.round(st.x[i]! * 10) / 10, Math.round((st.y[i]! + (a.dimensions?.height ?? 10)) * 10) / 10, Math.round(st.z[i]! * 10) / 10);
  }
  return noCollection > 0 ? { items, counts, noCollection } : { items, counts };
}

/**
 * Marge de production de l'heure (part de la demande raccordée), ou null sans objet : pas de réseau, demande trop
 * faible, ou déjà des bâtiments délestés (l'alerte « sans électricité » prend alors le relais).
 */
export function powerReserveShare(ctx: PluginContext): number | null {
  const power = ctx.use<ElectriciteService>('electricite');
  if (!power || !(power.hasNetwork?.() ?? true)) return null;
  const s = power.summary();
  if (!s || s.cut > 0) return null;
  const demand = s.demandKw - s.unlinkedKw;
  if (demand < 200) return null;
  // Capacité : production disponible + appoint du réseau voisin quand il est utilisé (plafond du raccordement).
  const capacity = s.availableKw + (s.importedKw !== undefined ? IMPORT_SPEC.capacityKw : 0);
  return (capacity - demand) / demand;
}

export function createAlertesPlugin(): SimPlugin {
  let last: AlertesPayload = { items: [], counts: emptyCounts() };
  let key = '', sentKey = '', acc = 60;
  /** Marges horaires des dernières 24 h (le vent et le soleil varient : l'alerte retient la plus basse). */
  let reserves: number[] = [];
  const refresh = (ctx: PluginContext, hourly = false): void => {
    last = computeAlerts(ctx);
    if (hourly) {
      const r = powerReserveShare(ctx);
      // Coupure en cours ou réseau absent : on repart de zéro (l'alerte de réserve n'a de sens qu'avant la coupure).
      if (r === null) reserves = []; else { reserves.push(r); if (reserves.length > 24) reserves.shift(); }
    }
    const low = reserves.length ? Math.min(...reserves) : Infinity;
    if (low < POWER_RESERVE_WARN) last.powerReserve = Math.round(Math.max(0, low) * 100) / 100;
    key = last.items.join(',') + (last.noCollection ? `|${last.noCollection}` : '') + (last.powerReserve !== undefined ? `|r${last.powerReserve}` : '');
  };
  return {
    id: 'alertes',
    onNewGame() { last = { items: [], counts: emptyCounts() }; key = ''; sentKey = ''; acc = 60; reserves = []; },
    onTick(ctx, minutes) {
      acc += minutes;
      if (acc < 60) return;
      acc = 0;
      refresh(ctx, true);
    },
    takeDelta() {
      if (key === sentKey) return undefined;
      sentKey = key;
      return last;
    },
    // Aucune alerte : rien d'émis (module inerte, simulation identique avec ou sans lui).
    snapshot(ctx) { refresh(ctx); sentKey = key; return last.items.length || last.noCollection || last.powerReserve !== undefined ? last : undefined; },
    command(ctx, name) {
      if (name === 'state') { refresh(ctx); return { ok: true, data: last }; }
      return { ok: false, code: 'INVALID_ARGS', message: `Commande inconnue : ${name}` };
    },
  };
}

export const alertesPlugin = createAlertesPlugin();
