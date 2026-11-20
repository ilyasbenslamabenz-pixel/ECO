/**
 * Partie de Boutique City : trésorerie de l'entrepreneur, commerces loués dans le quartier, clients minute par
 * minute, employés, stocks et commandes au grossiste, loyers, réputation, historique et sauvegarde.
 * Aucune valeur inventée à l'affichage : l'interface lit uniquement cet état. TypeScript pur (aucun DOM).
 */
import {
  ECONOMY, FURNITURE_BY_ID, PRODUCT_BY_ID, SHOP_TYPE_BY_ID, productsOf,
  type ProductDef, type ShopType,
} from './catalog';
import { MINUTES_PER_DAY, START_MINUTE, clockView } from './clock';
import { competitorsNear, generateDistrict, type District, type Premise } from './district';
import { canPlace, layoutStats, type LayoutStats, type PlacedItem } from './layout';
import { randomName } from './names';
import { Rng } from './rng';

export const SAVE_VERSION = 1;

export interface Employee { id: number; name: string; skill: number; wage: number; shopId: number | null; hiredDay: number }
export interface Candidate { id: number; name: string; skill: number; wage: number }
export interface ProductState { price: number; stock: number; auto: boolean }
export interface Order { id: number; shopId: number; productId: string; qty: number; cost: number; deliverAt: number }

export interface DayStats {
  day: number;
  customers: number;
  /** Clients perdus : rupture de stock, attente trop longue (caisses), magasin fermé faute d'employé. */
  lostStock: number;
  lostCapacity: number;
  lostStaff: number;
  revenue: number;
  /** Coût d'achat des articles vendus (marge = revenue − costOfSales). */
  costOfSales: number;
  /** Sorties de trésorerie. */
  purchases: number;
  wages: number;
  rent: number;
  equipment: number;
}

export interface Shop {
  id: number;
  premiseId: number;
  type: ShopType;
  name: string;
  items: PlacedItem[];
  nextUid: number;
  products: Record<string, ProductState>;
  open: number;
  close: number;
  reputation: number;
  deposit: number;
  today: DayStats;
  history: DayStats[];
  /** Taux d'arrivée et capacité de l'heure courante (clients / h), recalculés chaque heure. */
  rate: number;
  capacity: number;
  servedThisHour: number;
  /** Ruptures déjà signalées aujourd'hui (produits). */
  warned: string[];
}

export interface Notice { at: number; level: 'info' | 'ok' | 'warn' | 'error'; text: string }
/** Événement visuel (rendu) : un client entre dans un commerce du joueur. */
export interface ClientEvent { shopId: number; premiseId: number }

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; message: string };
const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const fail = (message: string): Result<never> => ({ ok: false, message });

const emptyDay = (day: number): DayStats => ({ day, customers: 0, lostStock: 0, lostCapacity: 0, lostStaff: 0, revenue: 0, costOfSales: 0, purchases: 0, wages: 0, rent: 0, equipment: 0 });
const r2 = (v: number): number => Math.round(v * 100) / 100;

export interface GameSave {
  v: number;
  seed: number;
  companyName: string;
  total: number;
  cash: number;
  shops: Shop[];
  employees: Employee[];
  candidates: Candidate[];
  orders: Order[];
  ledger: DayStats[];
  nextId: number;
  rng: number[];
}

export class Game {
  readonly district: District;
  companyName: string;
  total: number;
  cash: number;
  shops: Shop[] = [];
  employees: Employee[] = [];
  candidates: Candidate[] = [];
  orders: Order[] = [];
  /** Bilan quotidien de l'entreprise (tous commerces). */
  ledger: DayStats[] = [];
  today: DayStats;
  notices: Notice[] = [];
  events: ClientEvent[] = [];
  private rng: Rng;
  private nextId = 1;
  /** Version de l'état (l'interface ne redessine que si elle change). */
  version = 0;

  constructor(readonly seed: number, companyName = 'Mon entreprise', save?: GameSave) {
    this.district = generateDistrict(seed);
    this.companyName = companyName;
    this.rng = new Rng(seed ^ 0x5bd1e995);
    this.total = START_MINUTE;
    this.cash = ECONOMY.startCash;
    this.today = emptyDay(0);
    if (save) this.restore(save);
    else this.refreshCandidates();
  }

  /* ------------------------------ Lecture ------------------------------ */

