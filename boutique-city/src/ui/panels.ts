/**
 * Panneau latéral (droite) : local libre (louer), concurrent, commerce du joueur (onglets), finances de l'entreprise.
 * Tous les chiffres viennent de la simulation (Game) ; le panneau est redessiné quand l'état change, sauf pendant
 * une saisie (champ actif dans le panneau).
 */
import { ECONOMY, SHOP_TYPES, SHOP_TYPE_BY_ID, productsOf, type ShopType } from '../sim/catalog';
import { formatClock } from '../sim/clock';
import type { DayStats, Game, Shop } from '../sim/game';
import type { Premise } from '../sim/district';
import { $, button, chf, chf2, el, num, pct, signed } from './dom';

export type PanelTarget = { kind: 'premise'; premiseId: number } | { kind: 'shop'; shopId: number } | { kind: 'finances' } | { kind: 'building'; buildingId: number } | null;
type ShopTab = 'apercu' | 'stock' | 'equipe' | 'horaires' | 'resultats';

export class SidePanel {
  private readonly root = $('panel');
  target: PanelTarget = null;
  private tab: ShopTab = 'apercu';
  private drawnVersion = -1;
  private rentType: ShopType = 'epicerie';
  private rentName = '';

  constructor(
    private readonly game: Game,
    private readonly act: { toast: (t: string, k?: 'ok' | 'error' | 'info') => void; openEditor: (s: Shop) => void; focus: (premiseId: number) => void; changed: () => void },
  ) {}

  show(t: PanelTarget): void {
    if (t?.kind === 'shop' && (this.target?.kind !== 'shop' || this.target.shopId !== t.shopId)) this.tab = 'apercu';
    this.target = t;
    this.drawnVersion = -1;
    this.refresh(true);
  }

  /** Redessine si l'état a changé (et qu'aucune saisie n'est en cours dans le panneau). */
  refresh(force = false): void {
    if (!force && this.drawnVersion === this.game.version) return;
    if (!force && this.root.contains(document.activeElement) && (document.activeElement as HTMLElement).tagName === 'INPUT') return;
    this.drawnVersion = this.game.version;
    const t = this.target;
    this.root.classList.toggle('hidden', !t);
    if (!t) return;
    const scroll = this.root.querySelector('.p-body')?.scrollTop ?? 0;
    let body: HTMLElement[];
    let title = '', kicker = '';
    if (t.kind === 'premise') {
      const p = this.game.premise(t.premiseId)!;
      const sh = this.game.shopAt(p.id);
      if (sh) { this.target = { kind: 'shop', shopId: sh.id }; this.refresh(true); return; }
      kicker = p.competitor ? 'Concurrent' : 'Local commercial à louer'; title = p.competitor ? p.competitorName! : `Local n° ${p.id}`;
      body = p.competitor ? this.competitor(p) : this.free(p);
    } else if (t.kind === 'shop') {
      const s = this.game.shop(t.shopId);
      if (!s) { this.show(null); return; }
      kicker = SHOP_TYPE_BY_ID.get(s.type)!.nameFr; title = s.name;
      body = this.shop(s);
    } else if (t.kind === 'building') {
      const b = this.game.district.buildings.find((x) => x.id === t.buildingId)!;
      kicker = 'Immeuble'; title = b.kind === 'bureaux' ? 'Bureaux' : 'Logements';
      body = [el('p', { text: b.kind === 'bureaux' ? `${num(b.workers)} employés travaillent ici : ils passent dans les commerces voisins.` : `${num(b.residents)} habitants : clients des commerces du quartier.` }),
        el('p', { cls: 'muted', text: `${b.floors} étages. Seuls les rez-de-chaussée commerciaux (auvent) se louent.` })];
    } else {
      kicker = 'Entreprise'; title = this.game.companyName;
      body = this.finances();
    }
    this.root.replaceChildren(
      el('div', { cls: 'p-head' }, el('div', {}, el('div', { cls: 'kicker', text: kicker }), el('h3', { text: title })), button('×', () => this.show(null), 'icon-x')),
      el('div', { cls: 'p-body' }, ...body));
    const pb = this.root.querySelector('.p-body');
    if (pb) pb.scrollTop = scroll;
  }

