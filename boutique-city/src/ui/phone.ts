/**
 * Téléphone du joueur (touche T) : écran d'accueil à applis, comme le smartphone d'un jeu de gestion de vie.
 * Applis : Commerces (gestion à distance), Immobilier (locaux et appartements libres, baux, sous-locations, GPS),
 * Banque (trésorerie, prêts, résultats), Équipe (employés), Marché (prix du grossiste, prix des concurrents),
 * Concurrence (entreprises rivales, menaces, parts de marché, rachats),
 * Messages (historique des notifications), Objectifs, Véhicules, Carte, Entreprise, Réglages.
 * Redessiné quand la partie change (au plus deux fois par seconde), jamais sous le pointeur ni pendant une saisie.
 *
 * Chaque appli suit la même grammaire : tuiles de chiffres clés en tête, sections titrées, cartes (titre à gauche,
 * chiffre principal à droite, petites mesures dessous, boutons d'action en bas), état vide avec une action.
 */
import { HOME_BY_ID, PRODUCTS, SHOP_TYPES, SHOP_TYPE_BY_ID, VEHICLE_BY_ID } from '../sim/catalog';
import { FINANCE, INVESTMENTS, type InvestKind } from '../sim/catalog';
import { SHIFT_BY_ID, STAFF_ROLE_BY_ID } from '../sim/catalog';
import { WEEKDAYS_FR, clockView } from '../sim/clock';
import { dayProfit, type DayStats, type Notice } from '../sim/game';
import { OBJECTIVES, TIERS, TIER_BY_ID, activeObjectives, currentTier, netWorth, rankOf, tierCount, tierObjectives } from '../sim/objectives';
import { askConfirm, button, chf, chf2, el, icon, iconButton, num, pct, signed, type IconName } from './dom';
import { rescueView, rivalBuyView, rivalPriceText, subletView, type UiCtx } from './dialogs';
import { RESCUE, taxBracketsText, type ShopType } from '../sim/catalog';
import { STOP_FR, type NoticeAction } from '../sim/game';
import { RIVALS } from '../sim/catalog';
import { batchView } from './shop-panel';
import { logisticsView } from './warehouse-panel';

type AppId = 'commerces' | 'immo' | 'banque' | 'finances' | 'equipe' | 'marche' | 'rivaux' | 'messages' | 'objectifs' | 'vehicules' | 'logistique' | 'carte' | 'entreprise' | 'reglages';
interface App { id: AppId; name: string; icon: IconName; color: string }
const APPS: App[] = [
  { id: 'commerces', name: 'Commerces', icon: 'shop', color: '#ff8a3d' },
  { id: 'immo', name: 'Immobilier', icon: 'building', color: '#4c8dff' },
  { id: 'banque', name: 'Banque', icon: 'bank', color: '#20a36b' },
  { id: 'finances', name: 'Finances', icon: 'coin', color: '#7a5cff' },
  { id: 'equipe', name: 'Équipe', icon: 'team', color: '#ef6b8a' },
  { id: 'marche', name: 'Marché', icon: 'chart', color: '#e9a908' },
  { id: 'rivaux', name: 'Concurrence', icon: 'flag', color: '#c0485a' },
  { id: 'messages', name: 'Messages', icon: 'chat', color: '#2fb4de' },
  { id: 'objectifs', name: 'Objectifs', icon: 'trophy', color: '#e8574f' },
  { id: 'vehicules', name: 'Véhicules', icon: 'truck', color: '#6f7d90' },
  { id: 'logistique', name: 'Logistique', icon: 'box', color: '#b8863b' },
  { id: 'carte', name: 'Carte', icon: 'map', color: '#46a84f' },
  { id: 'entreprise', name: 'Entreprise', icon: 'briefcase', color: '#2a9d9b' },
  { id: 'reglages', name: 'Réglages', icon: 'gear', color: '#5b6573' },
];

export interface PhoneHooks {
  openMap: () => void;
  openCompany: () => void;
  save: () => void;
  toggleSound: () => boolean;
  muted: () => boolean;
  quality: () => string;
  setQuality: (q: string) => void;
  /** Ouverture / fermeture (le jeu se met en pause pendant que le téléphone est ouvert). */
  onToggle: (open: boolean) => void;
  /** Centre la caméra sur un point de la rue avec une balise lumineuse. */
  showOnMap: (x: number, z: number, label: string) => void;
}

type Tone = 'ok' | 'bad' | 'warn' | 'wrap' | 'warn wrap' | '';
/** Première lettre en capitale (« lundi » → « Lundi »). */
const cap = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);
const hhmm = (h: number, m: number): string => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
const WEATHER: Record<string, [IconName, string]> = { soleil: ['sun', 'Ensoleillé'], nuages: ['cloud', 'Nuageux'], pluie: ['rain', 'Pluie'] };

/* ------------------------------ Briques d'affichage ------------------------------ */

/** Tuile de chiffre clé (en tête d'appli). */
function tile(label: string, value: string, tone: Tone = '', sub?: string): HTMLElement {
  return el('div', { cls: 'ph-tile' }, el('span', { text: label }), el('b', { cls: tone, text: value }), sub ? el('small', { text: sub }) : null);
}
function tiles(...t: HTMLElement[]): HTMLElement { return el('div', { cls: `ph-tiles n${t.length}` }, ...t); }
/** Titre de section, avec un complément à droite (compteur, total). */
function sec(text: string, aside?: string): HTMLElement { return el('div', { cls: 'ph-sec' }, el('span', { text }), aside ? el('em', { text: aside }) : null); }
/** Petite mesure « libellé / valeur » dans une carte. */
function kv(label: string, value: string, tone: Tone = ''): HTMLElement { return el('div', { cls: 'ph-kv' }, el('span', { text: label }), el('b', { cls: tone, text: value })); }
function pill(text: string, tone: Tone | 'info' = ''): HTMLElement { return el('span', { cls: `pill ${tone}`.trim(), text }); }
function meter(p: number, tone: Tone = ''): HTMLElement {
  return el('div', { cls: `ph-meter ${tone}`.trim() }, el('i', { attrs: { style: `width:${Math.round(Math.max(0, Math.min(1, p)) * 100)}%` } }));
}

interface CardOpts { accent?: string; title: string; sub?: string; right?: Node | null; body?: (Node | null)[]; actions?: (Node | null)[]; cls?: string }
/** Carte d'élément : titre et sous-titre à gauche, chiffre ou étiquette à droite, contenu, boutons. */
function card(o: CardOpts): HTMLElement {
  const acts = (o.actions ?? []).filter((a): a is Node => !!a);
  return el('div', { cls: `ph-card ${o.cls ?? ''}`.trim(), attrs: o.accent ? { style: `--app:${o.accent}` } : {} },
    el('div', { cls: 'ph-card-top' }, el('div', { cls: 'ph-card-id' }, el('b', { text: o.title }), o.sub ? el('small', { text: o.sub }) : null), o.right ?? null),
    ...(o.body ?? []),
    acts.length ? el('div', { cls: 'ph-actions' }, ...acts) : null);
}
/** État vide : pictogramme, phrase, action éventuelle. */
function empty(ic: IconName, title: string, text: string, action?: HTMLElement | null): HTMLElement {
  return el('div', { cls: 'ph-empty' }, el('div', { cls: 'ph-empty-ico' }, icon(ic)), el('b', { text: title }), el('p', { text }), action ?? null);
}

export class Phone {
  readonly root = el('div', { cls: 'phone hidden', attrs: { role: 'dialog', 'aria-label': 'Téléphone' } });
  private readonly screen = el('div', { cls: 'ph-screen' });
  private readonly status = el('div', { cls: 'ph-status' });
  private app: AppId | null = null;
  private immoTab: 'locaux' | 'apparts' | 'baux' = 'locaux';
  private immoSort: 'benefice' | 'passants' | 'loyer' | 'surface' = 'benefice';
  private msgFilter: 'tout' | 'alertes' = 'tout';
  /** Voile assombri et flouté derrière le téléphone (un clic dessus le ferme). */
  private readonly veil = el('div', { cls: 'ph-veil hidden' });
  private lastVersion = -1;
  private lastPaint = 0;
  /** Nombre de messages déjà lus. */
  private seen = 0;
  /** Messages non lus au moment d'ouvrir l'appli Messages (marqués « nouveau »). */
  private fresh = 0;

