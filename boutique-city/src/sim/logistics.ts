/**
 * Logistique de Boutique City : entrepôts loués (étagères à palettes, stock en unités), importateur (commandes en
 * palettes, moins chères que le grossiste, livrées seulement à l'entrepôt après 1 à 2 jours) et tournées de nuit qui
 * transfèrent la marchandise de l'entrepôt vers les commerces passés sous leur stock minimum, dans la limite d'un
 * véhicule (transporteur payant, ou un de vos véhicules avec un chauffeur à la tournée).
 * Fonctions pures sur la partie (aucun DOM) ; aucun tirage aléatoire (la partie reste reproductible).
 */
import { ECONOMY, LOGISTICS, PRODUCT_BY_ID, TRANSPORT_FR, VEHICLE_BY_ID, productsOf, type ProductDef, type TransportMode } from './catalog';
import { MINUTES_PER_DAY } from './clock';
import type { Premise } from './district';
import type { Game, Result } from './game';

export interface Warehouse {
  id: number;
  premiseId: number;
  /** Étagères à palettes installées. */
  racks: number;
  /** Stock (produit → unités). */
  stock: Record<string, number>;
  deposit: number;
  /** Loyer provisionné depuis la dernière échéance (prélevé tous les 30 jours). */
  rentDue: number;
  leaseDay: number;
  /** Transport des tournées de nuit. */
  mode: TransportMode;
  /** Véhicule assigné (mode « vehicule »). */
  vehicleId: number | null;
  /** Seconde tournée en journée (LOGISTICS.middayHour) ; absent : non. */
  midday?: boolean;
}
export interface ImportOrder { id: number; warehouseId: number; /** Produit → unités. */ lines: Record<string, number>; cost: number; arriveAt: number }
export interface TourReport { day: number; warehouseId: number; units: number; stops: number; cost: number; capacity: number; missing: string[]; manual: boolean }
export interface LogiState {
  warehouses: Warehouse[];
  imports: ImportOrder[];
  /** Stocks minimums : commerce (id) → produit → unités. */
  mins: Record<string, Record<string, number>>;
  /** Dernières tournées (20 au plus). */
  tours: TourReport[];
  nextId: number;
}

export const emptyLogi = (): LogiState => ({ warehouses: [], imports: [], mins: {}, tours: [], nextId: 1 });

const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const fail = (message: string): Result<never> => ({ ok: false, message });
const r2 = (v: number): number => Math.round(v * 100) / 100;
const sum = (r: Record<string, number>): number => Object.values(r).reduce((a, b) => a + b, 0);
const lower = (id: string): string => PRODUCT_BY_ID.get(id)?.nameFr.toLowerCase() ?? id;

/* ------------------------------ Lecture ------------------------------ */

export const warehouseRent = (p: Premise): number => Math.round((p.rent * LOGISTICS.rentMult) / 10) * 10;
export const maxRacks = (p: Premise): number => Math.max(4, Math.floor(p.area / LOGISTICS.m2PerRack));
export const capacityOf = (w: Warehouse): number => w.racks * LOGISTICS.rackCapacity;
export const usedOf = (w: Warehouse): number => sum(w.stock);
export const incomingOf = (g: Game, w: Warehouse): number => g.logi.imports.filter((o) => o.warehouseId === w.id).reduce((a, o) => a + sum(o.lines), 0);
/** Place libre pour une nouvelle commande (capacité − stock − arrivages attendus). */
export const freeOf = (g: Game, w: Warehouse): number => Math.max(0, capacityOf(w) - usedOf(w) - incomingOf(g, w));
export const warehouse = (g: Game, id: number): Warehouse | undefined => g.logi.warehouses.find((w) => w.id === id);
export const warehouseAt = (g: Game, premiseId: number): Warehouse | undefined => g.logi.warehouses.find((w) => w.premiseId === premiseId);
export const warehousePremises = (g: Game): Premise[] => g.district.premises.filter((p) => p.warehouse);
/** Le personnage est dans l'entrepôt. */
export const atWarehouse = (g: Game, w: Warehouse): boolean => g.player.place.kind === 'local' && g.player.place.premiseId === w.premiseId;
/** Nom affiché d'un entrepôt (numéro dans l'ordre des locaux réservés). */
export function warehouseName(g: Game, premiseId: number): string {
  const k = warehousePremises(g).findIndex((p) => p.id === premiseId);
  return `Entrepôt ${k >= 0 ? k + 1 : premiseId}`;
}

