/**
 * Vues des lieux du quartier : grossiste, magasin de meubles, banque, agence pour l'emploi, garage, agence de
 * publicité, snack, local à louer, commerce concurrent, logement. Chaque achat passe par la partie, qui vérifie
 * que le personnage est bien sur place.
 */
import {
  CAMPAIGNS, CONTRACTS, ECONOMY, FOODS, TRAINING, FURNITURE, HOME_BY_ID, LOAN_OFFERS, PRODUCTS, SERVICE_BY_ID, SHOP_TYPES, SHOP_TYPE_BY_ID,
  VEHICLES, VEHICLE_BY_ID, loanTotal, type ServiceKind, type ShopType,
} from '../sim/catalog';
import type { Building, Home, Premise } from '../sim/district';
import type { Game } from '../sim/game';
import { askConfirm, button, chf, chf2, el, num, pct, signed } from './dom';
import type { Act, Panel, View } from './panel';

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
      dest ? el('label', { cls: 'field grow' }, el('span', { text: 'Ou livrer demain à 7 h à' }), dest) : null),
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
      const deliver = dest ? button('Livrer', () => ctx.act(g.order(Number(dest.value), p.id, Number(q.value)), (o) => `${o.qty} ${p.nameFr.toLowerCase()} livrés demain à 7 h (${chf2(o.cost)}).`), 'small') : null;
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
  const dest = remember('mdest', shopSelect(g));
  const out: (Node | null)[] = [el('label', { cls: 'field' }, el('span', { text: `Livrer dans la réserve de (livraison ${ECONOMY.furnitureDelivery} CHF par achat)` }), dest)];
  const shop = g.shop(Number(dest.value));
  const useful = (id: string): boolean => {
    if (!shop) return true;
    const f = FURNITURE.find((x) => x.id === id)!;
    if (f.kind === 'caisse' || f.kind === 'deco') return true;
    if (f.kind === 'machine') return shop.type === 'cafe';
    if (f.kind === 'table') return shop.type === 'cafe' || shop.type === 'fastfood' || shop.type === 'boulangerie';
    return PRODUCTS.some((p) => p.shop === shop.type && p.store === f.kind);
  };
  // Catégories : « Utiles » (adaptés au commerce choisi), présentoirs, caisses et machines, tables, décoration.
  const cats: [string, string, (f: typeof FURNITURE[number]) => boolean][] = [
    ['utiles', 'Utiles ici', (f) => useful(f.id)],
    ['presentoirs', 'Présentoirs', (f) => ['rayon', 'frigo', 'comptoir', 'vitrine', 'portant'].includes(f.kind)],
    ['caisses', 'Caisses et machines', (f) => f.kind === 'caisse' || f.kind === 'machine'],
    ['tables', 'Tables et sièges', (f) => f.kind === 'table'],
    ['deco', 'Décoration', (f) => f.kind === 'deco'],
  ];
  const cat = cats.find((c) => c[0] === meubleTab) ?? cats[0]!;
  out.push(el('div', { cls: 'tabs' }, ...cats.map(([id, label, pick]) => button(`${label} (${FURNITURE.filter(pick).length})`, () => { meubleTab = id; ctx.panel.paint(true); }, id === cat[0] ? 'on' : ''))));
  const tbl = el('table', { cls: 'tbl' }, el('tr', {}, el('th', { text: 'Meuble' }), el('th', { text: 'Taille' }), el('th', { text: 'Prix' }), el('th', { text: 'Qté' }), el('th', { text: '' })));
  for (const f of FURNITURE.filter(cat[2]).sort((a, b) => Number(useful(b.id)) - Number(useful(a.id)))) {
    const q = qtyInput(1, 20);
    const detail = f.capacity ? `${f.capacity} articles` : f.seats ? `${f.seats} places` : f.decor ? `déco +${f.decor}` : f.kind === 'caisse' ? 'encaisser' : f.kind === 'machine' ? 'café, thé' : '';
    tbl.append(el('tr', { cls: useful(f.id) ? '' : 'dim' },
      el('td', {}, el('b', { text: f.nameFr }), el('div', { cls: 'muted small', text: detail })),
      el('td', { text: `${f.w}×${f.d} m` }), el('td', { text: chf(f.price) }), el('td', {}, q),
      el('td', {}, button('Acheter', () => ctx.act(g.buyFurniture(f.id, Number(q.value), Number(dest.value)), (c) => `Achat de ${chf(c)} : à poser depuis la réserve (Aménager).`), 'small primary'))));
  }
  out.push(tbl);
  if (shop && Object.keys(shop.storage).length) out.push(note(`Réserve de ${shop.name} : ${Object.entries(shop.storage).map(([k, n]) => `${n} × ${FURNITURE.find((f) => f.id === k)!.nameFr}`).join(', ')}.`));
  return out;
}

/* ------------------------------ Banque ------------------------------ */

