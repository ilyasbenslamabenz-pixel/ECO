/**
 * Gestion d'un commerce (depuis l'intérieur ou à distance) : en-tête (type, statut, réputation), chiffres du jour,
 * puis onglets — aperçu et liste de contrôle, prix et stock (commande livrée, réassort automatique), employés,
 * horaires, résultats. Et le panneau Entreprise : trésorerie, journal, commerces, véhicules, prêts, objectifs.
 */
import { STAFF, type StaffRole } from '../sim/catalog';
import { ECONOMY, FURNITURE_BY_ID, PREMIUM, PREMIUM_BY_TYPE, SHOP_TYPE_BY_ID, TRAINING, VEHICLE_BY_ID, premiumDemand, productsOf, PRODUCT_BY_ID } from '../sim/catalog';
import { CLEANING, FLOORINGS, WALLINGS, cleanAppeal, type SurfaceDef } from '../sim/catalog';
import { clockView } from '../sim/clock';
import { dayProfit, type DayStats, type Game, type Shop } from '../sim/game';
import { OBJECTIVES, netWorth, rankOf } from '../sim/objectives';
import { askConfirm, button, chf, chf2, el, num, pct, signed } from './dom';
import { employeeRow, type UiCtx } from './dialogs';
import type { View } from './panel';

type Tab = 'apercu' | 'stock' | 'equipe' | 'horaires' | 'resultats';
const TABS: [Tab, string][] = [['apercu', 'Aperçu'], ['stock', 'Prix et stock'], ['equipe', 'Employés'], ['horaires', 'Horaires'], ['resultats', 'Résultats']];
let tab: Tab = 'apercu';
let lastShop = -1;

/* ------------------------------ Petits éléments ------------------------------ */

type Tone = 'ok' | 'warn' | 'bad' | 'muted' | '';

/** Jauge horizontale (0..1). */
function meter(frac: number, tone: Tone = 'ok', cls = ''): HTMLElement {
  const w = Math.round(Math.max(0, Math.min(1, frac)) * 100);
  return el('div', { cls: `gauge ${tone} ${cls}`.trim() }, el('i', { attrs: { style: `width:${w}%` } }));
}

/** Chiffre clé : libellé, valeur, ligne de détail facultative. */
function stat(label: string, value: string, sub?: string | null, tone: Tone = ''): HTMLElement {
  return el('div', { cls: 'sp-stat' }, el('span', { cls: 'sp-stat-l', text: label }), el('b', { cls: tone, text: value }), sub ? el('small', { text: sub }) : null);
}

/** Pastille de statut. */
function badge(text: string, tone: Tone): HTMLElement { return el('span', { cls: `tag-badge ${tone}`, text }); }

/** Titre de section avec complément à droite. */
function section(title: string, aside?: Node | string | null): HTMLElement {
  return el('div', { cls: 'sec sp-sec' }, el('span', { text: title }), aside ? (typeof aside === 'string' ? el('em', { text: aside }) : aside) : null);
}

function legend(items: [string, string][]): HTMLElement {
  return el('div', { cls: 'sp-legend' }, ...items.map(([color, label]) => el('span', {}, el('i', { attrs: { style: `background:${color}` } }), label)));
}

const isOpen = (g: Game, s: Shop): boolean => { const h = clockView(g.total).hour; return h >= s.open && h < s.close; };
const shopResult = (d: DayStats): number => d.revenue - d.costOfSales - d.wages - d.rent;

/** Éléments de la liste « Pour ouvrir ». */
function readiness(g: Game, id: number): [boolean, string][] {
  const s = g.shop(id)!, st = g.stats(s);
  return [
    [st.registers > 0, 'Une caisse posée'],
    [productsOf(s.type).some((p) => st.capacity[p.store] > 0), 'Des meubles de présentation adaptés'],
    ...(s.type === 'cafe' ? [[st.machines > 0, 'Machine à café (café, thé)'] as [boolean, string]] : []),
    [productsOf(s.type).some((p) => s.products[p.id]!.stock > 0), 'De la marchandise en rayon'],
    [g.staffOf(id).some((e) => g.roleOf(e) === 'caisse') || g.player.tending === id, 'Quelqu’un à la caisse (employé au rôle Caisse, ou vous)'],
    [st.blocked.length === 0, 'Tous les meubles accessibles'],
  ];
}

/* ------------------------------ Vue commerce ------------------------------ */

export function shopView(ctx: UiCtx, shopId: number): View {
  const g = ctx.game;
  if (lastShop !== shopId) { tab = 'apercu'; lastShop = shopId; }
  const s0 = g.shop(shopId);
  return {
    kicker: `Mon commerce${s0 ? ` · ${SHOP_TYPE_BY_ID.get(s0.type)!.nameFr}` : ''}`, title: s0?.name ?? '', wide: true,
    render: () => {
      const s = g.shop(shopId);
      if (!s) return [el('p', { text: 'Ce commerce n’existe plus.' })];
      const empties = productsOf(s.type).filter((p) => s.products[p.id]!.stock === 0 && g.storageFor(s, p) > 0).length;
      const alerts: Partial<Record<Tab, boolean>> = { apercu: readiness(g, shopId).some(([ok]) => !ok) || g.cleanliness(s) < CLEANING.warn, stock: empties > 0 };
      const tabs = el('div', { cls: 'tabs sp-tabs', attrs: { role: 'tablist' } }, ...TABS.map(([id, label]) => {
        const b = button(label, () => { tab = id; ctx.panel.paint(true); }, `${tab === id ? 'on' : ''}${alerts[id] ? ' alert' : ''}`.trim());
        b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(tab === id));
        return b;
      }));
      return [header(g, s), tabs, el('div', { cls: 'sp-pane' }, ...({ apercu, stock, equipe, horaires, resultats }[tab])(ctx, shopId))];
    },
  };
}