/** Unités par palette chez l'importateur. */
export const palletOf = (pr: ProductDef): number => (pr.cost >= LOGISTICS.bigUnitCost ? LOGISTICS.palletUnitsBig : LOGISTICS.palletUnits);
/** Prix unitaire de l'importateur (fixe). */
export const importUnit = (pr: ProductDef): number => r2(pr.cost * (1 - LOGISTICS.importDiscount));

export interface ImportQuote { pallets: number; units: number; goods: number; fee: number; total: number; days: number; arriveAt: number; lines: Record<string, number> }
/** Devis d'une commande à l'importateur (produit → palettes). */
export function importQuote(g: Game, pallets: Record<string, number>): ImportQuote {
  let n = 0, units = 0, goods = 0;
  const lines: Record<string, number> = {};
  for (const [id, k] of Object.entries(pallets)) {
    const pr = PRODUCT_BY_ID.get(id), q = Math.floor(k);
    if (!pr || !(q > 0)) continue;
    const u = q * palletOf(pr);
    lines[id] = u; n += q; units += u; goods += u * importUnit(pr);
  }
  const days = n > LOGISTICS.fastPallets ? 2 : 1;
  const arriveAt = (g.day + days) * MINUTES_PER_DAY + LOGISTICS.importHour * 60;
  const fee = n > 0 ? LOGISTICS.importFee : 0;
  return { pallets: n, units, goods: r2(goods), fee, total: r2(goods + fee), days, arriveAt, lines };
}

/** Capacité d'une tournée (unités) et coût estimé pour `units` unités livrées dans `stops` commerces. */
export function tourCapacity(g: Game, w: Warehouse): number {
  if (w.mode === 'service') return LOGISTICS.service.cargo;
  if (w.mode === 'vehicule' && w.vehicleId !== null && g.vehicle(w.vehicleId)) return Math.max(0, g.freeLoad(w.vehicleId));
  return 0;
}
export function tourCost(mode: TransportMode, units: number, stops: number): number {
  if (units <= 0 || mode === 'aucun') return 0;
  if (mode === 'service') return r2(LOGISTICS.service.base + LOGISTICS.service.perStop * stops + LOGISTICS.service.perUnit * units);
  return r2(LOGISTICS.own.base + LOGISTICS.own.perStop * stops);
}

/** Stock minimum d'un produit dans un commerce (0 : pas de réassort automatique depuis l'entrepôt). */
export const minOf = (g: Game, shopId: number, productId: string): number => g.logi.mins[shopId]?.[productId] ?? 0;

interface Need { shopId: number; productId: string; want: number; urgency: number }
/** Besoins des commerces : produits sous le minimum (stock + commandes en cours), à compléter jusqu'au rayon plein. */
export function needs(g: Game): Need[] {
  const out: Need[] = [];
  for (const s of g.shops) {
    for (const pr of productsOf(s.type)) {
      const m = minOf(g, s.id, pr.id);
      if (m <= 0 || !s.products[pr.id]) continue;
      const level = s.products[pr.id]!.stock + g.pendingQty(s.id, pr.id);
      if (level >= m) continue;
      const want = g.room(s, pr.id);
      if (want > 0) out.push({ shopId: s.id, productId: pr.id, want, urgency: level / m });
    }
  }
  return out.sort((a, b) => a.urgency - b.urgency || a.shopId - b.shopId);
}