  /* ------------------------------ Local libre ------------------------------ */

  private free(p: Premise): HTMLElement[] {
    const g = this.game;
    const rows = SHOP_TYPES.map((t) => {
      const comp = g.competition(p, t.id);
      return el('tr', {}, el('td', { text: t.nameFr }), el('td', { text: comp < 0.1 ? 'aucune' : comp < 0.6 ? 'faible' : comp < 1.2 ? 'moyenne' : 'forte' }), el('td', { text: `≈ ${num(g.estimatePeak(p, t.id))} / h` }));
    });
    const deposit = p.rent * ECONOMY.depositMonths;
    const typeSel = el('select', { attrs: { 'aria-label': 'Type de commerce' } }, ...SHOP_TYPES.map((t) => el('option', { text: t.nameFr, attrs: { value: t.id, ...(t.id === this.rentType ? { selected: '' } : {}) } })));
    typeSel.addEventListener('change', () => { this.rentType = typeSel.value as ShopType; });
    const name = el('input', { attrs: { type: 'text', maxlength: '40', placeholder: 'Nom de l’enseigne (facultatif)', value: this.rentName } });
    name.addEventListener('input', () => { this.rentName = name.value; });
    return [
      el('div', { cls: 'kpis' }, kpi('Surface', `${p.area} m²`), kpi('Loyer', `${chf(p.rent)} / mois`), kpi('Passage', `${num(p.footfall)} / h`)),
      el('p', { cls: 'muted', text: 'Passants par heure devant la vitrine à l’heure de pointe (habitants et employés proches).' }),
      el('div', { cls: 'sec', text: 'Selon le commerce' }),
      el('table', { cls: 'tbl' }, el('tr', {}, el('th', { text: 'Commerce' }), el('th', { text: 'Concurrence' }), el('th', { text: 'Clients en pointe*' })), ...rows),
      el('p', { cls: 'muted small', text: '* Commerce moyen (prix du quartier, choix complet). Votre aménagement, vos prix et votre réputation font la différence.' }),
      el('div', { cls: 'sec', text: 'Louer ce local' }),
      el('label', { cls: 'field' }, el('span', { text: 'Type de commerce' }), typeSel),
      el('label', { cls: 'field' }, el('span', { text: 'Enseigne' }), name),
      el('p', { text: `Dépôt de garantie : ${chf(deposit)} (rendu à la résiliation). Loyer prélevé chaque jour (${chf2(p.rent / 30)}).` }),
      button(`Louer — ${chf(deposit)}`, () => {
        const r = g.rent(p.id, this.rentType, this.rentName);
        if (!r.ok) { this.act.toast(r.message, 'error'); return; }
        this.rentName = '';
        this.act.changed();
        this.show({ kind: 'shop', shopId: r.data.id });
      }, 'primary wide'),
    ];
  }

  private competitor(p: Premise): HTMLElement[] {
    const t = SHOP_TYPE_BY_ID.get(p.competitor!)!;
    return [el('p', { text: `${t.nameFr} déjà installé(e). Il attire une partie des clients des commerces du même type alentour.` }),
      el('div', { cls: 'kpis' }, kpi('Surface', `${p.area} m²`), kpi('Passage', `${num(p.footfall)} / h`))];
  }

  /* ------------------------------ Commerce du joueur ------------------------------ */

  private shop(s: Shop): HTMLElement[] {
    const tabs: [ShopTab, string][] = [['apercu', 'Aperçu'], ['stock', 'Stock et prix'], ['equipe', 'Employés'], ['horaires', 'Horaires'], ['resultats', 'Résultats']];
    const bar = el('div', { cls: 'tabs' }, ...tabs.map(([id, label]) => button(label, () => { this.tab = id; this.refresh(true); }, this.tab === id ? 'on' : '')));
    const content = this.tab === 'apercu' ? this.overview(s) : this.tab === 'stock' ? this.stock(s) : this.tab === 'equipe' ? this.team(s) : this.tab === 'horaires' ? this.hours(s) : this.results(s);
    return [bar, ...content];
  }

