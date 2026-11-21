/**
 * Vues des lieux du quartier : grossiste, magasin de meubles, banque, agence pour l'emploi, garage, agence de
 * publicité, snack, local à louer, commerce concurrent, logement. Chaque achat passe par la partie, qui vérifie
 * que le personnage est bien sur place.
 */
import {
  CAMPAIGNS, CONTRACTS, ECONOMY, FOODS, TRAINING, FURNITURE, HOME_BY_ID, LOAN_OFFERS, PRODUCTS, SERVICE_BY_ID, SHOP_TYPES, SHOP_TYPE_BY_ID,
  VEHICLES, VEHICLE_BY_ID, loanTotal, type ServiceKind, type ShopType,
} from '../sim/catalog';
import { SHIFTS, SHIFT_BY_ID, STAFF, STAFF_ROLES, STAFF_ROLE_BY_ID, type ShiftKind, type StaffRole } from '../sim/catalog';
import { RIVALS } from '../sim/catalog';
import type { Building, Home, Premise } from '../sim/district';
import type { Game, Shop } from '../sim/game';
import { FURNITURE_FITS, HOME_MEAL, fitsType, isFestive, productsHosted, type FurnitureDef } from '../sim/catalog';
import { askConfirm, button, chf, chf2, el, num, pct, signed } from './dom';
import type { Act, Panel, View } from './panel';
import { LOGISTICS } from '../sim/catalog';
import { freeOf, importQuote, importUnit, palletOf, placeImport, warehouseName } from '../sim/logistics';
import { FINANCE, RESCUE, productsOf } from '../sim/catalog';
import { STOP_FR } from '../sim/game';
import { netWorth } from '../sim/objectives';

export interface UiCtx {
  game: Game;
  panel: Panel;
  act: Act;
  toast: (text: string, kind?: 'ok' | 'error' | 'info' | 'warn') => void;
  enterShop: (shopId: number) => void;
  openShop: (shopId: number) => void;
  waypoint: (x: number, z: number, label: string) => void;
  /** Appelé à la fermeture d'une vue de lieu (le personnage ressort). */
  leave: () => void;
}

const sec = (t: string): HTMLElement => el('div', { cls: 'sec', text: t });
const note = (t: string): HTMLElement => el('p', { cls: 'muted small', text: t });
const qtyInput = (v: number, max = 9999): HTMLInputElement => el('input', { cls: 'qty', attrs: { type: 'number', min: '1', max: String(max), value: String(v), step: '1', 'aria-label': 'Quantité' } });
function shopSelect(g: Game, pick?: (t: ShopType) => boolean): HTMLSelectElement {
  const s = el('select', { attrs: { 'aria-label': 'Commerce' } });
  for (const sh of g.shops) if (!pick || pick(sh.type)) s.append(el('option', { text: sh.name, attrs: { value: String(sh.id) } }));
  return s;
}
/** Sélection mémorisée d'un menu déroulant entre deux rafraîchissements. */
const memo = new Map<string, string>();
function remember<T extends HTMLSelectElement | HTMLInputElement>(key: string, e: T): T {
  const v = memo.get(key);
  if (v !== undefined && (e.tagName !== 'SELECT' || [...(e as HTMLSelectElement).options].some((o) => o.value === v))) e.value = v;
  e.addEventListener('change', () => memo.set(key, e.value));
  return e;
}

/**
 * Commerce visé par défaut : le dernier loué parmi ceux à qui il manque encore quelque chose pour ce service (meubles :
 * pas de caisse, un produit sans présentoir, un café sans machine ; emploi : personne en caisse), sinon le dernier loué.
 */
export function defaultShopId(g: Game, need: 'meubles' | 'emploi' | 'pub'): number | null {
  const last = [...g.shops].reverse();
  const lacks = (s: Shop): boolean => {
    if (need === 'emploi') return !g.staffOf(s.id).some((e) => g.roleOf(e) === 'caisse');
    if (need !== 'meubles') return false;
    const st = g.stats(s);
    return st.registers === 0 || productsOf(s.type).some((p) => st.capacity[p.store] <= 0 || (!!p.needsMachine && st.machines === 0));
  };
  return (last.find(lacks) ?? last[0])?.id ?? null;
}
/** Liste des commerces au moment d'un choix (un commerce loué ou rendu depuis : le choix par défaut reprend la main). */
const memoShops = new Map<string, string>();
/** Menu des commerces : choix du joueur gardé tant que la liste ne change pas, sinon le commerce par défaut (defaultShopId). */
function rememberShop(g: Game, key: string, need: 'meubles' | 'emploi' | 'pub'): HTMLSelectElement {
  const e = shopSelect(g), sig = g.shops.map((s) => s.id).join(','), v = memo.get(key), def = defaultShopId(g, need);
  if (v !== undefined && memoShops.get(key) === sig && [...e.options].some((o) => o.value === v)) e.value = v;
  else if (def !== null) e.value = String(def);
  e.addEventListener('change', () => { memo.set(key, e.value); memoShops.set(key, sig); });
  return e;
}

/**
 * « Décharger » dans un commerce : la marchandise portée et celle des véhicules garés devant. La place libre sert
 * d'abord ; si une commande en cours réserve le reste, le joueur choisit de ranger quand même (commande réduite
 * d'autant, remboursée au prorata) ou de garder la marchandise. `done` : après coup (rafraîchir l'affichage).
 */
export function unloadInto(ctx: UiCtx, shopId: number, done?: () => void): void {
  const g = ctx.game;
  let plan = g.unloadPlan(shopId);
  if (plan.now > 0 || plan.reducing <= 0) { ctx.act(g.unload(shopId, false)); plan = g.unloadPlan(shopId); }
  if (plan.reducing <= 0) { done?.(); return; }
  const lines = plan.lines.filter((l) => l.free > l.room && l.carried > l.room).map((l) => {
    const pr = PRODUCTS.find((p) => p.id === l.productId)!, o = g.orders.filter((x) => x.shopId === shopId && x.productId === l.productId).sort((a, b) => a.deliverAt - b.deliverAt)[0];
    return `${l.pending} ${pr.nameFr.toLowerCase()} commandés (livraison prévue ${o ? g.deliveryLabel(o.deliverAt) : 'bientôt'})`;
  });
  void askConfirm(`Place réservée par une livraison en cours : ${lines.join(', ')}. Ranger quand même ${plan.reducing} unité${plan.reducing > 1 ? 's' : ''} maintenant ? La commande sera réduite d’autant, remboursée au prorata (environ ${chf(plan.refund)}).`, 'Ranger quand même')
    .then((y) => { if (y) ctx.act(g.unload(shopId, true)); done?.(); });
}

export function serviceView(ctx: UiCtx, b: Building): View {
  const kind = b.service as ServiceKind;
  const def = SERVICE_BY_ID.get(kind)!;
  const render = { grossiste, meubles, banque, emploi, garage, pub, snack }[kind];
  return { kicker: def.nameFr, title: def.sign, render: () => [note(def.hint), ...render(ctx, b)], onClose: () => ctx.leave(), wide: kind === 'grossiste' || kind === 'meubles' };
}

/* ------------------------------ Grossiste ------------------------------ */