function banque(ctx: UiCtx): (Node | null)[] {
  const g = ctx.game;
  const out: (Node | null)[] = [el('div', { cls: 'kpis' }, kpi('Trésorerie', chf(g.cash)), kpi('Dette', chf(g.debt)), kpi('Plafond', chf(ECONOMY.maxDebt)))];
  out.push(sec('Prêts proposés'));
  LOAN_OFFERS.forEach((o, k) => {
    const total = loanTotal(o);
    out.push(el('div', { cls: 'item' }, el('div', {}, el('b', { text: chf(o.amount) }), el('div', { cls: 'muted small', text: `${o.days} jours · taux ${pct(o.rate)} par an · ${chf2(total / o.days)} par jour · total ${chf(total)}` })),
      button('Emprunter', () => ctx.act(g.takeLoan(k)), 'small primary')));
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
    const s = g.shops.length ? remember(`hire-${c.id}`, shopSelect(g)) : null;
    out.push(el('div', { cls: 'item' }, el('div', {}, el('b', { text: c.name }), el('div', { cls: 'muted small', text: `compétence ${pct(c.skill)} (${num(c.skill * ECONOMY.servePerRegister)} clients / h en caisse) · ${c.wage} CHF / h` })),
      s ? el('div', { cls: 'row tight' }, s, button('Embaucher', () => ctx.act(g.hire(c.id, Number(s.value))), 'small primary')) : null));
  }
  if (!g.candidates.length) out.push(note('Plus de candidats cette semaine : nouveaux candidats lundi.'));
  if (g.employees.length) {
    out.push(sec('Vos employés'));
    for (const e of g.employees) out.push(employeeRow(ctx, e.id));
  }
  return out;
}

export function employeeRow(ctx: UiCtx, id: number): HTMLElement {
  const g = ctx.game, e = g.employees.find((x) => x.id === id)!;
  const s = el('select', { attrs: { 'aria-label': 'Affectation' } }, el('option', { text: 'Sans affectation', attrs: { value: '' } }), ...g.shops.map((sh) => el('option', { text: sh.name, attrs: { value: String(sh.id) } })));
  s.value = e.shopId === null ? '' : String(e.shopId);
  s.addEventListener('change', () => ctx.act(g.assign(e.id, s.value ? Number(s.value) : null)));
  const mood = e.mood ?? 0.75, lv = e.training ?? 0, mw = g.marketWage(e.skill, lv);
  const face = mood > 0.7 ? '😊' : mood > 0.4 ? '😐' : '😠';
  const next = g.nextTrainingCost(e);
  const train = next === null ? null : button(`Former (${chf(next)})`, () => ctx.act(g.train(e.id), () => `${e.name} : formation niveau ${lv + 1} terminée.`), 'small');
  if (train) train.title = `Niveau ${lv + 1} / ${TRAINING.maxLevel} : +${pct(TRAINING.capacity)} de clients servis en caisse, salaire du marché +${TRAINING.wage} CHF / h.`;
  return el('div', { cls: 'item' }, el('div', {}, el('b', { text: `${face} ${e.name}` }),
    el('div', { cls: 'muted small', text: `compétence ${pct(e.skill)} · formation ${lv} / ${TRAINING.maxLevel} · ${num(g.serviceSkill(e) * ECONOMY.servePerRegister)} clients / h · ${e.wage} CHF / h (marché ${mw}) · satisfaction ${pct(mood)}${e.askedRaise ? ' · demande une augmentation' : ''}` })),
    el('div', { cls: 'row tight' }, s,
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
    const s = c.scope === 'shop' ? remember(`pub-${c.id}`, shopSelect(g)) : null;
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
      button(`${chf(f.price)}`, () => ctx.act(g.eat(f.id), 'Miam !'), 'small primary')))];
}

/* ------------------------------ Local, concurrent, logement ------------------------------ */

export function premiseView(ctx: UiCtx, p: Premise): View {
  const g = ctx.game;
  return {
    kicker: 'Local commercial à louer', title: `${p.area} m² · ${chf(p.rent)} / mois`, onClose: () => ctx.leave(),
    render: () => {
      const type = remember('rtype', el('select', { attrs: { 'aria-label': 'Type de commerce' } }, ...SHOP_TYPES.map((t) => el('option', { text: t.nameFr, attrs: { value: t.id } }))));
      const name = el('input', { attrs: { type: 'text', maxlength: '32', placeholder: 'Nom (facultatif)', 'aria-label': 'Nom du commerce' } });
      const rows = SHOP_TYPES.map((t) => el('tr', {}, el('td', { text: t.nameFr }), el('td', { text: num(g.estimatePeak(p, t.id)) }), el('td', { text: String(g.competition(p, t.id)) })));
      return [
        el('div', { cls: 'kpis' }, kpi('Passage (pointe)', `${num(p.footfall)} / h`), kpi('Loyer', `${chf(p.rent)} / mois`), kpi('Grille', `${p.gridW} × ${p.gridD} m`)),
        sec('Potentiel par type de commerce'),
        el('table', { cls: 'tbl' }, el('tr', {}, el('th', { text: 'Type' }), el('th', { text: 'Clients / h (pointe)' }), el('th', { text: 'Concurrence' })), ...rows),
        note('Estimation pour un commerce moyen bien tenu. La concurrence pèse plus quand elle est proche.'),
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
    render: () => [el('div', { cls: 'kpis' }, kpi('Passage', `${num(p.footfall)} / h`), kpi('Surface', `${p.area} m²`), kpi('Type', t.nameFr)),
      note('Un commerce du même type à proximité réduit vos clients. Installez-vous plutôt sur une autre rue, ou soignez prix et décoration.')],
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
  ask.addEventListener('change', () => ctx.act(g.setSubletAsk(sl.id, Number(ask.value))));
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