/** En-tête : enseigne, statut, horaires, réputation et chiffres du jour. */
function header(g: Game, s: Shop): HTMLElement {
  const t = SHOP_TYPE_BY_ID.get(s.type)!, d = s.today, open = isOpen(g, s);
  const tending = g.player.tending === s.id;
  const status = open
    ? (s.capacity > 0 ? badge(tending ? 'Ouvert · vous tenez la caisse' : 'Ouvert', 'ok') : badge('Ouvert · personne en caisse', 'warn'))
    : badge(`Fermé · ouvre à ${s.open} h`, 'muted');
  const lost = d.lostStaff + d.lostStock + d.lostCapacity;
  const margin = d.revenue - d.costOfSales, res = shopResult(d);
  const repTone: Tone = s.reputation >= 0.6 ? 'ok' : s.reputation >= 0.35 ? 'warn' : 'bad';
  return el('div', { cls: 'sp-head', attrs: { style: `--shop:${t.color}` } },
    el('div', { cls: 'sp-id' },
      el('div', { cls: 'sp-sign', text: t.nameFr.slice(0, 1).toUpperCase() }),
      el('div', { cls: 'sp-idtxt' },
        el('div', { cls: 'sp-line' }, status, s.premium ? badge('Premium', 'ok') : null, el('span', { cls: 'sp-hours', text: `${s.open} h – ${s.close} h` })),
        el('div', { cls: 'sp-rep' }, el('span', { text: 'Réputation' }), meter(s.reputation, repTone), el('b', { text: pct(s.reputation) })))),
    el('div', { cls: 'sp-stats' },
      stat('Clients', num(d.customers), lost ? `${num(lost)} perdu(s)` : 'aucun perdu', ''),
      stat('Ventes', chf(d.revenue)),
      stat('Marge brute', chf(margin), d.revenue > 0 ? `${Math.round((margin / d.revenue) * 100)} % des ventes` : null),
      stat('Résultat', signed(res), 'après salaires et loyer', res >= 0 ? 'ok' : 'bad')));
}

function apercu(ctx: UiCtx, id: number): (Node | null)[] {
  const g = ctx.game, s = g.shop(id)!, t = SHOP_TYPE_BY_ID.get(s.type)!, d = s.today;
  const checks = readiness(g, id), done = checks.filter(([ok]) => ok).length;
  const open = isOpen(g, s);
  const ready = done === checks.length;
  const causes: [string, number, string][] = [
    ['Sans caissier', d.lostStaff, 'embauchez ou tenez la caisse'],
    ['Rupture ou trop cher', d.lostStock, 'réassort, prix'],
    ['Attente trop longue', d.lostCapacity, 'caisse ou caissier de plus'],
    ['Articles reposés (prix)', d.refusedPrice, 'rapprochez-vous du quartier'],
  ];
  const boost = g.marketingBoost(id);
  return [
    section(`Pour ouvrir · ${t.nameFr}`, badge(ready ? 'Prêt' : `${done} / ${checks.length}`, ready ? 'ok' : 'warn')),
    el('ul', { cls: 'sp-checks' }, ...checks.map(([ok, label]) => el('li', { cls: ok ? 'ok' : 'todo' }, el('i', { attrs: { 'aria-hidden': 'true' } }), el('span', { text: label })))),
    Object.keys(s.storage).length ? el('p', { cls: 'sp-note', text: `Réserve : ${Object.entries(s.storage).map(([k, n]) => `${n} × ${FURNITURE_BY_ID.get(k)!.nameFr}`).join(', ')} — posez-les avec « Aménager » (B).` }) : null,
    section('Clients perdus aujourd’hui', el('em', { text: `attrait ${s.rate > 0 || open ? g.attractiveness(s).toFixed(2) : '—'}` })),
    el('div', { cls: 'sp-losses' }, ...causes.map(([label, n, hint]) => el('div', { cls: `sp-loss${n > 0 ? ' on' : ''}` }, el('b', { text: num(n) }), el('span', { text: label }), el('small', { text: hint })))),
    section('Affluence aujourd’hui', legend([['#5cc77a', 'servis'], ['#ef6b6b', 'perdus'], ['#2a3647', 'fermé']])),
    hourChart(s.hourServed ?? [], s.hourLost ?? [], s.open, s.close),
    boost > 0 ? el('p', { cls: 'sp-note ok', text: `Publicité en cours : +${pct(boost)} de clients.` }) : null,
    ...cleanBlock(ctx, id),
    ...surfaceBlock(ctx, id),
  ];
}