function grossiste(ctx: UiCtx, b: Building): (Node | null)[] {
  const g = ctx.game;
  const near = g.vehiclesNear(b.doorX, b.doorZ);
  const carrier = remember('carrier', el('select', { attrs: { 'aria-label': 'Transport' } },
    el('option', { text: `À pied (${g.freeLoad('pied')} / ${ECONOMY.carryOnFoot} places libres)`, attrs: { value: 'pied' } }),
    ...near.map((v) => el('option', { text: `${VEHICLE_BY_ID.get(v.type)!.nameFr} (${g.freeLoad(v.id)} / ${g.capacityOf(v.id)} places libres)`, attrs: { value: String(v.id) } }))));
  if (near.length && !memo.has('carrier')) carrier.value = String(near[0]!.id);
  const dest = g.shops.length ? remember('dest', shopSelect(g)) : null;
  const types = new Set(g.shops.map((s) => s.type));
  const order = [...SHOP_TYPES].sort((a, c) => Number(types.has(c.id)) - Number(types.has(a.id)));
  const out: (Node | null)[] = [
    el('div', { cls: 'row' }, el('label', { cls: 'field grow' }, el('span', { text: 'Emporter avec' }), carrier),
      dest ? el('label', { cls: 'field grow' }, el('span', { text: `Ou livrer (${g.deliveryLabel()}) à` }), dest) : null),
    near.length ? null : note(`Pour charger beaucoup : garez un véhicule à moins de ${ECONOMY.loadDistance} m de la porte.`),
    note(`Remise de ${pct(ECONOMY.bulkDiscount)} dès ${ECONOMY.bulkQty} unités. Livraison : ${ECONOMY.deliveryBase} CHF + ${pct(ECONOMY.deliveryRate)} du montant.`),
    ...contractBlock(ctx),
  ];
  for (const t of order) {
    out.push(sec(t.nameFr));
    const tbl = el('table', { cls: 'tbl' }, el('tr', {}, el('th', { text: 'Produit' }), el('th', { text: 'Prix' }), el('th', { text: 'Qté' }), el('th', { text: '' })));
    for (const p of PRODUCTS.filter((x) => x.shop === t.id)) {
      const q = remember(`q-${p.id}`, qtyInput(20));
      const take = button('Emporter', () => {
        const c = carrier.value === 'pied' ? 'pied' : Number(carrier.value);
        ctx.act(g.buyStock(p.id, Number(q.value), c), (n) => `${n} ${p.nameFr.toLowerCase()} chargés.`);
      }, 'small primary');
      const deliver = dest ? button('Livrer', () => ctx.act(g.order(Number(dest.value), p.id, Number(q.value)), (o) => `${o.qty} ${p.nameFr.toLowerCase()} livrés ${g.deliveryLabel(o.deliverAt)} (${chf2(o.cost)}).`), 'small') : null;
      tbl.append(el('tr', {}, el('td', { text: p.nameFr }), el('td', {}, el('b', { text: chf2(g.orderCost(p.id, 1)) }), el('span', { cls: g.marketIndex(p.id) > 1.02 ? 'small trend up' : g.marketIndex(p.id) < 0.98 ? 'small trend down' : 'small trend', text: g.marketIndex(p.id) > 1.02 ? ` ▲ ${Math.round((g.marketIndex(p.id) - 1) * 100)} %` : g.marketIndex(p.id) < 0.98 ? ` ▼ ${Math.round((1 - g.marketIndex(p.id)) * 100)} %` : ' =' })), el('td', {}, q), el('td', { cls: 'nowrap' }, take, deliver)));
    }
    out.push(tbl);
  }
  const loads = [{ label: 'Porté à pied', load: g.player.carry }, ...g.vehicles.map((v) => ({ label: VEHICLE_BY_ID.get(v.type)!.nameFr, load: v.cargo }))].filter((l) => Object.keys(l.load).length);
  if (loads.length) {
    out.push(sec('Marchandise transportée'));
    for (const l of loads) out.push(el('p', { cls: 'small', text: `${l.label} : ${Object.entries(l.load).map(([k, n]) => `${n} ${PRODUCTS.find((p) => p.id === k)!.nameFr.toLowerCase()}`).join(', ')}` }));
    out.push(note('Entrez dans votre commerce (véhicule garé devant) pour décharger.'));
  }
  return out;
}

/** Contrats fournisseurs : forfait quotidien contre une remise sur tous les achats (comparée aux achats récents). */
function contractBlock(ctx: UiCtx): (Node | null)[] {
  const g = ctx.game, cur = g.contractDef();
  const recent = g.ledger.slice(-7);
  const avgBuy = recent.length ? recent.reduce((a, d) => a + d.purchases - (cur && d.purchases >= cur.perDay ? cur.perDay : 0), 0) / recent.length : 0;
  const out: (Node | null)[] = [sec('Contrat fournisseur')];
  for (const c of CONTRACTS) {
    const on = cur?.id === c.id;
    // Gain estimé : remise sur les achats moyens des 7 derniers jours, moins le forfait.
    const gain = avgBuy * c.discount - c.perDay;
    out.push(el('div', { cls: 'item' }, el('div', {}, el('b', { text: `${c.nameFr}${on ? ' (en cours)' : ''}` }),
      el('div', { cls: 'muted small', text: `${c.desc} ${c.perDay} CHF / jour.${recent.length ? ` Avec vos achats récents (${chf(avgBuy)} / jour) : ${signed(gain)} / jour.` : ''}` })),
      on ? button('Résilier', () => ctx.act(g.signContract(null), 'Contrat résilié.'), 'small danger')
        : button('Signer', () => ctx.act(g.signContract(c.id), (d) => `${c.nameFr} signé (${chf(d)} pour aujourd’hui).`), 'small primary')));
  }
  out.push(note('Le forfait est payé chaque jour à minuit (le premier jour à la signature). Rentable quand vous achetez beaucoup : plusieurs commerces.'));
  return out;
}

/* ------------------------------ Meubles ------------------------------ */

