/**
 * Module « objectifs » (docs/PROGRESSION.md) : objectifs concrets qui se renouvellent selon les problèmes ACTUELS de la
 * ville (rapports de la démographie, des services, du bus, de l'électricité, des déchets, du budget), et réalisations
 * permanentes. Chaque objectif accompli verse de l'argent (trésorerie, ligne « Services ») et des points d'expansion
 * (service `paliers`) ; une réalisation donne des points une seule fois.
 *  - au plus 3 objectifs en même temps ; un nouveau est proposé au plus tous les 2 jours, d'abord celui qui répond au
 *    problème le plus grave ; un modèle accompli attend 15 jours avant d'être reproposé ;
 *  - un objectif est accompli quand sa condition tient plusieurs jours de suite (le budget : plusieurs mois) ;
 *  - tirages éventuels : PRNG PROPRE au module (départage des priorités), jamais celui de la partie.
 * Ville de moins de 150 habitants et rien d'acquis : aucun delta, aucune section de sauvegarde.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { PALIERS_SERVICE, type PaliersService } from '../../shared/milestones';
import {
  MAX_ACTIVE_OBJECTIVES, OBJECTIFS_SERVICE, type AchievementView, type ObjectiveDash, type ObjectiveDone, type ObjectiveView, type ObjectifsService, type ObjectifsState,
} from '../../shared/protocol-ext/objectifs';
import type { ElectriciteService } from '../../shared/power/types';
import type { BusSummary } from '../../shared/protocol-ext/bus';
import { MINUTES_PER_DAY } from '../clock';
import { runMigrations } from '../save-sections/types';
import type { PluginCommandResult, PluginContext, SimPlugin } from './types';

export const OBJECTIFS_SAVE_VERSION = 1;
/** Population à partir de laquelle les objectifs sont proposés (les « Premiers pas » couvrent le tout début). */
export const OBJECTIVES_MIN_POP = 150;
const OFFER_EVERY_DAYS = 2;
const COOLDOWN_DAYS = 15;
const REPLACE_EVERY_DAYS = 7;
const MAX_RECENT = 12;

/** Faits de la ville relevés chaque jour (valeurs 0..1 pour les parts). */
export interface CityFacts {
  pop: number; happiness: number; unemp: number; labor: number;
  cover: { police: number; pompiers: number; sante: number; education: number };
  crime: number; sick: number; distress: number; companies: number; struggling: number;
  lastBalance: number | null; busLines: number; busRiders: number; powerCut: number; wasteFull: number;
  growthHint: string | null;
}