  constructor(private readonly ctx: UiCtx, private readonly hooks: PhoneHooks) {
    const home = el('button', { cls: 'ph-home', attrs: { type: 'button', 'aria-label': 'Accueil du téléphone' }, on: { click: () => { this.app ? this.go(null) : this.close(); } } });
    this.root.append(el('div', { cls: 'ph-frame' }, el('div', { cls: 'ph-notch' }), this.status, this.screen, home));
    this.veil.addEventListener('click', () => this.close());
    document.body.append(this.veil, this.root);
    this.seen = ctx.game.notices.length;
  }

  get isOpen(): boolean { return !this.root.classList.contains('hidden'); }
  /** Messages non lus (pastille sur le bouton du téléphone). */
  get unread(): number { return Math.max(0, this.ctx.game.notices.length - this.seen); }

  toggle(): void { if (this.isOpen) this.close(); else this.open(); }
  open(app: AppId | null = null): void {
    const was = this.isOpen;
    this.root.classList.remove('hidden'); this.veil.classList.remove('hidden');
    if (!was) this.hooks.onToggle(true);
    this.go(app);
  }
  close(): void {
    if (!this.isOpen) return;
    this.root.classList.add('hidden'); this.veil.classList.add('hidden');
    this.hooks.onToggle(false);
  }
  /** Retour : appli → accueil → fermé. */
  back(): void { if (this.app) this.go(null); else this.close(); }

  go(app: AppId | null): void {
    if (app === 'carte') { this.close(); this.hooks.openMap(); return; }
    if (app === 'entreprise') { this.close(); this.hooks.openCompany(); return; }
    if (app === 'logistique') { this.close(); this.ctx.panel.open(logisticsView(this.ctx)); return; }
    this.app = app;
    if (app === 'messages') { this.fresh = this.unread; this.seen = this.ctx.game.notices.length; }
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
    if (this.app === 'messages') { this.fresh += this.unread; this.seen = g.notices.length; }
    const c = clockView(g.total);
    this.status.replaceChildren(el('b', { text: hhmm(c.hour, c.minute) }), el('span', { cls: g.cash < 0 ? 'bad' : '', text: chf(g.cash) }));
    const scroll = this.screen.querySelector('.ph-body')?.scrollTop ?? 0;
    if (!this.app) { this.screen.replaceChildren(this.homeScreen()); return; }
    const a = APPS.find((x) => x.id === this.app)!;
    const body = el('div', { cls: 'ph-body' }, ...this.render(this.app));
    const back = button('', () => this.go(null), 'ph-back');
    back.setAttribute('aria-label', 'Retour à l’accueil');
    back.append(icon('back'));
    this.screen.replaceChildren(
      el('div', { cls: 'ph-bar', attrs: { style: `--app:${a.color}` } }, back, el('span', { cls: 'ph-bar-ico' }, icon(a.icon)), el('b', { text: a.name }), this.barAside(this.app)),
      body);
    body.scrollTop = scroll;
  }

  /** Complément discret dans la barre de titre de l'appli. */
  private barAside(app: AppId): HTMLElement | null {
    const g = this.ctx.game;
    const t = app === 'commerces' ? `${g.shops.length}` : app === 'equipe' ? `${g.employees.length}` : app === 'vehicules' ? `${g.vehicles.length}`
      : app === 'objectifs' ? `${g.achieved.length}/${OBJECTIVES.length}` : app === 'banque' ? chf(g.cash) : app === 'finances' ? chf(netWorth(g)) : null;
    return t ? el('span', { cls: 'ph-bar-aside', text: t }) : null;
  }

  private homeScreen(): HTMLElement {
    const g = this.ctx.game;
    const warn = g.shops.reduce((n, s) => n + s.warned.length, 0);
    const pendingRaise = g.employees.filter((e) => e.askedRaise).length;
    const badge: Partial<Record<AppId, number>> = { messages: this.unread, commerces: warn, equipe: pendingRaise, rivaux: g.rivalry.threats().filter((t) => t.rival.promo > 0).length };
    const c = clockView(g.total);
    const today = dayProfit(g.today);
    const [wi, wl] = WEATHER[g.weather] ?? WEATHER['soleil']!;
    return el('div', { cls: 'ph-homescreen' },
      el('div', { cls: 'ph-clock' },
        el('b', { text: hhmm(c.hour, c.minute) }),
        el('span', { cls: 'ph-date' }, el('span', { text: `${cap(WEEKDAYS_FR[c.weekday]!)} · jour ${c.day + 1}` }), el('span', { cls: 'ph-weather' }, icon(wi), wl))),
      el('div', { cls: 'ph-widgets' },
        el('button', { cls: 'ph-widget', attrs: { type: 'button' }, on: { click: () => this.go('banque') } },
          el('span', { text: 'Compte' }), el('b', { cls: g.cash < 0 ? 'bad' : '', text: chf(g.cash) }),
          el('small', { cls: today >= 0 ? 'ok' : 'bad', text: `${signed(today)} aujourd’hui` })),
        el('button', { cls: 'ph-widget', attrs: { type: 'button' }, on: { click: () => this.go('objectifs') } },
          el('span', { text: 'Valeur nette' }), el('b', { text: chf(netWorth(g)) }), el('small', { text: rankOf(g) }))),
      g.inDifficulty() && !g.rescue.bankrupt ? el('button', { cls: 'ph-banner rd-banner', attrs: { type: 'button' }, on: { click: () => this.openRescue() } }, icon('alert'),
        el('span', { text: g.bankruptcyIn() !== null ? `Faillite dans ${g.bankruptcyIn()} jour(s) : plan de redressement` : 'Entreprise en difficulté : plan de redressement' }), icon('next')) : null,
      warn ? el('button', { cls: 'ph-banner', attrs: { type: 'button' }, on: { click: () => this.go('commerces') } }, icon('alert'), el('span', { text: `${warn} alerte${warn > 1 ? 's' : ''} dans vos commerces` }), icon('next')) : null,
      el('div', { cls: 'ph-grid' }, ...APPS.map((a) => el('button', { cls: 'ph-app', attrs: { type: 'button', 'data-app': a.id, 'aria-label': a.name }, on: { click: () => this.go(a.id) } },
        el('span', { cls: 'ph-ico', attrs: { style: `--app:${a.color}` } }, icon(a.icon)),
        badge[a.id] ? el('i', { cls: 'ph-badge', text: String(Math.min(99, badge[a.id]!)) }) : null,
        el('span', { cls: 'ph-name', text: a.name })))));
  }

  private render(app: AppId): (Node | null)[] {
    switch (app) {
      case 'commerces': return this.commerces();
      case 'immo': return this.immo();
      case 'banque': return this.banque();
      case 'finances': return this.finances();
      case 'equipe': return this.equipe();
      case 'marche': return this.marche();
      case 'rivaux': return this.rivaux();
      case 'messages': return this.messages();
      case 'objectifs': return this.objectifs();
      case 'vehicules': return this.vehicules();
      case 'reglages': return this.reglages();
      default: return [];
    }
  }