let meubleTab = 'utiles';
function meubles(ctx: UiCtx): (Node | null)[] {
  const g = ctx.game;
  if (!g.shops.length) return [note('Louez d’abord un local : les meubles sont livrés dans sa réserve.')];
  // Par défaut : le commerce qu'il reste à meubler (le dernier loué en premier), pas le premier de la liste.
  const dest = rememberShop(g, 'mdest', 'meubles');
  const out: (Node | null)[] = [el('label', { cls: 'field' }, el('span', { text: `Livrer dans la réserve de (livraison ${ECONOMY.furnitureDelivery} CHF par achat)` }), dest)];
  const shop = g.shop(Number(dest.value));
  /** Utile dans le commerce choisi : caisse, présentoir qui accueille ses produits, machine du café, sièges, décoration générale ou de son thème. */
  const useful = (f: FurnitureDef): boolean => {
    if (!shop) return !isFestive(f);
    if (f.kind === 'caisse') return true;
    if (f.kind === 'deco') return !isFestive(f) && fitsType(f, shop.type);
    if (f.kind === 'machine') return shop.type === 'cafe';
    if (f.kind === 'table') return shop.type === 'cafe' || shop.type === 'fastfood' || shop.type === 'boulangerie';
    return productsHosted(f, shop.type).length > 0;
  };
  // Catégories : « Utiles » (adaptés au commerce choisi), présentoirs, caisses et machines, tables, décoration, fêtes.
  const cats: [string, string, (f: FurnitureDef) => boolean][] = [
    ['utiles', 'Utiles ici', (f) => useful(f)],
    ['presentoirs', 'Présentoirs', (f) => ['rayon', 'frigo', 'comptoir', 'vitrine', 'portant'].includes(f.kind)],
    ['caisses', 'Caisses et machines', (f) => f.kind === 'caisse' || f.kind === 'machine'],
    ['tables', 'Tables et sièges', (f) => f.kind === 'table'],
    ['deco', 'Décoration', (f) => f.kind === 'deco' && !isFestive(f)],
    ['fetes', 'Fêtes', (f) => isFestive(f)],
  ];
  const cat = cats.find((c) => c[0] === meubleTab) ?? cats[0]!;
  out.push(el('div', { cls: 'tabs' }, ...cats.map(([id, label, pick]) => button(`${label} (${FURNITURE.filter(pick).length})`, () => { meubleTab = id; ctx.panel.paint(true); }, id === cat[0] ? 'on' : ''))));
  const tbl = el('table', { cls: 'tbl' }, el('tr', {}, el('th', { text: 'Meuble' }), el('th', { text: 'Taille' }), el('th', { text: 'Prix' }), el('th', { text: 'Qté' }), el('th', { text: '' })));
  for (const f of FURNITURE.filter(cat[2]).sort((a, b) => Number(useful(b)) - Number(useful(a)))) {
    const q = qtyInput(1, 20);
    tbl.append(el('tr', { cls: useful(f) ? '' : 'dim' },
      el('td', {}, el('b', { text: f.nameFr }), el('div', { cls: 'muted small', text: furnitureDetail(f, shop) })),
      el('td', { text: `${f.w}×${f.d} m` }), el('td', { text: chf(f.price) }), el('td', {}, q),
      // Un seul message : celui de la partie (quoi, où, combien, « à poser avec Aménager »).
      el('td', {}, button('Acheter', () => ctx.act(g.buyFurniture(f.id, Number(q.value), Number(dest.value))), 'small primary'))));
  }
  if (cat[0] === 'fetes') out.push(note('Décorations de fin d’année : elles décorent comme les autres, mais sortent du thème le reste de l’année.'));
  if (cat[0] === 'utiles' && shop) out.push(note(`« Utiles ici » : ce qui sert à ${shop.name} (présentoirs de ses produits, caisse, décoration de son style). Le reste est dans les autres onglets.`));
  out.push(tbl);
  if (shop && Object.keys(shop.storage).length) out.push(note(`Réserve de ${shop.name} : ${Object.entries(shop.storage).map(([k, n]) => `${n} × ${FURNITURE.find((f) => f.id === k)!.nameFr}`).join(', ')}.`));
  return out;
}

/**
 * Détail d'un meuble pour le commerce choisi : places et produits qu'il accueille (« accueille : pain, viennoiseries »),
 * produits qui ont besoin de la machine, places assises, points de décoration et thème.
 */
function furnitureDetail(f: FurnitureDef, shop: Shop | undefined): string {
  const hosts = shop ? productsHosted(f, shop.type) : [], names = hosts.map((p) => p.nameFr.toLowerCase()).join(', ');
  if (f.capacity) {
    const what = !shop ? '' : hosts.length ? ` · accueille : ${names}${hosts.length > 1 ? ` (${Math.floor(f.capacity / hosts.length)} chacun)` : ''}` : ` · n’accueille aucun produit de ${shop.name}`;
    return `${f.capacity} articles${what}`;
  }
  if (f.kind === 'machine') return hosts.length ? `indispensable pour : ${names}` : 'café, thé (pour un café)';
  if (f.seats) return `${f.seats} places`;
  if (f.kind === 'caisse') return 'encaisser les clients (une par caissier)';
  if (f.decor) {
    const fits = FURNITURE_FITS[f.id];
    return `déco +${f.decor}${isFestive(f) ? ' · fêtes de fin d’année' : fits && shop && !fits.includes(shop.type) ? ' · hors du style de ce commerce' : ''}`;
  }
  return '';
}

/* ------------------------------ Banque ------------------------------ */

function banque(ctx: UiCtx): (Node | null)[] {
  const g = ctx.game;
  const out: (Node | null)[] = [el('div', { cls: 'kpis' }, kpi('Trésorerie', chf(g.cash)), kpi('Dette', chf(g.debt)), kpi('Plafond', chf(g.creditLimit().limit)))];
  if (g.inDifficulty()) out.push(el('div', { cls: 'item rd-item' }, el('div', {}, el('b', { text: 'Entreprise en difficulté' }), el('div', { cls: 'muted small', text: 'Diagnostic, licenciements, résiliations et prêt d’urgence (hors plafond).' })),
    button('Plan de redressement', () => ctx.panel.open(rescueView(ctx)), 'small primary')));
  out.push(sec('Prêts proposés'));
  LOAN_OFFERS.forEach((o, k) => {
    const total = loanTotal(o);
    out.push(el('div', { cls: 'item' }, el('div', {}, el('b', { text: chf(o.amount) }), el('div', { cls: 'muted small', text: `${o.days} jours · taux ${pct(o.rate)} par an · ${chf2(total / o.days)} par jour · total ${chf(total)}` })),
      button('Emprunter', () => {
        // Au-delà du plafond, la banque refuse tout de suite (son message) ; sinon, le joueur confirme l'engagement.
        if (g.debt + total > g.creditLimit().limit) { ctx.act(g.takeLoan(k)); return; }
        void askConfirm(`Emprunter ${chf(o.amount)} ? La banque prélèvera ${chf2(total / o.days)} chaque nuit pendant ${o.days} jours : ${chf(total)} au total, dont ${chf(total - o.amount)} d’intérêts.`, 'Emprunter')
          .then((y) => { if (y) ctx.act(g.takeLoan(k)); });
      }, 'small primary')));
  });
  if (g.loans.length) {
    out.push(sec('Vos prêts'));
    for (const l of g.loans) out.push(el('div', { cls: 'item' }, el('div', {}, el('b', { text: `${chf(l.amount)} emprunté` }), el('div', { cls: 'muted small', text: `reste ${chf(l.remaining)} · ${chf2(l.daily)} par jour · ${l.daysLeft} jours` })),
      button(`Solder (${chf(g.repayAmount(l))})`, () => ctx.act(g.repayLoan(l.id), (d) => `Prêt soldé : ${chf(d)}.`), 'small')));
  }
  return out;
}

/* ------------------------------ Emploi ------------------------------ */

function emploi(ctx: UiCtx): (Node | null)[] {
  const g = ctx.game;
  const out: (Node | null)[] = [];
  if (!g.shops.length) out.push(note('Louez d’abord un local pour pouvoir embaucher.'));
  out.push(sec('Candidats de la semaine'));
  for (const c of g.candidates) {
    // Par défaut : le commerce sans caissier (le dernier loué en premier), pas le premier de la liste.
    const s = g.shops.length ? rememberShop(g, `hire-${c.id}`, 'emploi') : null;
    const want = c.wantShift ?? 'journee';
    const role = remember(`hire-role-${c.id}`, roleSelect('caisse'));
    // Équipe proposée : celle que souhaite le candidat, sauf pour un premier caissier (la journée complète évite un
    // commerce sans personne en caisse).
    const hasCashier = g.employees.some((e) => e.shopId !== null && g.roleOf(e) === 'caisse');
    const shift = remember(`hire-shift-${c.id}`, shiftSelect(hasCashier ? want : 'journee', want));
    const wish = `Souhaite : ${SHIFT_LABEL[want].toLowerCase()}, au moins ${c.minWage ?? c.wage} CHF / h`;
    out.push(el('div', { cls: 'item col' }, el('div', {}, el('b', { text: c.name }),
      el('div', { cls: 'muted small', text: `compétence ${pct(c.skill)} (${num(c.skill * ECONOMY.servePerRegister)} clients / h en caisse) · demande ${c.wage} CHF / h` }),
      el('div', { cls: 'small emp-wish', text: wish })),
      s ? el('div', { cls: 'row tight emp-wrap' }, s, role, shift, button('Embaucher', () => ctx.act(g.hire(c.id, Number(s.value), { role: role.value as StaffRole, shift: shift.value as ShiftKind })), 'small primary')) : null));
  }
  out.push(note(`Caisse : encaisse les clients (un caissier par caisse : sans caisse libre, le caissier en trop ne sert presque à rien). Rayon : conseille et présente, +${pct(STAFF.shelfBonus)} de clients par employé présent (selon compétence, jusqu’à +${pct(STAFF.shelfBonusMax)}). Entretien : garde le commerce propre. Équipes : matin (avant 14 h), soir (dès 14 h), journée complète, ou pointe (16 h – 20 h : un renfort de 4 h pour l’affluence du soir, avec une deuxième caisse) ; le salaire est payé à l’heure travaillée. Une équipe non souhaitée ou un salaire sous le minimum fait baisser la satisfaction.`));
  if (!g.candidates.length) out.push(note('Plus de candidats cette semaine : nouveaux candidats lundi.'));
  if (g.employees.length) {
    out.push(sec('Vos employés'));
    for (const e of g.employees) out.push(employeeRow(ctx, e.id));
  }
  return out;
}