  premise(id: number): Premise | undefined { return this.district.premises.find((p) => p.id === id); }
  shop(id: number): Shop | undefined { return this.shops.find((s) => s.id === id); }
  shopAt(premiseId: number): Shop | undefined { return this.shops.find((s) => s.premiseId === premiseId); }
  staffOf(shopId: number): Employee[] { return this.employees.filter((e) => e.shopId === shopId); }
  /** Statistiques d'aménagement (mises en cache jusqu'au prochain changement de mobilier). */
  stats(shop: Shop): LayoutStats {
    const c = this.statsCache.get(shop.id);
    if (c && c.rev === this.layoutRev) return c.st;
    const p = this.premise(shop.premiseId)!;
    const st = layoutStats(shop.items, p.gridW, p.gridD);
    this.statsCache.set(shop.id, { rev: this.layoutRev, st });
    return st;
  }
  private readonly statsCache = new Map<number, { rev: number; st: LayoutStats }>();
  /** Incrémenté à chaque changement de mobilier (tous commerces). */
  private layoutRev = 0;

  /** Local libre (ni concurrent, ni déjà loué par le joueur). */
  isFree(p: Premise): boolean { return !p.competitor && !this.shopAt(p.id); }

  /** Unités stockables d'un produit (capacité du meuble partagée entre les produits qu'il présente). */
  storageFor(shop: Shop, prod: ProductDef, st = this.stats(shop)): number {
    const same = productsOf(shop.type).filter((p) => p.store === prod.store).length;
    return Math.floor(st.capacity[prod.store] / Math.max(1, same));
  }

  pendingQty(shopId: number, productId: string): number {
    return this.orders.filter((o) => o.shopId === shopId && o.productId === productId).reduce((a, o) => a + o.qty, 0);
  }

  /** Concurrents du même type autour d'un local (commerces du joueur compris). */
  competition(p: Premise, type: ShopType): number {
    return competitorsNear(this.district, p, type, 300, (q) => this.shopAt(q.id)?.type ?? null);
  }

  /** Clients attendus par heure à l'heure de pointe pour un type de commerce dans ce local (aménagement moyen). */
  estimatePeak(p: Premise, type: ShopType): number {
    const t = SHOP_TYPE_BY_ID.get(type)!;
    return p.footfall * t.capture * (1 / (1 + 0.6 * this.competition(p, type)));
  }

  /* ------------------------------ Commandes du joueur ------------------------------ */

  rent(premiseId: number, type: ShopType, name?: string): Result<Shop> {
    const p = this.premise(premiseId);
    if (!p) return fail('Local introuvable');
    if (!this.isFree(p)) return fail('Ce local est déjà occupé');
    const deposit = p.rent * ECONOMY.depositMonths;
    if (this.cash < deposit) return fail(`Trésorerie insuffisante : dépôt de garantie de ${deposit} CHF`);
    const t = SHOP_TYPE_BY_ID.get(type);
    if (!t) return fail('Type de commerce inconnu');
    this.cash -= deposit;
    const products: Record<string, ProductState> = {};
    for (const pr of productsOf(type)) products[pr.id] = { price: pr.basePrice, stock: 0, auto: false };
    const shop: Shop = {
      id: this.nextId++, premiseId, type, name: name?.trim() || `${t.nameFr} ${this.companyName}`.slice(0, 40), items: [], nextUid: 1, products,
      open: t.open, close: t.close, reputation: 0.5, deposit, today: emptyDay(this.day), history: [], rate: 0, capacity: 0, servedThisHour: 0, warned: [],
    };
    this.shops.push(shop);
    this.notify('ok', `Local loué : ${shop.name} (${p.area} m², ${p.rent} CHF / mois). Aménagez-le, embauchez et commandez du stock.`);
    this.bump();
    return ok(shop);
  }

  release(shopId: number): Result<number> {
    const s = this.shop(shopId);
    if (!s) return fail('Commerce introuvable');
    const resale = Math.round(this.stats(s).value * ECONOMY.resale);
    this.cash += s.deposit + resale;
    for (const e of this.staffOf(s.id)) e.shopId = null;
    this.orders = this.orders.filter((o) => o.shopId !== s.id);
    this.shops = this.shops.filter((x) => x !== s);
    this.notify('info', `Bail résilié : ${s.name}. Dépôt rendu (${s.deposit} CHF), mobilier revendu ${resale} CHF.`);
    this.bump();
    return ok(s.deposit + resale);
  }