  private gps(x: number, z: number, label: string, cls = ''): HTMLButtonElement {
    return iconButton('route', 'Itinéraire', () => { this.ctx.waypoint(x, z, label); this.close(); }, `small ${cls}`.trim());
  }
  private onMap(x: number, z: number, label: string, cls = ''): HTMLButtonElement {
    return iconButton('eye', 'Voir sur la carte', () => { this.close(); this.hooks.showOnMap(x, z, label); }, `small ${cls}`.trim());
  }
  private serviceGps(service: string, label: string): HTMLButtonElement | null {
    const b = this.ctx.game.district.buildings.find((x) => x.service === service);
    return b ? iconButton('route', `Itinéraire : ${label}`, () => { this.ctx.waypoint(b.doorX, b.doorZ, label); this.close(); }, 'small primary') : null;
  }
  /** Ouvre le plan de redressement (panneau) et ferme le téléphone. */
  private openRescue(): void { this.close(); this.ctx.panel.open(rescueView(this.ctx)); }
  /** Aligne les prix d'un type de commerce (ou de tous) sur le prix du quartier. */
  private align(target: ShopType | 'tous'): void { this.ctx.act(this.ctx.game.applyBatch(target, { priceFactor: 1 }), (r) => r.changes ? `Prix alignés sur le quartier (${r.changes} prix modifié${r.changes > 1 ? 's' : ''}).` : 'Prix déjà au niveau du quartier.'); this.paint(true); }
  /** Bouton d'une action proposée par une notification. */
  private noticeButton(a: NoticeAction): HTMLButtonElement {
    return a.kind === 'aligner' ? button('Aligner les prix', () => this.align(a.target), 'small primary') : button('Plan de redressement', () => this.openRescue(), 'small primary');
  }

  /* ------------------------------ Commerces ------------------------------ */

  private commerces(): (Node | null)[] {
    const g = this.ctx.game;
    if (!g.shops.length) return [empty('shop', 'Aucun commerce', 'Trouvez un local libre dans l’appli Immobilier, puis signez le bail sur place.', button('Ouvrir Immobilier', () => this.go('immo'), 'primary'))];
    const c = clockView(g.total);
    const totRev = g.shops.reduce((a, s) => a + s.today.revenue, 0), totCli = g.shops.reduce((a, s) => a + s.today.customers, 0);
    const lost = g.shops.reduce((a, s) => a + s.today.lostStaff + s.today.lostStock + s.today.lostCapacity, 0);
    // Prix restés au-dessus du quartier, par type de commerce : bouton « Aligner ».
    const gaps = [...new Set(g.shops.map((s) => s.type))].map((t) => ({ t, gap: g.priceGap(t), n: g.batchShops(t).length })).filter((x) => x.gap >= 0.03);
    return [
      tiles(tile('Ventes du jour', chf(totRev)), tile('Clients', num(totCli), '', lost ? `${num(lost)} perdu(s)` : 'aucun perdu')),
      g.inDifficulty() && !g.rescue.bankrupt ? card({
        accent: '#ef5a5a', title: 'Entreprise en difficulté', sub: g.rescue.lossDays >= RESCUE.lossDaysPlan ? `${g.rescue.lossDays} jours de pertes d’affilée` : g.cash < 0 ? `Trésorerie négative : ${chf(g.cash)}` : 'Risque de faillite',
        actions: [button('Plan de redressement', () => this.openRescue(), 'small primary')],
      }) : null,
      ...gaps.map((x) => card({
        accent: SHOP_TYPE_BY_ID.get(x.t)!.color, title: `Prix au-dessus du quartier · ${SHOP_TYPE_BY_ID.get(x.t)!.nameFr}`,
        sub: `Vos prix sont ${Math.round(x.gap * 100)} % au-dessus du prix du quartier${x.n > 1 ? ` (${x.n} commerces)` : ''} : moins de clients, articles reposés.`,
        actions: [button('Aligner', () => this.align(x.t), 'small primary')],
      })),
      sec('Mes commerces', `${g.shops.length}`),
      g.shops.length >= 2 ? card({
        accent: '#2a9d9b', title: 'Réglages en lot', sub: 'Prix, réassort auto, horaires et nettoyage de nuit : tous les commerces d’un type (ou tous) d’un coup, avec aperçu.',
        actions: [button('Ouvrir', () => { this.close(); this.ctx.panel.open(batchView(this.ctx)); }, 'small primary')],
      }) : null,
      ...g.shops.map((s) => {
        const t = SHOP_TYPE_BY_ID.get(s.type)!, p = g.premise(s.premiseId)!;
        const open = c.hour >= s.open && c.hour < s.close;
        const staff = g.staffOf(s.id).length;
        const sLost = s.today.lostStaff + s.today.lostStock + s.today.lostCapacity;
        return card({
          accent: t.color, title: s.name, sub: `${t.nameFr} · ${s.open} h – ${s.close} h`,
          right: s.stopped ? pill('À l’arrêt', 'bad') : pill(open ? 'Ouvert' : 'Fermé', open ? 'ok' : ''),
          body: [
            el('div', { cls: 'ph-kvs' }, kv('Clients', num(s.today.customers)), kv('Ventes', chf(s.today.revenue)), kv('Employés', String(staff), staff ? '' : 'warn')),
            s.stopped ? el('div', { cls: 'ph-note bad' }, icon('alert'), el('span', { text: `À l’arrêt (${STOP_FR[s.stopped]}) : ${staff ? 'employés en chômage technique, non payés' : 'nettoyage de nuit suspendu'}. Il repart dès qu’il peut vendre.` })) : null,
            sLost ? el('div', { cls: 'ph-note warn' }, icon('alert'), el('span', { text: `${num(sLost)} client(s) perdu(s) aujourd’hui` })) : null,
            s.warned.length ? el('div', { cls: 'ph-note bad' }, icon('alert'), el('span', { text: `${s.warned.length} alerte(s) : stock, caisse ou place` })) : null,
          ],
          actions: [button('Gérer', () => { this.close(); this.ctx.openShop(s.id); }, 'small primary'), this.gps(p.doorX, p.doorZ, s.name)],
        });
      }),
    ];
  }

  /* ------------------------------ Immobilier ------------------------------ */