/** Aperçu de la prochaine tournée d'un entrepôt (sans rien déplacer) : unités, commerces livrés, coût, produits manquants. */
export function tourPreview(g: Game, w: Warehouse): { units: number; stops: number; cost: number; capacity: number; missing: string[] } {
  const cap = tourCapacity(g, w), stock = { ...w.stock }, shops = new Set<number>(), missing = new Set<string>();
  let left = cap, units = 0;
  for (const nd of needs(g)) {
    const have = stock[nd.productId] ?? 0;
    if (have <= 0) { missing.add(nd.productId); continue; }
    const q = Math.min(nd.want, have, left);
    if (q <= 0) continue;
    stock[nd.productId] = have - q; left -= q; units += q; shops.add(nd.shopId);
  }
  return { units, stops: shops.size, cost: tourCost(w.mode, units, shops.size), capacity: cap, missing: [...missing] };
}

/* ------------------------------ Bail et étagères ------------------------------ */

export function rentWarehouse(g: Game, premiseId: number): Result<Warehouse> {
  const p = g.premise(premiseId);
  if (!p || !p.warehouse) return fail('Ce local n’est pas un entrepôt.');
  if (warehouseAt(g, premiseId)) return fail('Entrepôt déjà loué.');
  const rent = warehouseRent(p), deposit = rent * ECONOMY.depositMonths;
  if (g.cash < deposit) return fail(`Trésorerie insuffisante : dépôt de garantie de ${deposit} CHF.`);
  g.cash -= deposit;
  const w: Warehouse = { id: g.logi.nextId++, premiseId, racks: 0, stock: {}, deposit, rentDue: 0, leaseDay: g.day, mode: 'aucun', vehicleId: null };
  g.logi.warehouses.push(w);
  g.notify('ok', `${warehouseName(g, premiseId)} loué (${p.area} m², ${rent} CHF / mois). Installez des étagères à palettes, puis commandez à l’importateur.`);
  g.version++;
  return ok(w);
}

export function releaseQuote(g: Game, id: number): { deposit: number; resale: number; refunds: number; rentDue: number; stockUnits: number; total: number } | null {
  const w = warehouse(g, id);
  if (!w) return null;
  const resale = Math.round(w.racks * LOGISTICS.rackPrice * ECONOMY.resale);
  const refunds = r2(g.logi.imports.filter((o) => o.warehouseId === id).reduce((a, o) => a + o.cost, 0));
  return { deposit: w.deposit, resale, refunds, rentDue: r2(w.rentDue), stockUnits: usedOf(w), total: r2(w.deposit + resale + refunds - w.rentDue) };
}

export function releaseWarehouse(g: Game, id: number): Result<number> {
  const w = warehouse(g, id), q = releaseQuote(g, id);
  if (!w || !q) return fail('Entrepôt introuvable');
  g.cash += q.total;
  g.logi.imports = g.logi.imports.filter((o) => o.warehouseId !== id);
  g.logi.warehouses = g.logi.warehouses.filter((x) => x !== w);
  g.notify('info', `Bail de l’entrepôt résilié : ${Math.round(q.total)} CHF récupérés (dépôt, étagères revendues, arrivages remboursés, loyer dû retenu).${q.stockUnits > 0 ? ` ${q.stockUnits} unités en stock perdues.` : ''}`);
  g.version++;
  return ok(q.total);
}

/** Achète et fait monter des étagères à palettes. */
export function buyRacks(g: Game, id: number, n: number): Result<number> {
  const w = warehouse(g, id), p = w && g.premise(w.premiseId);
  if (!w || !p) return fail('Entrepôt introuvable');
  const k = Math.min(Math.floor(n), maxRacks(p) - w.racks);
  if (!(k > 0)) return fail(`Entrepôt plein : ${maxRacks(p)} étagères au plus sur ${p.area} m².`);
  const cost = k * LOGISTICS.rackPrice;
  if (g.cash < cost) return fail(`Trésorerie insuffisante (${cost} CHF)`);
  g.cash -= cost; g.today.equipment += cost;
  w.racks += k;
  g.version++;
  return ok(k);
}

