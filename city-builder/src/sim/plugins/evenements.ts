/**
 * Module « evenements » (docs/PROGRESSION.md) : événements rares, lisibles et jamais injustes.
 *  - périodiques ou réactifs selon l'état de la ville : canicule (été, temps sec : demande d'eau et d'électricité,
 *    risque de feu), panne du réseau voisin (seulement si la ville achète son électricité), épidémie, grève des
 *    éboueurs (seulement avec un service de collecte), afflux de nouveaux habitants, investisseur (prime si un objectif
 *    en cours est atteint à temps) ;
 *  - toujours ANNONCÉS avant leur effet (préavis de 1 à 3 jours) avec ce qu'il faut faire, effet borné et court ;
 *    aucun événement pendant les 45 premiers jours d'une partie (ou d'une ancienne sauvegarde rechargée), répit
 *    d'au moins 18 jours entre deux, aucun événement négatif pour une ville en faillite ou déjà très mécontente ;
 *  - tirages : PRNG PROPRE au module (jamais celui de la partie) ; réglage du joueur : normal / rares / désactivés ;
 *  - effets publiés comme modificateurs (service `evenements`, src/shared/governance.ts) lus par l'électricité, l'eau,
 *    les déchets, la démographie et les services.
 * Réglage par défaut et aucun événement vécu : aucun delta, aucune section de sauvegarde.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { EVENTS_SERVICE, type GovernanceService, type ModifierDelta } from '../../shared/governance';
import {
  EVENT_FREQUENCIES, EVENT_KINDS, EVENT_TITLES, type EvenementsState, type EventDash, type EventFrequency, type EventKind, type EventRecord, type EventView,
} from '../../shared/protocol-ext/evenements';
import { OBJECTIFS_SERVICE, type ObjectifsService } from '../../shared/protocol-ext/objectifs';
import type { ElectriciteService } from '../../shared/power/types';
import { METEO_SERVICE, type MeteoService } from '../../shared/weather/types';
import { MINUTES_PER_DAY, MINUTES_PER_MONTH, MONTH_NAMES_FR } from '../clock';
import { runMigrations } from '../save-sections/types';
import type { PluginCommandResult, PluginContext, SimPlugin } from './types';

export const EVENEMENTS_SAVE_VERSION = 1;
/** Aucun événement avant 45 jours de partie (ni dans les 45 jours qui suivent le chargement d'une ancienne sauvegarde). */
export const EVENTS_START_DAYS = 45;
/** Répit minimal entre deux événements (jours) et probabilité quotidienne d'un événement, selon le réglage. */
export const EVENT_GAP_DAYS: Record<Exclude<EventFrequency, 'off'>, number> = { normal: 18, rares: 50 };
export const EVENT_DAILY_CHANCE: Record<Exclude<EventFrequency, 'off'>, number> = { normal: 1 / 16, rares: 1 / 45 };
const MAX_HISTORY = 12;

interface KindDef {
  title: string;
  /** Préavis (jours) et durée de l'effet (jours). */
  notice: number;
  duration: number;
  negative: boolean;
  dash: EventDash;
  effect: ModifierDelta;
  effects: string[];
  text: string;
  advice: string;
}