  private immo(): (Node | null)[] {
    const g = this.ctx.game;
    const free = g.district.premises.filter((p) => g.isFree(p));
    const homes = g.district.homes.filter((h) => g.homeFree(h.id));
    const leases = g.shops.length + g.sublets.length + (g.player.home ? 1 : 0);
    const tabs = el('div', { cls: 'ph-seg' }, ...([['locaux', 'Locaux', free.length], ['apparts', 'Apparts', homes.length], ['baux', 'Mes baux', leases]] as const)
      .map(([id, l, n]) => { const b = button('', () => { this.immoTab = id; this.paint(true); }, this.immoTab === id ? 'on' : ''); b.append(el('span', { text: l }), el('i', { text: String(n) })); return b; }));
    const out: (Node | null)[] = [tabs];
    const sortBar = (opts: readonly (readonly ['benefice' | 'passants' | 'loyer' | 'surface', string])[]): HTMLElement => el('div', { cls: 'ph-sort' }, el('span', { text: 'Trier par' }),
      ...opts.map(([id, l]) => button(l, () => { this.immoSort = id; this.paint(true); }, this.immoSort === id ? 'on' : '')));
    if (this.immoTab === 'locaux') {
      // Type conseillé : le meilleur bénéfice estimé par jour (pas seulement le plus de clients).
      const best = new Map(free.map((p) => [p.id, g.bestType(p)]));
      const key = { benefice: (p: { id: number }) => -(best.get(p.id)?.profit ?? 0), passants: (p: { footfall: number }) => -p.footfall, loyer: (p: { rent: number }) => p.rent, surface: (p: { area: number }) => -p.area }[this.immoSort] as (p: typeof g.district.premises[number]) => number;
      free.sort((a, b) => key(a) - key(b));
      out.push(sortBar([['benefice', 'Bénéfice'], ['passants', 'Passants'], ['loyer', 'Loyer'], ['surface', 'Surface']]));
      if (!free.length) out.push(empty('building', 'Aucun local libre', 'Tous les locaux du quartier sont occupés pour le moment.'));
      else out.push(el('p', { cls: 'ph-hint', text: 'Bénéfice estimé par jour pour le type conseillé, bien tenu en gamme standard (loyer, salaires, livraisons et nettoyage compris ; hors meubles et impôt). Le bail se signe sur place, devant l’anneau jaune.' }));
      for (const p of free.slice(0, 30)) {
        const b = best.get(p.id)!, e = g.estimateProfit(p, b.type);
        out.push(card({
          accent: '#ffd166', title: `Local de ${p.area} m²`, sub: `Grille ${p.gridW} × ${p.gridD} cases · ${num(p.footfall)} passants/h`,
          right: el('div', { cls: 'ph-price' }, el('b', { text: chf(p.rent) }), el('small', { text: 'par mois' })),
          body: [el('div', { cls: 'ph-kvs' }, kv('Conseillé', SHOP_TYPE_BY_ID.get(b.type)!.nameFr), kv('Bénéfice/j', `≈ ${signed(b.profit)}`, b.profit >= 0 ? 'ok' : 'bad'), kv('Clients/j', `≈ ${num(e.customers)}`))],
          actions: [this.onMap(p.doorX, p.doorZ, `Local ${p.area} m²`, 'primary'), this.gps(p.doorX, p.doorZ, `Local ${p.area} m²`)],
        }));
      }
    } else if (this.immoTab === 'apparts') {
      const size = (h: typeof homes[number]): number => { const d = HOME_BY_ID.get(h.def)!; return d.gridW * d.gridD; };
      homes.sort((a, b) => this.immoSort === 'loyer' ? HOME_BY_ID.get(a.def)!.rentDay - HOME_BY_ID.get(b.def)!.rentDay : size(b) - size(a));
      out.push(sortBar([['surface', 'Surface'], ['loyer', 'Loyer']]));
      if (!homes.length) out.push(empty('home', 'Aucun appartement libre', 'Revenez plus tard : des logements se libèrent.'));
      else out.push(el('p', { cls: 'ph-hint', text: 'Louez pour y habiter (meilleur sommeil) ou pour sous-louer à un locataire.' }));
      for (const h of homes.slice(0, 30)) {
        const d = HOME_BY_ID.get(h.def)!;
        out.push(card({
          accent: '#9ec9ff', title: d.nameFr, sub: `${d.gridW * d.gridD} m²`,
          right: el('div', { cls: 'ph-price' }, el('b', { text: `${d.rentDay} CHF` }), el('small', { text: 'par jour' })),
          body: [el('div', { cls: 'ph-kvs' }, kv('Confort', `× ${d.comfort}`), kv('Sous-location', `≈ ${chf(d.rentDay * 1.25)}/j`))],
          actions: [this.onMap(h.doorX, h.doorZ, d.nameFr, 'primary'), this.gps(h.doorX, h.doorZ, d.nameFr)],
        }));
      }
    } else {
      const home = g.district.homes.find((h) => h.id === g.player.home);
      out.push(sec('Logement'));
      if (home) {
        const d = HOME_BY_ID.get(home.def)!;
        out.push(card({ accent: '#ffffff', title: 'Chez moi', sub: d.nameFr, right: el('div', { cls: 'ph-price' }, el('b', { cls: 'bad', text: `−${d.rentDay} CHF` }), el('small', { text: 'par jour' })), actions: [this.gps(home.doorX, home.doorZ, 'Chez moi')] }));
      } else out.push(el('p', { cls: 'ph-hint', text: 'Pas de logement : vous dormez moins bien.' }));
      out.push(sec('Baux commerciaux', `${g.shops.length}`));
      if (!g.shops.length) out.push(el('p', { cls: 'ph-hint', text: 'Aucun bail commercial pour l’instant.' }));
      for (const s of g.shops) {
        const p = g.premise(s.premiseId)!;
        out.push(card({ accent: SHOP_TYPE_BY_ID.get(s.type)!.color, title: s.name, sub: `${p.area} m² · ${chf(p.rent)}/mois`, right: el('div', { cls: 'ph-price' }, el('b', { cls: 'bad', text: `−${chf(p.rent / 30)}` }), el('small', { text: 'par jour' })) }));
      }
      out.push(sec('Sous-locations', `${g.sublets.length}`));
      if (!g.sublets.length) out.push(el('p', { cls: 'ph-hint', text: 'Devant un local ou un appartement libre : « Prendre à bail pour sous-louer ».' }));
      for (const sl of g.sublets) {
        const where = sl.kind === 'logement' ? g.district.homes.find((h) => h.id === sl.ref) : g.premise(sl.ref);
        const margin = sl.tenant ? sl.ask - sl.cost : -sl.cost;
        out.push(card({
          accent: '#c39bff', title: sl.kind === 'logement' ? 'Appartement sous-loué' : 'Local sous-loué', sub: sl.tenant ?? 'Recherche de locataire…',
          right: pill(sl.tenant ? 'Loué' : 'Vacant', sl.tenant ? 'ok' : 'warn'),
          body: [el('div', { cls: 'ph-kvs' }, kv('Je paie', `${chf2(sl.cost)}/j`), kv('Je demande', `${chf2(sl.ask)}/j`), kv('Solde', `${signed(margin)}/j`, margin >= 0 ? 'ok' : 'bad'))],
          actions: [button('Gérer', () => { this.close(); this.ctx.panel.open(subletView(this.ctx, sl.id)); }, 'small primary'), where ? this.gps(where.doorX, where.doorZ, 'Sous-location') : null],
        }));
      }
    }
    return out;
  }

  /* ------------------------------ Banque ------------------------------ */

  private banque(): (Node | null)[] {
    const g = this.ctx.game;
    const days: DayStats[] = [...g.ledger.slice(-6), g.today];
    const max = Math.max(1, ...days.map((d) => Math.abs(dayProfit(d))));
    const today = dayProfit(g.today);
    const t = g.today;
    const lines = ([
      ['Ventes', t.revenue, 1], ['Loyers encaissés', t.rentalIncome ?? 0, 1], ['Achats de marchandise', t.purchases, -1], ['Salaires', t.wages, -1],
      ['Loyers (provisions et payés)', t.rent, -1], ['Équipement', t.equipment, -1], ['Publicité', t.marketing, -1], ['Prêts et découvert', t.finance, -1], ['Vie courante', t.living, -1], ['Frais de siège', t.overhead ?? 0, -1], ['Impôt sur le bénéfice', t.tax ?? 0, -1],
    ] as [string, number, number][]).filter(([l, v]) => v > 0 || l === 'Ventes');
    const em = g.emergencyOffer();
    return [
      tiles(tile('Compte', chf(g.cash), g.cash < 0 ? 'bad' : ''), tile('Dettes', chf(g.debt), g.debt > 0 ? 'warn' : ''), tile('Aujourd’hui', signed(today), today >= 0 ? 'ok' : 'bad')),
      g.inDifficulty() && !g.rescue.bankrupt ? card({
        accent: '#ef5a5a', title: 'Plan de redressement', sub: `${g.cash < 0 ? `Découvert de ${chf(-g.cash)} (${(FINANCE.overdraftRate * 100).toLocaleString('fr-CH')} % par jour). ` : ''}${g.rescue.lossDays ? `${g.rescue.lossDays} jour(s) de pertes d’affilée. ` : ''}${g.bankruptcyIn() !== null ? `Faillite dans ${g.bankruptcyIn()} jour(s).` : ''}`,
        right: em.available ? pill(`prêt d’urgence ${chf(em.offer.amount)}`, 'warn') : null,
        actions: [button('Ouvrir le plan', () => this.openRescue(), 'small primary')],
      }) : null,
      this.financeStrip(),
      sec('Résultat des 7 derniers jours'),
      el('div', { cls: 'ph-bars' }, ...days.map((d) => {
        const v = dayProfit(d), cur = d === g.today;
        return el('div', { cls: `ph-barcol${cur ? ' cur' : ''}`, attrs: { title: `Jour ${d.day + 1} : ${signed(v)}` } },
          el('i', { cls: v >= 0 ? 'pos' : 'neg', attrs: { style: `height:${Math.max(2, Math.round((Math.abs(v) / max) * 100))}%` } }),
          el('span', { text: cur ? 'Auj.' : `J${d.day + 1}` }));
      })),
      sec('Aujourd’hui', signed(today)),
      el('div', { cls: 'ph-ledger' }, ...lines.map(([l, v, k]) => el('div', {}, el('span', { text: l }), el('b', { cls: k > 0 ? 'ok' : 'bad', text: `${k > 0 ? '+' : '−'} ${chf(v)}` })))),
      this.investLedgerLine(),
      sec('Prêts', g.loans.length ? `${g.loans.length} en cours` : undefined),
      ...(g.loans.length ? g.loans.map((l) => card({
        accent: '#20a36b', title: `Prêt de ${chf(l.amount)}`, sub: `${chf(l.daily)} prélevés chaque jour`,
        right: pill(`${l.daysLeft} j restants`, 'info'),
        body: [meter(1 - l.remaining / Math.max(1, l.total), 'ok'), el('div', { cls: 'ph-meter-l' }, el('span', { text: 'Remboursé' }), el('b', { text: `reste ${chf(l.remaining)}` }))],
      })) : [el('p', { cls: 'ph-hint', text: 'Aucun prêt en cours. Les prêts se signent au guichet de la banque.' })]),
      el('div', { cls: 'ph-actions' }, this.serviceGps('banque', 'Banque du Quartier')),
    ];
  }