  private overview(s: Shop): HTMLElement[] {
    const g = this.game, st = g.stats(s), staff = g.staffOf(s.id), t = s.today;
    const p = g.premise(s.premiseId)!;
    const checks: [boolean, string][] = [
      [st.registers > 0, 'Au moins une caisse'],
      [productsOf(s.type).every((pr) => st.capacity[pr.store] > 0) && (s.type !== 'cafe' || st.machines > 0), 'Mobilier pour tous les produits'],
      [staff.length > 0, `Employé(s) : ${staff.length} (caisses tenues : ${Math.min(staff.length, st.registers)})`],
      [productsOf(s.type).some((pr) => s.products[pr.id]!.stock > 0 || g.pendingQty(s.id, pr.id) > 0), 'Stock en rayon ou commandé'],
    ];
    const open = (() => { const h = Math.floor((g.total % 1440) / 60); return h >= s.open && h < s.close; })();
    return compact([
      el('div', { cls: 'kpis' }, kpi('Clients aujourd’hui', num(t.customers)), kpi('Ventes', chf(t.revenue)), kpi('Réputation', pct(s.reputation))),
      el('p', { cls: open ? 'ok' : 'muted', text: open ? `Ouvert (${s.open} h – ${s.close} h) · ${num(s.rate)} clients attendus / h · capacité ${num(s.capacity)} / h` : `Fermé (ouvre de ${s.open} h à ${s.close} h)` }),
      el('div', { cls: 'sec', text: 'Pour bien démarrer' }),
      el('ul', { cls: 'checks' }, ...checks.map(([okv, txt]) => el('li', { cls: okv ? 'ok' : 'todo', text: `${okv ? '✓' : '○'} ${txt}` }))),
      el('div', { cls: 'row' }, button('Aménager le local', () => this.act.openEditor(s), 'primary'), button('Voir', () => this.act.focus(p.id))),
      t.lostStock + t.lostCapacity + t.lostStaff > 0 ? el('p', { cls: 'warn', text: `Clients perdus aujourd’hui : ${t.lostStock} rupture · ${t.lostCapacity} attente aux caisses · ${t.lostStaff} faute de personnel` }) : null,
      el('div', { cls: 'sec', text: 'Local' }),
      el('p', { cls: 'muted', text: `${p.area} m² · loyer ${chf(p.rent)} / mois · passage ${num(p.footfall)} / h · attrait ${Math.round(g.attractiveness(s) * 100)} (100 = commerce moyen)` }),
      button('Résilier le bail…', () => {
        if (!confirm(`Résilier le bail de « ${s.name} » ? Le dépôt (${chf(s.deposit)}) est rendu et le mobilier revendu à ${Math.round(ECONOMY.resale * 100)} %.`)) return;
        const r = g.release(s.id); if (r.ok) { this.act.changed(); this.show(null); }
      }, 'danger small'),
    ]);
  }