/* ------------------------------ Propreté et revêtements (aperçu) ------------------------------ */

/** Propreté : jauge, effet sur la clientèle, nettoyage sur place, entretien de l'équipe, service de nuit. */
function cleanBlock(ctx: UiCtx, id: number): (Node | null)[] {
  const g = ctx.game, s = g.shop(id)!;
  const c = g.cleanliness(s), tone: Tone = c >= CLEANING.fine ? 'ok' : c >= CLEANING.warn ? 'warn' : 'bad';
  const loss = 1 - cleanAppeal(c);
  const here = g.player.place.kind === 'commerce' && g.player.place.shopId === id;
  const power = g.cleaningPower(s), fee = g.cleanServiceCost(id);
  const effect = loss > 0.005 ? `Magasin ${c < CLEANING.warn ? 'sale' : 'un peu négligé'} : −${pct(loss)} de clients, la réputation en pâtit.` : 'Magasin propre : aucun effet sur la clientèle.';
  return [
    section('Propreté', badge(`${Math.round(c)} %`, tone)),
    el('div', { cls: 'item prop-row' },
      el('div', { cls: 'prop-main' }, meter(c / 100, tone),
        el('div', { cls: `sub${tone === 'bad' ? ' bad' : ''}`, text: effect }),
        el('div', { cls: 'sub', text: power > 0 ? `Entretien de l’équipe présente : +${Math.round(power * CLEANING.perPower)} points par heure.` : 'Aucun employé d’entretien présent en ce moment.' })),
      el('div', { cls: 'row tight' },
        button(`Nettoyer (${CLEANING.playerMinutes} min)`, () => ctx.act(g.cleanShop(id), (v) => `Magasin nettoyé : propreté ${v} %.`), here && c < 98 ? 'small primary' : 'small'))),
    el('div', { cls: 'item' },
      el('div', {}, el('b', { text: 'Service de nettoyage de nuit' }), el('div', { cls: 'sub', text: `Une équipe passe chaque nuit : magasin impeccable à l’ouverture. ${chf(fee)} par jour (selon la surface).` })),
      s.cleanService
        ? button('Résilier', () => ctx.act(g.setCleanService(id, false)), 'small')
        : button(`Souscrire (${chf(fee)} / jour)`, () => ctx.act(g.setCleanService(id, true), 'Service de nettoyage souscrit.'), 'small')),
    el('p', { cls: 'sp-note', text: `Chaque client salit un peu, chaque heure d’ouverture aussi. Sous ${CLEANING.fine} %, moins de clients entrent (jusqu’à −${pct(1 - CLEANING.minAppeal)} si tout est sale) et la réputation baisse ; alerte sous ${CLEANING.warn} %. « Nettoyer » se fait sur place et prend ${CLEANING.playerMinutes} minutes de jeu (+${CLEANING.playerGain} points).` }),
  ];
}

/** Revêtements de sol et de murs : choix, prix pour ce local, bonus d'attrait (pose sur place). */
function surfaceBlock(ctx: UiCtx, id: number): (Node | null)[] {
  const g = ctx.game, s = g.shop(id)!;
  const here = g.player.place.kind === 'commerce' && g.player.place.shopId === id;
  const row = (part: 'sol' | 'murs', list: readonly SurfaceDef[], cur: string): HTMLElement =>
    el('div', { cls: 'prop-surf' }, el('span', { cls: 'prop-surf-l', text: part === 'sol' ? 'Sol' : 'Murs' }),
      el('div', { cls: 'prop-chips' }, ...list.map((d) => {
        const cost = g.surfaceCost(id, part, d.id), on = d.id === cur;
        const b = el('button', { cls: `prop-chip${on ? ' on' : ''}`, attrs: { type: 'button', title: d.desc, 'aria-pressed': String(on) } },
          el('i', { attrs: { style: `background:${d.color}` } }),
          el('span', {}, el('b', { text: d.nameFr }), el('small', { text: on ? 'en place' : `${cost ? chf(cost) : 'gratuit'}${d.appeal ? ` · attrait +${(d.appeal * 100).toLocaleString('fr-CH', { maximumFractionDigits: 1 })} %` : ''}` })));
        b.addEventListener('click', () => {
          if (on) return;
          if (!cost) { ctx.act(g.setSurface(id, part, d.id)); return; }
          void askConfirm(`Faire poser « ${d.nameFr} » (${part === 'sol' ? 'sol' : 'murs'}) dans ${s.name} pour ${chf(cost)} ? L’ancien revêtement n’est pas remboursé.`, 'Faire poser').then((y) => { if (y) ctx.act(g.setSurface(id, part, d.id)); });
        });
        return b;
      })));
  const appeal = g.surfaceAppeal(s);
  return [
    section('Aménagement · revêtements', el('em', { text: appeal > 0 ? `attrait +${(appeal * 100).toLocaleString('fr-CH', { maximumFractionDigits: 1 })} %` : 'd’origine' })),
    row('sol', FLOORINGS, s.floorId ?? 'origine'),
    row('murs', WALLINGS, s.wallId ?? 'origine'),
    here ? null : el('p', { cls: 'sp-note', text: 'La pose se commande sur place, dans le commerce.' }),
  ];
}