const SHIFT_LABEL: Record<ShiftKind, string> = { journee: 'Journée complète', matin: 'Matin (avant 14 h)', soir: 'Soir (dès 14 h)', pointe: 'Pointe (16 h – 20 h)' };
/** Menu des rôles (caisse, rayon, entretien). */
function roleSelect(value: StaffRole): HTMLSelectElement {
  const s = el('select', { attrs: { 'aria-label': 'Rôle' } }, ...STAFF_ROLES.map((r) => el('option', { text: r.nameFr, attrs: { value: r.id, title: r.desc } })));
  s.value = value;
  return s;
}
/** Menu des équipes ; l'équipe souhaitée par le salarié est signalée. */
function shiftSelect(value: ShiftKind, want?: ShiftKind): HTMLSelectElement {
  const s = el('select', { attrs: { 'aria-label': 'Équipe' } }, ...SHIFTS.map((x) => el('option', { text: `${SHIFT_LABEL[x.id]}${x.id === want ? ' ★ souhaitée' : ''}`, attrs: { value: x.id } })));
  s.value = value;
  return s;
}

export function employeeRow(ctx: UiCtx, id: number): HTMLElement {
  const g = ctx.game, e = g.employees.find((x) => x.id === id)!;
  const role = roleSelect(g.roleOf(e)), shift = shiftSelect(g.shiftOf(e), e.wantShift);
  role.addEventListener('change', () => ctx.act(g.setRole(e.id, role.value as StaffRole)));
  shift.addEventListener('change', () => ctx.act(g.setShift(e.id, shift.value as ShiftKind)));
  const hours = g.hoursPerDay(e), wishes = g.unmetWishes(e);
  const work = e.shopId === null ? 'sans affectation' : hours ? `${hours} h / jour (${chf(hours * e.wage)})` : 'ne travaille jamais avec ces horaires';
  const s = el('select', { attrs: { 'aria-label': 'Affectation' } }, el('option', { text: 'Sans affectation', attrs: { value: '' } }), ...g.shops.map((sh) => el('option', { text: sh.name, attrs: { value: String(sh.id) } })));
  s.value = e.shopId === null ? '' : String(e.shopId);
  s.addEventListener('change', () => ctx.act(g.assign(e.id, s.value ? Number(s.value) : null)));
  const mood = e.mood ?? 0.75, lv = e.training ?? 0, mw = g.marketWage(e.skill, lv);
  const face = mood > 0.7 ? '😊' : mood > 0.4 ? '😐' : '😠';
  const next = g.nextTrainingCost(e);
  const train = next === null ? null : button(`Former (${chf(next)})`, () => ctx.act(g.train(e.id), () => `${e.name} : formation niveau ${lv + 1} terminée.`), 'small');
  if (train) train.title = `Niveau ${lv + 1} / ${TRAINING.maxLevel} : +${pct(TRAINING.capacity)} de clients servis en caisse, salaire du marché +${TRAINING.wage} CHF / h.`;
  return el('div', { cls: 'item col' }, el('div', {}, el('b', { text: `${face} ${e.name} · ${STAFF_ROLE_BY_ID.get(g.roleOf(e))!.nameFr} · ${SHIFT_BY_ID.get(g.shiftOf(e))!.nameFr}` }),
    el('div', { cls: 'muted small', text: `compétence ${pct(e.skill)} · formation ${lv} / ${TRAINING.maxLevel} · ${g.roleOf(e) === 'caisse' ? `${num(g.serviceSkill(e) * ECONOMY.servePerRegister)} clients / h · ` : ''}${e.wage} CHF / h (marché ${mw}) · satisfaction ${pct(mood)}${e.askedRaise ? ' · demande une augmentation' : ''}` }),
    el('div', { cls: `small ${hours ? 'muted' : 'warn'}`, text: `Travaille ${work}` }),
    wishes.length ? el('div', { cls: 'small warn', text: `Mécontent : ${wishes.join(', ')}` }) : null),
    el('div', { cls: 'row tight emp-wrap' }, s, role, shift,
      button(`+2 CHF/h`, () => ctx.act(g.raiseWage(e.id, e.wage + 2)), e.askedRaise ? 'small primary' : 'small'),
      train,
      button('Licencier', () => ctx.act(g.fire(e.id), (p) => `Indemnité versée : ${chf(p)}.`), 'small danger')));
}

/* ------------------------------ Garage ------------------------------ */

function garage(ctx: UiCtx): (Node | null)[] {
  const g = ctx.game;
  const out: (Node | null)[] = [sec('À vendre')];
  for (const v of VEHICLES) out.push(el('div', { cls: 'item' }, el('div', {}, el('b', { text: v.nameFr }), el('div', { cls: 'muted small', text: `${v.cargo} unités de marchandise · ${Math.round(v.speed * 3.6)} km/h · assurance ${v.insurance} CHF / jour` })),
    button(`Acheter ${chf(v.price)}`, () => ctx.act(g.buyVehicle(v.id)), 'small primary')));
  if (g.vehicles.length) {
    out.push(sec('Vos véhicules'));
    for (const v of g.vehicles) {
      const d = VEHICLE_BY_ID.get(v.type)!;
      out.push(el('div', { cls: 'item' }, el('div', {}, el('b', { text: d.nameFr }), el('div', { cls: 'muted small', text: `cargaison ${Object.values(v.cargo).reduce((a, b) => a + b, 0)} / ${d.cargo}` })),
        button(`Revendre ${chf(d.price * ECONOMY.vehicleResale)}`, () => ctx.act(g.sellVehicle(v.id)), 'small')));
    }
  }
  out.push(note('Approchez-vous d’un véhicule et appuyez sur E pour le conduire (Z/Q/S/D ou flèches, Espace pour freiner).'));
  return out;
}

/* ------------------------------ Publicité ------------------------------ */