/** Revend une étagère vide (la capacité restante doit couvrir le stock et les arrivages). */
export function sellRack(g: Game, id: number): Result<number> {
  const w = warehouse(g, id);
  if (!w || w.racks <= 0) return fail('Aucune étagère à revendre');
  if ((w.racks - 1) * LOGISTICS.rackCapacity < usedOf(w) + incomingOf(g, w)) return fail('Étagères pleines : videz un peu le stock d’abord.');
  const back = Math.round(LOGISTICS.rackPrice * ECONOMY.resale);
  w.racks--; g.cash += back;
  g.version++;
  return ok(back);
}

/* ------------------------------ Importateur ------------------------------ */

/** Commande à l'importateur (produit → palettes), livrée à l'entrepôt après 1 ou 2 jours. */
export function placeImport(g: Game, warehouseId: number, pallets: Record<string, number>): Result<ImportOrder> {
  const w = warehouse(g, warehouseId);
  if (!w) return fail('Louez d’abord un entrepôt : l’importateur ne livre qu’aux entrepôts.');
  const q = importQuote(g, pallets);
  if (q.pallets < LOGISTICS.minPallets) return fail(`Commande minimale : ${LOGISTICS.minPallets} palettes (actuellement ${q.pallets}).`);
  const free = freeOf(g, w);
  if (q.units > free) return fail(`Pas assez de place à l’entrepôt : ${q.units} unités commandées pour ${free} places libres. Ajoutez des étagères.`);
  if (g.cash < q.total) return fail(`Trésorerie insuffisante (${Math.round(q.total)} CHF)`);
  g.cash -= q.total; g.today.purchases += q.total;
  const o: ImportOrder = { id: g.logi.nextId++, warehouseId, lines: q.lines, cost: q.total, arriveAt: q.arriveAt };
  g.logi.imports.push(o);
  g.notify('ok', `Importateur : ${q.pallets} palettes (${q.units} unités, ${Math.round(q.total)} CHF) livrées ${g.deliveryLabel(o.arriveAt)} à ${warehouseName(g, w.premiseId)}.`);
  g.version++;
  return ok(o);
}

/* ------------------------------ Stocks minimums et transport ------------------------------ */

export function setMin(g: Game, shopId: number, productId: string, n: number): Result<number> {
  const s = g.shop(shopId);
  if (!s || !s.products[productId]) return fail('Produit inconnu');
  const v = Math.max(0, Math.min(9999, Math.floor(Number.isFinite(n) ? n : 0)));
  const m = (g.logi.mins[shopId] ??= {});
  if (v > 0) m[productId] = v; else delete m[productId];
  if (!Object.keys(m).length) delete g.logi.mins[shopId];
  g.version++;
  return ok(v);
}

/** Minimums proposés : une part (LOGISTICS.autoMinShare) de la place en rayon de chaque produit (0 : tout effacer). */
export function autoMins(g: Game, shopId: number, share: number = LOGISTICS.autoMinShare): Result<number> {
  const s = g.shop(shopId);
  if (!s) return fail('Commerce introuvable');
  let n = 0;
  for (const pr of productsOf(s.type)) {
    const v = Math.floor(g.storageFor(s, pr) * share);
    setMin(g, shopId, pr.id, v);
    if (v > 0) n++;
  }
  return ok(n);
}