function stock(ctx: UiCtx, id: number): (Node | null)[] {
  const g = ctx.game, s = g.shop(id)!;
  const prods = productsOf(s.type);
  const head = el('tr', {}, ...['Produit', 'Stock', 'Prix de vente', 'Marge / u.', 'Auto', 'Commander'].map((h, k) => el('th', { cls: k >= 3 ? 'c' : '', text: h })));
  const tbl = el('table', { cls: 'tbl stock sp-stock' }, head);
  let empty = 0, pendingAll = 0, value = 0;
  for (const p of prods) {
    const ps = s.products[p.id]!, cap = g.storageFor(s, p), pend = g.pendingQty(id, p.id);
    const unitCost = g.orderCost(p.id, 1, id), ref = g.refPrice(p, s);
    value += ps.stock * unitCost; pendingAll += pend;
    if (ps.stock === 0 && cap > 0) empty++;
    const price = el('input', { cls: 'price', attrs: { type: 'number', step: '0.1', min: '0', value: String(ps.price), 'aria-label': `Prix ${p.nameFr}` } });
    // Champ vidé ou invalide : ignoré (on remet le prix actuel) plutôt que de tomber au prix plancher.
    price.addEventListener('change', () => { const v = Number(price.value); if (price.value.trim() === '' || !Number.isFinite(v) || v <= 0) { price.value = String(ps.price); return; } ctx.act(g.setPrice(id, p.id, v)); });
    const auto = el('input', { attrs: { type: 'checkbox', 'aria-label': `Réassort automatique ${p.nameFr}` } });
    auto.checked = ps.auto;
    auto.addEventListener('change', () => ctx.act(g.setAuto(id, p.id, auto.checked)));
    const room = g.room(s, p.id);
    // Écart au prix du quartier.
    const gap = ref > 0 ? ps.price / ref - 1 : 0;
    const gapTone: Tone = gap > 0.3 ? 'bad' : gap > 0.1 ? 'warn' : gap < -0.1 ? 'muted' : 'ok';
    const gapText = Math.abs(gap) < 0.005 ? 'au prix' : `${gap > 0 ? '+' : '−'}${Math.round(Math.abs(gap) * 100)} %`;
    // Stock : jauge colorée selon le remplissage.
    const frac = cap > 0 ? ps.stock / cap : 0;
    const stTone: Tone = cap === 0 ? 'muted' : ps.stock === 0 ? 'bad' : frac < 0.25 ? 'warn' : 'ok';
    const marginU = ps.price - unitCost, marginP = ps.price > 0 ? marginU / ps.price : 0;
    const est = room > 0 ? g.orderCost(p.id, room, id) : 0;
    const orderBtn = button(room > 0 ? `+${room}` : 'Plein', () => ctx.act(g.order(id, p.id, room), (o) => `Livraison ${g.deliveryLabel(o.deliverAt)} : ${o.qty} ${p.nameFr.toLowerCase()} (${chf2(o.cost)}).`), room > 0 ? 'small order' : 'small');
    if (room > 0) orderBtn.title = `Commander ${room} unités (environ ${chf(est + g.deliveryFee(est, id))} livraison comprise)`;
    tbl.append(el('tr', { cls: stTone === 'bad' ? 'row-bad' : '' },
      el('td', {}, el('b', { text: p.nameFr }), el('div', { cls: 'sub', text: `achat ${chf2(unitCost)}${p.needsMachine ? ' · machine' : ''}` })),
      el('td', { cls: `sp-st ${ps.stock === 0 && cap > 0 ? 'bad' : ''}`.trim() },
        el('div', { cls: 'sp-stnum' }, el('b', { text: String(ps.stock) }), el('span', { text: ` / ${cap}` }), pend ? el('em', { text: `+${pend} ${g.deliveryLabel(Math.min(...g.orders.filter((o) => o.shopId === id && o.productId === p.id).map((o) => o.deliverAt)))}` }) : null),
        cap > 0 ? meter(frac, stTone, 'thin') : el('div', { cls: 'sub', text: 'aucun meuble adapté' })),
      el('td', {}, el('div', { cls: 'sp-price' }, price, el('span', { cls: `gap ${gapTone}`, text: gapText })), el('div', { cls: 'sub', text: `quartier ${chf2(ref)}` })),
      el('td', { cls: 'c' }, el('b', { cls: marginU >= 0 ? '' : 'bad', text: chf2(marginU) }), el('div', { cls: 'sub', text: `${Math.round(marginP * 100)} %` })),
      el('td', { cls: 'c' }, auto),
      el('td', { cls: 'c' }, orderBtn)));
  }
  return [
    ...rangeBlock(ctx, id),
    el('div', { cls: 'sp-strip' },
      stat('Ruptures', String(empty), null, empty ? 'bad' : 'ok'),
      stat('En commande', `${num(pendingAll)} u.`, 'livraisons à 7 h et 14 h'),
      stat('Valeur du stock', chf(value), 'au prix d’achat')),
    tbl,
    el('p', { cls: 'sp-note', text: `Commander = livraison au prochain passage du grossiste (7 h ou 14 h, commande au moins 2 h avant ; prochain : ${g.deliveryLabel()}), frais de livraison en plus. Moins cher : acheter chez le grossiste et transporter vous-même. Auto : à 11 h et à 21 h, commande de quoi remplir le rayon s’il est rempli à moins de 75 %, livrée au passage suivant. Écart : votre prix comparé à celui du quartier ; dès qu’il le dépasse, des clients reposent l’article (environ 1 sur 5 à +10 %, 1 sur 2 à +30 %).` }),
  ];
}