export const EVENT_DEFS: Record<EventKind, KindDef> = {
  canicule: {
    title: EVENT_TITLES.canicule, notice: 2, duration: 4, negative: true, dash: 'water',
    effect: { powerDemandFactor: 1.15, waterDemandFactor: 1.25, fireRiskFactor: 2, happiness: -1 },
    effects: ['Électricité demandée +15 %', 'Eau demandée +25 %', 'Risque de départ de feu ×2', 'Satisfaction −1'],
    text: 'Une vague de chaleur arrive sur la ville.',
    advice: 'Vérifiez la marge de vos réseaux d’eau et d’électricité, adoptez si besoin les restrictions d’eau, et couvrez les quartiers par les pompiers. Un orage peut y mettre fin plus tôt.',
  },
  panne_reseau: {
    title: EVENT_TITLES.panne_reseau, notice: 2, duration: 2, negative: true, dash: 'energy',
    effect: { powerImportFactor: 0.5 },
    effects: ['Électricité achetée au réseau voisin : capacité −50 %'],
    text: 'Le réseau électrique voisin annonce des travaux : la ville ne pourra acheter que la moitié de l’électricité habituelle.',
    advice: 'Construisez une centrale (même petite) pour compléter, ou adoptez la politique « Sobriété énergétique » pendant la panne.',
  },
  epidemie: {
    title: EVENT_TITLES.epidemie, notice: 3, duration: 6, negative: true, dash: 'services',
    effect: { sicknessFactor: 2.5, happiness: -1 },
    effects: ['Risque de tomber malade ×2,5', 'Satisfaction −1'],
    text: 'Une épidémie de grippe gagne la région.',
    advice: 'Des centres de santé et un hôpital à portée raccourcissent la maladie et évitent les décès ; améliorer un équipement augmente sa capacité.',
  },
  greve_eboueurs: {
    title: EVENT_TITLES.greve_eboueurs, notice: 2, duration: 4, negative: true, dash: 'waste',
    effect: { wasteCollectionFactor: 0.25 },
    effects: ['Camions-bennes en service : un sur quatre'],
    text: 'Les éboueurs annoncent une grève : seule une partie des camions sortira.',
    advice: 'Videz les bacs avant la grève en augmentant le financement des camions (Déchets), puis rétablissez-le ensuite.',
  },
  afflux: {
    title: EVENT_TITLES.afflux, notice: 1, duration: 5, negative: false, dash: 'population',
    effect: { immigrationFactor: 1.8, demand: { R: 0.25 } },
    effects: ['Arrivées de nouveaux habitants ×1,8', 'Demande résidentielle en hausse'],
    text: 'La ville attire : de nombreuses familles cherchent à s’y installer.',
    advice: 'Zonez du résidentiel desservi (eau, électricité) pour les accueillir, et prévoyez des emplois.',
  },
  investisseur: {
    title: EVENT_TITLES.investisseur, notice: 0, duration: 30, negative: false, dash: 'progression',
    effect: {},
    effects: [],
    text: 'Un investisseur suit de près la ville.',
    advice: 'Atteignez l’objectif indiqué avant la date limite pour toucher la prime (Progression › Objectifs).',
  },
};

interface Current {
  kind: EventKind; phase: 'annonce' | 'actif'; announcedAt: number; startAt: number; endAt: number;
  objKey?: string; objTitle?: string; bonus?: number;
  /** Mesures de l'issue : valeur de départ (compteurs du mois), mois de départ, pire valeur horaire. */
  base: number; baseMonth: number; peak: number;
}
interface Live { setting: EventFrequency; current: Current | null; history: EventRecord[]; startedAt: number; lastEndAt: number }
export type EvenementsSave = Live;
const fresh = (now = 0): Live => ({ setting: 'normal', current: null, history: [], startedAt: now, lastEndAt: -1e12 });
export const emptyEvenementsSave = (): Live => fresh(0);

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export function migrateEvenements(data: unknown, from: number): EvenementsSave {
  const o = runMigrations(data, from, EVENEMENTS_SAVE_VERSION, {}, 'evenements') as Partial<Live>;
  const out = fresh(0);
  if (EVENT_FREQUENCIES.includes(o.setting as EventFrequency)) out.setting = o.setting as EventFrequency;
  if (fin(o.startedAt)) out.startedAt = o.startedAt;
  if (fin(o.lastEndAt)) out.lastEndAt = o.lastEndAt;
  for (const h of Array.isArray(o.history) ? o.history : []) {
    if (h && typeof h === 'object' && EVENT_KINDS.includes(h.kind)) out.history.push({ kind: h.kind, title: typeof h.title === 'string' ? h.title : EVENT_TITLES[h.kind], at: fin(h.at) ? h.at : 0, outcome: typeof h.outcome === 'string' ? h.outcome : '' });
  }
  out.history = out.history.slice(-MAX_HISTORY);
  const c = o.current as Partial<Current> | null | undefined;
  if (c && typeof c === 'object' && EVENT_KINDS.includes(c.kind as EventKind) && fin(c.startAt) && fin(c.endAt)) {
    out.current = {
      kind: c.kind as EventKind, phase: c.phase === 'actif' ? 'actif' : 'annonce', announcedAt: fin(c.announcedAt) ? c.announcedAt : c.startAt, startAt: c.startAt, endAt: c.endAt,
      base: fin(c.base) ? c.base : 0, baseMonth: fin(c.baseMonth) ? c.baseMonth : 0, peak: fin(c.peak) ? c.peak : 0,
      ...(typeof c.objKey === 'string' ? { objKey: c.objKey } : {}), ...(typeof c.objTitle === 'string' ? { objTitle: c.objTitle } : {}), ...(fin(c.bonus) ? { bonus: c.bonus } : {}),
    };
  }
  return out;
}