  private stock(s: Shop): HTMLElement[] {
    const g = this.game, st = g.stats(s);
    const rows = productsOf(s.type).map((pr) => {
      const ps = s.products[pr.id]!;
      const cap = g.storageFor(s, pr, st), pend = g.pendingQty(s.id, pr.id), room = g.room(s, pr.id);
      const price = el('input', { cls: 'price', attrs: { type: 'number', step: '0.1', min: String(Math.round(pr.basePrice * 30) / 100), max: String(pr.basePrice * 3), value: ps.price.toFixed(2), 'aria-label': `Prix ${pr.nameFr}` } });
      price.addEventListener('change', () => { const r = g.setPrice(s.id, pr.id, Number(price.value)); if (!r.ok) this.act.toast(r.message, 'error'); this.refresh(true); });
      const auto = el('input', { attrs: { type: 'checkbox', 'aria-label': `Réassort automatique ${pr.nameFr}`, ...(ps.auto ? { checked: '' } : {}) } });
      auto.addEventListener('change', () => { g.setAuto(s.id, pr.id, auto.checked); this.refresh(true); });
      const orderBtn = button(room > 0 ? `+${room} (${chf(g.orderCost(pr.id, room))})` : 'plein', () => {
        const r = g.order(s.id, pr.id, room);
        if (!r.ok) this.act.toast(r.message, 'error'); else this.act.toast(`Commande : ${r.data.qty} ${pr.nameFr.toLowerCase()}, livraison ${formatClock(r.data.deliverAt)}`, 'ok');
        this.refresh(true);
      }, 'small');
      if (room <= 0) orderBtn.disabled = true;
      const margin = ps.price - pr.cost;
      return el('tr', {},
        el('td', {}, el('b', { text: pr.nameFr }), el('div', { cls: 'muted small', text: `achat ${chf2(pr.cost)} · marge ${chf2(margin)} · quartier ${chf2(pr.basePrice)}` })),
        el('td', { text: cap ? `${num(ps.stock)} / ${num(cap)}${pend ? ` (+${pend})` : ''}` : '—' }),
        el('td', {}, price),
        el('td', {}, orderBtn),
        el('td', {}, auto));
    });
    return [
      el('p', { cls: 'muted', text: `Commandes livrées le lendemain à ${ECONOMY.deliveryHour} h. Remise de ${Math.round(ECONOMY.bulkDiscount * 100)} % dès ${ECONOMY.bulkQty} unités. Réassort automatique : à 21 h, commande pour remplir si le stock est sous la moitié.` }),
      el('table', { cls: 'tbl stock' }, el('tr', {}, el('th', { text: 'Produit' }), el('th', { text: 'Stock' }), el('th', { text: 'Prix' }), el('th', { text: 'Commander' }), el('th', { text: 'Auto' })), ...rows),
      el('p', { cls: 'muted small', text: 'Plus cher que le quartier : moins de clients, et certains renoncent à l’article. Moins cher : plus de clients, marge réduite.' }),
    ];
  }

  private team(s: Shop): HTMLElement[] {
    const g = this.game, staff = g.staffOf(s.id), st = g.stats(s);
    const others = g.employees.filter((e) => e.shopId !== s.id);
    return compact([
      el('p', { cls: 'muted', text: `Chaque employé tient une caisse (${st.registers} caisse(s)) et sert jusqu’à ${ECONOMY.servePerRegister} clients par heure selon sa compétence. Salaire payé pour chaque heure d’ouverture.` }),
      el('div', { cls: 'sec', text: `Équipe (${staff.length})` }),
      staff.length ? el('div', { cls: 'list' }, ...staff.map((e) => el('div', { cls: 'item' },
        el('div', {}, el('b', { text: e.name }), el('div', { cls: 'muted small', text: `compétence ${pct(e.skill)} · ${e.wage} CHF / h · ${chf(e.wage * (s.close - s.open))} / jour` })),
        button('Licencier', () => { if (!confirm(`Licencier ${e.name} ? Indemnité : ${chf(e.wage * 8 * ECONOMY.severanceDays)}.`)) return; g.fire(e.id); this.refresh(true); }, 'small danger')))) : el('p', { cls: 'warn', text: 'Personne : le commerce ne peut pas servir de clients.' }),
      others.length ? el('div', { cls: 'sec', text: 'Employés des autres commerces' }) : null,
      ...others.map((e) => el('div', { cls: 'item' }, el('div', {}, el('b', { text: e.name }), el('div', { cls: 'muted small', text: `${e.shopId ? g.shop(e.shopId)?.name ?? '—' : 'sans affectation'} · ${pct(e.skill)} · ${e.wage} CHF / h` })),
        button('Muter ici', () => { g.assign(e.id, s.id); this.refresh(true); }, 'small'))),
      el('div', { cls: 'sec', text: 'Candidats (renouvelés chaque lundi)' }),
      el('div', { cls: 'list' }, ...g.candidates.map((c) => el('div', { cls: 'item' },
        el('div', {}, el('b', { text: c.name }), el('div', { cls: 'muted small', text: `compétence ${pct(c.skill)} · ${c.wage} CHF / h` })),
        button('Embaucher', () => { const r = g.hire(c.id, s.id); if (!r.ok) this.act.toast(r.message, 'error'); this.refresh(true); }, 'small primary')))),
    ]);
  }