  /** Ligne du grand livre : gains ou pertes des placements la nuit dernière (valeur placée, hors bénéfice d'exploitation). */
  private investLedgerLine(): HTMLElement | null {
    const y = this.ctx.game.ledger.at(-1), v = y?.investGain ?? 0;
    if (!y || Math.abs(v) < 0.005) return null;
    return el('div', { cls: 'ph-ledger' }, el('div', { attrs: { title: 'Ajouté à la valeur des placements, pas au compte courant ; hors bénéfice et hors impôt.' } },
      el('span', { text: `Placements, nuit du jour ${y.day + 1} (intérêts / plus-values)` }), el('b', { cls: v >= 0 ? 'ok' : 'bad', text: `${v >= 0 ? '+' : '−'} ${chf(Math.abs(v))}` })));
  }

  /** Rappel dans l'appli Banque : impôt de la semaine et plafond de crédit, avec accès aux détails. */
  private financeStrip(): HTMLElement {
    const g = this.ctx.game, tx = g.taxEstimate(), cl = g.creditLimit();
    return el('div', { cls: 'ph-card fin-strip', attrs: { style: '--app:#7a5cff' } },
      kv('Impôt de la semaine (estimé)', tx.exempt ? 'exonéré' : chf(tx.due), tx.due > 0 ? 'warn' : ''),
      kv('Crédit encore disponible', `${chf(cl.available)} sur ${chf(cl.limit)}`),
      el('div', { cls: 'ph-actions' }, button('Détails dans Finances', () => this.go('finances'), 'small')));
  }

  /* ------------------------------ Finances ------------------------------ */

  private finances(): (Node | null)[] {
    const g = this.ctx.game;
    const tx = g.taxEstimate(), cl = g.creditLimit();
    const when = tx.daysLeft <= 0 ? 'ce soir à minuit' : tx.daysLeft === 1 ? 'demain à minuit' : `dans ${tx.daysLeft + 1} jours, à minuit`;
    const placed = g.investValue();
    const carryLeft = g.lossCarry(tx.week + 1);
    const out: (Node | null)[] = [
      tiles(tile('Valeur nette', chf(netWorth(g)), 'wrap'), tile('Placements', chf(placed), 'wrap', 'valeur de rachat'), tile('Impôt estimé', tx.exempt ? 'exonéré' : chf(tx.due), tx.due > 0 ? 'warn wrap' : 'wrap')),
      // Impôt sur le bénéfice : barème progressif par semaine, pertes reportées.
      sec('Impôt sur le bénéfice', 'progressif, par semaine'),
      card({
        accent: '#7a5cff', title: `Semaine ${tx.week + 1}`, sub: tx.exempt ? 'Première semaine exonérée : aide à la création d’entreprise.' : `Prélèvement automatique ${when}.`,
        right: pill(tx.exempt ? 'exonéré' : chf(tx.due), tx.exempt ? 'ok' : tx.due > 0 ? 'warn' : 'ok'),
        body: [
          kv('Bénéfice de la semaine (avant impôt)', signed(tx.base), tx.base >= 0 ? 'ok' : 'bad'),
          tx.carry > 0 ? kv('Pertes reportées déduites', `− ${chf(tx.carry)}`, 'ok') : null,
          kv('Provision estimée', tx.exempt ? '0 CHF' : `${chf(tx.due)} sur ${chf(tx.taxable)} imposables`),
          el('p', { cls: 'ph-hint', text: `Barème : ${taxBracketsText()} (chaque tranche n’est taxée qu’à son taux). Le bénéfice est la somme des résultats du jour (ventes et loyers encaissés, moins toutes les dépenses ; le capital des prêts n’est pas une charge). Une semaine en déficit n’est pas imposée, et ce déficit est déduit des bénéfices des ${FINANCE.taxCarryWeeks} semaines suivantes${carryLeft > 0 ? ` (encore ${chf(carryLeft)} à déduire)` : ''}. L’impôt apparaît dans le bilan du 7e jour.` }),
        ],
      }),
      ...g.taxes.slice(-3).reverse().map((t) => kv(`Semaine ${t.week + 1} · bénéfice ${signed(t.base)}${t.carried ? ` (− ${chf(t.carried)} reportés)` : ''}`, t.amount > 0 ? `− ${chf(t.amount)}` : 'aucun impôt', t.amount > 0 ? 'bad' : 'ok')),
      // Crédit.
      sec('Plafond de crédit', chf(cl.limit)),
      card({
        accent: '#20a36b', title: `Encore ${chf(cl.available)} empruntables`, sub: `Déjà dû : ${chf(g.debt)} (intérêts compris).`,
        right: pill(cl.capped ? 'plafond maximal' : 'évolutif', cl.capped ? 'warn' : 'info'),
        body: [
          meter(g.debt / Math.max(1, cl.limit), g.debt > cl.limit * 0.8 ? 'bad' : g.debt > cl.limit * 0.5 ? 'warn' : 'ok'),
          kv('Socle accordé à toute entreprise', chf(cl.base)),
          kv(`${Math.round(FINANCE.creditWorthShare * 100)} % de la valeur nette (${chf(cl.worth)})`, `+ ${chf(cl.fromWorth)}`),
          kv(`${FINANCE.creditSalesWeeks} × les ventes des 7 derniers jours (${chf(cl.sales7)})`, `+ ${chf(cl.fromSales)}`),
          el('p', { cls: 'ph-hint', text: `Le plafond monte avec vos ventes et votre valeur nette (maximum ${chf(FINANCE.creditMax)}). Il compte le total à rembourser, intérêts compris. Les prêts se signent au guichet de la banque.` }),
        ],
        actions: [this.serviceGps('banque', 'Banque du Quartier')],
      }),
      // Placements.
      sec('Placements', placed > 0 ? chf(placed) : undefined),
      el('p', { cls: 'ph-hint', text: `Banque en ligne : placez votre trésorerie disponible (minimum ${chf(FINANCE.investMin)}). Les placements comptent dans la valeur nette, mais pas pour payer loyers et salaires.` }),
    ];
    const gains7 = g.ledger.slice(-7).reduce((a, d) => a + (d.investGain ?? 0), 0);
    if (g.ledger.slice(-7).some((d) => d.investGain)) out.push(kv('Intérêts et plus-values des 7 dernières nuits', signed(gains7), gains7 >= 0 ? 'ok' : 'bad'));
    for (const def of INVESTMENTS) out.push(this.investCard(def.id));
    // Notoriété.
    out.push(sec('Notoriété', `−${Math.round(FINANCE.awarenessDecay * 100)} % par jour`));
    if (!g.shops.length) out.push(el('p', { cls: 'ph-hint', text: 'Ouvrez un commerce : les campagnes de l’agence de publicité font connaître vos boutiques.' }));
    for (const s of g.shops) {
      const v = g.awarenessView(s.id), n = g.campaigns.filter((c) => c.shopId === s.id || c.shopId === null).length;
      const d = Math.round(v.trend * 100);
      out.push(card({
        accent: SHOP_TYPE_BY_ID.get(s.type)?.color ?? '#7a5cff', title: s.name,
        sub: n ? `${n} campagne${n > 1 ? 's' : ''} en cours` : v.now > 0 ? 'Aucune campagne : la notoriété s’estompe.' : 'Aucune campagne en cours.',
        right: pill(`+${Math.round(v.now * 100)} % de clients`, v.now > 0 ? 'ok' : ''),
        body: [meter(v.now / FINANCE.awarenessMax, 'ok'), el('div', { cls: 'ph-meter-l' }, el('span', { text: 'Tendance pour demain' }),
          el('b', { cls: d > 0 ? 'ok' : d < 0 ? 'bad' : '', text: d > 0 ? `▲ +${d} pts` : d < 0 ? `▼ ${d} pts` : 'stable' }))],
      }));
    }
    if (g.shops.length) out.push(el('p', { cls: 'ph-hint', text: `Chaque campagne donne son effet dès le lancement, puis ajoute ${Math.round(FINANCE.awarenessGain * 100)} % de cet effet chaque jour où elle dure : une longue campagne monte plus haut. Ensuite, la notoriété baisse de ${Math.round(FINANCE.awarenessDecay * 100)} % par jour (maximum +${Math.round(FINANCE.awarenessMax * 100)} % de clients par commerce).` }));
    out.push(el('div', { cls: 'ph-actions' }, this.serviceGps('pub', 'Agence de publicité')));
    return out;
  }

