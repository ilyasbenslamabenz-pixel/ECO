// Harnais de parties simulées : joueurs-robots déterministes qui jouent plusieurs décennies avec les mêmes leviers
// que le joueur (programmes d'équipement, centrales, cartes du plan climat, budget), et mesure de ce qu'ils obtiennent
// (missions, jalons climat, finances, satisfaction, élections, défaites, crises, progression).
// Utilisé par `npm run playtest` (tests/playtest.ts) et par les tests de non-régression d'équilibre (tests/balance.test.ts).
import { BUDGET_LINES } from '../shared/sim/data';
import { applyAction, applyGovAction, applyServiceAction, createGame, schedulePolicy, tick } from '../shared/sim/engine';
import { continueAfterDefeat } from '../shared/sim/victory';
import { assessNeeds, type NeedAction } from '../shared/sim/needs';
import { CARDS, cardStatus } from '../shared/sim/climate';
import { titleOf } from '../shared/sim/missions';
import type { GameState, Policy } from '../shared/sim/types';

export const STRATEGIES = ['passif', 'besoins', 'climat', 'austerite', 'depensier', 'equilibre'] as const;
export type Strategy = (typeof STRATEGIES)[number];
export const STRATEGY_NAMES: Record<Strategy, string> = {
  passif: 'Passif', besoins: 'Besoins', climat: 'Climat', austerite: 'Austérité', depensier: 'Dépensier', equilibre: 'Équilibré',
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const gdp = (S: GameState) => Math.max(1, S.accounts.gdp);
const deficit = (S: GameState) => -S.accounts.balance / gdp(S);
const debtRatio = (S: GameState) => S.finance.debt / gdp(S);
const unemployment = (S: GameState) => S.demography.unemployed / Math.max(1, S.demography.labourForce);
const govPop = (S: GameState) => {
  const P = S.politics;
  return P ? P.parties.filter((p) => P.coalition.includes(p.id)).reduce((s, p) => s + p.popularity, 0) : 0;
};

// ---------- Mémoire des robots (déterministe, propre à chaque partie) ----------
export interface BotMemory { needCooldown: Record<string, number>; lastCard: number; actions: number; cards: number; spentBuild: number; missionDone: Record<number, true>; levers: number }
export const newMemory = (): BotMemory => ({ needCooldown: {}, lastCard: -99, actions: 0, cards: 0, spentBuild: 0, missionDone: {}, levers: 0 });

/** Action payante proposée par le diagnostic (programme, centrale), ou null. */
function costedAction(actions: NeedAction[]): Exclude<NeedAction, { kind: 'panel' } | { kind: 'demolish' }> | null {
  for (const a of actions) if (a.kind === 'program' || a.kind === 'energyBuild' || a.kind === 'energyClose' || a.kind === 'recruit') return a;
  return null;
}
function execute(S: GameState, a: NeedAction): boolean {
  if (a.kind === 'program') return applyServiceAction(S, { type: 'programme', building: a.building, cityId: a.cityId, count: a.count }).ok;
  if (a.kind === 'energyBuild') return applyAction(S, { type: 'energyBuild', tech: a.tech, mw: a.mw }).ok;
  if (a.kind === 'energyClose') return applyAction(S, { type: 'energyClose', tech: a.tech, mw: a.mw }).ok;
  if (a.kind === 'demolish') return applyServiceAction(S, { type: 'demolir', infraId: a.infraId }).ok;
  if (a.kind === 'recruit') return applyServiceAction(S, { type: 'recruter', service: a.service, role: a.role, count: a.count }).ok;
  return false;
}

/** Levier de politique (copie de la politique programmée, procédure parlementaire). */
function lever(S: GameState, f: (p: Policy) => void) {
  const p: Policy = clone(S.pending?.policy ?? S.policy);
  f(p);
  schedulePolicy(S, p, { parliament: true });
  return true;
}
const card = (S: GameState, id: string) => applyGovAction(S, { type: 'climatCard', card: id }).ok;

/**
 * Joueur qui lit ses missions : à l'apparition d'une mission, il actionne UNE fois le levier rapide le plus évident pour
 * l'indicateur visé (recrutement, petit ajustement fiscal ou budgétaire, centrale, carte climat). Pas d'optimisation :
 * c'est ce que ferait un joueur raisonnable qui suit les conseils des panneaux.
 */
function playMissions(S: GameState, mem: BotMemory, o: { maxDeficit: number }) {
  const M = S.missions!;
  for (const m of M.active) {
    if (mem.missionDone[m.id]) continue;
    mem.missionDone[m.id] = true;
    const spendOk = deficit(S) < o.maxDeficit;
    let ok = false;
    switch (m.metric) {
      case 'chomage': ok = spendOk && lever(S, (p) => { p.labour.hiringAid += 1200; }); break;
      case 'satisfaction': case 'confiance': ok = spendOk && lever(S, (p) => { p.incomeTax.activityCredit += 400; p.budget.sante *= 1.05; }); break;
      case 'pauvrete': ok = spendOk && lever(S, (p) => { p.incomeTax.activityCredit += 300; p.labour.familyAllowance += 20; }); break;
      case 'capaciteSoins': case 'attenteSoins':
        ok = spendOk && applyServiceAction(S, { type: 'recruter', service: 'sante', role: 'medecins', count: Math.round(S.health!.doctors.staff * 0.06) }).ok;
        if (ok && m.metric === 'capaciteSoins') applyServiceAction(S, { type: 'recruter', service: 'sante', role: 'infirmiers', count: Math.round(S.health!.nurses.staff * 0.05) });
        break;
      case 'securite': ok = spendOk && applyServiceAction(S, { type: 'recruter', service: 'securite', role: 'policiers', count: Math.round(S.security!.police.staff * 0.08) }).ok; break;
      case 'dette': case 'deficit': ok = lever(S, (p) => { p.vat.normal = Math.min(0.25, p.vat.normal + 0.01); for (const b of BUDGET_LINES) p.budget[b] *= 0.985; }); break;
      case 'renouvelable': ok = spendOk && applyAction(S, { type: 'energyBuild', tech: 'solaire', mw: 600 }).ok; break;
      case 'margeElec': ok = applyAction(S, { type: 'energyBuild', tech: 'batteries', mw: 400 }).ok; break;
      case 'emissions': case 'air': ok = card(S, 'sortie_charbon') || card(S, 'bus_elec') || card(S, 'velo'); break;
      case 'congestion': ok = card(S, 'frequence') || card(S, 'velo'); break;
      case 'attenteLogement': case 'tensionLogement': ok = spendOk && applyServiceAction(S, { type: 'planLogement', kind: 'social', units: 8000, months: 24 }).ok; break;
      default: ok = false; // écoles, universités : traitées par le diagnostic des besoins (constructions)
    }
    if (ok) mem.levers++;
  }
}

/**
 * Robot « besoins » : chaque mois, la première action payante du besoin le plus urgent (niveau ≥ 1) si le budget le
 * permet. Un besoin traité n'est pas retraité avant `cooldown` mois (le temps que les chantiers sortent de terre).
 */
function playNeeds(S: GameState, mem: BotMemory, o: { maxDeficit: number; maxDebt: number; maxCost: number; cooldown: number; perMonth: number }) {
  let done = 0;
  for (const n of assessNeeds(S)) {
    if (done >= o.perMonth) return;
    if (n.level < 1) continue;
    if ((mem.needCooldown[n.id] ?? -1) > S.month) continue;
    const a = costedAction(n.actions);
    if (!a) continue;
    if (deficit(S) > o.maxDeficit || debtRatio(S) > o.maxDebt || a.cost > o.maxCost * gdp(S)) continue;
    if (execute(S, a)) { mem.needCooldown[n.id] = S.month + o.cooldown; mem.actions++; mem.spentBuild += a.cost; done++; }
  }
}

/** Ordre de préférence des cartes : t CO₂ évitées par point de soutien dépensé (prévision sur l'état courant). */
function cardOrder(S: GameState) {
  return CARDS.map((c) => {
    const st = cardStatus(S, c.id);
    const cost = st.cost.etat + st.cost.entreprises + st.cost.citoyens;
    return { id: c.id, st, score: st.forecast.co2 / Math.max(1, cost) };
  }).filter((x) => x.st.available && x.st.forecast.co2 > 0).sort((a, b) => b.score - a.score);
}
/** Robot « climat » : joue la meilleure carte disponible (au plus `perMonth` par mois, une carte tous les `gap` mois). */
function playClimate(S: GameState, mem: BotMemory, o: { perMonth: number; gap: number; maxDeficit?: number }) {
  if (S.month - mem.lastCard < o.gap) return;
  if (o.maxDeficit !== undefined && deficit(S) > o.maxDeficit) return;
  let n = 0;
  for (const c of cardOrder(S)) {
    if (n >= o.perMonth) break;
    const r = applyGovAction(S, { type: 'climatCard', card: c.id });
    if (r.ok) { n++; mem.cards++; mem.lastCard = S.month; }
  }
}

/** Multiplie toutes les lignes budgétaires (procédure parlementaire : au-delà de 10 % c'est une loi votée). */
function scaleBudget(S: GameState, k: number) {
  const p: Policy = clone(S.pending?.policy ?? S.policy);
  for (const b of BUDGET_LINES) p.budget[b] = Math.round(p.budget[b] * k);
  schedulePolicy(S, p, { parliament: true });
}
/** Petit ajustement fiscal (TVA normale ± points), décret si < 2 points. */
function nudgeVat(S: GameState, d: number) {
  const p: Policy = clone(S.pending?.policy ?? S.policy);
  p.vat.normal = Math.min(0.3, Math.max(0.12, p.vat.normal + d));
  schedulePolicy(S, p, { parliament: true });
}

const CLIMATE_RESEARCH = ['pompes_chaleur', 'materiaux_bas_carbone', 'batiments_passifs', 'capture_carbone', 'agriculture_precision', 'solaire_ng', 'eolien_hp', 'hydrogene_vert', 'reseaux_intelligents', 'nucleaire_avance'];

export function botStep(S: GameState, strat: Strategy, mem: BotMemory) {
  const jan = S.month % 12 === 0;
  switch (strat) {
    case 'passif': return;
    case 'besoins':
      playNeeds(S, mem, { maxDeficit: 0.04, maxDebt: 1.1, maxCost: 0.004, cooldown: 12, perMonth: 1 });
      return;
    case 'climat':
      playClimate(S, mem, { perMonth: 1, gap: 1 });
      return;
    case 'austerite':
      // −4 % sur toutes les lignes chaque janvier pendant 5 ans (≈ −18 %), puis gel
      if (jan && S.month > 0 && S.month <= 60) scaleBudget(S, 0.96);
      return;
    case 'depensier':
      // +5 % sur toutes les lignes chaque janvier, toutes les actions proposées sans regarder le budget, cartes à volonté
      if (jan && S.month > 0) scaleBudget(S, 1.05);
      playNeeds(S, mem, { maxDeficit: 1, maxDebt: 9, maxCost: 1, cooldown: 6, perMonth: 3 });
      playClimate(S, mem, { perMonth: 2, gap: 1 });
      return;
    case 'equilibre':
      // recherche orientée climat dès le départ (débloque les cartes « bâtiments passifs », captage, hydrogène…)
      if (S.month === 0) applyServiceAction(S, { type: 'fileRecherche', techs: CLIMATE_RESEARCH });
      playMissions(S, mem, { maxDeficit: 0.035 });
      playNeeds(S, mem, { maxDeficit: 0.03, maxDebt: 0.95, maxCost: 0.003, cooldown: 12, perMonth: 1 });
      playClimate(S, mem, { perMonth: 1, gap: 2, maxDeficit: 0.04 });
      // pilotage budgétaire annuel : si le déficit dérape, +1 point de TVA ; s'il y a de la marge, −0,5 point
      if (jan && S.month > 0) {
        if (deficit(S) > 0.035) nudgeVat(S, 0.01);
        else if (deficit(S) < -0.01 && S.policy.vat.normal > 0.18) nudgeVat(S, -0.005);
      }
      return;
  }
}

// ---------- Mesures ----------
export interface Snapshot { month: number; xp: number; title: string; titleIndex: number; won: number; failed: number; debt: number; deficit: number; unemployment: number; satisfaction: number; trust: number; popularity: number; emissions: number; netCut: number }
export interface RunResult {
  strategy: Strategy;
  seed: number;
  years: number;
  missionsWon: number;
  missionsFailed: number;
  successRate: number;
  meanDelay: number; // mois entre début et réussite (missions réussies)
  milestones: Record<number, string>; // année → statut
  milestoneGap: Record<number, number>;
  elections: { month: number; outcome: string; govShare: number }[];
  electionsWon: number;
  defeat: null | { reason: string; month: number };
  defeats: { reason: string; month: number }[];
  crises: number; // événements déclenchés (hors opportunités)
  hazards: number; // aléas climatiques
  firstTrophy: number | null; // mois
  firstTrophyId: string | null;
  trophies: number;
  cards: number;
  actions: number;
  levers: number;
  minSatisfaction: number;
  maxDebt: number;
  at: Record<number, Snapshot>; // instantanés à 5, 10, 20, 30… ans
  final: Snapshot;
}

function snap(S: GameState): Snapshot {
  const M = S.missions!;
  const t = titleOf(M.xp);
  const C = S.climate!;
  const net = S.history.emissionsNet ?? S.history.emissions;
  const avg = net.slice(-12).reduce((a, b) => a + b, 0) / Math.min(12, net.length);
  return {
    month: S.month, xp: M.xp, title: t.name, titleIndex: t.index, won: M.won, failed: M.failed, debt: debtRatio(S), deficit: deficit(S), unemployment: unemployment(S),
    satisfaction: S.satisfaction.overall, trust: S.satisfaction.trust, popularity: govPop(S), emissions: avg, netCut: 1 - avg / Math.max(1, C.reference),
  };
}

const HAZARDS = new Set(['canicule', 'inondations', 'penurie_eau', 'tempete']);
let baseGame: Map<number, GameState> = new Map();
/** Partie neuve (création mise en cache par graine : la création est la partie la plus lente). */
export function newGame(seed = 2030): GameState {
  if (!baseGame.has(seed)) baseGame.set(seed, createGame({ seed }));
  return clone(baseGame.get(seed)!);
}
export function resetCache() { baseGame = new Map(); }

/** Joue une partie complète. `continueAfterDefeat` : la partie se poursuit en mode libre pour mesurer la suite. */
export function runStrategy(strategy: Strategy, years = 30, seed = 2030, opts: { snapshotsAt?: number[] } = {}): RunResult {
  const S = newGame(seed);
  const mem = newMemory();
  const at: Record<number, Snapshot> = {};
  const snapsAt = new Set((opts.snapshotsAt ?? [5, 10, 20, 30, 50]).map((y) => y * 12));
  const defeats: { reason: string; month: number }[] = [];
  let crises = 0, hazards = 0, minSat = 100, maxDebt = 0;
  let firstTrophy: number | null = null, firstTrophyId: string | null = null;
  const delays: number[] = [];
  const counted = new Set<number>();
  let lastSeq = S.events?.seq ?? 1;
  for (let m = 0; m < years * 12; m++) {
    botStep(S, strategy, mem);
    tick(S);
    const E = S.events!;
    if (E.seq !== lastSeq) {
      for (const ev of [...E.active, ...E.history]) {
        if (ev.uid < lastSeq || ev.kind === 'opportunite') continue;
        crises++;
        if (HAZARDS.has(ev.id)) hazards++;
      }
      lastSeq = E.seq;
    }
    const V = S.victory!;
    if (V.status === 'defaite' && V.defeat) {
      defeats.push({ reason: V.defeat.reason, month: V.defeat.month });
      continueAfterDefeat(S);
    }
    const M = S.missions!;
    for (const h of M.history) {
      if (counted.has(h.id)) continue;
      counted.add(h.id);
      if (h.status === 'reussie' && h.endMonth !== undefined) delays.push(h.endMonth - h.startMonth);
    }
    if (firstTrophy === null) {
      const ids = Object.entries(M.trophies).filter(([id]) => id !== 'decennie');
      if (ids.length) { firstTrophy = S.month; firstTrophyId = ids[0][0]; }
    }
    minSat = Math.min(minSat, S.satisfaction.overall);
    maxDebt = Math.max(maxDebt, debtRatio(S));
    if (snapsAt.has(S.month)) at[S.month / 12] = snap(S);
  }
  const M = S.missions!;
  const C = S.climate!;
  const P = S.politics!;
  const milestones: Record<number, string> = {};
  const milestoneGap: Record<number, number> = {};
  for (const ms of C.milestones) { milestones[ms.year] = ms.status; if (ms.gap !== undefined) milestoneGap[ms.year] = ms.gap; }
  return {
    strategy, seed, years,
    missionsWon: M.won, missionsFailed: M.failed, successRate: M.won / Math.max(1, M.won + M.failed),
    meanDelay: delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : NaN,
    milestones, milestoneGap,
    elections: P.elections.map((e) => ({ month: e.month, outcome: e.outcome, govShare: e.coalitionSeats / P.seatsTotal })),
    electionsWon: P.electionsWon,
    defeat: defeats[0] ?? null, defeats,
    crises, hazards, firstTrophy, firstTrophyId, trophies: Object.keys(M.trophies).length,
    cards: mem.cards, actions: mem.actions, levers: mem.levers, minSatisfaction: minSat, maxDebt,
    at, final: snap(S),
  };
}

// ---------- Rapport texte ----------
const p1 = (v: number) => `${(v * 100).toFixed(1)}%`;
const f1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '—');
const ST: Record<string, string> = { atteint: 'OK', proche: 'proche', manque: 'raté', a_venir: '—' };