  place(shopId: number, defId: string, x: number, z: number, rot: 0 | 1): Result<PlacedItem> {
    const s = this.shop(shopId), def = FURNITURE_BY_ID.get(defId);
    if (!s || !def) return fail('Commerce ou meuble inconnu');
    const p = this.premise(s.premiseId)!;
    const why = canPlace(s.items, p.gridW, p.gridD, def, x, z, rot);
    if (why) return fail(why);
    if (this.cash < def.price) return fail(`Trésorerie insuffisante (${def.price} CHF)`);
    this.cash -= def.price;
    s.today.equipment += def.price; this.today.equipment += def.price;
    const it: PlacedItem = { uid: s.nextUid++, def: defId, x, z, rot };
    s.items.push(it);
    this.layoutRev++;
    this.bump();
    return ok(it);
  }

  moveItem(shopId: number, uid: number, x: number, z: number, rot: 0 | 1): Result<PlacedItem> {
    const s = this.shop(shopId);
    const it = s?.items.find((i) => i.uid === uid);
    if (!s || !it) return fail('Meuble introuvable');
    const p = this.premise(s.premiseId)!;
    const why = canPlace(s.items, p.gridW, p.gridD, FURNITURE_BY_ID.get(it.def)!, x, z, rot, uid);
    if (why) return fail(why);
    it.x = x; it.z = z; it.rot = rot;
    this.layoutRev++;
    this.bump();
    return ok(it);
  }

  removeItem(shopId: number, uid: number): Result<number> {
    const s = this.shop(shopId);
    const it = s?.items.find((i) => i.uid === uid);
    if (!s || !it) return fail('Meuble introuvable');
    const refund = Math.round(FURNITURE_BY_ID.get(it.def)!.price * ECONOMY.resale);
    s.items = s.items.filter((i) => i !== it);
    this.layoutRev++;
    this.cash += refund;
    // Stock en trop pour la nouvelle capacité : perdu (signalé).
    const st = this.stats(s);
    for (const pr of productsOf(s.type)) {
      const ps = s.products[pr.id]!, cap = this.storageFor(s, pr, st);
      if (ps.stock > cap) { this.notify('warn', `${s.name} : ${ps.stock - cap} ${pr.nameFr.toLowerCase()} jetés (plus de place).`); ps.stock = cap; }
    }
    this.bump();
    return ok(refund);
  }

  setPrice(shopId: number, productId: string, price: number): Result<number> {
    const s = this.shop(shopId), pr = PRODUCT_BY_ID.get(productId);
    if (!s || !pr || !s.products[productId]) return fail('Produit inconnu');
    if (!Number.isFinite(price)) return fail('Prix invalide');
    const v = r2(Math.min(pr.basePrice * 3, Math.max(pr.basePrice * 0.3, price)));
    s.products[productId]!.price = v;
    this.bump();
    return ok(v);
  }

  setAuto(shopId: number, productId: string, on: boolean): Result {
    const ps = this.shop(shopId)?.products[productId];
    if (!ps) return fail('Produit inconnu');
    ps.auto = on;
    this.bump();
    return ok(undefined);
  }

  setHours(shopId: number, open: number, close: number): Result {
    const s = this.shop(shopId);
    if (!s) return fail('Commerce introuvable');
    if (!(Number.isInteger(open) && Number.isInteger(close) && open >= 5 && close <= 23 && close - open >= 4)) return fail('Horaires : de 5 h à 23 h, au moins 4 h d’ouverture');
    s.open = open; s.close = close;
    this.bump();
    return ok(undefined);
  }

  /** Prix d'une commande (remise de gros au-delà de ECONOMY.bulkQty unités). */
  orderCost(productId: string, qty: number): number {
    const pr = PRODUCT_BY_ID.get(productId)!;
    return r2(qty * pr.cost * (qty >= ECONOMY.bulkQty ? 1 - ECONOMY.bulkDiscount : 1));
  }

  /** Place libre pour une commande (capacité − stock − commandes en cours). */
  room(shop: Shop, productId: string): number {
    const pr = PRODUCT_BY_ID.get(productId)!;
    return Math.max(0, this.storageFor(shop, pr) - shop.products[productId]!.stock - this.pendingQty(shop.id, productId));
  }

