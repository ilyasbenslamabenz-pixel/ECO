/**
 * Téléphone du joueur (touche T) : écran d'accueil à applis, comme le smartphone d'un jeu de gestion de vie.
 * Applis : Commerces (gestion à distance), Immobilier (locaux et appartements libres, baux, sous-locations, GPS),
 * Banque (trésorerie, prêts, résultats), Équipe (employés), Marché (prix du grossiste, prix des concurrents),
 * Messages (historique des notifications), Objectifs, Véhicules, Carte, Entreprise, Réglages.
 * Redessiné quand la partie change (au plus deux fois par seconde), jamais sous le pointeur ni pendant une saisie.
 */
import { HOME_BY_ID, PRODUCTS, SHOP_TYPES, SHOP_TYPE_BY_ID, VEHICLE_BY_ID } from '../sim/catalog';
import { clockView, formatClock } from '../sim/clock';
import { dayProfit } from '../sim/game';
import { OBJECTIVES, netWorth, rankOf } from '../sim/objectives';
import { button, chf, chf2, el, num, pct, signed } from './dom';
import { subletView, type UiCtx } from './dialogs';

type AppId = 'commerces' | 'immo' | 'banque' | 'equipe' | 'marche' | 'messages' | 'objectifs' | 'vehicules' | 'carte' | 'entreprise' | 'reglages';
interface App { id: AppId; name: string; icon: string; color: string }
const APPS: App[] = [
  { id: 'commerces', name: 'Commerces', icon: '🏪', color: '#ff8a3d' },
  { id: 'immo', name: 'Immobilier', icon: '🏢', color: '#4c8dff' },
  { id: 'banque', name: 'Banque', icon: '🏦', color: '#22b07d' },
  { id: 'equipe', name: 'Équipe', icon: '🧑‍🍳', color: '#a76bff' },
  { id: 'marche', name: 'Marché', icon: '📈', color: '#f2b705' },
  { id: 'messages', name: 'Messages', icon: '💬', color: '#2fbfde' },
  { id: 'objectifs', name: 'Objectifs', icon: '🏆', color: '#ff5a7a' },
  { id: 'vehicules', name: 'Véhicules', icon: '🚐', color: '#7a8798' },
  { id: 'carte', name: 'Carte', icon: '🗺️', color: '#3fae4f' },
  { id: 'entreprise', name: 'Entreprise', icon: '💼', color: '#d9534f' },
  { id: 'reglages', name: 'Réglages', icon: '⚙️', color: '#5b6573' },
];

export interface PhoneHooks {
  openMap: () => void;
  openCompany: () => void;
  save: () => void;
  toggleSound: () => boolean;
  muted: () => boolean;
  quality: () => string;
  setQuality: (q: string) => void;
}

export class Phone {
  readonly root = el('div', { cls: 'phone hidden', attrs: { role: 'dialog', 'aria-label': 'Téléphone' } });
  private readonly screen = el('div', { cls: 'ph-screen' });
  private readonly status = el('div', { cls: 'ph-status' });
  private app: AppId | null = null;
  private immoTab: 'locaux' | 'apparts' | 'baux' = 'locaux';
  private lastVersion = -1;
  private lastPaint = 0;
  /** Nombre de messages déjà lus. */
  private seen = 0;

  constructor(private readonly ctx: UiCtx, private readonly hooks: PhoneHooks) {
    const home = el('button', { cls: 'ph-home', attrs: { type: 'button', 'aria-label': 'Accueil du téléphone' }, on: { click: () => { this.app ? this.go(null) : this.close(); } } });
    this.root.append(el('div', { cls: 'ph-frame' }, el('div', { cls: 'ph-notch' }), this.status, this.screen, home));
    document.body.append(this.root);
    this.seen = ctx.game.notices.length;
  }

  get isOpen(): boolean { return !this.root.classList.contains('hidden'); }
  /** Messages non lus (pastille sur le bouton du téléphone). */
  get unread(): number { return Math.max(0, this.ctx.game.notices.length - this.seen); }

