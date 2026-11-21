/**
 * Gestion d'un commerce (depuis l'intérieur ou à distance) : aperçu et liste de contrôle, prix et stock (commande
 * livrée, réassort automatique), employés, horaires, résultats. Et le panneau Entreprise : trésorerie, journal,
 * commerces, véhicules, prêts, campagnes.
 */
import { FURNITURE_BY_ID, SHOP_TYPE_BY_ID, VEHICLE_BY_ID, productsOf, PRODUCT_BY_ID } from '../sim/catalog';
import { clockView } from '../sim/clock';
import { dayProfit, type DayStats } from '../sim/game';
import { OBJECTIVES, netWorth, rankOf } from '../sim/objectives';
import { askConfirm, button, chf, chf2, el, num, pct, signed } from './dom';
import { employeeRow, kpi, type UiCtx } from './dialogs';
import type { View } from './panel';

type Tab = 'apercu' | 'stock' | 'equipe' | 'horaires' | 'resultats';
const TABS: [Tab, string][] = [['apercu', 'Aperçu'], ['stock', 'Prix et stock'], ['equipe', 'Employés'], ['horaires', 'Horaires'], ['resultats', 'Résultats']];
let tab: Tab = 'apercu';
let lastShop = -1;

export function shopView(ctx: UiCtx, shopId: number): View {
  const g = ctx.game;
  if (lastShop !== shopId) { tab = 'apercu'; lastShop = shopId; }
  return {
    kicker: 'Mon commerce', title: g.shop(shopId)?.name ?? '', wide: true,
    render: () => {
      const s = g.shop(shopId);
      if (!s) return [el('p', { text: 'Ce commerce n’existe plus.' })];
      const tabs = el('div', { cls: 'tabs' }, ...TABS.map(([id, label]) => button(label, () => { tab = id; ctx.panel.paint(true); }, tab === id ? 'on' : '')));
      return [tabs, ...({ apercu, stock, equipe, horaires, resultats }[tab])(ctx, shopId)];
    },
  };
}

function apercu(ctx: UiCtx, id: number): (Node | null)[] {
  const g = ctx.game, s = g.shop(id)!, st = g.stats(s), t = SHOP_TYPE_BY_ID.get(s.type)!;
  const c = clockView(g.total);
  const open = c.hour >= s.open && c.hour < s.close;
  const staff = g.staffOf(id);
  const anyStock = productsOf(s.type).some((p) => s.products[p.id]!.stock > 0);
  const anyShelf = productsOf(s.type).some((p) => st.capacity[p.store] > 0);
  const checks: [boolean, string][] = [
    [st.registers > 0, 'Une caisse posée'],
    [anyShelf, 'Des meubles de présentation adaptés'],
    [s.type !== 'cafe' || st.machines > 0, 'Machine à café (café, thé)'],
    [anyStock, 'De la marchandise en rayon'],
    [staff.length > 0 || g.player.tending === id, 'Quelqu’un à la caisse (employé, ou vous)'],
    [st.blocked.length === 0, 'Tous les meubles accessibles'],
  ];
  const lost = s.today.lostStaff + s.today.lostStock + s.today.lostCapacity;
  return [
    el('div', { cls: 'kpis' },
      kpi('État', open ? (s.capacity > 0 ? 'Ouvert' : 'Ouvert, sans caissier') : `Fermé (${s.open} h – ${s.close} h)`),
      kpi('Clients aujourd’hui', num(s.today.customers)), kpi('Ventes', chf(s.today.revenue))),
    el('div', { cls: 'kpis' }, kpi('Clients perdus', num(lost)), kpi('Réputation', pct(s.reputation)), kpi('Attrait', s.rate > 0 || open ? g.attractiveness(s).toFixed(2) : '—')),
    el('div', { cls: 'sec', text: `Pour ouvrir (${t.nameFr})` }),
    el('ul', { cls: 'checks' }, ...checks.map(([ok, label]) => el('li', { cls: ok ? 'ok' : 'todo', text: `${ok ? '✓' : '•'} ${label}` }))),
    lost || s.today.refusedPrice ? el('p', { cls: 'muted small', text: `Avis du jour : ${s.today.lostStaff} sans caissier, ${s.today.lostStock} rupture ou trop cher, ${s.today.lostCapacity} attente trop longue, ${s.today.refusedPrice} article(s) reposé(s) pour le prix.` }) : null,
    Object.keys(s.storage).length ? el('p', { cls: 'small', text: `Réserve : ${Object.entries(s.storage).map(([k, n]) => `${n} × ${FURNITURE_BY_ID.get(k)!.nameFr}`).join(', ')} — posez-les avec « Aménager ».` }) : null,
    el('div', { cls: 'sec', text: 'Affluence aujourd’hui (servis / perdus par heure)' }),
    hourChart(s.hourServed ?? [], s.hourLost ?? [], s.open, s.close),
    g.marketingBoost(id) > 0 ? el('p', { cls: 'small ok', text: `Publicité en cours : +${pct(g.marketingBoost(id))} de clients.` }) : null,
  ];
}