  private investCard(kind: InvestKind): HTMLElement {
    const g = this.ctx.game, def = INVESTMENTS.find((i) => i.id === kind)!;
    const bal = g.invest[kind] ?? 0, gain = bal - (g.investPrincipal[kind] ?? 0);
    const amount = el('input', { cls: 'price fin-amount', attrs: { type: 'number', min: String(FINANCE.investMin), step: '100', value: String(Math.max(FINANCE.investMin, Math.min(5000, Math.floor(Math.max(0, g.cash) / 100) * 100))), 'aria-label': `Montant pour ${def.nameFr}` } });
    const body: (Node | null)[] = [el('p', { cls: 'ph-hint', text: def.desc })];
    if (bal > 0) body.push(kv('Montant versé', chf(g.investPrincipal[kind] ?? 0)), kv('Gain ou perte', signed(gain), gain >= 0 ? 'ok' : 'bad'));
    if (def.dailyVol > 0 && g.fundReturns.length) {
      const last = g.fundReturns.slice(-7), tot = last.reduce((a, r) => a * (1 + r), 1) - 1;
      body.push(el('div', { cls: 'fin-spark', attrs: { title: 'Variation des 7 dernières nuits' } }, ...last.map((r) => el('i', { cls: r >= 0 ? 'pos' : 'neg', attrs: { style: `height:${Math.max(8, Math.min(100, Math.round(Math.abs(r) * 4000)))}%`, title: `${r >= 0 ? '+' : ''}${(r * 100).toFixed(2).replace('.', ',')} %` } }))),
        kv(`Sur ${last.length} nuit${last.length > 1 ? 's' : ''}`, `${tot >= 0 ? '+' : ''}${(tot * 100).toFixed(1).replace('.', ',')} %`, tot >= 0 ? 'ok' : 'bad'));
    }
    return card({
      accent: kind === 'fonds' ? '#e9a908' : '#20a36b', title: def.nameFr, sub: def.exitFee > 0 ? `Frais de retrait ${Math.round(def.exitFee * 100)} %` : 'Retrait gratuit et immédiat',
      right: el('div', { cls: 'ph-price' }, el('b', { text: chf(bal) }), el('small', { text: bal > 0 ? 'placés' : 'rien de placé' })), body,
      actions: [amount,
        button('Placer', () => this.ctx.act(g.deposit(kind, Number(amount.value)), (d) => `${chf(d)} placés.`), 'small primary'),
        bal > 0 ? button('Retirer', () => this.ctx.act(g.withdraw(kind, Number(amount.value)), (d) => `${chf(d)} versés sur le compte.`), 'small') : null,
        bal > 0 ? button('Tout retirer', () => this.ctx.act(g.withdraw(kind, bal), (d) => `${chf(d)} versés sur le compte.`), 'small') : null],
    });
  }

  /* ------------------------------ Équipe ------------------------------ */

  private equipe(): (Node | null)[] {
    const g = this.ctx.game;
    if (!g.employees.length) return [empty('team', 'Personne dans l’équipe', 'Embauchez à l’agence pour l’emploi : nouveaux candidats chaque lundi.', this.serviceGps('emploi', "Agence pour l'emploi"))];
    // Coût réel : salaire horaire × heures de l'équipe (matin, soir ou journée) dans les horaires du commerce.
    const wages = g.employees.reduce((a, e) => a + e.wage * g.hoursPerDay(e), 0);
    const moods = g.employees.map((e) => e.mood ?? 1);
    const avgMood = moods.reduce((a, b) => a + b, 0) / moods.length;
    const groups = [...g.shops.map((s) => ({ name: s.name, id: s.id as number | null })), { name: 'Sans affectation', id: null }];
    const out: (Node | null)[] = [tiles(tile('Employés', String(g.employees.length)), tile('Salaires', `${chf(wages)}/j`, '', 'selon les équipes'), tile('Moral', pct(avgMood), avgMood < 0.45 ? 'bad' : avgMood < 0.7 ? 'warn' : 'ok'))];
    for (const grp of groups) {
      const list = g.employees.filter((e) => e.shopId === grp.id);
      if (!list.length) continue;
      out.push(sec(grp.name, `${list.length}`));
      for (const e of list) {
        const mood = e.mood ?? 1, hours = g.hoursPerDay(e);
        const role = STAFF_ROLE_BY_ID.get(g.roleOf(e))?.nameFr ?? 'Caisse', shift = SHIFT_BY_ID.get(g.shiftOf(e))?.nameFr ?? 'Journée complète';
        out.push(card({
          title: e.name, sub: e.shopId === null ? `${role} · sans affectation (non payé)` : `${role} · équipe ${shift.toLowerCase()} · ${hours} h par jour`,
          right: el('div', { cls: 'ph-price' }, el('b', { text: `${chf(e.wage * hours)}` }), el('small', { text: `par jour · ${e.wage} CHF/h` })),
          body: [
            el('div', { cls: 'ph-gauges' },
              el('div', {}, el('div', { cls: 'ph-meter-l' }, el('span', { text: 'Compétence' }), el('b', { text: pct(e.skill) })), meter(e.skill)),
              el('div', {}, el('div', { cls: 'ph-meter-l' }, el('span', { text: 'Moral' }), el('b', { text: pct(mood) })), meter(mood, mood < 0.45 ? 'bad' : mood < 0.7 ? 'warn' : 'ok'))),
            e.askedRaise ? el('div', { cls: 'ph-note warn' }, icon('coin'), el('span', { text: 'Demande une augmentation (panneau du commerce).' })) : null,
          ],
        }));
      }
    }
    out.push(el('div', { cls: 'ph-actions' }, this.serviceGps('emploi', "Agence pour l'emploi")));
    return out;
  }

  /* ------------------------------ Marché ------------------------------ */

  private marche(): (Node | null)[] {
    const g = this.ctx.game;
    const mine = new Set(g.shops.map((s) => s.type));
    const types = [...SHOP_TYPES].sort((a, b) => Number(mine.has(b.id)) - Number(mine.has(a.id)));
    const out: (Node | null)[] = [
      el('p', { cls: 'ph-hint', text: 'Prix du grossiste aujourd’hui : achetez quand ils baissent. Vos types de commerce sont en tête.' }),
      el('div', { cls: 'ph-legend' }, el('span', { cls: 'trend down', text: '▼ moins cher' }), el('span', { cls: 'trend up', text: '▲ plus cher' })),
    ];
    for (const t of types) {
      const rv = g.rivals[t.id] ?? 1;
      out.push(el('div', { cls: 'ph-sec', attrs: { style: `--app:${t.color}` } },
        el('span', { cls: 'ph-sec-dot' }), el('span', { text: t.nameFr }), mine.has(t.id) ? pill('à moi', 'ok') : null,
        el('em', { cls: rv < 0.995 ? 'bad' : '', text: rv < 0.995 ? `concurrence −${Math.round((1 - rv) * 100)} %` : 'prix habituels' })));
      for (const p of PRODUCTS.filter((x) => x.shop === t.id)) {
        const m = g.marketIndex(p.id);
        out.push(el('div', { cls: 'ph-line' }, el('span', { text: p.nameFr }), el('b', { text: chf2(p.cost * m) }),
          el('span', { cls: m > 1.02 ? 'trend up' : m < 0.98 ? 'trend down' : 'trend', text: m > 1.02 ? `▲ ${Math.round((m - 1) * 100)} %` : m < 0.98 ? `▼ ${Math.round((1 - m) * 100)} %` : '=' })));
      }
    }
    out.push(el('div', { cls: 'ph-actions' }, this.serviceGps('grossiste', 'Grossiste')));
    return out;
  }