export function setTransport(g: Game, warehouseId: number, mode: TransportMode, vehicleId: number | null = null): Result<TransportMode> {
  const w = warehouse(g, warehouseId);
  if (!w) return fail('Entrepôt introuvable');
  if (!(mode in TRANSPORT_FR)) return fail('Transport inconnu');
  if (mode === 'vehicule') {
    const v = vehicleId === null ? g.vehicles[0] : g.vehicle(vehicleId);
    if (!v) return fail('Achetez d’abord un véhicule au garage (une camionnette est idéale).');
    const other = g.logi.warehouses.find((x) => x !== w && x.mode === 'vehicule' && x.vehicleId === v.id);
    if (other) return fail('Ce véhicule fait déjà les tournées d’un autre entrepôt.');
    w.vehicleId = v.id;
  } else w.vehicleId = null;
  w.mode = mode;
  g.version++;
  return ok(mode);
}

/** Active ou non la seconde tournée de la journée. */
export function setMidday(g: Game, warehouseId: number, on: boolean): Result<boolean> {
  const w = warehouse(g, warehouseId);
  if (!w) return fail('Entrepôt introuvable');
  if (on) w.midday = true; else delete w.midday;
  g.version++;
  return ok(on);
}

/** Dépose dans l'entrepôt la marchandise portée et celle des véhicules garés devant (sur place). */
export function stow(g: Game, warehouseId: number): Result<number> {
  const w = warehouse(g, warehouseId), p = w && g.premise(w.premiseId);
  if (!w || !p) return fail('Entrepôt introuvable');
  if (!atWarehouse(g, w)) return fail('Rendez-vous à l’entrepôt pour décharger.');
  let free = capacityOf(w) - usedOf(w), moved = 0;
  for (const load of [g.player.carry, ...g.vehiclesNear(p.doorX, p.doorZ).map((v) => v.cargo)]) {
    for (const [pid, n] of Object.entries(load)) {
      const q = Math.min(n, free);
      if (q <= 0) continue;
      w.stock[pid] = (w.stock[pid] ?? 0) + q;
      load[pid] = n - q;
      if (load[pid] === 0) delete load[pid];
      free -= q; moved += q;
    }
  }
  if (moved === 0) return fail(capacityOf(w) - usedOf(w) <= 0 ? 'Entrepôt plein : ajoutez des étagères.' : 'Rien à décharger (garez un véhicule devant la porte).');
  g.notify('ok', `${moved} unités rangées à ${warehouseName(g, w.premiseId)}.`);
  g.version++;
  return ok(moved);
}

/** Prend de la marchandise de l'entrepôt : portée à pied ou chargée dans un véhicule garé devant (sur place). */
export function takeOut(g: Game, warehouseId: number, productId: string, qty: number, carrier: 'pied' | number): Result<number> {
  const w = warehouse(g, warehouseId), p = w && g.premise(w.premiseId);
  if (!w || !p) return fail('Entrepôt introuvable');
  if (!atWarehouse(g, w)) return fail('Rendez-vous à l’entrepôt pour charger.');
  if (carrier !== 'pied') {
    const v = g.vehicle(carrier);
    if (!v || Math.hypot(v.x - p.doorX, v.z - p.doorZ) > ECONOMY.loadDistance) return fail('Garez le véhicule devant l’entrepôt.');
  }
  const n = Math.min(Math.floor(qty), w.stock[productId] ?? 0, g.freeLoad(carrier));
  if (!(n > 0)) return fail((w.stock[productId] ?? 0) <= 0 ? 'Plus de stock de ce produit.' : 'Plus de place pour transporter.');
  w.stock[productId]! -= n;
  if (w.stock[productId] === 0) delete w.stock[productId];
  const load = g.loadOf(carrier);
  load[productId] = (load[productId] ?? 0) + n;
  g.version++;
  return ok(n);
}

/* ------------------------------ Tournées ------------------------------ */

/**
 * Tournée : chaque entrepôt équipé d'un transport livre les produits sous le minimum (les plus urgents d'abord),
 * jusqu'à remplir les rayons, dans la limite de la capacité du véhicule. Coût payé à la tournée.
 */