function stock(ctx: UiCtx, id: number): (Node | null)[] {
  const g = ctx.game, s = g.shop(id)!;
  const tbl = el('table', { cls: 'tbl stock' }, el('tr', {}, el('th', { text: 'Produit' }), el('th', { text: 'Stock' }), el('th', { text: 'Prix (réf.)' }), el('th', { text: 'Auto' }), el('th', { text: 'Commander' })));
  for (const p of productsOf(s.type)) {
    const ps = s.products[p.id]!, cap = g.storageFor(s, p), pend = g.pendingQty(id, p.id);
    const price = el('input', { cls: 'price', attrs: { type: 'number', step: '0.1', min: '0', value: String(ps.price), 'aria-label': `Prix ${p.nameFr}` } });
    price.addEventListener('change', () => ctx.act(g.setPrice(id, p.id, Number(price.value))));
    const auto = el('input', { attrs: { type: 'checkbox', 'aria-label': `Réassort automatique ${p.nameFr}` } });
    auto.checked = ps.auto;
    auto.addEventListener('change', () => ctx.act(g.setAuto(id, p.id, auto.checked)));
    const room = g.room(s, p.id);
    tbl.append(el('tr', {},
      el('td', {}, el('b', { text: p.nameFr }), el('div', { cls: 'muted small', text: `achat ${chf2(p.cost * g.marketIndex(p.id))}${p.needsMachine ? ' · machine' : ''}` })),
      el('td', { text: `${ps.stock} / ${cap}${pend ? ` (+${pend})` : ''}`, cls: ps.stock === 0 && cap > 0 ? 'bad' : '' }),
      el('td', {}, price, el('div', { cls: 'muted small', text: `quartier ${chf2(g.refPrice(p))}` })),
      el('td', {}, auto),
      el('td', {}, button(room > 0 ? `+${room}` : 'Plein', () => ctx.act(g.order(id, p.id, room), (o) => `Livraison demain 7 h : ${o.qty} ${p.nameFr.toLowerCase()} (${chf2(o.cost)}).`), 'small'))));
  }
  return [tbl, el('p', { cls: 'muted small', text: 'Commander d’ici = livraison (frais). Moins cher : acheter chez le grossiste et transporter vous-même. Auto : commande livrée chaque soir à 21 h quand le rayon est à moitié vide.' })];
}

function equipe(ctx: UiCtx, id: number): (Node | null)[] {
  const g = ctx.game, staff = g.staffOf(id), st = g.stats(g.shop(id)!);
  return [
    el('p', { cls: 'small', text: `${staff.length} employé(s) · ${st.registers} caisse(s). Chaque caissier sert jusqu’à 28 clients par heure selon sa compétence ; les autres réassortent.` }),
    ...staff.map((e) => employeeRow(ctx, e.id)),
    el('p', { cls: 'muted small', text: 'Pour embaucher, rendez-vous à l’agence pour l’emploi. Vous pouvez aussi tenir la caisse vous-même (E derrière la caisse).' }),
  ];
}