  order(shopId: number, productId: string, qty: number): Result<Order> {
    const s = this.shop(shopId), pr = PRODUCT_BY_ID.get(productId);
    if (!s || !pr || !s.products[productId]) return fail('Produit inconnu');
    const n = Math.floor(qty);
    if (!(n > 0)) return fail('Quantité invalide');
    const room = this.room(s, productId);
    if (room <= 0) return fail(`Plus de place pour ${pr.nameFr.toLowerCase()} : ajoutez un meuble « ${pr.store} »`);
    const q = Math.min(n, room);
    const cost = this.orderCost(productId, q);
    if (this.cash < cost) return fail(`Trésorerie insuffisante (${cost} CHF)`);
    this.cash -= cost;
    s.today.purchases += cost; this.today.purchases += cost;
    const o: Order = { id: this.nextId++, shopId, productId, qty: q, cost, deliverAt: this.nextDelivery() };
    this.orders.push(o);
    this.bump();
    return ok(o);
  }

  hire(candidateId: number, shopId: number): Result<Employee> {
    const c = this.candidates.find((x) => x.id === candidateId);
    if (!c) return fail('Candidat introuvable');
    if (!this.shop(shopId)) return fail('Commerce introuvable');
    const e: Employee = { id: c.id, name: c.name, skill: c.skill, wage: c.wage, shopId, hiredDay: this.day };
    this.employees.push(e);
    this.candidates = this.candidates.filter((x) => x !== c);
    this.notify('ok', `${e.name} rejoint ${this.shop(shopId)!.name} (${e.wage} CHF / h).`);
    this.bump();
    return ok(e);
  }

  assign(employeeId: number, shopId: number | null): Result {
    const e = this.employees.find((x) => x.id === employeeId);
    if (!e) return fail('Employé introuvable');
    if (shopId !== null && !this.shop(shopId)) return fail('Commerce introuvable');
    e.shopId = shopId;
    this.bump();
    return ok(undefined);
  }

  fire(employeeId: number): Result<number> {
    const e = this.employees.find((x) => x.id === employeeId);
    if (!e) return fail('Employé introuvable');
    const pay = Math.round(e.wage * 8 * ECONOMY.severanceDays);
    this.cash -= pay;
    this.today.wages += pay;
    this.employees = this.employees.filter((x) => x !== e);
    this.notify('info', `${e.name} quitte l'entreprise (indemnité ${pay} CHF).`);
    this.bump();
    return ok(pay);
  }

  /* ------------------------------ Simulation ------------------------------ */

  get day(): number { return Math.floor(this.total / MINUTES_PER_DAY); }

  /** Avance de `minutes` minutes de jeu (minute par minute). */
  advance(minutes: number): void {
    for (let k = 0; k < minutes; k++) this.minute();
  }

  private minute(): void {
    this.total++;
    const c = clockView(this.total);
    if (c.minute === 0) this.hour(c.hour, c.weekday);
    for (const s of this.shops) {
      if (s.rate <= 0) continue;
      const n = this.rng.poisson(s.rate / 60);
      for (let k = 0; k < n; k++) this.customer(s);
    }
    if (c.hour === 0 && c.minute === 0) this.newDay(c.weekday);
  }

  private hour(h: number, weekday: number): void {
    // Livraisons du grossiste.
    const due = this.orders.filter((o) => o.deliverAt <= this.total);
    if (due.length) {
      this.orders = this.orders.filter((o) => o.deliverAt > this.total);
      for (const o of due) { const s = this.shop(o.shopId); if (s) s.products[o.productId]!.stock += o.qty; }
      this.notify('info', `Livraison reçue : ${due.length} commande(s).`);
    }
    if (h === 21) this.autoReorder();
    for (const s of this.shops) {
      // Réputation : clients servis face aux clients perdus pendant l'heure écoulée.
      this.updateReputation(s);
      s.servedThisHour = 0;
      const open = h >= s.open && h < s.close;
      const staff = this.staffOf(s.id);
      if (!open) { s.rate = 0; s.capacity = 0; continue; }
      for (const e of staff) { s.today.wages += e.wage; this.today.wages += e.wage; this.cash -= e.wage; }
      const st = this.stats(s);
      const t = SHOP_TYPE_BY_ID.get(s.type)!;
      const p = this.premise(s.premiseId)!;
      const att = this.attractiveness(s, st);
      const weekend = weekday >= 5 ? t.weekend : 1;
      s.rate = p.footfall * t.hourly[h]! * weekend * t.capture * att;
      // Capacité : une caisse tenue par employé ; compétence moyenne des employés au travail.
      const tended = Math.min(st.registers, staff.length);
      const skill = tended ? staff.map((e) => e.skill).sort((a, b) => b - a).slice(0, tended).reduce((a, b) => a + b, 0) : 0;
      s.capacity = ECONOMY.servePerRegister * skill;
      if (staff.length === 0 && s.rate > 0) this.warnOnce(s, '__staff', `${s.name} est ouvert mais personne n'y travaille : embauchez (onglet Employés).`);
      else if (st.registers === 0 && s.rate > 0) this.warnOnce(s, '__caisse', `${s.name} n'a pas de caisse : aucun client ne peut payer (onglet Aménagement).`);
    }
    this.bump();
  }