interface Template {
  id: string;
  dash: ObjectiveDash;
  /** Gravité du problème 0..1 (0 : pas proposé). */
  severity(f: CityFacts): number;
  make(f: CityFacts): { title: string; hint: string; target: number; unit: string; higher: boolean; need: number; streakUnit?: 'jours' | 'mois'; difficulty: number };
  value(f: CityFacts): number;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const pct = (v: number): number => Math.round(v * 1000) / 10;
/** Arrondi « joli » par excès (deux chiffres significatifs). */
export function niceUp(n: number): number {
  if (n <= 0) return 0;
  const step = 10 ** Math.max(0, Math.floor(Math.log10(n)) - 1);
  return Math.ceil(n / step) * step;
}

const coverage = (id: string, key: keyof CityFacts['cover'], label: string, hint: string, dash: ObjectiveDash = 'services'): Template => ({
  id, dash,
  severity: (f) => (f.pop >= 300 && f.cover[key] < 0.7 ? 0.25 + clamp01((0.8 - f.cover[key]) / 0.8) * 0.6 : 0),
  make: () => ({ title: `Couvre 80 % des habitants par ${label}`, hint, target: 80, unit: '%', higher: true, need: 3, difficulty: 1.2 }),
  value: (f) => pct(f.cover[key]),
});

export const OBJECTIVE_TEMPLATES: readonly Template[] = [
  { id: 'chomage', dash: 'population',
    severity: (f) => (f.labor >= 80 && f.unemp > 0.07 ? 0.3 + clamp01((f.unemp - 0.05) / 0.15) * 0.6 : 0),
    make: () => ({ title: 'Ramène le chômage sous 5 %', hint: 'Zonez de l’industrie, des commerces ou des bureaux ; une ligne de bus élargit la recherche d’emploi.', target: 5, unit: '%', higher: false, need: 3, difficulty: 1.3 }),
    value: (f) => pct(f.unemp) },
  coverage('police', 'police', 'la police', 'Construisez un commissariat (Services) près des quartiers non couverts, ou améliorez-le.'),
  coverage('pompiers', 'pompiers', 'les pompiers', 'Une caserne de pompiers couvre environ 3 600 habitants dans son rayon.'),
  coverage('sante', 'sante', 'les soins', 'Centres de santé et hôpitaux soignent plus vite et réduisent la mortalité.'),
  coverage('education', 'education', 'les écoles', 'Une école à proximité des logements : les familles y tiennent.'),
  { id: 'bus', dash: 'transport',
    severity: (f) => {
      if (f.pop < 1200) return 0;
      const target = Math.min(5000, Math.max(150, Math.round((f.pop * 0.15) / 50) * 50));
      if (f.busRiders >= target * 0.8) return 0;
      return 0.3 + (f.growthHint === 'traffic-jam' || f.growthHint === 'need-transit' ? 0.35 : 0);
    },
    make: (f) => {
      const target = Math.min(5000, Math.max(150, Math.round((f.pop * 0.15) / 50) * 50));
      return { title: `Transporte ${target.toLocaleString('fr-FR')} voyageurs par jour en bus`, hint: f.busLines ? 'Ajoutez des arrêts près des logements et des emplois, ou des bus pour réduire l’attente.' : 'Construisez un dépôt de bus (Transports) puis tracez une ligne entre logements et emplois.', target, unit: 'voyageurs/jour', higher: true, need: 3, difficulty: 1.5 };
    },
    value: (f) => Math.round(f.busRiders) },
  { id: 'satisfaction', dash: 'population',
    severity: (f) => (f.pop >= 200 && f.happiness < 68 ? 0.2 + clamp01((70 - f.happiness) / 40) * 0.5 : 0),
    make: (f) => {
      const target = Math.max(60, Math.min(80, Math.ceil((f.happiness + 4) / 5) * 5));
      return { title: `Atteins ${target} de satisfaction`, hint: 'Population › Aperçu détaille ce qui pèse sur la satisfaction : services, emploi, loyers, pollution, impôts.', target, unit: '/100', higher: true, need: 3, difficulty: 1.2 };
    },
    value: (f) => Math.round(f.happiness * 10) / 10 },
  { id: 'budget', dash: 'finance',
    severity: (f) => (f.lastBalance !== null && f.lastBalance < 0 ? 0.55 : 0),
    make: () => ({ title: 'Équilibre le budget 3 mois de suite', hint: 'Finances : ajustez les impôts, l’entretien et les emprunts ; un solde de fonctionnement positif chaque mois.', target: 0, unit: 'CHF', higher: true, need: 3, streakUnit: 'mois', difficulty: 1.6 }),
    value: (f) => Math.round(f.lastBalance ?? 0) },
  { id: 'criminalite', dash: 'services',
    severity: (f) => (f.pop >= 300 && f.crime > 22 ? 0.3 + clamp01((f.crime - 12) / 40) * 0.5 : 0),
    make: () => ({ title: 'Fais baisser la criminalité moyenne sous 12', hint: 'Police à proximité, emplois et loyers abordables font baisser la criminalité.', target: 12, unit: '/100', higher: false, need: 3, difficulty: 1.4 }),
    value: (f) => Math.round(f.crime * 10) / 10 },
  { id: 'loyers', dash: 'population',
    severity: (f) => (f.pop >= 300 && f.distress > 0.1 ? 0.3 + clamp01(f.distress / 0.3) * 0.4 : 0),
    make: () => ({ title: 'Moins de 5 % de ménages en difficulté de loyer', hint: 'Plus de logements (zones résidentielles), de meilleurs emplois, ou la politique « Aide au logement ».', target: 5, unit: '%', higher: false, need: 3, difficulty: 1.4 }),
    value: (f) => pct(f.distress) },
  { id: 'entreprises', dash: 'population',
    severity: (f) => (f.companies >= 10 && f.struggling > 0.15 ? 0.25 + clamp01(f.struggling / 0.4) * 0.4 : 0),
    make: () => ({ title: 'Moins de 8 % d’entreprises en difficulté', hint: 'Population › Économie donne la raison de leurs difficultés : clientèle, main-d’œuvre, loyers.', target: 8, unit: '%', higher: false, need: 3, difficulty: 1.3 }),
    value: (f) => pct(f.struggling) },
  { id: 'electricite', dash: 'energy',
    severity: (f) => (f.powerCut > 0.02 ? 0.5 + clamp01(f.powerCut) * 0.4 : 0),
    make: () => ({ title: 'Plus aucune coupure d’électricité pendant 7 jours', hint: 'Ajoutez des centrales, des postes ou le raccordement au réseau voisin (Énergie).', target: 0.5, unit: '% coupés', higher: false, need: 7, difficulty: 1.4 }),
    value: (f) => pct(f.powerCut) },
  { id: 'dechets', dash: 'waste',
    severity: (f) => (f.pop >= 300 && f.wasteFull > 0.05 ? 0.3 + clamp01(f.wasteFull / 0.3) * 0.4 : 0),
    make: () => ({ title: 'Moins de 2 % de bacs pleins', hint: 'Plus de camions (financement), un dépôt plus proche ou une filière de traitement en plus (Déchets).', target: 2, unit: '%', higher: false, need: 3, difficulty: 1.2 }),
    value: (f) => pct(f.wasteFull) },
  { id: 'maladies', dash: 'services',
    severity: (f) => (f.pop >= 300 && f.sick > 0.04 ? 0.35 + clamp01(f.sick / 0.12) * 0.4 : 0),
    make: () => ({ title: 'Moins de 2 % d’habitants malades', hint: 'Centres de santé et hôpitaux à portée, moins de pollution près des logements.', target: 2, unit: '%', higher: false, need: 3, difficulty: 1.2 }),
    value: (f) => pct(f.sick) },
  { id: 'population', dash: 'progression',
    severity: (f) => (f.pop >= OBJECTIVES_MIN_POP ? 0.05 : 0),
    make: (f) => {
      const target = niceUp(Math.max(f.pop * 1.3, f.pop + 100));
      return { title: `Atteins ${target.toLocaleString('fr-FR')} habitants`, hint: 'Zonez du résidentiel là où la demande R est forte et gardez les services au niveau.', target, unit: 'habitants', higher: true, need: 1, difficulty: 1 };
    },
    value: (f) => f.pop },
];

interface AchievementDef { id: string; title: string; detail: string; xp: number; check?(f: CityFacts, st: Live): boolean }

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'premiers_habitants', title: 'Premiers habitants', detail: '100 habitants', xp: 25, check: (f) => f.pop >= 100 },
  { id: 'mille', title: 'Mille âmes', detail: '1 000 habitants', xp: 100, check: (f) => f.pop >= 1000 },
  { id: 'cinq_mille', title: 'Ville moyenne', detail: '5 000 habitants', xp: 300, check: (f) => f.pop >= 5000 },
  { id: 'vingt_mille', title: 'Grande cité', detail: '20 000 habitants', xp: 800, check: (f) => f.pop >= 20000 },
  { id: 'plein_emploi', title: 'Plein emploi', detail: 'Chômage sous 3 % avec au moins 300 actifs', xp: 150, check: (f) => f.labor >= 300 && f.unemp < 0.03 },
  { id: 'ville_heureuse', title: 'Ville heureuse', detail: 'Satisfaction de 80 avec au moins 500 habitants', xp: 250, check: (f) => f.pop >= 500 && f.happiness >= 80 },
  { id: 'bien_protegee', title: 'Ville sûre', detail: 'Police, pompiers et soins couvrent 90 % de 1 000 habitants ou plus', xp: 300, check: (f) => f.pop >= 1000 && f.cover.police >= 0.9 && f.cover.pompiers >= 0.9 && f.cover.sante >= 0.9 },
  { id: 'tous_a_lecole', title: 'Tous à l’école', detail: 'Écoles couvrant 90 % de 1 000 habitants ou plus', xp: 200, check: (f) => f.pop >= 1000 && f.cover.education >= 0.9 },
  { id: 'premiere_ligne', title: 'Première ligne', detail: 'Une ligne de bus transporte ses premiers voyageurs', xp: 75, check: (f) => f.busLines >= 1 && f.busRiders > 0 },
  { id: 'mille_voyageurs', title: 'Réseau fréquenté', detail: '1 000 voyageurs par jour en bus', xp: 250, check: (f) => f.busRiders >= 1000 },
  { id: 'budget_annee', title: 'Gestion saine', detail: '12 mois de suite avec un budget en excédent', xp: 400, check: (_f, s) => s.positiveMonths >= 12 },
  { id: 'objectifs_5', title: 'Maire efficace', detail: '5 objectifs accomplis', xp: 150, check: (_f, s) => s.completedCount >= 5 },
  { id: 'objectifs_20', title: 'Bâtisseur infatigable', detail: '20 objectifs accomplis', xp: 500, check: (_f, s) => s.completedCount >= 20 },
  { id: 'crise_surmontee', title: 'Crise surmontée', detail: 'Traverser un événement (canicule, épidémie, panne, grève)', xp: 150 },
];