  /* ------------------------------ Concurrence ------------------------------ */

  private rivaux(): (Node | null)[] {
    const g = this.ctx.game, rv = g.rivalry;
    const threats = rv.threats(), promos = rv.shops.filter((s) => s.promo > 0).length;
    const out: (Node | null)[] = [
      tiles(tile('Rivaux actifs', String(rv.active.length)), tile('Commerces rivaux', String(rv.shops.filter((s) => s.co).length), '', `+ ${rv.shops.filter((s) => !s.co).length} indép.`),
        tile('Menaces', String(threats.length), threats.length ? 'warn' : 'ok', promos ? `${promos} en promo` : 'pas de promo')),
      rv.awake ? null : el('p', { cls: 'ph-hint', text: `Les entreprises rivales observent le quartier. Dès le jour ${RIVALS.startDay + 1}, elles ouvriront des commerces, ajusteront leurs prix et lanceront des promotions.` }),
    ];
    // Menaces : rivaux du même type près de vos commerces.
    out.push(sec('Menaces près de vos commerces', threats.length ? `${threats.length}` : undefined));
    if (!threats.length) out.push(empty('flag', 'Aucune menace', g.shops.length ? `Aucun concurrent du même type à moins de ${RIVALS.nearRadius} m de vos commerces.` : 'Ouvrez un commerce : les concurrents du même type à proximité apparaîtront ici.'));
    for (const t of threats.slice(0, 8)) {
      const q = g.premise(t.rival.premiseId)!, co = rv.co(t.rival.co), loss = rv.promoLoss(t.shop);
      out.push(card({
        accent: co?.color ?? '#7d6a8c', title: t.rival.name, sub: `à ${t.dist} m de ${t.shop.name}`,
        right: t.rival.promo > 0 ? pill(`promo ${t.rival.promo} j`, 'bad') : t.rival.opened > 0 && g.day - t.rival.opened < 7 ? pill('nouveau', 'warn') : pill(co ? co.brand : 'indépendant', 'info'),
        body: [el('div', { cls: 'ph-kvs' }, kv('Clients/j', `≈ ${num(t.rival.customers || rv.estimate(t.rival).customers)}`), kv('Prix', rivalPriceText(t.rival.price), t.rival.price < 0.97 ? 'bad' : ''),
          kv('Vos clients', loss > 0.005 && t.rival.promo > 0 ? `−${Math.round(loss * 100)} %` : '—', loss > 0.005 && t.rival.promo > 0 ? 'bad' : ''))],
        actions: [this.onMap(q.doorX, q.doorZ, t.rival.name), button('Racheter…', () => { this.close(); this.ctx.panel.open(rivalBuyView(this.ctx, q.id)); }, 'small')],
      }));
    }
    // Parts de marché par type (clients par jour).
    const rows = rv.marketShare().filter((r) => r.total > 0).sort((a, b) => b.mine - a.mine || b.total - a.total);
    out.push(sec('Parts de marché', 'clients / jour'));
    for (const r of rows) {
      const t = SHOP_TYPE_BY_ID.get(r.type)!;
      const segs = [{ label: 'Vous', color: '#5cc77a', customers: r.mine }, ...r.parts].filter((p) => p.customers > 0);
      out.push(el('div', { cls: 'riv-share' },
        el('div', { cls: 'riv-share-top' }, el('span', { text: t.nameFr }), el('b', { cls: r.mine > 0 ? 'ok' : '', text: r.mine > 0 ? `vous ${pct(r.mine / r.total)}` : `${num(r.total)} / j` })),
        el('div', { cls: 'riv-bar' }, ...segs.map((p) => el('i', { attrs: { style: `width:${(p.customers / r.total) * 100}%;background:${p.color}`, title: `${p.label} : ${num(p.customers)} clients / jour (${pct(p.customers / r.total)})` } }))),
        el('div', { cls: 'riv-legend' }, ...segs.map((p) => el('span', {}, el('i', { attrs: { style: `background:${p.color}` } }), `${p.label} ${pct(p.customers / r.total)}`)))));
    }
    // Entreprises rivales.
    out.push(sec('Entreprises rivales', `${rv.active.length}`));
    for (const co of rv.active) {
      const list = rv.shopsOf(co.id), cq = rv.companyQuote(co.id);
      const cust = list.reduce((a, s) => a + (s.customers || rv.estimate(s).customers), 0);
      out.push(card({
        accent: co.color, title: co.name, sub: [...new Set(list.map((s) => SHOP_TYPE_BY_ID.get(s.type)!.nameFr.toLowerCase()))].join(', ') || 'aucun commerce',
        right: el('b', { text: `${list.length} commerce${list.length > 1 ? 's' : ''}` }),
        body: [
          el('div', { cls: 'ph-kvs' }, kv('Trésorerie', `${Math.round(co.cash / 1000)} k CHF`, co.cash < 0 ? 'bad' : ''), kv('Réputation', pct(co.reputation)), kv('Clients/j', `≈ ${num(cust)}`)),
          ...list.map((s) => {
            const q = rv.quote(s.premiseId), p = rv.avgProfit(s);
            return el('div', { cls: 'riv-row' },
              el('div', {}, el('b', { text: s.name }), el('small', { text: `${chf(rv.avgRevenue(s))} / j · prix ${rivalPriceText(s.price)}${p < 0 ? ' · en perte' : ''}${s.promo > 0 ? ' · promo' : ''}` })),
              q ? button(chf(q.total), () => { this.close(); this.ctx.panel.open(rivalBuyView(this.ctx, s.premiseId)); }, 'small') : null);
          }),
        ],
        actions: [cq ? button(`Racheter l’entreprise (${chf(cq.total)})`, () => { void this.buyCompany(co.id); }, 'small') : null],
      }));
    }
    const gone = rv.cos.filter((c) => c.gone);
    if (gone.length) {
      out.push(sec('Disparues', `${gone.length}`));
      for (const c of gone) out.push(el('div', { cls: 'ph-line' }, el('span', { text: c.name }), el('b', { text: c.bought ? 'rachetée' : 'faillite' }), el('span', { cls: 'trend', text: `jour ${(c.endDay ?? 0) + 1}` })));
    }
    out.push(el('p', { cls: 'ph-hint', text: `Une promotion rivale prend jusqu’à ${Math.round(RIVALS.promoMax * 100)} % des clients d’un commerce du même type à moins de ${RIVALS.promoRadius} m. Un rival qui perd de l’argent finit par fermer : le local redevient libre.` }));
    return out;
  }

  private async buyCompany(coId: string): Promise<void> {
    const g = this.ctx.game, co = g.rivalry.co(coId), q = g.rivalry.companyQuote(coId);
    if (!co || !q) return;
    if (!(await askConfirm(`Racheter ${co.name} : ${q.shops} commerce(s) meublés et approvisionnés, employés repris, pour ${chf(q.total)} (dépôts des baux compris) ?`, 'Racheter'))) return;
    this.ctx.act(g.rivalry.buyCompany(coId, true), (n) => `${co.name} vous appartient (${n} commerce${n > 1 ? 's' : ''}) !`);
    this.paint(true);
  }

  /* ------------------------------ Messages ------------------------------ */