export function runTours(g: Game, manual = false, only?: (w: Warehouse) => boolean): TourReport[] {
  const out: TourReport[] = [];
  for (const w of g.logi.warehouses) {
    if (w.mode === 'vehicule' && (w.vehicleId === null || !g.vehicle(w.vehicleId))) {
      w.mode = 'aucun'; w.vehicleId = null;
      g.notify('warn', `${warehouseName(g, w.premiseId)} : le véhicule des tournées n’existe plus. Choisissez un transport.`);
    }
  }
  const active = g.logi.warehouses.filter((w) => w.mode !== 'aucun' && (!only || only(w)));
  const pending = needs(g);
  if (!pending.length) return out;
  if (!active.length) {
    if (!manual && g.logi.warehouses.length) g.notify('warn', 'Des commerces sont sous leur stock minimum mais aucun entrepôt n’a de transport : choisissez un transporteur ou un véhicule.');
    return out;
  }
  const missing = new Set<string>();
  for (const w of active) {
    const cap = tourCapacity(g, w);
    let left = cap, units = 0;
    const perShop = new Map<number, number>();
    for (const nd of needs(g)) {
      if (left <= 0) break;
      const s = g.shop(nd.shopId)!, have = w.stock[nd.productId] ?? 0;
      if (have <= 0) continue;
      const q = Math.min(nd.want, have, left);
      if (q <= 0) continue;
      // Commerce premium : supplément de gamme facturé au rangement (comme pour la marchandise emportée).
      const sup = s.premium ? g.orderCost(nd.productId, 1, s.id) - g.orderCost(nd.productId, 1) : 0;
      if (sup > 0) { const c = r2(sup * q); g.cash -= c; s.today.purchases += c; g.today.purchases += c; }
      s.products[nd.productId]!.stock += q;
      w.stock[nd.productId] = have - q;
      if (w.stock[nd.productId] === 0) delete w.stock[nd.productId];
      left -= q; units += q;
      perShop.set(s.id, (perShop.get(s.id) ?? 0) + q);
    }
    const stops = perShop.size, cost = tourCost(w.mode, units, stops);
    if (cost > 0) {
      g.cash -= cost; g.today.purchases += cost;
      for (const [sid, q] of perShop) { const s = g.shop(sid)!; s.today.purchases += r2(cost * q / units); }
    }
    if (units <= 0) continue;
    out.push({ day: g.day, warehouseId: w.id, units, stops, cost, capacity: cap, missing: [], manual });
    g.notify('ok', `Tournée ${manual ? 'immédiate' : only ? 'de mi-journée' : 'de nuit'} (${warehouseName(g, w.premiseId)}) : ${units} unités livrées dans ${stops} commerce(s), ${Math.round(cost)} CHF.${left <= 0 && needs(g).some((n) => (w.stock[n.productId] ?? 0) > 0) ? ` Véhicule plein (${cap} unités) : le reste partira à la prochaine tournée.` : ''}`);
  }
  // Produits encore sous le minimum alors qu'aucun entrepôt n'en a : alerte « entrepôt vide ».
  for (const nd of needs(g)) if (!g.logi.warehouses.some((w) => (w.stock[nd.productId] ?? 0) > 0)) missing.add(nd.productId);
  if (missing.size) {
    const list = [...missing].map(lower);
    if (out.length) out[out.length - 1]!.missing = [...missing];
    g.notify('warn', `Entrepôt vide pour : ${list.slice(0, 5).join(', ')}${list.length > 5 ? ` et ${list.length - 5} autre(s)` : ''}. Commandez à l’importateur.`);
  }
  g.logi.tours.push(...out);
  if (g.logi.tours.length > 20) g.logi.tours.splice(0, g.logi.tours.length - 20);
  g.version++;
  return out;
}