interface Instance {
  key: string; id: string; title: string; hint: string; unit: string; higher: boolean; target: number; start: number; current: number;
  streak: number; need: number; streakUnit: 'jours' | 'mois'; money: number; xp: number; since: number; dash: ObjectiveDash;
}

interface Live {
  active: Instance[]; recent: ObjectiveDone[]; completedCount: number; ach: Record<string, number>; cooldown: Record<string, number>;
  lastOffer: number; replaceAt: number; positiveMonths: number; seq: number; doneKeys: string[]; cutMax: number; cutDay: number;
}
export type ObjectifsSave = Live;
const fresh = (): Live => ({ active: [], recent: [], completedCount: 0, ach: {}, cooldown: {}, lastOffer: -1e9, replaceAt: 0, positiveMonths: 0, seq: 0, doneKeys: [], cutMax: 0, cutDay: 0 });
export const emptyObjectifsSave = fresh;

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const DASHES: readonly ObjectiveDash[] = ['population', 'services', 'transport', 'finance', 'energy', 'waste', 'progression'];

export function migrateObjectifs(data: unknown, from: number): ObjectifsSave {
  const o = runMigrations(data, from, OBJECTIFS_SAVE_VERSION, {}, 'objectifs') as Partial<Live>;
  const out = fresh();
  const known = new Set(OBJECTIVE_TEMPLATES.map((t) => t.id));
  for (const a of Array.isArray(o.active) ? o.active : []) {
    if (!a || typeof a !== 'object' || !known.has(str(a.id))) continue;
    out.active.push({
      key: str(a.key, `${a.id}-0`), id: a.id, title: str(a.title), hint: str(a.hint), unit: str(a.unit), higher: a.higher === true,
      target: fin(a.target) ? a.target : 0, start: fin(a.start) ? a.start : 0, current: fin(a.current) ? a.current : 0, streak: fin(a.streak) ? a.streak : 0,
      need: fin(a.need) ? Math.max(1, a.need) : 3, streakUnit: a.streakUnit === 'mois' ? 'mois' : 'jours', money: fin(a.money) ? a.money : 0, xp: fin(a.xp) ? a.xp : 0,
      since: fin(a.since) ? a.since : 0, dash: DASHES.includes(a.dash as ObjectiveDash) ? a.dash as ObjectiveDash : 'progression',
    });
  }
  out.active = out.active.slice(0, MAX_ACTIVE_OBJECTIVES);
  for (const r of Array.isArray(o.recent) ? o.recent : []) if (r && typeof r === 'object') out.recent.push({ key: str(r.key), title: str(r.title), at: fin(r.at) ? r.at : 0, rewardMoney: fin(r.rewardMoney) ? r.rewardMoney : 0, rewardXp: fin(r.rewardXp) ? r.rewardXp : 0 });
  out.recent = out.recent.slice(-MAX_RECENT);
  const achIds = new Set(ACHIEVEMENTS.map((a) => a.id));
  if (o.ach && typeof o.ach === 'object') for (const [k, v] of Object.entries(o.ach)) if (achIds.has(k) && fin(v)) out.ach[k] = v;
  if (o.cooldown && typeof o.cooldown === 'object') for (const [k, v] of Object.entries(o.cooldown)) if (known.has(k) && fin(v)) out.cooldown[k] = v;
  for (const k of ['completedCount', 'lastOffer', 'replaceAt', 'positiveMonths', 'seq', 'cutMax', 'cutDay'] as const) if (fin(o[k])) out[k] = o[k];
  out.doneKeys = Array.isArray(o.doneKeys) ? o.doneKeys.filter((k): k is string => typeof k === 'string').slice(-50) : [];
  return out;
}