function pub(ctx: UiCtx): (Node | null)[] {
  const g = ctx.game;
  const out: (Node | null)[] = [];
  if (!g.shops.length) return [note('Louez d’abord un local.')];
  for (const c of CAMPAIGNS) {
    const s = c.scope === 'shop' ? rememberShop(g, `pub-${c.id}`, 'pub') : null;
    const days = remember(`pubd-${c.id}`, el('select', { attrs: { 'aria-label': 'Durée' } }, ...[3, 7, 14].map((d) => el('option', { text: `${d} jours (${chf(d * c.perDay)})`, attrs: { value: String(d) } }))));
    out.push(el('div', { cls: 'item col' }, el('div', {}, el('b', { text: c.nameFr }), el('div', { cls: 'muted small', text: `${c.desc} ${c.perDay} CHF / jour.` })),
      el('div', { cls: 'row tight' }, s, days, button('Lancer', () => ctx.act(g.startCampaign(c.id, s ? Number(s.value) : null, Number(days.value))), 'small primary'))));
  }
  if (g.campaigns.length) {
    out.push(sec('Campagnes en cours'));
    for (const c of g.campaigns) out.push(el('p', { cls: 'small', text: `${CAMPAIGNS.find((x) => x.id === c.kind)!.nameFr} · ${c.shopId ? g.shop(c.shopId)?.name : 'tous les commerces'} · encore ${c.daysLeft} j` }));
  }
  return out;
}

/* ------------------------------ Snack ------------------------------ */

function snack(ctx: UiCtx): (Node | null)[] {
  const g = ctx.game;
  return [el('div', { cls: 'kpis' }, kpi('Faim', `${Math.round(g.player.hunger)} %`), kpi('Énergie', `${Math.round(g.player.energy)} %`), kpi('Argent', chf(g.cash))),
    ...FOODS.map((f) => el('div', { cls: 'item' }, el('div', {}, el('b', { text: f.nameFr }), el('div', { cls: 'muted small', text: `${f.hunger ? `faim +${f.hunger}` : ''}${f.hunger && f.energy ? ' · ' : ''}${f.energy ? `énergie +${f.energy}` : ''}` })),
      button(`${chf(f.price)}`, () => ctx.act(g.eat(f.id), 'Miam !'), 'small primary'))),
    g.hasKitchen() ? note(`Moins cher chez vous : « Manger (cuisine) » dans votre logement, ${chf(HOME_MEAL.price)} de courses, faim +${HOME_MEAL.hunger} (${HOME_MEAL.minutes} minutes).`) : null];
}

/* ------------------------------ Local, concurrent, logement ------------------------------ */

export function premiseView(ctx: UiCtx, p: Premise): View {
  const g = ctx.game;
  return {
    kicker: 'Local commercial à louer', title: `${p.area} m² · ${chf(p.rent)} / mois`, onClose: () => ctx.leave(),
    render: () => {
      // Potentiel par type : bénéfice estimé par jour (le plus rentable en tête et proposé par défaut).
      const est = SHOP_TYPES.map((t) => ({ t, e: g.estimateProfit(p, t.id) })).sort((a, b) => b.e.profit - a.e.profit);
      const type = remember('rtype', el('select', { attrs: { 'aria-label': 'Type de commerce' } }, ...SHOP_TYPES.map((t) => el('option', { text: t.nameFr, attrs: { value: t.id } }))));
      if (!memo.has('rtype')) type.value = est[0]!.t.id;
      const name = el('input', { attrs: { type: 'text', maxlength: '32', placeholder: 'Nom (facultatif)', 'aria-label': 'Nom du commerce' } });
      const rows = est.map(({ t, e }, k) => el('tr', { cls: k === 0 ? 'rd-best' : '' },
        el('td', {}, el('b', { text: t.nameFr }), k === 0 ? el('span', { cls: 'rd-tag', text: 'conseillé' }) : null),
        el('td', { cls: 'n', text: num(e.customers) }),
        el('td', { cls: `n ${e.profit >= 0 ? 'ok' : 'bad'}`, text: signed(e.profit), attrs: { title: `Ventes ${chf(e.revenue)}, marge ${chf(e.margin)}, ${e.cashiers} caissier(s) ${chf(e.wages)}, loyer ${chf(e.rent)}, livraisons et nettoyage ${chf(e.other)}` } }),
        el('td', { cls: 'n', text: String(g.competition(p, t.id)) })));
      return [
        el('div', { cls: 'kpis' }, kpi('Passage (pointe)', `${num(p.footfall)} / h`), kpi('Loyer', `${chf(p.rent)} / mois`), kpi('Grille', `${p.gridW} × ${p.gridD} m`)),
        sec('Potentiel par type de commerce'),
        el('table', { cls: 'tbl' }, el('tr', {}, el('th', { text: 'Type' }), el('th', { cls: 'n', text: 'Clients / jour' }), el('th', { cls: 'n', text: 'Bénéfice / jour' }), el('th', { cls: 'n', text: 'Concurrence' })), ...rows),
        note('Estimation pour un commerce bien tenu en gamme standard : prix du quartier, caissiers selon l’affluence, loyer, livraisons et nettoyage de nuit compris (hors meubles, impôt et vie courante). La concurrence pèse plus quand elle est proche.'),
        sec('Louer'),
        el('div', { cls: 'row' }, type, name),
        button(`Signer le bail (dépôt ${chf(p.rent * ECONOMY.depositMonths)})`, () => {
          const r = g.rent(p.id, type.value as ShopType, name.value);
          if (ctx.act(r) && r.ok) ctx.enterShop(r.data.id);
        }, 'primary wide'),
        sec('Ou louer pour sous-louer'),
        note(`Vous payez ${chf2(g.marketRent('local', p.id))} / jour et relouez le local à une entreprise (cabinet, agence, atelier…). Plus le loyer demandé est élevé, plus il faut de temps pour trouver un locataire.`),
        button('Prendre à bail pour sous-louer', () => { if (ctx.act(g.leaseForSublet('local', p.id))) ctx.panel.close(); }, 'wide'),
      ];
    },
  };
}

export function competitorView(ctx: UiCtx, p: Premise): View {
  const t = SHOP_TYPE_BY_ID.get(p.competitor!)!;
  return {
    kicker: `Concurrent · ${t.nameFr}`, title: p.competitorName ?? t.nameFr, onClose: () => ctx.leave(),
    render: () => {
      const g = ctx.game, rv = g.rivalry, rs = rv.shopAt(p.id);
      if (!rs) return [note('Ce commerce a fermé : le local est à louer.')];
      const co = rv.co(rs.co), q = rv.quote(p.id);
      return [el('div', { cls: 'kpis' }, kpi('Passage', `${num(p.footfall)} / h`), kpi('Surface', `${p.area} m²`), kpi('Enseigne', co ? co.name : 'Indépendant')),
        el('div', { cls: 'kpis' }, kpi('Clients / jour', `≈ ${num(q?.customers ?? 0)}`), kpi('Prix', rivalPriceText(rs.price)), kpi('Réputation', pct(rs.reputation))),
        rs.promo > 0 ? el('p', { cls: 'riv-promo', text: `Promotion en cours : −${Math.round(RIVALS.promoDiscount * 100)} % encore ${rs.promo} jour(s).` }) : null,
        note('Un commerce du même type à proximité réduit vos clients. Installez-vous plutôt sur une autre rue, soignez prix et décoration… ou rachetez-le.'),
        q ? button(`Racheter ce commerce (${chf(q.total)})`, () => ctx.panel.open(rivalBuyView(ctx, p.id)), 'primary wide') : null];
    },
  };
}

/** Niveau de prix d'un rival en clair : « habituels », « −8 % », « +6 % ». */
export function rivalPriceText(price: number): string {
  const d = Math.round((price - 1) * 100);
  return d === 0 ? 'habituels' : d < 0 ? `−${-d} %` : `+${d} %`;
}

/** Reprise des employés cochée par défaut, mémorisée entre deux rafraîchissements. */
let buyWithStaff = true;