  /** Attrait du commerce (1 ≈ commerce moyen du quartier). */
  attractiveness(s: Shop, st = this.stats(s)): number {
    let shareAvail = 0, priceAcc = 0;
    for (const pr of productsOf(s.type)) {
      if (!this.sellable(s, pr, st)) continue;
      const ps = s.products[pr.id]!;
      shareAvail += pr.share;
      priceAcc += pr.share * Math.min(1.8, Math.max(0.05, Math.exp(-2.2 * (ps.price / pr.basePrice - 1))));
    }
    if (shareAvail <= 0) return 0;
    const price = priceAcc / shareAvail;
    const variety = 0.3 + 0.7 * shareAvail;
    const decor = 0.85 + 0.25 * Math.min(1, st.decor) + (s.type === 'cafe' ? 0.3 * Math.min(1, st.seats / 16) - 0.1 : 0);
    const rep = 0.5 + s.reputation;
    const comp = 1 / (1 + 0.6 * this.competition(this.premise(s.premiseId)!, s.type));
    return price * variety * decor * rep * comp;
  }

  private sellable(s: Shop, pr: ProductDef, st: LayoutStats): boolean {
    return s.products[pr.id]!.stock > 0 && st.capacity[pr.store] > 0 && (!pr.needsMachine || st.machines > 0);
  }

  private customer(s: Shop): void {
    const st = this.stats(s);
    const t = SHOP_TYPE_BY_ID.get(s.type)!;
    if (st.registers === 0 || this.staffOf(s.id).length === 0) { s.today.lostStaff++; this.today.lostStaff++; return; }
    if (s.servedThisHour >= s.capacity) { s.today.lostCapacity++; this.today.lostCapacity++; return; }
    const avail = productsOf(s.type).filter((pr) => this.sellable(s, pr, st));
    if (!avail.length) { s.today.lostStock++; this.today.lostStock++; return; }
    const items = Math.max(1, this.rng.poisson(t.basket - 1) + 1);
    let bought = 0;
    for (let k = 0; k < items; k++) {
      // Produit voulu selon les parts de demande ; en rupture : le client renonce à cet article.
      let r = this.rng.next(), want = productsOf(s.type)[0]!;
      for (const pr of productsOf(s.type)) { r -= pr.share; if (r <= 0) { want = pr; break; } }
      const ps = s.products[want.id]!;
      if (!this.sellable(s, want, st)) {
        if (!s.warned.includes(want.id) && st.capacity[want.store] > 0 && ps.stock <= 0) this.warnOnce(s, want.id, `${s.name} : rupture de ${want.nameFr.toLowerCase()} (commandez dans l'onglet Stock).`);
        continue;
      }
      // Prix trop élevé : renonce parfois à l'article.
      if (this.rng.next() > Math.min(1, Math.exp(-2.2 * (ps.price / want.basePrice - 1)))) continue;
      ps.stock--;
      bought++;
      s.today.revenue += ps.price; this.today.revenue += ps.price; this.cash += ps.price;
      s.today.costOfSales += want.cost; this.today.costOfSales += want.cost;
    }
    if (bought === 0) { s.today.lostStock++; this.today.lostStock++; return; }
    s.servedThisHour++;
    s.today.customers++; this.today.customers++;
    if (this.events.length < 200) this.events.push({ shopId: s.id, premiseId: s.premiseId });
  }