interface BusLike { system: { summary(ctx: PluginContext): BusSummary } }
interface DechetsLike { binFull(id: number): boolean }

/** Relevé des faits de la ville (une fois par jour). */
export function cityFacts(ctx: PluginContext, cutMax: number): CityFacts {
  const r = ctx.demography!.report();
  const cs = r.cityServices;
  const lv = r.living;
  const bus = ctx.use<BusLike>('bus');
  let busLines = 0, busRiders = 0;
  if (bus) { const b = bus.system.summary(ctx); busLines = b.lines; busRiders = b.ridersDay; }
  const dechets = ctx.use<DechetsLike>('dechets');
  let occupied = 0, full = 0;
  if (dechets) {
    const st = ctx.buildings.store;
    for (let i = 0; i < ctx.buildings.count; i++) {
      if (st.residents[i]! + st.workers[i]! <= 0) continue;
      occupied++;
      if (dechets.binFull(st.id[i]!)) full++;
    }
  }
  const companies = lv ? lv.companiesActive + lv.companiesInDifficulty : 0;
  return {
    pop: r.population, happiness: r.happiness, unemp: r.unemploymentRate, labor: r.laborForce,
    // Couverture des habitants : qualité des services (police, pompiers, soins) si disponible, sinon couverture simple.
    cover: {
      police: cs?.coverage.police ?? r.services['Sécurité'] ?? 0, pompiers: cs?.coverage.fire ?? r.services['Secours incendie'] ?? 0,
      sante: cs?.coverage.health ?? r.services['Santé'] ?? 0, education: r.services['Éducation'] ?? 0,
    },
    crime: cs?.crime.average ?? 0, sick: cs?.health.sickShare ?? 0, distress: lv?.distressShare ?? 0,
    companies, struggling: companies ? (lv!.companiesInDifficulty / companies) : 0,
    lastBalance: ctx.economy.lastMonth()?.balance ?? null, busLines, busRiders, powerCut: cutMax,
    wasteFull: occupied ? full / occupied : 0, growthHint: r.growthHint,
  };
}