/** Fenêtre de rachat d'un commerce rival : prix détaillé, reprise des employés en option. */
export function rivalBuyView(ctx: UiCtx, premiseId: number): View {
  const g = ctx.game;
  const name = g.rivalry.shopAt(premiseId)?.name ?? 'Commerce';
  return {
    kicker: 'Rachat d’un commerce concurrent', title: name, onClose: () => ctx.leave(),
    render: () => {
      const rs = g.rivalry.shopAt(premiseId), q = g.rivalry.quote(premiseId);
      if (!rs || !q) return [note('Ce commerce n’est plus à vendre.')];
      const t = SHOP_TYPE_BY_ID.get(rs.type)!, co = g.rivalry.co(rs.co);
      const staff = el('input', { attrs: { type: 'checkbox', 'aria-label': 'Reprendre les employés' } });
      staff.checked = buyWithStaff;
      staff.addEventListener('change', () => { buyWithStaff = staff.checked; });
      const wage = g.marketWage(0.72);
      return [
        el('div', { cls: 'kpis' }, kpi('Ventes / jour', `≈ ${chf(q.revenue)}`), kpi('Clients / jour', `≈ ${num(q.customers)}`), kpi('Réputation', pct(q.reputation))),
        sec('Prix'),
        el('table', { cls: 'tbl riv-tbl' },
          el('tr', {}, el('td', { text: `Fonds de commerce (${RIVALS.buyRevenueDays} jours de ventes × réputation, mobilier compris${g.rivalry.buys ? `, majoré de ${Math.round((g.rivalry.buyFactor() - 1) * 100)} % : ${g.rivalry.buys} rachat${g.rivalry.buys > 1 ? 's' : ''} déjà fait${g.rivalry.buys > 1 ? 's' : ''}` : ''})` }), el('td', { text: chf(q.price) })),
          el('tr', {}, el('td', { text: 'Dépôt de garantie du bail (rendu à la résiliation)' }), el('td', { text: chf(q.deposit) })),
          el('tr', {}, el('th', { text: 'Total à payer' }), el('th', { text: chf(q.total) }))),
        note(`${t.nameFr}${co ? ` de ${co.name}` : ' indépendant'} : vous reprenez le bail, le mobilier (${chf(q.furniture)} au catalogue, posé) et des rayons remplis à ${Math.round(RIVALS.buyStock * 100)} %. Le nom et la réputation restent. Chaque rachat renchérit les suivants de ${Math.round(RIVALS.buySurcharge * 100)} % : les vendeurs connaissent votre appétit.`),
        el('label', { cls: 'riv-check' }, staff, el('span', { text: `Reprendre ${q.staff} employé${q.staff > 1 ? 's' : ''} en caisse (environ ${wage} CHF / h chacun)` })),
        button(`Racheter (${chf(q.total)})`, () => {
          if (ctx.act(g.rivalry.buy(premiseId, buyWithStaff), (sh) => `${sh.name} est à vous !`)) ctx.panel.close();
        }, 'primary wide'),
        g.cash < q.total ? note(`Il vous manque ${chf(q.total - g.cash)}.`) : null,
      ];
    },
  };
}

export function homeView(ctx: UiCtx, h: Home): View {
  const g = ctx.game, def = HOME_BY_ID.get(h.def)!;
  return {
    kicker: 'Logement', title: def.nameFr, onClose: () => ctx.leave(),
    render: () => {
      const sl = g.subletOf('logement', h.id);
      if (sl) return [el('div', { cls: 'kpis' }, kpi('Surface', `${def.gridW * def.gridD} m²`), kpi('Confort', `×${def.comfort}`)), ...subletBlock(ctx, sl.id)];
      return [el('div', { cls: 'kpis' }, kpi('Loyer', `${def.rentDay} CHF / jour`), kpi('Confort', `×${def.comfort}`), kpi('Surface', `${def.gridW * def.gridD} m²`)),
        note('Le confort accélère la récupération pendant le sommeil. Vous pouvez déménager quand vous voulez (une semaine d’avance).'),
        button(`Louer et emménager (${chf(def.rentDay * 7)})`, () => ctx.act(g.rentHome(h.id)), 'primary wide'),
        sec('Ou louer pour sous-louer'),
        note(`Vous payez ${def.rentDay} CHF / jour et relouez l’appartement à un locataire. Revenu possible : environ ${chf(def.rentDay * 1.25)} / jour une fois loué.`),
        button(`Prendre à bail pour sous-louer (${chf(def.rentDay * 7)})`, () => ctx.act(g.leaseForSublet('logement', h.id)), 'wide')];
    },
  };
}

/** Vue d'une sous-location : sous-locataire, loyers, loyer demandé (modifiable), résiliation. */
export function subletView(ctx: UiCtx, id: number): View {
  return { kicker: 'Sous-location', title: 'Bien en sous-location', onClose: () => ctx.leave(), render: () => subletBlock(ctx, id) };
}

export function subletBlock(ctx: UiCtx, id: number): (Node | null)[] {
  const g = ctx.game, sl = g.sublets.find((x) => x.id === id);
  if (!sl) return [note('Ce bail est terminé.')];
  const ask = el('input', { cls: 'price', attrs: { type: 'number', step: '1', min: '0', value: String(Math.round(sl.ask)), 'aria-label': 'Loyer demandé par jour' } });
  // Champ vidé ou invalide : ignoré (le loyer actuel est remis).
  ask.addEventListener('change', () => { const v = Number(ask.value); if (ask.value.trim() === '' || !Number.isFinite(v) || v <= 0) { ask.value = String(Math.round(sl.ask)); return; } ctx.act(g.setSubletAsk(sl.id, v)); });
  const chance = g.tenantChance(sl);
  return [
    el('div', { cls: 'kpis' }, kpi('Locataire', sl.tenant ?? 'aucun'), kpi('Vous payez', `${chf2(sl.cost)} / j`), kpi('Marge', sl.tenant ? signed(sl.ask - sl.cost) + ' / j' : '—')),
    sec('Loyer demandé (CHF / jour)'),
    el('div', { cls: 'row' }, ask, el('span', { cls: 'muted small', text: `marché : ${chf2(g.marketRent(sl.kind, sl.ref))}` })),
    sl.tenant ? note(`${sl.tenant} occupe les lieux depuis ${sl.since} jour(s).`) : note(`Chance de trouver un locataire chaque jour : ${Math.round(chance * 100)} %. Baissez le loyer pour louer plus vite.`),
    button('Résilier le bail', () => { void askConfirm('Résilier ce bail de sous-location ?', 'Résilier', true).then((y) => { if (y) ctx.act(g.endSublet(sl.id)); }); }, 'danger wide'),
  ];
}

export function kpi(label: string, value: string): HTMLElement {
  return el('div', { cls: 'kpi' }, el('span', { text: label }), el('b', { text: value }));
}

/* ------------------------------ Plan de redressement ------------------------------ */

/**
 * Plan de redressement (pertes d'affilée, trésorerie négative, risque de faillite) : état des comptes, diagnostic par
 * commerce, puis les leviers : licencier (indemnité payable à découvert), résilier un bail, prêt d'urgence, relancer
 * les ventes (prix alignés, réassort automatique). Accessible à distance (récapitulatif, téléphone, messages).
 */