  toggle(): void { if (this.isOpen) this.close(); else this.open(); }
  open(app: AppId | null = null): void { this.root.classList.remove('hidden'); this.go(app); }
  close(): void { this.root.classList.add('hidden'); }
  /** Retour : appli → accueil → fermé. */
  back(): void { if (this.app) this.go(null); else this.close(); }

  go(app: AppId | null): void {
    if (app === 'carte') { this.close(); this.hooks.openMap(); return; }
    if (app === 'entreprise') { this.close(); this.hooks.openCompany(); return; }
    this.app = app;
    if (app === 'messages') this.seen = this.ctx.game.notices.length;
    this.paint(true);
  }

  /** Redessin (appelé à chaque image ; limité). */
  paint(force = false): void {
    if (!this.isOpen) return;
    const g = this.ctx.game, now = performance.now();
    if (!force) {
      if (g.version === this.lastVersion ? now - this.lastPaint < 4000 : now - this.lastPaint < 500) return;
      const a = document.activeElement;
      if (a && this.root.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'SELECT')) return;
      if (this.root.querySelector('button:hover, input:hover')) return;
    }
    this.lastVersion = g.version; this.lastPaint = now;
    if (this.app === 'messages') this.seen = g.notices.length;
    const c = clockView(g.total);
    this.status.replaceChildren(el('b', { text: `${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}` }), el('span', { text: chf(g.cash) }));
    const scroll = this.screen.querySelector('.ph-body')?.scrollTop ?? 0;
    if (!this.app) { this.screen.replaceChildren(this.homeScreen()); return; }
    const a = APPS.find((x) => x.id === this.app)!;
    const body = el('div', { cls: 'ph-body' }, ...this.render(this.app));
    this.screen.replaceChildren(
      el('div', { cls: 'ph-bar', attrs: { style: `--app:${a.color}` } }, button('‹', () => this.go(null), 'ph-back'), el('b', { text: a.name }), el('span', { text: a.icon })),
      body);
    body.scrollTop = scroll;
  }

  private homeScreen(): HTMLElement {
    const g = this.ctx.game;
    const warn = g.shops.reduce((n, s) => n + s.warned.length, 0);
    const badge: Partial<Record<AppId, number>> = { messages: this.unread, commerces: warn };
    const c = clockView(g.total);
    return el('div', { cls: 'ph-homescreen' },
      el('div', { cls: 'ph-clock' }, el('b', { text: `${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}` }), el('span', { text: formatClock(g.total).split('·')[0]!.trim() })),
      el('div', { cls: 'ph-widget' }, el('span', { text: 'Valeur nette' }), el('b', { text: chf(netWorth(g)) }), el('span', { cls: 'small', text: `${rankOf(g.achieved.length)} · ${g.shops.length} commerce(s) · ${g.sublets.length} bail(aux) en sous-location` })),
      el('div', { cls: 'ph-grid' }, ...APPS.map((a) => el('button', { cls: 'ph-app', attrs: { type: 'button', 'data-app': a.id }, on: { click: () => this.go(a.id) } },
        el('span', { cls: 'ph-ico', attrs: { style: `--app:${a.color}` }, text: a.icon }),
        badge[a.id] ? el('i', { cls: 'ph-badge', text: String(Math.min(99, badge[a.id]!)) }) : null,
        el('span', { cls: 'ph-name', text: a.name })))));
  }

  private render(app: AppId): (Node | null)[] {
    switch (app) {
      case 'commerces': return this.commerces();
      case 'immo': return this.immo();
      case 'banque': return this.banque();
      case 'equipe': return this.equipe();
      case 'marche': return this.marche();
      case 'messages': return this.messages();
      case 'objectifs': return this.objectifs();
      case 'vehicules': return this.vehicules();
      case 'reglages': return this.reglages();
      default: return [];
    }
  }

  private gps(x: number, z: number, label: string): HTMLButtonElement {
    return button('📍 GPS', () => { this.ctx.waypoint(x, z, label); this.close(); }, 'small');
  }

  private commerces(): (Node | null)[] {
    const g = this.ctx.game;
    if (!g.shops.length) return [el('p', { cls: 'ph-empty', text: 'Aucun commerce. Ouvrez l’appli Immobilier pour trouver un local à louer.' }), button('Ouvrir Immobilier', () => this.go('immo'), 'primary wide')];
    const c = clockView(g.total);
    const totRev = g.shops.reduce((a, s) => a + s.today.revenue, 0), totCli = g.shops.reduce((a, s) => a + s.today.customers, 0);
    return [
      el('div', { cls: 'ph-sum' }, el('div', {}, el('span', { text: 'Ventes du jour' }), el('b', { text: chf(totRev) })), el('div', {}, el('span', { text: 'Clients' }), el('b', { text: num(totCli) }))),
      ...g.shops.map((s) => {
        const t = SHOP_TYPE_BY_ID.get(s.type)!, p = g.premise(s.premiseId)!;
        const open = c.hour >= s.open && c.hour < s.close;
        const staff = g.staffOf(s.id).length;
        return el('div', { cls: 'ph-card', attrs: { style: `--app:${t.color}` } },
          el('div', { cls: 'ph-card-top' }, el('b', { text: s.name }), el('span', { cls: open ? 'pill ok' : 'pill', text: open ? 'Ouvert' : 'Fermé' })),
          el('div', { cls: 'ph-stats' }, el('span', { text: `${t.nameFr}` }), el('span', { text: `${s.today.customers} clients` }), el('span', { text: chf(s.today.revenue) }), el('span', { text: `${staff} employé(s)` })),
          s.warned.length ? el('div', { cls: 'ph-alert', text: `⚠ ${s.warned.length} alerte(s) : stock, caisse ou place` }) : null,
          el('div', { cls: 'row' }, button('Gérer', () => { this.close(); this.ctx.openShop(s.id); }, 'small primary'), this.gps(p.doorX, p.doorZ, s.name)));
      }),
    ];
  }

  private immo(): (Node | null)[] {
    const g = this.ctx.game;
    const tabs = el('div', { cls: 'ph-tabs' }, ...([['locaux', 'Locaux'], ['apparts', 'Appartements'], ['baux', 'Mes baux']] as const).map(([id, l]) => button(l, () => { this.immoTab = id; this.paint(true); }, this.immoTab === id ? 'on' : '')));
    const out: (Node | null)[] = [tabs];
    if (this.immoTab === 'locaux') {
      const free = g.district.premises.filter((p) => g.isFree(p)).sort((a, b) => b.footfall - a.footfall);
      out.push(el('p', { cls: 'ph-hint', text: `${free.length} locaux libres. Signez le bail sur place (pour votre commerce ou pour sous-louer).` }));
      for (const p of free.slice(0, 30)) {
        const best = [...SHOP_TYPES].sort((a, b) => g.estimatePeak(p, b.id) - g.estimatePeak(p, a.id))[0]!;
        out.push(el('div', { cls: 'ph-card' },
          el('div', { cls: 'ph-card-top' }, el('b', { text: `${p.area} m² · ${chf(p.rent)}/mois` }), el('span', { cls: 'pill', text: `${num(p.footfall)} passants/h` })),
          el('div', { cls: 'ph-stats' }, el('span', { text: `Idéal : ${best.nameFr}` }), el('span', { text: `≈ ${num(g.estimatePeak(p, best.id))} clients/h` }), el('span', { text: `grille ${p.gridW}×${p.gridD}` })),
          el('div', { cls: 'row' }, this.gps(p.doorX, p.doorZ, `Local ${p.area} m²`))));
      }
    } else if (this.immoTab === 'apparts') {
      const homes = g.district.homes.filter((h) => g.homeFree(h.id));
      out.push(el('p', { cls: 'ph-hint', text: 'Louez pour y habiter (confort du sommeil) ou pour sous-louer à un locataire.' }));
      for (const h of homes.slice(0, 30)) {
        const d = HOME_BY_ID.get(h.def)!;
        out.push(el('div', { cls: 'ph-card' },
          el('div', { cls: 'ph-card-top' }, el('b', { text: `${d.nameFr} · ${d.gridW * d.gridD} m²` }), el('span', { cls: 'pill', text: `${d.rentDay} CHF/jour` })),
          el('div', { cls: 'ph-stats' }, el('span', { text: `Confort ×${d.comfort}` }), el('span', { text: `Sous-location ≈ ${chf(d.rentDay * 1.25)}/j` })),
          el('div', { cls: 'row' }, this.gps(h.doorX, h.doorZ, d.nameFr))));
      }
    } else {
      const home = g.district.homes.find((h) => h.id === g.player.home);
      if (home) { const d = HOME_BY_ID.get(home.def)!; out.push(el('div', { cls: 'ph-card' }, el('div', { cls: 'ph-card-top' }, el('b', { text: `Chez moi : ${d.nameFr}` }), el('span', { cls: 'pill', text: `−${d.rentDay} CHF/j` })), el('div', { cls: 'row' }, this.gps(home.doorX, home.doorZ, 'Chez moi')))); }
      for (const s of g.shops) { const p = g.premise(s.premiseId)!; out.push(el('div', { cls: 'ph-card' }, el('div', { cls: 'ph-card-top' }, el('b', { text: s.name }), el('span', { cls: 'pill', text: `−${chf(p.rent / 30)}/j` })), el('div', { cls: 'ph-stats' }, el('span', { text: `Bail commercial · ${p.area} m²` })))); }
      if (!g.sublets.length) out.push(el('p', { cls: 'ph-hint', text: 'Aucune sous-location. Devant un local ou un appartement libre : « Prendre à bail pour sous-louer ».' }));
      for (const sl of g.sublets) {
        const where = sl.kind === 'logement' ? g.district.homes.find((h) => h.id === sl.ref) : g.premise(sl.ref);
        out.push(el('div', { cls: 'ph-card', attrs: { style: '--app:#c39bff' } },
          el('div', { cls: 'ph-card-top' }, el('b', { text: sl.kind === 'logement' ? 'Appartement sous-loué' : 'Local sous-loué' }), el('span', { cls: sl.tenant ? 'pill ok' : 'pill warn', text: sl.tenant ? 'Loué' : 'Vacant' })),
          el('div', { cls: 'ph-stats' }, el('span', { text: sl.tenant ?? 'Recherche de locataire…' }), el('span', { text: `paie ${chf2(sl.cost)}/j` }), el('span', { text: `demande ${chf2(sl.ask)}/j` })),
          el('div', { cls: 'row' }, button('Gérer', () => { this.close(); this.ctx.panel.open(subletView(this.ctx, sl.id)); }, 'small primary'), where ? this.gps(where.doorX, where.doorZ, 'Sous-location') : null)));
      }
    }
    return out;
  }

  private banque(): (Node | null)[] {
    const g = this.ctx.game;
    const days = [...g.ledger.slice(-6), g.today];
    const max = Math.max(1, ...days.map((d) => Math.abs(dayProfit(d))));
    const bank = g.district.buildings.find((b) => b.service === 'banque');
    return [
      el('div', { cls: 'ph-sum' }, el('div', {}, el('span', { text: 'Compte' }), el('b', { cls: g.cash < 0 ? 'bad' : '', text: chf(g.cash) })), el('div', {}, el('span', { text: 'Dettes' }), el('b', { text: chf(g.debt) }))),
      el('div', { cls: 'ph-sec', text: 'Résultat des 7 derniers jours' }),
      el('div', { cls: 'ph-bars' }, ...days.map((d) => { const v = dayProfit(d); return el('div', { cls: 'ph-barcol', attrs: { title: signed(v) } }, el('i', { cls: v >= 0 ? 'pos' : 'neg', attrs: { style: `height:${Math.round((Math.abs(v) / max) * 100)}%` } }), el('span', { text: `J${d.day + 1}` })); })),
      el('div', { cls: 'ph-sec', text: 'Prêts' }),
      ...(g.loans.length ? g.loans.map((l) => el('div', { cls: 'ph-card' }, el('div', { cls: 'ph-card-top' }, el('b', { text: chf(l.amount) }), el('span', { cls: 'pill', text: `${l.daysLeft} j` })), el('div', { cls: 'ph-stats' }, el('span', { text: `reste ${chf(l.remaining)}` }), el('span', { text: `${chf(l.daily)} / jour` })))) : [el('p', { cls: 'ph-hint', text: 'Aucun prêt en cours. Les prêts se signent à la banque.' })]),
      bank ? el('div', { cls: 'row' }, this.gps(bank.doorX, bank.doorZ, 'Banque du Quartier')) : null,
      el('div', { cls: 'ph-sec', text: 'Aujourd’hui' }),
      el('div', { cls: 'ph-stats col' }, el('span', { text: `Ventes ${chf(g.today.revenue)}` }), el('span', { text: `Loyers encaissés ${chf(g.today.rentalIncome)}` }), el('span', { text: `Achats ${chf(g.today.purchases)}` }), el('span', { text: `Salaires ${chf(g.today.wages)}` }), el('span', { text: `Loyers payés ${chf(g.today.rent)}` })),
    ];
  }

  private equipe(): (Node | null)[] {
    const g = this.ctx.game;
    const agency = g.district.buildings.find((b) => b.service === 'emploi');
    if (!g.employees.length) return [el('p', { cls: 'ph-empty', text: 'Personne dans l’équipe. Embauchez à l’agence pour l’emploi (nouveaux candidats chaque lundi).' }), agency ? this.gps(agency.doorX, agency.doorZ, "Agence pour l'emploi") : null];
    return [
      el('div', { cls: 'ph-sum' }, el('div', {}, el('span', { text: 'Employés' }), el('b', { text: String(g.employees.length) })), el('div', {}, el('span', { text: 'Salaires / h' }), el('b', { text: chf(g.employees.reduce((a, e) => a + e.wage, 0)) }))),
      ...g.employees.map((e) => el('div', { cls: 'ph-card' },
        el('div', { cls: 'ph-card-top' }, el('b', { text: e.name }), el('span', { cls: 'pill', text: `${e.wage} CHF/h` })),
        el('div', { cls: 'ph-stats' }, el('span', { text: e.shopId ? g.shop(e.shopId)?.name ?? '—' : 'Sans affectation' })),
        el('div', { cls: 'ph-meter' }, el('i', { attrs: { style: `width:${Math.round(e.skill * 100)}%` } })),
        el('span', { cls: 'small muted', text: `Compétence ${pct(e.skill)}` }))),
    ];
  }

  private marche(): (Node | null)[] {
    const g = this.ctx.game;
    const out: (Node | null)[] = [el('p', { cls: 'ph-hint', text: 'Prix du grossiste aujourd’hui (achetez quand ça baisse) et prix pratiqués par vos concurrents.' })];
    for (const t of SHOP_TYPES) {
      const rv = g.rivals[t.id] ?? 1;
      out.push(el('div', { cls: 'ph-sec', text: `${t.nameFr} · concurrents ${rv < 0.995 ? `−${Math.round((1 - rv) * 100)} %` : 'prix habituels'}` }));
      for (const p of PRODUCTS.filter((x) => x.shop === t.id)) {
        const m = g.marketIndex(p.id);
        out.push(el('div', { cls: 'ph-line' }, el('span', { text: p.nameFr }), el('b', { text: chf2(p.cost * m) }),
          el('span', { cls: m > 1.02 ? 'trend up' : m < 0.98 ? 'trend down' : 'trend', text: m > 1.02 ? `▲${Math.round((m - 1) * 100)}%` : m < 0.98 ? `▼${Math.round((1 - m) * 100)}%` : '=' })));
      }
    }
    return out;
  }

  private messages(): (Node | null)[] {
    const g = this.ctx.game;
    const list = [...g.notices].reverse().slice(0, 60);
    if (!list.length) return [el('p', { cls: 'ph-empty', text: 'Aucun message.' })];
    return list.map((n) => el('div', { cls: `ph-msg ${n.level}` }, el('span', { cls: 'small muted', text: formatClock(n.at) }), el('div', { text: n.text })));
  }

  private objectifs(): (Node | null)[] {
    const g = this.ctx.game;
    return [
      el('div', { cls: 'ph-sum' }, el('div', {}, el('span', { text: 'Rang' }), el('b', { text: rankOf(g.achieved.length) })), el('div', {}, el('span', { text: 'Atteints' }), el('b', { text: `${g.achieved.length} / ${OBJECTIVES.length}` }))),
      ...OBJECTIVES.map((o) => {
        const done = g.achieved.includes(o.id), pr = o.progress(g);
        return el('div', { cls: `ph-card ${done ? 'done' : ''}` }, el('div', { cls: 'ph-card-top' }, el('b', { text: `${done ? '✓ ' : ''}${o.title}` })),
          done ? null : el('span', { cls: 'small muted', text: o.hint }),
          el('div', { cls: 'ph-meter' }, el('i', { attrs: { style: `width:${Math.round((done ? 1 : pr.p) * 100)}%` } })), el('span', { cls: 'small', text: done ? 'fait' : pr.text }));
      }),
    ];
  }

  private vehicules(): (Node | null)[] {
    const g = this.ctx.game;
    const garage = g.district.buildings.find((b) => b.service === 'garage');
    if (!g.vehicles.length) return [el('p', { cls: 'ph-empty', text: 'Aucun véhicule. Le garage vend scooters, citadines, voitures de luxe, camionnettes et camions.' }), garage ? this.gps(garage.doorX, garage.doorZ, 'Garage') : null];
    return g.vehicles.map((v) => {
      const d = VEHICLE_BY_ID.get(v.type)!, load = Object.values(v.cargo).reduce((a, b) => a + b, 0);
      return el('div', { cls: 'ph-card' }, el('div', { cls: 'ph-card-top' }, el('b', { text: d.nameFr }), el('span', { cls: 'pill', text: `${load} / ${d.cargo}` })),
        el('div', { cls: 'ph-meter' }, el('i', { attrs: { style: `width:${Math.round((load / d.cargo) * 100)}%` } })),
        el('div', { cls: 'row' }, this.gps(v.x, v.z, d.nameFr)));
    });
  }

  private reglages(): (Node | null)[] {
    const q = this.hooks.quality();
    return [
      el('div', { cls: 'ph-sec', text: 'Graphismes' }),
      el('div', { cls: 'ph-tabs' }, ...([['auto', 'Auto'], ['basse', 'Basse'], ['haute', 'Haute']] as const).map(([id, l]) => button(l, () => { this.hooks.setQuality(id); this.paint(true); }, q === id ? 'on' : ''))),
      el('p', { cls: 'ph-hint', text: 'Auto : la qualité baisse toute seule si les images par seconde chutent (ombres, résolution).' }),
      el('div', { cls: 'ph-sec', text: 'Son' }),
      button(this.hooks.muted() ? '🔇 Son coupé' : '🔊 Son activé', () => { this.hooks.toggleSound(); this.paint(true); }, 'wide'),
      el('div', { cls: 'ph-sec', text: 'Partie' }),
      button('💾 Sauvegarder', () => this.hooks.save(), 'primary wide'),
      el('p', { cls: 'ph-hint', text: 'Raccourcis : T téléphone · M carte · E interagir · B aménager · P pause · Échap fermer.' }),
    ];
  }
}