  private messages(): (Node | null)[] {
    const g = this.ctx.game;
    const all = [...g.notices].reverse();
    const alerts = all.filter((n) => n.level === 'warn' || n.level === 'error');
    const seg = el('div', { cls: 'ph-seg' }, ...([['tout', 'Tous', all.length], ['alertes', 'Alertes', alerts.length]] as const)
      .map(([id, l, n]) => { const b = button('', () => { this.msgFilter = id; this.paint(true); }, this.msgFilter === id ? 'on' : ''); b.append(el('span', { text: l }), el('i', { text: String(n) })); return b; }));
    const list = (this.msgFilter === 'alertes' ? alerts : all).slice(0, 60);
    if (!list.length) return [seg, empty('chat', 'Aucun message', this.msgFilter === 'alertes' ? 'Aucune alerte : tout va bien.' : 'Les nouvelles du quartier et de vos commerces arriveront ici.')];
    const out: (Node | null)[] = [seg];
    const ic: Record<Notice['level'], IconName> = { info: 'info', ok: 'check', warn: 'alert', error: 'alert' };
    const today = Math.floor(g.total / 1440);
    let lastDay = -1;
    list.forEach((n) => {
      const d = Math.floor(n.at / 1440);
      if (d !== lastDay) { lastDay = d; out.push(sec(d === today ? 'Aujourd’hui' : d === today - 1 ? 'Hier' : `${cap(WEEKDAYS_FR[d % 7]!)} · jour ${d + 1}`)); }
      const isNew = all.indexOf(n) < this.fresh;
      const c = clockView(n.at);
      out.push(el('div', { cls: `ph-msg ${n.level}${isNew ? ' new' : ''}` },
        el('span', { cls: 'ph-msg-ico' }, icon(ic[n.level])),
        el('div', { cls: 'ph-msg-txt' }, el('div', { text: n.text }), el('small', { text: hhmm(c.hour, c.minute) }),
          // Action proposée (aligner les prix, plan de redressement), seulement pour les messages des deux derniers jours.
          n.action && d >= today - 1 ? el('div', { cls: 'ph-msg-act' }, this.noticeButton(n.action)) : null),
        isNew ? el('i', { cls: 'ph-dot', attrs: { title: 'Nouveau' } }) : null));
    });
    return out;
  }

  /* ------------------------------ Objectifs ------------------------------ */

  /** Objectifs : les trois objectifs actifs (indication, avancement), puis les quatre paliers et leurs récompenses. */
  private objectifs(): (Node | null)[] {
    const g = this.ctx.game;
    const cur = currentTier(g), level = cur ? TIERS.indexOf(cur) : TIERS.length, cc = cur ? tierCount(g, cur.id) : null;
    const active = activeObjectives(g);
    const out: (Node | null)[] = [
      tiles(tile('Rang', rankOf(g), 'wrap'), tile('Palier', cur ? `${level + 1} / ${TIERS.length}` : 'tous', '', cc ? `${cc.done} / ${cc.total} objectifs` : 'franchis'), tile('Atteints', `${g.achieved.length} / ${OBJECTIVES.length}`)),
      meter(g.achieved.length / OBJECTIVES.length, 'ok'),
    ];
    if (active.length) {
      out.push(sec('En cours', `${active.length} en parallèle`));
      for (const o of active) {
        const pr = o.progress(g);
        out.push(card({
          cls: 'current', accent: '#ffcc4d', title: o.title, sub: `Palier ${TIER_BY_ID.get(o.tier)!.name}`, right: el('span', { cls: 'ph-step', text: String(OBJECTIVES.indexOf(o) + 1) }),
          body: [el('p', { cls: 'ph-card-txt', text: o.hint }), meter(pr.p, 'ok'), el('div', { cls: 'ph-meter-l' }, el('span', { text: 'Avancement' }), el('b', { text: pr.text }))],
        }));
      }
    } else out.push(el('div', { cls: 'ph-note ok' }, icon('trophy'), el('span', { text: 'Tous les objectifs sont atteints : vous êtes la légende du quartier !' })));
    TIERS.forEach((t, k) => {
      const c = tierCount(g, t.id);
      out.push(sec(`Palier ${k + 1} · ${t.name}`, `${c.done} / ${c.total}`));
      out.push(el('p', { cls: 'ph-hint', text: `${c.done >= c.total ? 'Récompense obtenue' : k > level ? 'À débloquer · récompense' : 'Récompense'} : ${t.reward}.` }));
      out.push(el('ol', { cls: `ph-olist${k > level ? ' locked' : ''}` }, ...tierObjectives(t.id).map((o) => {
        const done = g.achieved.includes(o.id);
        return el('li', { cls: done ? 'done' : active.includes(o) ? 'on' : '' }, el('i', {}, done ? icon('check') : String(OBJECTIVES.indexOf(o) + 1)), el('span', { text: o.title }));
      })));
    });
    return out;
  }

  /* ------------------------------ Véhicules ------------------------------ */

  private vehicules(): (Node | null)[] {
    const g = this.ctx.game;
    if (!g.vehicles.length) return [empty('truck', 'Aucun véhicule', 'Le garage vend scooters, citadines, voitures de luxe, camionnettes et camions pour transporter la marchandise.', this.serviceGps('garage', 'Garage'))];
    const names = new Map(PRODUCTS.map((p) => [p.id, p.nameFr]));
    return [
      tiles(tile('Véhicules', String(g.vehicles.length)), tile('Capacité', num(g.vehicles.reduce((a, v) => a + VEHICLE_BY_ID.get(v.type)!.cargo, 0)), '', 'unités au total')),
      ...g.vehicles.map((v) => {
        const d = VEHICLE_BY_ID.get(v.type)!;
        const goods = Object.entries(v.cargo).filter(([, n]) => n > 0);
        const load = goods.reduce((a, [, n]) => a + n, 0);
        return card({
          accent: d.color, title: d.nameFr, sub: `Assurance ${d.insurance} CHF/jour`,
          right: el('div', { cls: 'ph-price' }, el('b', { text: `${num(load)} / ${num(d.cargo)}` }), el('small', { text: 'chargement' })),
          body: [meter(load / d.cargo, load >= d.cargo ? 'warn' : ''),
            el('p', { cls: 'ph-card-txt', text: goods.length ? goods.map(([id, n]) => `${names.get(id) ?? id} × ${n}`).join(' · ') : 'Vide' })],
          actions: [this.gps(v.x, v.z, d.nameFr, 'primary')],
        });
      }),
    ];
  }

  /* ------------------------------ Réglages ------------------------------ */

  private reglages(): (Node | null)[] {
    const q = this.hooks.quality();
    const muted = this.hooks.muted();
    const keys: [string, string][] = [['T', 'Téléphone'], ['M', 'Carte'], ['E', 'Interagir'], ['B', 'Aménager'], ['P', 'Pause'], ['1 – 4', 'Vitesse'], ['H', 'Aide'], ['Échap', 'Fermer']];
    return [
      sec('Graphismes'),
      el('div', { cls: 'ph-seg' }, ...([['auto', 'Auto'], ['basse', 'Basse'], ['haute', 'Haute']] as const).map(([id, l]) => button(l, () => { this.hooks.setQuality(id); this.paint(true); }, q === id ? 'on' : ''))),
      el('p', { cls: 'ph-hint', text: 'Auto : la qualité baisse toute seule si les images par seconde chutent (ombres, résolution).' }),
      sec('Son'),
      el('button', { cls: `ph-toggle${muted ? '' : ' on'}`, attrs: { type: 'button', 'aria-pressed': String(!muted) }, on: { click: () => { this.hooks.toggleSound(); this.paint(true); } } },
        icon(muted ? 'mute' : 'sound'), el('span', { text: muted ? 'Son coupé' : 'Son activé' }), el('i', {})),
      sec('Partie'),
      iconButton('save', 'Sauvegarder la partie', () => this.hooks.save(), 'primary wide'),
      el('p', { cls: 'ph-hint', text: 'La partie est aussi sauvegardée automatiquement chaque nuit.' }),
      sec('Raccourcis'),
      el('div', { cls: 'ph-keys' }, ...keys.map(([k, t]) => el('div', {}, el('kbd', { text: k }), el('span', { text: t })))),
    ];
  }
}