export function rescueView(ctx: UiCtx): View {
  const g = ctx.game;
  return {
    kicker: 'Banque du Quartier · conseil aux entreprises', title: 'Plan de redressement', wide: true,
    render: () => {
      const R = g.rescue, s = g.lossSummary(), od = g.overdraftLimit(), left = g.bankruptcyIn(), worth = netWorth(g);
      const out: (Node | null)[] = [
        el('div', { cls: 'kpis' }, kpi('Trésorerie', chf(g.cash)), kpi('Pertes d’affilée', R.lossDays ? `${R.lossDays} jour${R.lossDays > 1 ? 's' : ''}` : 'aucune'), kpi('Valeur nette', chf(worth))),
      ];
      if (R.bankrupt) out.push(el('p', { cls: 'rd-alert bad', text: 'Faillite prononcée : la partie est terminée.' }));
      else if (left !== null) out.push(el('p', { cls: 'rd-alert bad', text: `Faillite dans ${left} jour${left > 1 ? 's' : ''} : valeur nette sous ${signed(RESCUE.bankruptWorth)} avec une trésorerie négative. Repassez la trésorerie au-dessus de zéro, ou la valeur nette au-dessus du seuil.` }));
      if (g.cash < 0) out.push(el('p', { cls: 'rd-alert warn', text: `Découvert de ${chf(-g.cash)} depuis ${R.negDays || 1} jour${R.negDays > 1 ? 's' : ''}, facturé ${(FINANCE.overdraftRate * 100).toLocaleString('fr-CH')} % par jour. Commandes encore possibles jusqu’à ${chf(od)} de découvert${g.cash < -od ? ' : limite atteinte, plus aucune commande ne passe' : ` (reste ${chf(od + g.cash)})`}.` }));
      // Diagnostic.
      out.push(sec('Diagnostic'),
        note(`Moyenne des ${s.days} dernier${s.days > 1 ? 's' : ''} jour${s.days > 1 ? 's' : ''} : ventes ${chf(s.revenue)}, salaires ${chf(s.wages)}, loyers ${chf(s.rent)}, marchandise vendue et autres charges ${chf(s.other)}, soit ${signed(s.result)} par jour (hors investissements).`));
      const diag = g.shopDiagnosis().sort((a, b) => a.result - b.result);
      const state = (d: typeof diag[number]): [string, string] => d.stopped ? [`à l’arrêt (${STOP_FR[d.stopped]})`, 'bad']
        : d.noSale >= 1 && d.blocker ? [`aucune vente depuis ${d.noSale} j (${STOP_FR[d.blocker]})`, 'bad']
        : d.result < 0 ? ['en perte', 'warn'] : ['rentable', 'ok'];
      if (diag.length) out.push(el('table', { cls: 'tbl rd-tbl' },
        el('tr', {}, ...['Commerce', 'Ventes / j', 'Marge / j', 'Salaires / j', 'Loyer / j', 'Solde / j', 'État'].map((t, k) => el('th', { cls: k && k < 6 ? 'n' : '', text: t }))),
        ...diag.map((d) => { const [txt, tone] = state(d); return el('tr', {}, el('td', {}, el('b', { text: d.shop.name })), el('td', { cls: 'n', text: chf(d.revenue) }), el('td', { cls: 'n', text: chf(d.margin) }), el('td', { cls: 'n', text: chf(d.wages) }), el('td', { cls: 'n', text: chf(d.rent) }), el('td', { cls: `n ${d.result >= 0 ? 'ok' : 'bad'}`, text: signed(d.result) }), el('td', { cls: tone, text: txt })); })));
      else out.push(note('Aucun commerce.'));
      out.push(note('Un commerce qui n’a rien vendu depuis 2 jours et ne peut plus vendre (rayons vides, pas de caisse, pas de caissier) est mis à l’arrêt : ses employés sont en chômage technique (ni présents ni payés) et le nettoyage de nuit est suspendu, jusqu’à ce qu’il puisse vendre à nouveau.'));
      // 1. Relancer les ventes.
      const fixes: (Node | null)[] = [];
      for (const d of diag) {
        const sh = d.shop, gap = g.priceGap(sh);
        if (gap >= 0.03) fixes.push(el('div', { cls: 'item' }, el('div', {}, el('b', { text: sh.name }), el('div', { cls: 'muted small', text: `Prix ${Math.round(gap * 100)} % au-dessus du quartier : des clients reposent les articles.` })),
          button('Aligner les prix', () => ctx.act(g.applyBatch(sh.type, { priceFactor: 1 }), 'Prix alignés sur le quartier.'), 'small primary')));
        const manual = productsOf(sh.type).filter((pr) => !sh.products[pr.id]!.auto).length;
        if (d.blocker === 'rayons' || manual) fixes.push(el('div', { cls: 'item' }, el('div', {}, el('b', { text: sh.name }), el('div', { cls: 'muted small', text: d.blocker === 'rayons' ? 'Rayons vides : réassort automatique (livraison à 7 h ou 14 h), payable à découvert.' : `${manual} produit(s) sans réassort automatique : risque de rupture.` })),
          button('Réassort automatique', () => { for (const pr of productsOf(sh.type)) g.setAuto(sh.id, pr.id, true); for (const pr of productsOf(sh.type)) { const q = g.room(sh, pr.id); if (q > 0 && sh.products[pr.id]!.stock === 0) g.order(sh.id, pr.id, q); } ctx.toast('Réassort automatique activé.', 'ok'); ctx.panel.paint(true); }, 'small')));
        if (d.blocker === 'caissier') fixes.push(el('div', { cls: 'item' }, el('div', {}, el('b', { text: sh.name }), el('div', { cls: 'muted small', text: 'Personne en caisse : embauchez un caissier (agence pour l’emploi) ou donnez le rôle Caisse à un employé.' }))));
        if (d.blocker === 'caisse') fixes.push(el('div', { cls: 'item' }, el('div', {}, el('b', { text: sh.name }), el('div', { cls: 'muted small', text: 'Aucune caisse posée : achetez-en une au magasin de meubles, puis Aménager.' }))));
      }
      out.push(sec('1. Relancer les ventes'), ...(fixes.length ? fixes : [note('Rien à corriger côté prix, stock et caisses.')]));
      // 2. Réduire les salaires.
      out.push(sec('2. Réduire les salaires'));
      const byResult = new Map(diag.map((d) => [d.shop.id, d.result]));
      const staff = [...g.employees].sort((a, b) => (byResult.get(a.shopId ?? -1) ?? -1e9) - (byResult.get(b.shopId ?? -1) ?? -1e9));
      if (!staff.length) out.push(note('Aucun employé.'));
      for (const e of staff) {
        const sh = e.shopId === null ? undefined : g.shop(e.shopId), hours = g.hoursPerDay(e), pay = g.severance(e);
        out.push(el('div', { cls: 'item' }, el('div', {}, el('b', { text: e.name }),
          el('div', { cls: 'muted small', text: `${sh?.name ?? 'sans affectation'} · ${STAFF_ROLE_BY_ID.get(g.roleOf(e))!.nameFr.toLowerCase()} · ${sh?.stopped ? 'chômage technique (non payé)' : `${chf(e.wage * hours)} par jour`}` })),
          button(`Licencier (indemnité ${chf(pay)})`, () => ctx.act(g.fire(e.id, true), (p) => `${e.name} licencié : indemnité ${chf(p)}.`), 'small danger')));
      }
      if (staff.length) out.push(note(`L’indemnité (${ECONOMY.severanceDays} jours de salaire) peut être payée à découvert depuis ce plan, dans la limite du découvert autorisé.`));
      // 3. Résilier un bail.
      out.push(sec('3. Résilier un bail'));
      for (const d of diag) {
        const q = g.releaseQuote(d.shop.id);
        if (!q) continue;
        out.push(el('div', { cls: 'item' }, el('div', {}, el('b', { text: d.shop.name }),
          el('div', { cls: 'muted small', text: `solde ${signed(d.result)} par jour · récupéré : dépôt ${chf(q.deposit)}, mobilier ${chf(q.resale)}${q.refunds ? `, remboursements ${chf(q.refunds)}` : ''}${q.rentDue ? `, moins le loyer dû ${chf(q.rentDue)}` : ''}${q.stockUnits ? ` ; ${num(q.stockUnits)} articles perdus` : ''}` })),
          button(`Résilier (${signed(q.total)})`, () => { void askConfirm(`Résilier le bail de ${d.shop.name} ? Vous récupérez ${chf(q.total)} ; employés sans affectation, stock en rayon perdu.`, 'Résilier', true).then((y) => { if (y) ctx.act(g.release(d.shop.id), (t) => `Bail résilié : ${chf(t)} récupérés.`); }); }, 'small danger')));
      }
      for (const sl of g.sublets.filter((x) => !x.tenant)) out.push(el('div', { cls: 'item' }, el('div', {}, el('b', { text: sl.kind === 'logement' ? 'Appartement sous-loué (vacant)' : 'Local sous-loué (vacant)' }), el('div', { cls: 'muted small', text: `vous coûte ${chf2(sl.cost)} par jour sans locataire` })),
        button('Résilier', () => ctx.act(g.endSublet(sl.id)), 'small danger')));
      if (!g.shops.length && !g.sublets.some((x) => !x.tenant)) out.push(note('Aucun bail à résilier.'));
      // 4. Prêt d'urgence.
      const em = g.emergencyOffer();
      out.push(sec('4. Prêt d’urgence'), el('div', { cls: 'item' }, el('div', {}, el('b', { text: `${chf(em.offer.amount)} tout de suite` }),
        el('div', { cls: 'muted small', text: `${em.offer.days} jours · taux ${pct(em.offer.rate)} par an · ${chf2(em.daily)} par jour · total ${chf(em.total)}. Hors plafond de crédit, un seul à la fois.` })),
        em.available ? button('Emprunter', () => void askConfirm(`Prêt d’urgence de ${chf(em.offer.amount)} ? ${chf2(em.daily)} prélevés chaque nuit pendant ${em.offer.days} jours : ${chf(em.total)} au total, dont ${chf(em.total - em.offer.amount)} d’intérêts.`, 'Emprunter')
          .then((y) => { if (y) ctx.act(g.takeEmergencyLoan()); }), 'small primary') : el('span', { cls: 'muted small', text: em.why ?? '' })));
      out.push(note(`Faillite si la valeur nette reste sous ${signed(RESCUE.bankruptWorth)} avec une trésorerie négative pendant ${RESCUE.bankruptDays} jours d’affilée.`));
      return out;
    },
  };
}