const progressOf = (a: Instance): number => {
  if (a.higher) return a.target === a.start ? (a.current >= a.target ? 1 : 0) : clamp01((a.current - a.start) / (a.target - a.start));
  return a.start === a.target ? (a.current < a.target ? 1 : 0) : clamp01((a.start - a.current) / (a.start - a.target));
};
const met = (a: Instance): boolean => (a.higher ? a.current >= a.target : a.current < a.target);

export function createObjectifsPlugin(): SimPlugin & { readonly state: () => ObjectifsSave } {
  let s = fresh();
  let version = 0, sent = -1, minuteAcc = 0;
  let ctxRef: PluginContext | null = null;
  const paliers = (ctx: PluginContext): PaliersService | undefined => ctx.use<PaliersService>(PALIERS_SERVICE);
  const idle = (ctx: PluginContext): boolean => !s.active.length && !s.completedCount && !Object.keys(s.ach).length && (ctx.demography?.population ?? 0) < OBJECTIVES_MIN_POP;

  const view = (): ObjectifsState => ({
    active: s.active.map((a): ObjectiveView => ({
      key: a.key, id: a.id, title: a.title, hint: a.hint, current: a.current, target: a.target, unit: a.unit, higher: a.higher, progress: Math.round(progressOf(a) * 1000) / 1000,
      streak: a.streak, streakNeeded: a.need, streakUnit: a.streakUnit, rewardMoney: a.money, rewardXp: a.xp, since: a.since, dash: a.dash,
    })),
    recent: s.recent.map((r) => ({ ...r })),
    completedCount: s.completedCount,
    achievements: ACHIEVEMENTS.map((a): AchievementView => ({ id: a.id, title: a.title, detail: a.detail, xp: a.xp, done: a.id in s.ach, at: s.ach[a.id] ?? null })),
    replaceAt: s.replaceAt,
  });

  const achieve = (ctx: PluginContext, id: string): void => {
    const def = ACHIEVEMENTS.find((a) => a.id === id);
    if (!def || id in s.ach) return;
    s.ach[id] = ctx.clock.totalMinutes;
    const got = paliers(ctx)?.grant(def.xp, 'realisations') ?? 0;
    ctx.notify('info', `Réalisation : ${def.title} (${def.detail})${got ? ` — +${got.toLocaleString('fr-FR')} points d'expansion` : ''}`);
    version++;
  };

  const offer = (ctx: PluginContext, f: CityFacts, exclude?: string): boolean => {
    const now = ctx.clock.totalMinutes;
    const activeIds = new Set(s.active.map((a) => a.id));
    let best: Template | null = null, bestScore = 0;
    for (const t of OBJECTIVE_TEMPLATES) {
      if (activeIds.has(t.id) || t.id === exclude) continue;
      if ((s.cooldown[t.id] ?? -1e9) > now) continue;
      // Objectif « population » : seulement quand aucun problème ne réclame d'attention (un seul à la fois).
      const sev = t.severity(f);
      if (sev <= 0) continue;
      const score = sev + ctx.rng.next() * 0.05;
      if (score > bestScore) { bestScore = score; best = t; }
    }
    if (!best) return false;
    const m = best.make(f);
    const gap = paliers(ctx)?.gap() ?? 500;
    const money = Math.min(2_000_000, Math.round(((25_000 + f.pop * 20) * m.difficulty) / 1000) * 1000);
    const xp = Math.max(20, Math.round(gap * 0.08 * m.difficulty));
    const cur = best.value(f);
    const inst: Instance = {
      key: `${best.id}-${++s.seq}`, id: best.id, title: m.title, hint: m.hint, unit: m.unit, higher: m.higher, target: m.target, start: cur, current: cur,
      streak: 0, need: m.need, streakUnit: m.streakUnit ?? 'jours', money, xp, since: now, dash: best.dash,
    };
    s.active.push(inst);
    s.lastOffer = now;
    ctx.notify('info', `Nouvel objectif : ${inst.title} — récompense ${money.toLocaleString('fr-FR')} CHF et ${xp.toLocaleString('fr-FR')} points d'expansion`);
    version++;
    return true;
  };

  const complete = (ctx: PluginContext, a: Instance): void => {
    const now = ctx.clock.totalMinutes;
    s.active = s.active.filter((x) => x !== a);
    ctx.economy.applyService(a.money, true);
    const got = paliers(ctx)?.grant(a.xp, 'objectifs') ?? 0;
    s.completedCount++;
    s.cooldown[a.id] = now + COOLDOWN_DAYS * MINUTES_PER_DAY;
    s.recent.push({ key: a.key, title: a.title, at: now, rewardMoney: a.money, rewardXp: got });
    if (s.recent.length > MAX_RECENT) s.recent.shift();
    s.doneKeys.push(a.key);
    if (s.doneKeys.length > 50) s.doneKeys.shift();
    ctx.notify('info', `Objectif accompli : ${a.title} — +${a.money.toLocaleString('fr-FR')} CHF et +${got.toLocaleString('fr-FR')} points d'expansion`);
    version++;
  };

  const service: ObjectifsService = {
    active: () => s.active.map((a) => ({ key: a.key, title: a.title, rewardMoney: a.money, progress: progressOf(a) })),
    completed: (key) => s.doneKeys.includes(key),
    achieve: (id) => { if (ctxRef) achieve(ctxRef, id); },
  };

  return {
    id: 'objectifs',
    saveVersion: OBJECTIFS_SAVE_VERSION,
    state: () => s,
    init(ctx) { ctxRef = ctx; ctx.provide(OBJECTIFS_SERVICE, service); },
    onNewGame(ctx) { ctxRef = ctx; s = fresh(); version++; sent = -1; minuteAcc = 0; },
    // Coupures d'électricité : part maximale des bâtiments coupés relevée à chaque heure de la journée.
    onTick(ctx, minutes) {
      minuteAcc += minutes;
      if (minuteAcc < 60) return;
      minuteAcc = 0;
      if ((ctx.demography?.population ?? 0) < OBJECTIVES_MIN_POP && !s.active.length) return;
      const el = ctx.use<ElectriciteService>('electricite');
      const sum = el?.hasNetwork?.() ? el.summary() : undefined;
      if (sum && sum.buildings > 0) s.cutMax = Math.max(s.cutMax, sum.cut / sum.buildings);
    },
    onDayStart(ctx) {
      if (!ctx.demography || idle(ctx)) { s.cutMax = 0; return; }
      const f = cityFacts(ctx, s.cutMax);
      s.cutDay = s.cutMax; s.cutMax = 0;
      // Avancement des objectifs (le budget avance au début du mois).
      for (const a of [...s.active]) {
        const t = OBJECTIVE_TEMPLATES.find((x) => x.id === a.id);
        if (!t) continue;
        a.current = t.value(f);
        if (a.streakUnit === 'mois') continue;
        a.streak = met(a) ? a.streak + 1 : 0;
        if (a.streak >= a.need) complete(ctx, a);
      }
      version++;
      for (const def of ACHIEVEMENTS) if (def.check && !(def.id in s.ach) && def.check(f, s)) achieve(ctx, def.id);
      // Nouvel objectif : au plus 3 en cours, au plus un tous les 2 jours.
      const now = ctx.clock.totalMinutes;
      if (f.pop >= OBJECTIVES_MIN_POP && s.active.length < MAX_ACTIVE_OBJECTIVES && now - s.lastOffer >= OFFER_EVERY_DAYS * MINUTES_PER_DAY) offer(ctx, f);
    },
    onMonthStart(ctx) {
      const lm = ctx.economy.lastMonth();
      if (!lm) return;
      s.positiveMonths = lm.balance >= 0 ? s.positiveMonths + 1 : 0;
      for (const a of [...s.active]) {
        if (a.streakUnit !== 'mois') continue;
        a.current = Math.round(lm.balance);
        a.streak = met(a) ? a.streak + 1 : 0;
        if (a.streak >= a.need) complete(ctx, a);
      }
      version++;
    },
    takeDelta(ctx) {
      if (version === sent) return undefined;
      sent = version;
      return idle(ctx) ? undefined : view();
    },
    snapshot(ctx) { return idle(ctx) ? undefined : view(); },
    save(ctx) { return idle(ctx) ? undefined : JSON.parse(JSON.stringify(s)) as Live; },
    load(_ctx, data, v) { s = migrateObjectifs(data, v); version++; },
    command(ctx, name, payload): PluginCommandResult {
      if (name === 'state') return { ok: true, data: view() };
      if (name === 'remplacer') {
        const key = (payload as { key?: unknown } | null)?.key;
        const a = s.active.find((x) => x.key === key);
        if (!a) return { ok: false, code: 'NOT_FOUND', message: 'Objectif introuvable' };
        const now = ctx.clock.totalMinutes;
        if (now < s.replaceAt) return { ok: false, code: 'INVALID_ARGS', message: `Un objectif peut être remplacé une fois par semaine de jeu (encore ${Math.ceil((s.replaceAt - now) / MINUTES_PER_DAY)} jour(s))` };
        if (!ctx.demography) return { ok: false, code: 'NO_GAME', message: 'Aucune partie' };
        s.active = s.active.filter((x) => x !== a);
        s.cooldown[a.id] = now + 10 * MINUTES_PER_DAY;
        s.replaceAt = now + REPLACE_EVERY_DAYS * MINUTES_PER_DAY;
        offer(ctx, cityFacts(ctx, s.cutDay), a.id);
        version++;
        return { ok: true, data: view() };
      }
      return { ok: false, code: 'INVALID_ARGS', message: `Commande inconnue : ${name}` };
    },
  };
}

export const objectifsPlugin = createObjectifsPlugin();
