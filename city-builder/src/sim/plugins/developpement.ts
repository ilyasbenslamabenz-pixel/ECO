/**
 * Module « developpement » (docs/PROGRESSION.md §8) : arbres de développement par domaine. Les points viennent des
 * paliers franchis (service `paliers`, `devPointsEarned`) ; le joueur les dépense pour débloquer des nœuds
 * (src/shared/development.ts). Effets publiés par le service `developpement` : modificateurs combinés (lus par
 * l'électricité, l'eau, le zonage, les services…), rayon / capacité des équipements, criminalité, réussite scolaire
 * (appliqués par la simulation) et bâtiments débloqués avant leur palier (lus par le module `paliers`).
 * Aucun point ni nœud : aucun delta, aucune section de sauvegarde, aucun effet.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import {
  DEV_DOMAINS, DEV_DOMAIN_NAMES_FR, DEV_NODES, DEV_POINTS_BY_MILESTONE, DEVELOPMENT_SERVICE, devFactors, devNode, devPointsEarned, devPointsSpent,
  type DevelopmentService, type DevelopmentState, type DevFactors,
} from '../../shared/development';
import { combine, type ModifierDelta } from '../../shared/governance';
import { MILESTONES, PALIERS_SERVICE, type PaliersService } from '../../shared/milestones';
import { runMigrations } from '../save-sections/types';
import type { PluginCommandResult, PluginContext, SimPlugin } from './types';

export const DEVELOPPEMENT_SAVE_VERSION = 1;
export interface DeveloppementSave { unlocked: string[] }
export const emptyDeveloppementSave = (): DeveloppementSave => ({ unlocked: [] });

export function migrateDeveloppement(data: unknown, from: number): DeveloppementSave {
  const o = runMigrations(data, from, DEVELOPPEMENT_SAVE_VERSION, {}, 'developpement') as Partial<DeveloppementSave>;
  const out: string[] = [];
  for (const id of Array.isArray(o.unlocked) ? o.unlocked : []) if (typeof id === 'string' && devNode(id) && !out.includes(id)) out.push(id);
  return { unlocked: out };
}

export function createDeveloppementPlugin(): SimPlugin & { readonly state: () => DeveloppementSave; readonly service: DevelopmentService } {
  let unlocked: string[] = [];
  let version = 0, sent = -1, everSent = false;
  /** Points gagnés au dernier contrôle (null : à relever sans notification, après une nouvelle partie ou un chargement). */
  let seen: number | null = null;
  let cache: { v: number; f: DevFactors; mods: ModifierDelta } | null = null;
  const factors = (): { f: DevFactors; mods: ModifierDelta } => {
    if (!cache || cache.v !== version) { const f = devFactors(unlocked); cache = { v: version, f, mods: combine(f.mods) }; }
    return cache;
  };
  const reached = (ctx: PluginContext): number => ctx.use<PaliersService>(PALIERS_SERVICE)?.reachedCount() ?? 0;
  const earned = (ctx: PluginContext): number => devPointsEarned(reached(ctx));
  const available = (ctx: PluginContext): number => earned(ctx) - devPointsSpent(unlocked);
  const idle = (ctx: PluginContext): boolean => !unlocked.length && earned(ctx) === 0;
  const view = (ctx: PluginContext): DevelopmentState => {
    const e = earned(ctx), sp = devPointsSpent(unlocked), av = e - sp;
    const done = new Set(unlocked);
    const nx = MILESTONES[reached(ctx)] ?? null;
    return {
      earned: e, spent: sp, available: av,
      nextPoints: nx ? DEV_POINTS_BY_MILESTONE[nx.id] ?? 0 : 0, nextMilestone: nx?.nameFr ?? null,
      nodes: DEV_NODES.map((n) => {
        const req = n.requires.every((q) => done.has(q));
        return { ...n, unlocked: done.has(n.id), available: !done.has(n.id) && req, affordable: !done.has(n.id) && req && n.cost <= av };
      }),
      domains: DEV_DOMAINS.map((d) => ({ id: d, nameFr: DEV_DOMAIN_NAMES_FR[d], unlocked: DEV_NODES.filter((n) => n.domain === d && done.has(n.id)).length, total: DEV_NODES.filter((n) => n.domain === d).length })),
    };
  };
  const service: DevelopmentService = {
    modifiers: () => factors().mods,
    factors: () => factors().f,
    assetUnlocked: (id) => unlocked.length > 0 && factors().f.assets.has(id),
    version: () => version,
  };
  return {
    id: 'developpement',
    saveVersion: DEVELOPPEMENT_SAVE_VERSION,
    service,
    state: () => ({ unlocked: [...unlocked] }),
    init(ctx) { ctx.provide(DEVELOPMENT_SERVICE, service); },
    onNewGame() { unlocked = []; version++; everSent = false; seen = null; },
    afterLoad(ctx) { seen = earned(ctx); version++; },
    onDayStart(ctx) {
      const e = earned(ctx);
      if (seen === null) { seen = e; if (e > 0) version++; return; }
      if (e > seen) {
        const gained = e - seen;
        seen = e;
        version++;
        ctx.notify('info', `+${gained} point${gained > 1 ? 's' : ''} de développement (palier franchi) : ${available(ctx)} à dépenser dans Progression › Développement.`);
      }
    },
    takeDelta(ctx) {
      if (version === sent) return undefined;
      if (idle(ctx) && !everSent) { sent = version; return undefined; }
      sent = version; everSent = true;
      return view(ctx);
    },
    snapshot(ctx) { return idle(ctx) ? undefined : view(ctx); },
    save() { return unlocked.length ? { unlocked: [...unlocked] } : undefined; },
    load(_ctx, data, v) { unlocked = migrateDeveloppement(data, v).unlocked; version++; },
    command(ctx, name, payload): PluginCommandResult {
      const p = (typeof payload === 'object' && payload !== null ? payload : {}) as { id?: unknown; dryRun?: unknown };
      if (name === 'state') return { ok: true, data: view(ctx) };
      if (name === 'unlock') {
        const def = typeof p.id === 'string' ? devNode(p.id) : undefined;
        if (!def) return { ok: false, code: 'INVALID_ARGS', message: 'Amélioration inconnue' };
        if (unlocked.includes(def.id)) return { ok: false, code: 'INVALID_ARGS', message: 'Amélioration déjà débloquée' };
        const missing = def.requires.filter((q) => !unlocked.includes(q));
        if (missing.length) return { ok: false, code: 'INVALID_ARGS', message: `Il faut d'abord : ${missing.map((q) => devNode(q)?.nameFr ?? q).join(', ')}` };
        const av = available(ctx);
        if (def.cost > av) return { ok: false, code: 'INVALID_ARGS', message: `Points de développement insuffisants (${def.cost} requis, ${av} disponible${av > 1 ? 's' : ''}) : franchissez le prochain palier` };
        if (p.dryRun === true) return { ok: true, data: view(ctx) };
        unlocked.push(def.id);
        version++;
        ctx.notify('info', `Développement : ${def.nameFr} — ${def.descFr}`);
        return { ok: true, data: view(ctx) };
      }
      return { ok: false, code: 'INVALID_ARGS', message: `Commande inconnue : ${name}` };
    },
  };
}

export const developpementPlugin = createDeveloppementPlugin();