function horaires(ctx: UiCtx, id: number): (Node | null)[] {
  const g = ctx.game, s = g.shop(id)!;
  const sel = (v: number, from: number, to: number): HTMLSelectElement => {
    const e = el('select', {}, ...Array.from({ length: to - from + 1 }, (_, k) => el('option', { text: `${from + k} h`, attrs: { value: String(from + k) } })));
    e.value = String(v);
    return e;
  };
  const o = sel(s.open, 5, 19), c = sel(s.close, 9, 23);
  const save = (): void => { ctx.act(g.setHours(id, Number(o.value), Number(c.value)), 'Horaires enregistrés.'); };
  o.addEventListener('change', save); c.addEventListener('change', save);
  const t = SHOP_TYPE_BY_ID.get(s.type)!;
  const peak = t.hourly.map((v, h) => [h, v] as const).filter(([, v]) => v >= 0.8).map(([h]) => `${h} h`).join(', ');
  return [el('div', { cls: 'row' }, el('label', { cls: 'field' }, el('span', { text: 'Ouverture' }), o), el('label', { cls: 'field' }, el('span', { text: 'Fermeture' }), c)),
    el('p', { cls: 'muted small', text: `Heures d’affluence pour ce type : ${peak}. Les salaires sont payés à chaque heure d’ouverture.` })];
}

function resultats(ctx: UiCtx, id: number): (Node | null)[] {
  const g = ctx.game, s = g.shop(id)!;
  const days = [...s.history.slice(-13), s.today];
  return [chart(days.map((d) => d.revenue), days.map((d) => d.revenue - d.costOfSales - d.wages - d.rent)),
    el('p', { cls: 'muted small', text: 'Barres : ventes. Ligne : marge après salaires et loyer.' }),
    ledger(days.slice().reverse(), false),
    button('Résilier le bail…', () => void askConfirm(`Résilier le bail de ${s.name} ? Le dépôt est rendu et le mobilier revendu à 40 %.`, 'Résilier', true).then((y) => { if (y) { ctx.act(g.release(id)); ctx.panel.close(); } }), 'danger')];
}

function ledger(days: DayStats[], all: boolean): HTMLElement {
  return el('table', { cls: 'tbl' }, el('tr', {}, el('th', { text: 'Jour' }), el('th', { text: 'Clients' }), el('th', { text: 'Ventes' }), el('th', { text: 'Achats' }), el('th', { text: 'Salaires' }), el('th', { text: all ? 'Autres' : 'Loyer' }), el('th', { text: 'Solde' })),
    ...days.map((d) => {
      const other = all ? d.rent + d.equipment + d.marketing + d.finance + d.living : d.rent;
      const p = all ? dayProfit(d) : d.revenue - d.purchases - d.wages - d.rent - d.equipment - d.marketing;
      return el('tr', {}, el('td', { text: String(d.day + 1) }), el('td', { text: num(d.customers) }), el('td', { text: chf(d.revenue) }), el('td', { text: chf(d.purchases) }), el('td', { text: chf(d.wages) }), el('td', { text: chf(other) }), el('td', { text: signed(p), cls: p >= 0 ? 'ok' : 'bad' }));
    }));
}