/** Gamme du commerce : standard ou premium (mise en place payée une fois, clientèle selon la réputation). */
function rangeBlock(ctx: UiCtx, id: number): (Node | null)[] {
  const g = ctx.game, s = g.shop(id)!, def = PREMIUM_BY_TYPE.get(s.type)!;
  const demand = premiumDemand(s.reputation), trained = g.bestTraining(id) >= PREMIUM.minTraining;
  const effect = `Prix du quartier ×${String(PREMIUM.priceMult).replace('.', ',')}, achats ×${String(PREMIUM.costMult).replace('.', ',')}. Clientèle premium avec votre réputation (${pct(s.reputation)}) : ${pct(demand)} de la clientèle standard.`;
  let action: HTMLElement;
  if (s.premium) action = button('Revenir à la gamme standard', () => ctx.act(g.setPremium(id, false)), 'small');
  else if (s.premiumOwned) action = button('Repasser en gamme premium', () => ctx.act(g.setPremium(id, true)), 'small primary');
  else action = button(`Passer en gamme premium (${chf(def.cost)})`, () => void askConfirm(`Passer ${s.name} en gamme « ${def.nameFr} » pour ${chf(def.cost)} ? Les prix de vente sont multipliés par ${String(PREMIUM.priceMult).replace('.', ',')}.`, 'Monter en gamme').then((y) => { if (y) ctx.act(g.setPremium(id, true), 'Gamme premium en place.'); }), trained ? 'small primary' : 'small');
  return [
    section('Gamme', badge(s.premium ? def.nameFr : 'Standard', s.premium ? 'ok' : 'muted')),
    el('div', { cls: 'item' }, el('div', {}, el('b', { text: def.nameFr }), el('div', { cls: 'sub', text: `${def.desc} ${effect}` }),
      !s.premium && !trained ? el('div', { cls: 'sub bad', text: 'Il faut d’abord un employé formé dans ce commerce (onglet Employés › Former).' }) : null), action),
  ];
}

function equipe(ctx: UiCtx, id: number): (Node | null)[] {
  const g = ctx.game, s = g.shop(id)!, staff = g.staffOf(id), st = g.stats(s);
  const wagesDay = staff.reduce((a, e) => a + e.wage * g.hoursPerDay(e), 0);
  const count = (r: StaffRole): number => staff.filter((e) => g.roleOf(e) === r).length;
  const here = isOpen(g, s) ? g.onDuty(id) : [];
  const gaps = g.cashierGaps(id);
  const shelf = g.shelfBonus(s);
  // Planning : une case par heure d'ouverture, nombre de caissiers présents.
  const hours: HTMLElement[] = [];
  for (let h = s.open; h < s.close; h++) {
    const n = g.onDuty(id, 'caisse', h).length;
    hours.push(el('span', { cls: `emp-hour ${n ? (n >= Math.max(1, st.registers) ? 'ok' : 'warn') : 'bad'}`, text: String(h), attrs: { title: `${h} h : ${n} caissier(s), ${g.onDuty(id, undefined, h).length} employé(s) présent(s)` } }));
  }
  return [
    el('div', { cls: 'sp-strip' },
      stat('Employés', String(staff.length), staff.length ? `${count('caisse')} caisse · ${count('rayon')} rayon · ${count('entretien')} entretien` : 'personne', staff.length ? '' : 'warn'),
      stat('Présents', isOpen(g, s) ? String(here.length) : 'fermé', isOpen(g, s) ? `${here.filter((e) => g.roleOf(e) === 'caisse').length} en caisse${shelf > 0 ? ` · rayon +${pct(shelf)} clients` : ''}` : null),
      stat('Caisses', String(st.registers), st.registers ? `jusqu’à ${st.registers * ECONOMY.servePerRegister} clients / h` : 'aucune', st.registers ? '' : 'bad'),
      stat('Salaires', `${chf(wagesDay)} / jour`, 'payés à l’heure travaillée')),
    section('Caissiers par heure', gaps.length ? 'trou dans le planning' : staff.length ? 'caisse toujours tenue' : null),
    el('div', { cls: 'emp-hours' }, ...hours),
    gaps.length ? el('p', { cls: 'sp-note emp-alert', text: `Aucun caissier ${gaps.map(([a, b]) => `de ${a} h à ${b} h`).join(', ')} : les clients ne peuvent pas payer (sauf si vous tenez la caisse). Passez un employé au rôle Caisse, changez son équipe, ou embauchez.` }) : null,
    section('Équipe'),
    ...(staff.length ? staff.map((e) => employeeRow(ctx, e.id)) : [el('div', { cls: 'sp-empty', text: 'Aucun employé affecté à ce commerce.' })]),
    el('p', { cls: 'sp-note', text: `Rôles — Caisse : sert jusqu’à ${ECONOMY.servePerRegister} clients par heure selon sa compétence (un caissier de plus que de caisses ne sert pas plus). Rayon : conseille et présente, +${pct(STAFF.shelfBonus)} de clients attirés par employé présent (selon compétence, jusqu’à +${pct(STAFF.shelfBonusMax)}). Entretien : garde le commerce propre. Équipes — matin (avant 14 h), soir (dès 14 h) ou journée complète, toujours dans les horaires d’ouverture ; un employé n’est payé et ne compte que pendant son équipe. Respectez l’équipe souhaitée et le salaire minimum pour garder vos employés satisfaits. Deux employés présents ou plus découragent les voleurs. Former : +${pct(TRAINING.capacity)} de clients servis par niveau, mais le salaire du marché monte de ${TRAINING.wage} CHF / h. Un employé formé permet la gamme premium. Pour embaucher : agence pour l’emploi. Vous pouvez aussi tenir la caisse vous-même (E derrière la caisse).` }),
  ];
}

