/**
 * Module de simulation « Zonage » (phase 2B) : zones peintes le long des routes, demande R/C/B/I, croissance
 * automatique des bâtiments et densification. Moteur : src/sim/zoning/** ; protocole :
 * src/shared/protocol-ext/zonage.ts ; sauvegarde : src/sim/save-sections/zonage.ts ; documentation : docs/ZONAGE.md.
 *
 * Écriture dans la simulation de base : uniquement par `ctx.development` (promotion privée : pose sans coût pour
 * la ville avec les contrôles de `placeBuilding`, démolition sans remboursement). Les chantiers, s'ils sont
 * enregistrés, s'ouvrent d'eux-mêmes sur les bâtiments posés.
 *
 * Sans zone peinte, le module est totalement inerte : aucun tirage, aucun delta, aucun instantané, aucune section.
 * Services consultés (facultatifs) : `chantiers` (limite de chantiers simultanés), `zonage:demande` (demande externe).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { ZONAGE_ID, ZONE_DEPTH_DEFAULT, isZoneType, zoneOf, type ZoneType } from '../../shared/protocol-ext/zonage';
import { TILE_SIZE } from '../../shared/constants';
// Chemin écrit depuis la racine de src/sim (garde-fou d'architecture sur « ../save… », voir chantiers).
import { ZONAGE_SAVE_VERSION, migrateZonage } from '../../sim/save-sections/zonage';
import { ZoningSystem } from '../zoning/system';
import type { PluginCommandResult, PluginContext, SimPlugin } from './types';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const bad = (message: string): PluginCommandResult => ({ ok: false, code: 'INVALID_ARGS', message });
/** Points d'un tracé acceptés par commande (un geste est envoyé par morceaux). */
const MAX_STROKE_POINTS = 512;

export type ZonagePlugin = SimPlugin & { systemOf(ctx: PluginContext): ZoningSystem };

/** Fabrique un module (une instance par simulation dans les tests ; le registre utilise `zonagePlugin`). */
export function createZonagePlugin(): ZonagePlugin {
  /** État PAR PARTIE (façade propre à chaque Simulation : deux parties dans un même processus restent isolées). */
  const systems = new WeakMap<PluginContext, ZoningSystem>();
  const sys = (ctx: PluginContext): ZoningSystem => {
    let s = systems.get(ctx);
    if (!s) { s = new ZoningSystem(); systems.set(ctx, s); }
    return s;
  };

  return {
    id: ZONAGE_ID,
    saveVersion: ZONAGE_SAVE_VERSION,
    systemOf: sys,

    init(ctx) { sys(ctx).setCatalog(ctx); },
    onNewGame(ctx) { sys(ctx).reset(ctx); },
    onTick(ctx) { sys(ctx).tick(ctx); },
    onDayStart(ctx) { sys(ctx).day(ctx); },
    takeDelta(ctx) { return sys(ctx).takeDelta(ctx); },
    snapshot(ctx) { const s = sys(ctx); return s.active ? s.full(ctx) : undefined; },

    command(ctx, name, payload): PluginCommandResult {
      const s = sys(ctx);
      if (!ctx.inGame) return { ok: false, code: 'NO_GAME', message: 'Aucune partie en cours' };
      const p = isObj(payload) ? payload : {};
      switch (name) {
        case 'state':
          s.updateDemand(ctx);
          return { ok: true, data: s.full(ctx) };
        case 'paint': {
          const pts = p.points;
          if (!Array.isArray(pts) || pts.length < 2 || pts.length % 2 !== 0 || pts.length > 2 * MAX_STROKE_POINTS || !pts.every((v) => num(v) !== undefined)) {
            return bad(`points : tableau [x0, z0, x1, z1, …] attendu (au plus ${MAX_STROKE_POINTS} points)`);
          }
          const zone = p.zone === null ? null : isZoneType(p.zone) ? (p.zone as ZoneType) : undefined;
          if (zone === undefined) return bad('zone : type de zone ou null (retirer) attendu');
          const depth = num(p.depth) ?? ZONE_DEPTH_DEFAULT;
          const radius = num(p.radius) ?? (depth + 1) * TILE_SIZE;
          const changed = s.paint(ctx, pts as number[], zone, depth, radius);
          // Cases modifiées renvoyées tout de suite (la partie peut être en pause : aucun delta ne partirait).
          const cells = s.grid.takeChanged();
          return { ok: true, data: cells ? { changed, cells } : { changed } };
        }
        case 'cellAt': {
          const x = num(p.x), z = num(p.z);
          if (x === undefined || z === undefined) return bad('x, z attendus');
          const idx = s.grid.index(x, z);
          const g = s.grid.info;
          const code = idx >= 0 ? s.grid.zone[idx]! : 0;
          return {
            ok: true,
            data: {
              zone: zoneOf(code),
              connected: idx >= 0 && s.grid.connected(idx), i: g && idx >= 0 ? idx % g.w : -1, j: g && idx >= 0 ? Math.floor(idx / g.w) : -1,
            },
          };
        }
        case 'setGrowth':
          if (typeof p.enabled !== 'boolean') return bad('enabled (booléen) attendu');
          s.setGrowth(p.enabled);
          return { ok: true, data: { growth: s.growth } };
        case 'tuning':
          return { ok: true, data: s.setTuning(p) };
        case 'grow': {
          const attempts = Math.max(0, Math.min(200, Math.floor(num(p.attempts) ?? 0)));
          const densify = Math.max(0, Math.min(50, Math.floor(num(p.densify) ?? 0)));
          s.updateDemand(ctx);
          let grown = 0, densified = 0;
          for (let k = 0; k < attempts; k++) grown += s.growHour(ctx);
          for (let k = 0; k < densify; k++) densified += s.densifyDay(ctx);
          return { ok: true, data: { grown, densified } };
        }
        default:
          return bad(`Commande zonage inconnue : ${name}`);
      }
    },

    save(ctx) { return sys(ctx).toSave(); },
    load(ctx, data, version) { sys(ctx).load(ctx, migrateZonage(data, version)); },
  };
}

/** Instance du registre (src/sim/plugins/index.ts). */
export const zonagePlugin = createZonagePlugin();