export function summarize(results: RunResult[]) {
  const by = new Map<Strategy, RunResult[]>();
  for (const r of results) { if (!by.has(r.strategy)) by.set(r.strategy, []); by.get(r.strategy)!.push(r); }
  const rows: Record<string, string>[] = [];
  for (const [s, rs] of by) {
    const avg = (f: (r: RunResult) => number) => rs.reduce((a, r) => a + f(r), 0) / rs.length;
    const y10 = (r: RunResult) => r.at[10];
    const y30 = (r: RunResult) => r.at[30] ?? r.final;
    rows.push({
      'stratégie': STRATEGY_NAMES[s],
      'missions ✓/✗': `${f1(avg((r) => r.missionsWon))}/${f1(avg((r) => r.missionsFailed))}`,
      'taux ✓': p1(avg((r) => r.successRate)),
      'délai ✓ (mois)': f1(avg((r) => (Number.isFinite(r.meanDelay) ? r.meanDelay : 0))),
      'jalon 2035': rs.map((r) => ST[r.milestones[2035]] ?? '—').join(' '),
      'écart 2035': rs.map((r) => f1(r.milestoneGap[2035] ?? NaN)).join(' '),
      'jalon 2050': rs.map((r) => ST[r.milestones[2050]] ?? '—').join(' '),
      'CO₂ −% 10/30 ans': `${p1(avg((r) => y10(r)?.netCut ?? 0))}/${p1(avg((r) => y30(r).netCut))}`,
      'dette 10/30 ans': `${p1(avg((r) => y10(r)?.debt ?? 0))}/${p1(avg((r) => y30(r).debt))}`,
      'dette max': p1(avg((r) => r.maxDebt)),
      'chômage 10 ans': p1(avg((r) => y10(r)?.unemployment ?? 0)),
      'satisf. 10/30': `${f1(avg((r) => y10(r)?.satisfaction ?? 0))}/${f1(avg((r) => y30(r).satisfaction))}`,
      'popularité 10 ans': p1(avg((r) => y10(r)?.popularity ?? 0)),
      'élections': rs.map((r) => r.elections.map((e) => (e.outcome === 'majorite' || e.outcome === 'coalition_elargie' ? 'G' : e.outcome === 'cohabitation' ? 'C' : 'P')).join('')).join(' '),
      'défaite': rs.map((r) => (r.defeat ? `${r.defeat.reason}@${(r.defeat.month / 12).toFixed(1)}a` : 'aucune')).join(' '),
      'crises': f1(avg((r) => r.crises)),
      '1er trophée (mois)': rs.map((r) => r.firstTrophy ?? '—').join(' '),
      'XP 10/30 ans': `${Math.round(avg((r) => y10(r)?.xp ?? 0))}/${Math.round(avg((r) => y30(r).xp))}`,
      'titre 10/30': `${y10(rs[0])?.title ?? '—'} / ${y30(rs[0]).title}`,
      'cartes/actions/leviers': `${f1(avg((r) => r.cards))}/${f1(avg((r) => r.actions))}/${f1(avg((r) => r.levers))}`,
    });
  }
  return rows;
}

/** Tableau Markdown (colonnes = stratégies) pour docs/EQUILIBRAGE.md. */
export function markdownTable(rows: Record<string, string>[]) {
  const keys = Object.keys(rows[0]).filter((k) => k !== 'stratégie');
  const head = `| Indicateur | ${rows.map((r) => r['stratégie']).join(' | ')} |`;
  const sep = `|---|${rows.map(() => '---').join('|')}|`;
  const body = keys.map((k) => `| ${k} | ${rows.map((r) => r[k]).join(' | ')} |`);
  return [head, sep, ...body].join('\n');
}