/** Petit graphique : barres (valeurs a) et ligne (valeurs b). */
function chart(a: number[], b: number[]): SVGSVGElement {
  const W = 360, H = 120, n = a.length;
  const max = Math.max(1, ...a, ...b.map(Math.abs));
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'chart');
  const y0 = H - 18, sc = (y0 - 6) / max, bw = W / Math.max(1, n);
  a.forEach((v, k) => { const r = document.createElementNS(ns, 'rect'); r.setAttribute('x', String(k * bw + 3)); r.setAttribute('width', String(bw - 6)); r.setAttribute('y', String(y0 - v * sc)); r.setAttribute('height', String(v * sc)); r.setAttribute('fill', 'rgba(95,195,255,0.55)'); svg.append(r); });
  const pl = document.createElementNS(ns, 'polyline');
  pl.setAttribute('points', b.map((v, k) => `${k * bw + bw / 2},${y0 - Math.max(-6, v) * sc}`).join(' '));
  pl.setAttribute('fill', 'none'); pl.setAttribute('stroke', '#5cc77a'); pl.setAttribute('stroke-width', '2.5');
  svg.append(pl);
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
      const out: (Node | null)[] = [
        el('div', { cls: 'kpis' }, kpi('Trésorerie', chf(g.cash)), kpi('Dette', chf(g.debt)), kpi('Solde du jour', signed(dayProfit(g.today)))),
        el('div', { cls: 'sec', text: 'Mes commerces' }),
      ];
      if (!g.shops.length) out.push(el('p', { cls: 'muted small', text: 'Aucun commerce. Repérez les anneaux jaunes devant les locaux à louer (carte : touche M).' }));
      for (const s of g.shops) {
        const p = g.premise(s.premiseId)!;
        out.push(el('div', { cls: 'item' }, el('div', {}, el('b', { text: s.name }), el('div', { cls: 'muted small', text: `${s.today.customers} clients · ${chf(s.today.revenue)} aujourd’hui · ${g.staffOf(s.id).length} employé(s)` })),
          el('div', { cls: 'row tight' }, button('Gérer', () => ctx.openShop(s.id), 'small'), button('Y aller', () => ctx.waypoint(p.doorX, p.doorZ, s.name), 'small'))));
      }
      if (g.vehicles.length) {
        out.push(el('div', { cls: 'sec', text: 'Véhicules' }));
        for (const v of g.vehicles) {
          const load = Object.entries(v.cargo).map(([k, n]) => `${n} ${PRODUCT_BY_ID.get(k)!.nameFr.toLowerCase()}`).join(', ');
          out.push(el('div', { cls: 'item' }, el('div', {}, el('b', { text: VEHICLE_BY_ID.get(v.type)!.nameFr }), el('div', { cls: 'muted small', text: load || 'vide' })), button('Y aller', () => ctx.waypoint(v.x, v.z, 'Véhicule'), 'small')));
        }
      }
      out.push(el('div', { cls: 'sec', text: `Objectifs · ${rankOf(g.achieved.length)} · valeur nette ${chf(netWorth(g))}` }),
        el('ul', { cls: 'checks objlist' }, ...OBJECTIVES.map((o) => { const done = g.achieved.includes(o.id); return el('li', { cls: done ? 'ok' : 'todo', text: `${done ? '✓' : '•'} ${o.title}${done ? '' : ` — ${o.progress(g).text}`}` }); })));
      if (g.loans.length) out.push(el('p', { cls: 'small', text: `Prêts : ${g.loans.map((l) => `${chf(l.remaining)} restants (${chf2(l.daily)} / jour)`).join(' · ')}` }));
      out.push(el('div', { cls: 'sec', text: 'Journal (toutes dépenses)' }), chart(days.map((d) => d.revenue), days.map(dayProfit)), ledger(days.slice().reverse(), true));
      return out;
    },
  };
}

/** Barres par heure (6 h – 23 h) : clients servis (vert) et perdus (rouge) ; zone grisée hors ouverture. */
function hourChart(served: number[], lost: number[], open: number, close: number): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg', W = 360, H = 90, h0 = 6, n = 18;
  const max = Math.max(1, ...served.map((v, k) => v + (lost[k] ?? 0)));
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'chart');
  const bw = W / n, y0 = H - 14;
  const rect = (x: number, y: number, w: number, h: number, fill: string): void => { const r = document.createElementNS(ns, 'rect'); r.setAttribute('x', String(x)); r.setAttribute('y', String(y)); r.setAttribute('width', String(w)); r.setAttribute('height', String(Math.max(0, h))); r.setAttribute('fill', fill); svg.append(r); };
  for (let k = 0; k < n; k++) {
    const hr = h0 + k, x = k * bw;
    if (hr < open || hr >= close) rect(x, 0, bw, y0, 'rgba(255,255,255,0.04)');
    const sv = served[hr] ?? 0, ls = lost[hr] ?? 0, sc = (y0 - 4) / max;
    rect(x + 2, y0 - sv * sc, bw - 4, sv * sc, 'rgba(92,199,122,0.8)');
    rect(x + 2, y0 - (sv + ls) * sc, bw - 4, ls * sc, 'rgba(239,107,107,0.8)');
    if (k % 3 === 0) { const t = document.createElementNS(ns, 'text'); t.setAttribute('x', String(x + 2)); t.setAttribute('y', String(H - 2)); t.setAttribute('fill', '#9fb0c2'); t.setAttribute('font-size', '10'); t.textContent = `${hr} h`; svg.append(t); }
  }
  return svg;
}