/** Date courte « 12 juin » d'une minute de jeu. */
export function dayLabel(minute: number): string {
  const day = Math.floor(minute / MINUTES_PER_DAY) % 30 + 1;
  const month = Math.floor(minute / MINUTES_PER_MONTH) % 12;
  return `${day} ${MONTH_NAMES_FR[month]}`;
}

export function createEvenementsPlugin(): SimPlugin & { readonly state: () => EvenementsSave } {
  let s = fresh();
  let version = 0, sent = -1, everSent = false, minuteAcc = 0;
  let sectionLoaded = false;
  const idle = (): boolean => s.setting === 'normal' && !s.current && !s.history.length;
  const quietUntil = (): number => {
    const gap = EVENT_GAP_DAYS[s.setting === 'rares' ? 'rares' : 'normal'];
    return Math.max(s.startedAt + EVENTS_START_DAYS * MINUTES_PER_DAY, s.lastEndAt + gap * MINUTES_PER_DAY);
  };
  const service: GovernanceService = {
    modifiers: () => (s.current && s.current.phase === 'actif' ? EVENT_DEFS[s.current.kind].effect : {}),
  };

  const viewOf = (c: Current): EventView => {
    const d = EVENT_DEFS[c.kind];
    const v: EventView = {
      kind: c.kind, title: d.title, phase: c.phase, text: d.text, advice: d.advice, effects: [...d.effects], startsAt: c.startAt, endsAt: c.endAt, dash: d.dash,
    };
    if (c.kind === 'investisseur') {
      v.text = `Un investisseur promet ${(c.bonus ?? 0).toLocaleString('fr-FR')} CHF si l’objectif « ${c.objTitle ?? ''} » est atteint avant le ${dayLabel(c.endAt)}.`;
      v.objective = c.objTitle ?? '';
      v.bonus = c.bonus ?? 0;
      v.effects = [`Prime promise : ${(c.bonus ?? 0).toLocaleString('fr-FR')} CHF`];
    }
    return v;
  };
  const view = (): EvenementsState => ({ setting: s.setting, current: s.current ? viewOf(s.current) : null, history: s.history.map((h) => ({ ...h })), quietUntil: quietUntil() });

  /** Mesure de l'issue (compteur cumulé du mois : feux, malades, arrivées). */
  const counter = (ctx: PluginContext, kind: EventKind, which: 'month' | 'lastMonth'): number => {
    if (!ctx.demography) return 0;
    const r = ctx.demography.report();
    if (kind === 'canicule') return r.cityServices?.[which].fires ?? 0;
    if (kind === 'epidemie') return r.cityServices?.[which].sickCases ?? 0;
    if (kind === 'afflux') return r[which].immigrants;
    return 0;
  };
  const sinceStart = (ctx: PluginContext, c: Current): number => {
    const sameMonth = ctx.clock.monthIndex === c.baseMonth;
    return sameMonth ? counter(ctx, c.kind, 'month') - c.base : counter(ctx, c.kind, 'month') + Math.max(0, counter(ctx, c.kind, 'lastMonth') - c.base);
  };
  const wasteFullShare = (ctx: PluginContext): number => {
    const d = ctx.use<{ binFull(id: number): boolean }>('dechets');
    if (!d) return 0;
    const st = ctx.buildings.store;
    let occ = 0, full = 0;
    for (let i = 0; i < ctx.buildings.count; i++) { if (st.residents[i]! + st.workers[i]! <= 0) continue; occ++; if (d.binFull(st.id[i]!)) full++; }
    return occ ? full / occ : 0;
  };

  const finish = (ctx: PluginContext, outcome: string): void => {
    const c = s.current!;
    const d = EVENT_DEFS[c.kind];
    s.history.push({ kind: c.kind, title: d.title, at: ctx.clock.totalMinutes, outcome });
    if (s.history.length > MAX_HISTORY) s.history.shift();
    s.current = null;
    s.lastEndAt = ctx.clock.totalMinutes;
    ctx.notify('info', `Événement terminé — ${d.title} : ${outcome}`);
    if (d.negative) ctx.use<ObjectifsService>(OBJECTIFS_SERVICE)?.achieve('crise_surmontee');
    version++;
  };

  const outcomeOf = (ctx: PluginContext, c: Current): string => {
    switch (c.kind) {
      case 'canicule': { const n = sinceStart(ctx, c); return n ? `${n} départ${n > 1 ? 's' : ''} de feu pendant la vague de chaleur.` : 'aucun départ de feu pendant la vague de chaleur.'; }
      case 'panne_reseau': return c.peak > 0.005 ? `jusqu’à ${Math.round(c.peak * 100)} % des bâtiments privés de courant.` : 'aucune coupure : la ville a tenu.';
      case 'epidemie': { const n = sinceStart(ctx, c); return `${n.toLocaleString('fr-FR')} habitant${n > 1 ? 's' : ''} tombé${n > 1 ? 's' : ''} malade${n > 1 ? 's' : ''}.`; }
      case 'greve_eboueurs': { const v = wasteFullShare(ctx); return v > 0.02 ? `${Math.round(v * 100)} % des bacs pleins à la reprise : les camions rattrapent le retard.` : 'les bacs ont tenu, la collecte reprend normalement.'; }
      case 'afflux': { const n = sinceStart(ctx, c); return `${n.toLocaleString('fr-FR')} nouveaux habitants accueillis.`; }
      default: return '';
    }
  };

  /** Événements possibles maintenant, avec leur poids. */
  const eligible = (ctx: PluginContext): [EventKind, number][] => {
    const out: [EventKind, number][] = [];
    const pop = ctx.demography?.population ?? 0;
    if (pop < 300) return out;
    const r = ctx.demography!.report();
    const calm = !ctx.economy.bankrupt && r.happiness >= 40;
    const month = ctx.clock.month;
    if (calm) {
      const w = ctx.use<MeteoService>(METEO_SERVICE)?.payload();
      const dry = !w || (w.kind !== 'pluie' && w.kind !== 'orage' && w.kind !== 'neige');
      if (pop >= 400 && month >= 6 && month <= 8 && dry && (!w || w.tempC >= 20)) out.push(['canicule', 3]);
      const el = ctx.use<ElectriciteService>('electricite');
      const sum = el?.summary() as { importedKw?: number } | undefined;
      if (pop >= 400 && (sum?.importedKw ?? 0) > 0) out.push(['panne_reseau', 2]);
      if (pop >= 1000) out.push(['epidemie', month >= 10 || month <= 3 ? 2 : 0.5]);
      if (pop >= 500 && hasTag(ctx, 'dechets:depot')) out.push(['greve_eboueurs', 1.5]);
    }
    if (r.housingFree >= 20 || r.demand.residential > 0.2) out.push(['afflux', 1.5]);
    const obj = ctx.use<ObjectifsService>(OBJECTIFS_SERVICE)?.active() ?? [];
    if (pop >= 500 && obj.some((o) => !o.title.startsWith('Atteins'))) out.push(['investisseur', 1.5]);
    return out.filter(([, w]) => w > 0);
  };

  const announce = (ctx: PluginContext, kind: EventKind): void => {
    const d = EVENT_DEFS[kind];
    const now = ctx.clock.totalMinutes;
    // Début de l'effet à 6 h le jour J (préavis en jours entiers), fin à 6 h le jour J + durée.
    const day0 = Math.floor(now / MINUTES_PER_DAY) * MINUTES_PER_DAY;
    const startAt = d.notice > 0 ? day0 + d.notice * MINUTES_PER_DAY + 6 * 60 : now;
    const c: Current = { kind, phase: d.notice > 0 ? 'annonce' : 'actif', announcedAt: now, startAt, endAt: startAt + d.duration * MINUTES_PER_DAY, base: 0, baseMonth: ctx.clock.monthIndex, peak: 0 };
    if (kind === 'investisseur') {
      const list = (ctx.use<ObjectifsService>(OBJECTIFS_SERVICE)?.active() ?? []).filter((o) => !o.title.startsWith('Atteins'));
      const o = list[Math.floor(ctx.rng.next() * list.length)]!;
      c.objKey = o.key; c.objTitle = o.title;
      c.bonus = Math.round((o.rewardMoney * 1.5) / 1000) * 1000;
    }
    s.current = c;
    const v = viewOf(c);
    if (c.phase === 'annonce') ctx.notify('info', `Événement annoncé — ${d.title} le ${dayLabel(startAt)} (${d.duration} jours) : ${d.text} ${d.advice}`);
    else { start(ctx); ctx.notify('info', `Événement — ${d.title} : ${v.text}`); }
    version++;
  };

  const start = (ctx: PluginContext): void => {
    const c = s.current!;
    c.phase = 'actif';
    c.baseMonth = ctx.clock.monthIndex;
    c.base = counter(ctx, c.kind, 'month');
    c.peak = 0;
    version++;
  };

  return {
    id: 'evenements',
    saveVersion: EVENEMENTS_SAVE_VERSION,
    state: () => s,
    init(ctx) { ctx.provide(EVENTS_SERVICE, service); },
    onNewGame(ctx) { s = fresh(ctx.clock.totalMinutes); version++; sent = -1; everSent = false; minuteAcc = 0; sectionLoaded = false; },
    // Ancienne sauvegarde (sans section) : 45 jours de calme à partir du chargement (le joueur découvre le système).
    afterLoad(ctx) { if (!sectionLoaded) s.startedAt = ctx.clock.totalMinutes; sectionLoaded = false; },
    onTick(ctx, minutes) {
      const c = s.current;
      if (!c || c.phase !== 'actif') { minuteAcc = 0; return; }
      minuteAcc += minutes;
      if (minuteAcc < 60) return;
      minuteAcc = 0;
      if (c.kind === 'panne_reseau') {
        const sum = ctx.use<ElectriciteService>('electricite')?.summary();
        if (sum && sum.buildings > 0) c.peak = Math.max(c.peak, sum.cut / sum.buildings);
      } else if (c.kind === 'canicule') {
        const w = ctx.use<MeteoService>(METEO_SERVICE)?.payload();
        if (w && (w.kind === 'pluie' || w.kind === 'orage')) finish(ctx, `un ${w.kind === 'orage' ? 'orage' : 'épisode de pluie'} a rafraîchi la ville plus tôt que prévu ; ${outcomeOf(ctx, c)}`);
      }
    },
    onDayStart(ctx) {
      const now = ctx.clock.totalMinutes;
      const c = s.current;
      if (c) {
        if (c.phase === 'annonce' && now >= c.startAt) {
          start(ctx);
          ctx.notify('info', `Événement — ${EVENT_DEFS[c.kind].title} : c’est maintenant (jusqu’au ${dayLabel(c.endAt)}). ${EVENT_DEFS[c.kind].effects.join(', ')}.`);
        }
        if (c.phase === 'actif' && c.kind === 'investisseur') {
          const obj = ctx.use<ObjectifsService>(OBJECTIFS_SERVICE);
          if (obj?.completed(c.objKey ?? '')) {
            ctx.economy.applyService(c.bonus ?? 0, true);
            finish(ctx, `objectif atteint : prime de ${(c.bonus ?? 0).toLocaleString('fr-FR')} CHF versée.`);
          } else if (now >= c.endAt || (obj && !obj.active().some((o) => o.key === c.objKey))) finish(ctx, 'objectif non atteint à temps : l’investisseur s’est retiré, sans pénalité.');
        } else if (c.phase === 'actif' && now >= c.endAt) finish(ctx, outcomeOf(ctx, c));
        return;
      }
      if (s.setting === 'off' || now < quietUntil()) return;
      const p = EVENT_DAILY_CHANCE[s.setting === 'rares' ? 'rares' : 'normal'];
      if (ctx.rng.next() >= p) return;
      const list = eligible(ctx);
      if (!list.length) return;
      let total = 0;
      for (const [, w] of list) total += w;
      let x = ctx.rng.next() * total;
      for (const [k, w] of list) { x -= w; if (x <= 0) { announce(ctx, k); return; } }
      announce(ctx, list[list.length - 1]![0]);
    },
    takeDelta() {
      if (version === sent) return undefined;
      sent = version;
      if (idle() && !everSent) return undefined;
      everSent = true;
      return view();
    },
    snapshot() { return idle() ? undefined : view(); },
    save() { return idle() ? undefined : JSON.parse(JSON.stringify(s)) as Live; },
    load(_ctx, data, v) { s = migrateEvenements(data, v); sectionLoaded = true; version++; },
    command(ctx, name, payload): PluginCommandResult {
      const p = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>;
      if (name === 'state') return { ok: true, data: view() };
      if (name === 'reglage') {
        const f = p['frequence'];
        if (!EVENT_FREQUENCIES.includes(f as EventFrequency)) return { ok: false, code: 'INVALID_ARGS', message: 'frequence : normal, rares ou off' };
        if (s.setting !== f) {
          s.setting = f as EventFrequency;
          // Désactivés : un événement annoncé est annulé ; un événement en cours va à son terme (effet borné, déjà commencé).
          if (s.setting === 'off' && s.current?.phase === 'annonce') { s.current = null; ctx.notify('info', 'Événements désactivés : l’événement annoncé est annulé.'); }
          version++;
        }
        return { ok: true, data: view() };
      }
      // Diagnostic et tests : annonce immédiate d'un événement (hors conditions de déclenchement).
      if (name === 'declencher') {
        const k = p['kind'];
        if (!EVENT_KINDS.includes(k as EventKind)) return { ok: false, code: 'INVALID_ARGS', message: 'Événement inconnu' };
        if (s.current) return { ok: false, code: 'INVALID_ARGS', message: 'Un événement est déjà en cours' };
        if (k === 'investisseur' && !(ctx.use<ObjectifsService>(OBJECTIFS_SERVICE)?.active() ?? []).some((o) => !o.title.startsWith('Atteins'))) return { ok: false, code: 'INVALID_ARGS', message: 'Aucun objectif en cours' };
        announce(ctx, k as EventKind);
        return { ok: true, data: view() };
      }
      return { ok: false, code: 'INVALID_ARGS', message: `Commande inconnue : ${name}` };
    },
  };
}

function hasTag(ctx: PluginContext, tag: string): boolean {
  const st = ctx.buildings.store;
  const assets = ctx.catalog?.assets ?? [];
  for (let i = 0; i < ctx.buildings.count; i++) if (assets[st.assetIndex[i]!]?.tags.includes(tag)) return true;
  return false;
}

export const evenementsPlugin = createEvenementsPlugin();