/* ------------------------------ Logistique : importateur ------------------------------ */

/**
 * Importateur (commande à distance) : palettes de chaque produit, prix fixe plus bas que le grossiste, commande
 * minimale, livraison à l'entrepôt seulement, après 1 ou 2 jours. `back` : vue à rouvrir (entrepôt).
 */
export function importerView(ctx: UiCtx, back?: () => View): View {
  const g = ctx.game;
  return {
    kicker: 'Logistique · Importateur', title: 'Import Grand Large', wide: true,
    render: () => {
      if (!g.logi.warehouses.length) return [note('L’importateur ne livre qu’aux entrepôts : louez d’abord un entrepôt (appli Logistique du téléphone).'), back ? button('Retour', () => ctx.panel.open(back()), 'wide') : null];
      const dest = remember('imp-dest', el('select', { attrs: { 'aria-label': 'Entrepôt de livraison' } },
        ...g.logi.warehouses.map((w) => el('option', { text: `${warehouseName(g, w.premiseId)} (${num(freeOf(g, w))} places libres)`, attrs: { value: String(w.id) } }))));
      const inputs = new Map<string, HTMLInputElement>();
      const summary = el('div', { cls: 'logi-sum' });
      const refresh = (): void => {
        const q = importQuote(g, Object.fromEntries([...inputs].map(([id, i]) => [id, Number(i.value) || 0])));
        const w = g.logi.warehouses.find((x) => String(x.id) === dest.value);
        const free = w ? freeOf(g, w) : 0;
        const okMin = q.pallets >= LOGISTICS.minPallets, okRoom = q.units <= free;
        summary.replaceChildren(...[
          el('b', { text: `${q.pallets} palette(s) · ${num(q.units)} unités · ${chf(q.total)}` }),
          el('span', { cls: 'muted small', text: ` dont transport ${chf(q.fee)} · livraison ${q.pallets ? g.deliveryLabel(q.arriveAt) : '—'}` }),
          !okMin ? el('div', { cls: 'small warn', text: `Commande minimale : ${LOGISTICS.minPallets} palettes.` }) : null,
          !okRoom ? el('div', { cls: 'small warn', text: `Place libre à l’entrepôt : ${num(free)} unités. Ajoutez des étagères.` }) : null].filter((x): x is HTMLElement => !!x));
      };
      dest.addEventListener('change', refresh);
      const types = new Set(g.shops.map((s) => s.type));
      const order = [...SHOP_TYPES].sort((a, c) => Number(types.has(c.id)) - Number(types.has(a.id)));
      const out: (Node | null)[] = [
        note(`Prix fixes, ${pct(LOGISTICS.importDiscount)} sous le prix catalogue du grossiste. Vente par palettes (${LOGISTICS.palletUnits} unités, ${LOGISTICS.palletUnitsBig} pour les articles chers), ${LOGISTICS.minPallets} palettes minimum par commande, transport ${LOGISTICS.importFee} CHF. Livré à l’entrepôt à ${LOGISTICS.importHour} h : le lendemain jusqu’à ${LOGISTICS.fastPallets} palettes, sinon en 2 jours.`),
        el('label', { cls: 'field' }, el('span', { text: 'Livrer à' }), dest),
      ];
      for (const t of order) {
        out.push(sec(t.nameFr));
        const tbl = el('table', { cls: 'tbl' }, el('tr', {}, el('th', { text: 'Produit' }), el('th', { text: 'Palette' }), el('th', { text: 'Prix / u.' }), el('th', { text: 'Grossiste' }), el('th', { text: 'Palettes' })));
        for (const p of PRODUCTS.filter((x) => x.shop === t.id)) {
          const inp = remember(`imp-${p.id}`, el('input', { cls: 'qty', attrs: { type: 'number', min: '0', max: '99', step: '1', value: '0', 'aria-label': `Palettes de ${p.nameFr}` } }));
          inp.addEventListener('input', refresh);
          inputs.set(p.id, inp);
          tbl.append(el('tr', {}, el('td', { text: p.nameFr }), el('td', { text: `${palletOf(p)} u.` }), el('td', {}, el('b', { text: chf2(importUnit(p)) })),
            el('td', { cls: 'muted', text: chf2(g.orderCost(p.id, 100) / 100) }), el('td', {}, inp)));
        }
        out.push(tbl);
      }
      refresh();
      out.push(summary,
        button('Passer la commande', () => {
          const lines = Object.fromEntries([...inputs].map(([id, i]) => [id, Number(i.value) || 0]));
          if (ctx.act(placeImport(g, Number(dest.value), lines), (o) => `Commande passée : livraison ${g.deliveryLabel(o.arriveAt)}.`)) {
            for (const id of inputs.keys()) memo.delete(`imp-${id}`);
            ctx.panel.paint(true);
          }
        }, 'primary wide'),
        back ? button('Retour à l’entrepôt', () => ctx.panel.open(back()), 'wide') : null);
      return out;
    },
  };
}