  private updateReputation(s: Shop): void {
    const d = s.today;
    const served = d.customers, lost = d.lostStock + d.lostCapacity + d.lostStaff;
    if (served + lost < 3) return;
    const target = Math.min(1, Math.max(0, (served / (served + lost)) * 1.05 - 0.05));
    s.reputation += (target - s.reputation) * 0.04;
  }

  private autoReorder(): void {
    for (const s of this.shops) {
      for (const pr of productsOf(s.type)) {
        const ps = s.products[pr.id]!;
        if (!ps.auto) continue;
        const cap = this.storageFor(s, pr);
        if (cap <= 0 || ps.stock + this.pendingQty(s.id, pr.id) > cap * 0.5) continue;
        const q = this.room(s, pr.id);
        if (q > 0) { const r = this.order(s.id, pr.id, q); if (!r.ok) this.warnOnce(s, `__auto${pr.id}`, `${s.name} : réassort automatique de ${pr.nameFr.toLowerCase()} impossible (${r.message}).`); }
      }
    }
  }

  private newDay(weekday: number): void {
    // Loyers (au jour), clôture des bilans.
    for (const s of this.shops) {
      const p = this.premise(s.premiseId)!;
      const rent = r2(p.rent / 30);
      s.today.rent += rent; this.today.rent += rent; this.cash -= rent;
      s.history.push(s.today);
      if (s.history.length > 60) s.history.shift();
      s.today = emptyDay(this.day);
      s.warned = [];
    }
    const y = this.today;
    this.ledger.push(y);
    if (this.ledger.length > 120) this.ledger.shift();
    this.today = emptyDay(this.day);
    if (this.shops.length) {
      const profit = y.revenue - y.purchases - y.wages - y.rent - y.equipment;
      this.notify(profit >= 0 ? 'ok' : 'info', `Bilan du jour ${y.day + 1} : ${Math.round(y.revenue)} CHF de ventes, ${y.customers} clients, solde ${profit >= 0 ? '+' : ''}${Math.round(profit)} CHF.`);
    }
    if (this.cash < 0) this.notify('error', `Trésorerie négative (${Math.round(this.cash)} CHF) : réduisez les dépenses ou résiliez un bail.`);
    if (weekday === 0) this.refreshCandidates();
  }

  private refreshCandidates(): void {
    this.candidates = [];
    for (let k = 0; k < 6; k++) {
      const skill = r2(0.55 + this.rng.next() * 0.45);
      this.candidates.push({ id: this.nextId++, name: randomName(this.rng), skill, wage: Math.round(20 + skill * 14 + this.rng.next() * 3) });
    }
  }

  private nextDelivery(): number {
    const c = clockView(this.total);
    const base = c.day * MINUTES_PER_DAY + ECONOMY.deliveryHour * 60;
    return c.hour < ECONOMY.deliveryHour - 2 ? base : base + MINUTES_PER_DAY;
  }

  private warnOnce(s: Shop, key: string, text: string): void {
    if (s.warned.includes(key)) return;
    s.warned.push(key);
    this.notify('warn', text);
  }

  notify(level: Notice['level'], text: string): void {
    this.notices.push({ at: this.total, level, text });
    if (this.notices.length > 100) this.notices.shift();
  }

  private bump(): void { this.version++; }

  /* ------------------------------ Sauvegarde ------------------------------ */

  save(): GameSave {
    return {
      v: SAVE_VERSION, seed: this.seed, companyName: this.companyName, total: this.total, cash: this.cash,
      shops: structuredClone(this.shops), employees: structuredClone(this.employees), candidates: structuredClone(this.candidates),
      orders: structuredClone(this.orders), ledger: structuredClone([...this.ledger, this.today]), nextId: this.nextId, rng: this.rng.state(),
    };
  }

  private restore(s: GameSave): void {
    if (s.v !== SAVE_VERSION) throw new Error(`Sauvegarde de version ${s.v} non prise en charge`);
    this.companyName = s.companyName; this.total = s.total; this.cash = s.cash;
    this.shops = structuredClone(s.shops); this.employees = structuredClone(s.employees); this.candidates = structuredClone(s.candidates);
    this.orders = structuredClone(s.orders);
    const led = structuredClone(s.ledger);
    this.today = led.pop() ?? emptyDay(this.day);
    this.ledger = led;
    this.nextId = s.nextId;
    this.rng = new Rng(s.rng);
  }
}