function horaires(ctx: UiCtx, id: number): (Node | null)[] {
  const g = ctx.game, s = g.shop(id)!;
  const sel = (v: number, from: number, to: number, label: string): HTMLSelectElement => {
    const e = el('select', { attrs: { 'aria-label': label } }, ...Array.from({ length: to - from + 1 }, (_, k) => el('option', { text: `${from + k} h`, attrs: { value: String(from + k) } })));
    e.value = String(v);
    return e;
  };
  const o = sel(s.open, 5, 19, 'Ouverture'), c = sel(s.close, 9, 23, 'Fermeture');
  const save = (): void => { ctx.act(g.setHours(id, Number(o.value), Number(c.value)), 'Horaires enregistrés.'); };
  o.addEventListener('change', save); c.addEventListener('change', save);
  const t = SHOP_TYPE_BY_ID.get(s.type)!;
  const peak = t.hourly.map((v, h) => [h, v] as const).filter(([, v]) => v >= 0.8).map(([h]) => `${h} h`).join(', ');
  const maxH = Math.max(...t.hourly, 0.01);
  // Bandeau 5 h – 23 h : demande relative par heure, heures d'ouverture surlignées.
  const strip = el('div', { cls: 'sp-hstrip' }, ...Array.from({ length: 19 }, (_, k) => {
    const h = 5 + k, v = t.hourly[h] ?? 0, on = h >= s.open && h < s.close;
    return el('div', { cls: `hcol${on ? ' on' : ''}${v >= 0.8 ? ' peak' : ''}`, attrs: { title: `${h} h` } },
      el('i', { attrs: { style: `height:${Math.round((v / maxH) * 100)}%` } }), el('span', { text: h % 2 === 1 ? String(h) : '' }));
  }));
  return [
    el('div', { cls: 'sp-hours-row' }, el('label', { cls: 'field' }, el('span', { text: 'Ouverture' }), o), el('span', { cls: 'sp-dash', text: '→' }), el('label', { cls: 'field' }, el('span', { text: 'Fermeture' }), c),
      el('div', { cls: 'sp-hours-sum' }, el('b', { text: `${s.close - s.open} h` }), el('span', { text: 'par jour' }))),
    section('Demande des clients par heure', legend([['#ffcc4d', 'ouvert'], ['#3a4a60', 'fermé']])),
    strip,
    el('p', { cls: 'sp-note', text: `Heures d’affluence pour ce type : ${peak || '—'}. Les salaires sont payés à chaque heure d’ouverture : ouvrez sur les pointes, fermez les heures creuses.` }),
  ];
}

function resultats(ctx: UiCtx, id: number): (Node | null)[] {
  const g = ctx.game, s = g.shop(id)!;
  const days = [...s.history.slice(-13), s.today];
  const past = s.history.slice(-7);
  const avg = past.length ? past.reduce((a, d) => a + shopResult(d), 0) / past.length : 0;
  const best = past.reduce((m, d) => Math.max(m, d.revenue), 0);
  return [
    el('div', { cls: 'sp-strip' },
      stat('Résultat moyen', past.length ? signed(avg) : '—', past.length ? `sur ${past.length} jour(s)` : 'pas encore de bilan', avg >= 0 ? 'ok' : 'bad'),
      stat('Meilleures ventes', past.length ? chf(best) : '—', '7 derniers jours'),
      stat('Dépôt de garantie', chf(s.deposit), 'rendu à la résiliation')),
    section('14 derniers jours', legend([['rgba(95,195,255,0.7)', 'ventes'], ['#5cc77a', 'marge après salaires et loyer']])),
    chart(days.map((d) => d.revenue), days.map(shopResult)),
    ledger(days.slice().reverse(), false),
    el('div', { cls: 'sp-danger' }, el('div', {}, el('b', { text: 'Résilier le bail' }), el('div', { cls: 'sub', text: releaseText(g, id) })),
      button('Résilier le bail…', () => void askConfirm(`Résilier le bail de ${s.name} ? ${releaseText(g, id)}`, 'Résilier', true).then((y) => { if (y) { ctx.act(g.release(id), (t) => `Bail résilié : ${chf(t)} récupérés.`); ctx.panel.close(); } }), 'danger')),
  ];
}