  private hours(s: Shop): HTMLElement[] {
    const t = SHOP_TYPE_BY_ID.get(s.type)!;
    const sel = (v: number, from: number, to: number): HTMLSelectElement => el('select', {}, ...Array.from({ length: to - from + 1 }, (_, k) => from + k).map((h) => el('option', { text: `${h} h`, attrs: { value: String(h), ...(h === v ? { selected: '' } : {}) } })));
    const o = sel(s.open, 5, 19), c = sel(s.close, 9, 23);
    const apply = (): void => { const r = this.game.setHours(s.id, Number(o.value), Number(c.value)); if (!r.ok) this.act.toast(r.message, 'error'); this.refresh(true); };
    o.addEventListener('change', apply); c.addEventListener('change', apply);
    const peak = t.hourly.map((v, h) => [h, v] as const).filter(([, v]) => v >= 0.8).map(([h]) => `${h} h`).join(', ');
    return [
      el('label', { cls: 'field' }, el('span', { text: 'Ouverture' }), o),
      el('label', { cls: 'field' }, el('span', { text: 'Fermeture' }), c),
      el('p', { cls: 'muted', text: `Heures de pointe d’un(e) ${t.nameFr.toLowerCase()} : ${peak}. Week-end : ×${t.weekend} de clients. Chaque heure d’ouverture coûte les salaires de l’équipe.` }),
      hourChart(t.hourly, s.open, s.close),
    ];
  }

  private results(s: Shop): HTMLElement[] {
    const days = [...s.history.slice(-13), s.today];
    return [
      chart(days),
      el('table', { cls: 'tbl' },
        el('tr', {}, el('th', { text: 'Jour' }), el('th', { text: 'Clients' }), el('th', { text: 'Ventes' }), el('th', { text: 'Marge' }), el('th', { text: 'Charges' }), el('th', { text: 'Résultat' })),
        ...[...days].reverse().map((d) => {
          const res = d.revenue - d.costOfSales - d.wages - d.rent;
          return el('tr', {}, el('td', { text: d === s.today ? 'auj.' : `j${d.day + 1}` }), el('td', { text: num(d.customers) }), el('td', { text: chf(d.revenue) }), el('td', { text: chf(d.revenue - d.costOfSales) }), el('td', { text: chf(d.wages + d.rent) }), el('td', { cls: res >= 0 ? 'ok' : 'bad', text: signed(res) }));
        })),
      el('p', { cls: 'muted small', text: 'Résultat = ventes − coût d’achat des articles vendus − salaires − loyer (hors mobilier).' }),
    ];
  }

  /* ------------------------------ Finances ------------------------------ */