/** Heure de jeu : arrivages de l'importateur, tournée de nuit. Appelée par la partie à chaque heure pleine. */
export function logisticsHour(g: Game, h: number): void {
  const L = g.logi;
  if (!L.warehouses.length && !L.imports.length) return;
  const due = L.imports.filter((o) => o.arriveAt <= g.total);
  if (due.length) {
    L.imports = L.imports.filter((o) => o.arriveAt > g.total);
    for (const o of due) {
      const w = warehouse(g, o.warehouseId);
      if (!w) continue;
      let free = capacityOf(w) - usedOf(w), back = 0, units = 0;
      const total = sum(o.lines);
      for (const [pid, n] of Object.entries(o.lines)) {
        const q = Math.max(0, Math.min(n, free));
        if (q > 0) { w.stock[pid] = (w.stock[pid] ?? 0) + q; free -= q; units += q; }
        if (q < n) back += (n - q) * (o.cost / Math.max(1, total));
      }
      if (back > 0) { back = r2(back); g.cash += back; g.today.purchases -= back; }
      g.notify(back > 0 ? 'warn' : 'info', `Arrivage de l’importateur à ${warehouseName(g, w.premiseId)} : ${units} unités.${back > 0 ? ` Faute de place, le reste est reparti (${Math.round(back)} CHF remboursés).` : ''}`);
    }
    g.version++;
  }
  if (h === LOGISTICS.tourHour) runTours(g);
  else if (h === LOGISTICS.middayHour && L.warehouses.some((w) => w.midday && w.mode !== 'aucun')) runTours(g, false, (w) => !!w.midday);
}

/** Minuit : loyer des entrepôts (provision quotidienne, prélevé tous les 30 jours). */
export function logisticsNight(g: Game): void {
  for (const w of g.logi.warehouses) {
    const p = g.premise(w.premiseId);
    if (!p) continue;
    const rent = r2(warehouseRent(p) / 30);
    g.today.rent += rent;
    w.rentDue = r2(w.rentDue + rent);
    if (g.day > w.leaseDay && (g.day - w.leaseDay) % 30 === 0) {
      g.cash -= w.rentDue;
      g.notify('info', `${warehouseName(g, w.premiseId)} : loyer du mois prélevé (${Math.round(w.rentDue)} CHF).`);
      w.rentDue = 0;
    }
  }
  // Minimums des commerces fermés depuis : oubliés.
  for (const k of Object.keys(g.logi.mins)) if (!g.shop(Number(k))) delete g.logi.mins[k];
}

/** Copie de sauvegarde (et restauration tolérante : champs absents → valeurs par défaut). */
export const saveLogi = (L: LogiState): LogiState => structuredClone(L);
export function restoreLogi(s: Partial<LogiState> | undefined): LogiState {
  const L = emptyLogi();
  if (!s) return L;
  L.warehouses = (s.warehouses ?? []).map((w) => ({ ...w, stock: { ...(w.stock ?? {}) }, racks: w.racks ?? 0, deposit: w.deposit ?? 0, rentDue: w.rentDue ?? 0, leaseDay: w.leaseDay ?? 0, mode: w.mode ?? 'aucun', vehicleId: w.vehicleId ?? null }));
  L.imports = structuredClone(s.imports ?? []);
  L.mins = structuredClone(s.mins ?? {});
  L.tours = structuredClone(s.tours ?? []);
  L.nextId = s.nextId ?? 1 + Math.max(0, ...L.warehouses.map((w) => w.id), ...L.imports.map((o) => o.id));
  return L;
}

/** Valeur d'achat (prix importateur) du stock d'un entrepôt. */
export const stockValue = (w: Warehouse): number => r2(Object.entries(w.stock).reduce((a, [id, n]) => a + n * importUnit(PRODUCT_BY_ID.get(id)!), 0));
/** Libellé du véhicule assigné. */
export function vehicleLabel(g: Game, w: Warehouse): string {
  const v = w.vehicleId === null ? undefined : g.vehicle(w.vehicleId);
  return v ? `${VEHICLE_BY_ID.get(v.type)!.nameFr} (${VEHICLE_BY_ID.get(v.type)!.cargo} unités)` : 'aucun';
}