/** Décompte de la résiliation, en clair (montant net réellement versé, stock perdu). */
function releaseText(g: Game, id: number): string {
  const q = g.releaseQuote(id);
  if (!q) return '';
  const parts = [`dépôt ${chf(q.deposit)}`, `mobilier revendu à 40 % ${chf(q.resale)}`];
  if (q.refunds > 0) parts.push(`commandes et publicité remboursées ${chf(q.refunds)}`);
  if (q.rentDue > 0) parts.push(`moins le loyer dû ${chf(q.rentDue)}`);
  return `Vous récupérez ${chf(q.total)} (${parts.join(', ')}).${q.stockUnits > 0 ? ` Le stock en rayon (${num(q.stockUnits)} articles, ${chf(q.stockValue)} à l’achat) est perdu.` : ''}`;
}

function ledger(days: DayStats[], all: boolean): HTMLElement {
  return el('table', { cls: 'tbl ledger' }, el('tr', {}, ...['Jour', 'Clients', 'Ventes', 'Achats', 'Salaires', all ? 'Autres' : 'Loyer', 'Solde'].map((h, k) => el('th', { cls: k ? 'n' : '', text: h }))),
    ...days.map((d) => {
      const other = all ? d.rent + d.equipment + d.marketing + d.finance + d.living : d.rent;
      const p = all ? dayProfit(d) : d.revenue - d.purchases - d.wages - d.rent - d.equipment - d.marketing;
      return el('tr', {}, el('td', { text: String(d.day + 1) }), el('td', { cls: 'n', text: num(d.customers) }), el('td', { cls: 'n', text: chf(d.revenue) }), el('td', { cls: 'n', text: chf(d.purchases) }), el('td', { cls: 'n', text: chf(d.wages) }), el('td', { cls: 'n', text: chf(other) }), el('td', { text: signed(p), cls: `n ${p >= 0 ? 'ok' : 'bad'}` }));
    }));
}

/** Petit graphique : barres (valeurs a) et ligne (valeurs b), axe zéro tracé. */
function chart(a: number[], b: number[]): SVGSVGElement {
  const W = 560, H = 130, n = a.length;
  const max = Math.max(1, ...a, ...b.map(Math.abs));
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'chart');
  const y0 = H - 18, sc = (y0 - 6) / max, bw = W / Math.max(1, n);
  a.forEach((v, k) => { const r = document.createElementNS(ns, 'rect'); r.setAttribute('x', String(k * bw + 3)); r.setAttribute('width', String(bw - 6)); r.setAttribute('y', String(y0 - v * sc)); r.setAttribute('height', String(v * sc)); r.setAttribute('rx', '2'); r.setAttribute('fill', 'rgba(95,195,255,0.55)'); svg.append(r); });
  const pl = document.createElementNS(ns, 'polyline');
  pl.setAttribute('points', b.map((v, k) => `${k * bw + bw / 2},${y0 - Math.max(-6, v) * sc}`).join(' '));
  pl.setAttribute('fill', 'none'); pl.setAttribute('stroke', '#5cc77a'); pl.setAttribute('stroke-width', '2.5'); pl.setAttribute('stroke-linejoin', 'round');
  svg.append(pl);
  b.forEach((v, k) => { const c = document.createElementNS(ns, 'circle'); c.setAttribute('cx', String(k * bw + bw / 2)); c.setAttribute('cy', String(y0 - Math.max(-6, v) * sc)); c.setAttribute('r', '2.6'); c.setAttribute('fill', v >= 0 ? '#5cc77a' : '#ef6b6b'); svg.append(c); });
  const base = document.createElementNS(ns, 'line');
  base.setAttribute('x1', '0'); base.setAttribute('x2', String(W)); base.setAttribute('y1', String(y0)); base.setAttribute('y2', String(y0)); base.setAttribute('stroke', 'rgba(255,255,255,0.25)');
  svg.append(base);
  return svg;
}

/* ------------------------------ Entreprise ------------------------------ */