  private finances(): HTMLElement[] {
    const g = this.game;
    const days = [...g.ledger.slice(-13), g.today];
    const week = g.ledger.slice(-7);
    const sum = (k: keyof DayStats): number => week.reduce((a, d) => a + (d[k] as number), 0);
    return [
      el('div', { cls: 'kpis' }, kpi('Trésorerie', chf(g.cash)), kpi('Commerces', String(g.shops.length)), kpi('Employés', String(g.employees.length))),
      el('div', { cls: 'sec', text: 'Trésorerie : entrées et sorties par jour' }),
      chart(days, true),
      el('table', { cls: 'tbl' },
        el('tr', {}, el('th', { text: '7 derniers jours' }), el('th', { text: '' })),
        el('tr', {}, el('td', { text: 'Ventes' }), el('td', { text: chf(sum('revenue')) })),
        el('tr', {}, el('td', { text: 'Achats de marchandise' }), el('td', { text: `−${chf(sum('purchases'))}` })),
        el('tr', {}, el('td', { text: 'Salaires' }), el('td', { text: `−${chf(sum('wages'))}` })),
        el('tr', {}, el('td', { text: 'Loyers' }), el('td', { text: `−${chf(sum('rent'))}` })),
        el('tr', {}, el('td', { text: 'Mobilier' }), el('td', { text: `−${chf(sum('equipment'))}` })),
        el('tr', {}, el('td', {}, el('b', { text: 'Solde' })), el('td', {}, el('b', { text: signed(sum('revenue') - sum('purchases') - sum('wages') - sum('rent') - sum('equipment')) })))),
      el('div', { cls: 'sec', text: 'Mes commerces' }),
      ...(g.shops.length ? g.shops.map((s) => el('div', { cls: 'item' },
        el('div', {}, el('b', { text: s.name }), el('div', { cls: 'muted small', text: `${SHOP_TYPE_BY_ID.get(s.type)!.nameFr} · ${num(s.today.customers)} clients aujourd’hui · ${chf(s.today.revenue)}` })),
        button('Ouvrir', () => this.show({ kind: 'shop', shopId: s.id }), 'small'))) : [el('p', { cls: 'muted', text: 'Aucun commerce : cliquez sur un local « À louer » (étiquette sombre) dans le quartier.' })]),
    ];
  }
}

function compact(a: readonly (HTMLElement | null)[]): HTMLElement[] { return a.filter((x): x is HTMLElement => !!x); }

function kpi(label: string, value: string): HTMLElement { return el('div', { cls: 'kpi' }, el('span', { text: label }), el('b', { text: value })); }

/** Histogramme des derniers jours : ventes (barres) et résultat (ligne) ; `cash` : solde de trésorerie du jour. */
function chart(days: DayStats[], cash = false): HTMLCanvasElement {
  const cv = el('canvas', { cls: 'chart', attrs: { width: '340', height: '120' } });
  const g = cv.getContext('2d')!;
  const res = days.map((d) => cash ? d.revenue - d.purchases - d.wages - d.rent - d.equipment : d.revenue - d.costOfSales - d.wages - d.rent);
  const max = Math.max(1, ...days.map((d) => d.revenue), ...res.map((r) => Math.abs(r)));
  const W = 340, H = 120, zero = H * 0.72, bw = W / Math.max(1, days.length);
  g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, zero, W, 1);
  days.forEach((d, k) => { const h = (d.revenue / max) * zero * 0.95; g.fillStyle = 'rgba(95,195,255,0.55)'; g.fillRect(k * bw + 3, zero - h, bw - 6, h); });
  g.strokeStyle = '#ffd166'; g.lineWidth = 2; g.beginPath();
  res.forEach((r, k) => { const y = zero - (r / max) * zero * 0.95; const x = k * bw + bw / 2; if (k) g.lineTo(x, y); else g.moveTo(x, y); });
  g.stroke();
  g.fillStyle = '#9fb0c2'; g.font = '11px system-ui';
  g.fillText('ventes', 4, 12); g.fillStyle = '#ffd166'; g.fillText(cash ? 'solde de trésorerie' : 'résultat', 52, 12);
  return cv;
}

function hourChart(hourly: readonly number[], open: number, close: number): HTMLCanvasElement {
  const cv = el('canvas', { cls: 'chart', attrs: { width: '340', height: '80' } });
  const g = cv.getContext('2d')!;
  const bw = 340 / 24;
  hourly.forEach((v, h) => { g.fillStyle = h >= open && h < close ? 'rgba(92,199,122,0.8)' : 'rgba(255,255,255,0.18)'; g.fillRect(h * bw + 1, 70 - v * 60, bw - 2, v * 60); });
  g.fillStyle = '#9fb0c2'; g.font = '10px system-ui';
  for (const h of [0, 6, 12, 18]) g.fillText(`${h}h`, h * bw, 79);
  return cv;
}