export function companyView(ctx: UiCtx): View {
  const g = ctx.game;
  return {
    kicker: 'Entreprise', title: g.companyName, wide: true,
    render: () => {
      const days = [...g.ledger.slice(-13), g.today];
      const today = dayProfit(g.today);
      const out: (Node | null)[] = [
        el('div', { cls: 'sp-stats sp-stats-co' },
          stat('Trésorerie', chf(g.cash), null, g.cash >= 0 ? '' : 'bad'),
          stat('Dette', chf(g.debt), g.loans.length ? `${g.loans.length} prêt(s)` : 'aucun prêt', g.debt > 0 ? 'warn' : ''),
          stat('Solde du jour', signed(today), 'toutes dépenses', today >= 0 ? 'ok' : 'bad'),
          stat('Valeur nette', chf(netWorth(g)), rankOf(g.achieved.length))),
        section('Mes commerces', g.shops.length ? `${g.shops.length}` : null),
      ];
      if (!g.shops.length) out.push(el('div', { cls: 'sp-empty', text: 'Aucun commerce. Repérez les anneaux jaunes devant les locaux à louer (carte : touche M).' }));
      for (const s of g.shops) {
        const p = g.premise(s.premiseId)!, t = SHOP_TYPE_BY_ID.get(s.type)!, open = isOpen(g, s);
        out.push(el('div', { cls: 'item sp-shoprow', attrs: { style: `--shop:${t.color}` } },
          el('div', { cls: 'sp-shoprow-id' }, el('div', { cls: 'sp-sign sm', text: t.nameFr.slice(0, 1).toUpperCase() }),
            el('div', {}, el('b', { text: s.name }), el('div', { cls: 'sub', text: `${t.nameFr} · ${open ? 'ouvert' : 'fermé'} · ${g.staffOf(s.id).length} employé(s)` }))),
          el('div', { cls: 'sp-shoprow-n' }, el('b', { text: chf(s.today.revenue) }), el('div', { cls: 'sub', text: `${num(s.today.customers)} clients` })),
          el('div', { cls: 'row tight' }, button('Gérer', () => ctx.openShop(s.id), 'small'), button('Y aller', () => ctx.waypoint(p.doorX, p.doorZ, s.name), 'small'))));
      }
      if (g.vehicles.length) {
        out.push(section('Véhicules'));
        for (const v of g.vehicles) {
          const load = Object.entries(v.cargo).map(([k, n]) => `${n} ${PRODUCT_BY_ID.get(k)!.nameFr.toLowerCase()}`).join(', ');
          out.push(el('div', { cls: 'item' }, el('div', {}, el('b', { text: VEHICLE_BY_ID.get(v.type)!.nameFr }), el('div', { cls: 'sub', text: load || 'vide' })), button('Y aller', () => ctx.waypoint(v.x, v.z, 'Véhicule'), 'small')));
        }
      }
      const ct = g.contractDef();
      if (ct) out.push(el('p', { cls: 'sp-note', text: `${ct.nameFr} avec le grossiste : −${pct(ct.discount)} sur les achats, ${chf(ct.perDay)} / jour.` }));
      if (g.loans.length) out.push(el('p', { cls: 'sp-note', text: `Prêts : ${g.loans.map((l) => `${chf(l.remaining)} restants (${chf2(l.daily)} / jour)`).join(' · ')}` }));
      out.push(section('Objectifs', `${g.achieved.length} / ${OBJECTIVES.length}`),
        el('ul', { cls: 'sp-checks objlist' }, ...OBJECTIVES.map((o) => {
          const done = g.achieved.includes(o.id);
          return el('li', { cls: done ? 'ok' : 'todo' }, el('i', { attrs: { 'aria-hidden': 'true' } }), el('span', { text: o.title }), done ? null : el('small', { text: o.progress(g).text }));
        })));
      out.push(section('Journal (toutes dépenses)', legend([['rgba(95,195,255,0.7)', 'ventes'], ['#5cc77a', 'solde']])), chart(days.map((d) => d.revenue), days.map(dayProfit)), ledger(days.slice().reverse(), true));
      return out;
    },
  };
}

/** Barres par heure (6 h – 23 h) : clients servis (vert) et perdus (rouge) ; zone grisée hors ouverture. */
function hourChart(served: number[], lost: number[], open: number, close: number): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg', W = 560, H = 100, h0 = 6, n = 18;
  const max = Math.max(1, ...served.map((v, k) => v + (lost[k] ?? 0)));
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'chart');
  const bw = W / n, y0 = H - 14;
  const rect = (x: number, y: number, w: number, h: number, fill: string): void => { const r = document.createElementNS(ns, 'rect'); r.setAttribute('x', String(x)); r.setAttribute('y', String(y)); r.setAttribute('width', String(w)); r.setAttribute('height', String(Math.max(0, h))); r.setAttribute('fill', fill); svg.append(r); };
  for (let k = 0; k < n; k++) {
    const hr = h0 + k, x = k * bw;
    if (hr < open || hr >= close) rect(x, 0, bw, y0, 'rgba(42,54,71,0.55)');
    const sv = served[hr] ?? 0, ls = lost[hr] ?? 0, sc = (y0 - 4) / max;
    rect(x + 2, y0 - sv * sc, bw - 4, sv * sc, 'rgba(92,199,122,0.85)');
    rect(x + 2, y0 - (sv + ls) * sc, bw - 4, ls * sc, 'rgba(239,107,107,0.85)');
    if (k % 3 === 0) { const t = document.createElementNS(ns, 'text'); t.setAttribute('x', String(x + 2)); t.setAttribute('y', String(H - 2)); t.setAttribute('fill', '#9fb0c2'); t.setAttribute('font-size', '10'); t.textContent = `${hr} h`; svg.append(t); }
  }
  const base = document.createElementNS(ns, 'line');
  base.setAttribute('x1', '0'); base.setAttribute('x2', String(W)); base.setAttribute('y1', String(y0)); base.setAttribute('y2', String(y0)); base.setAttribute('stroke', 'rgba(255,255,255,0.25)');
  svg.append(base);
  return svg;
}
