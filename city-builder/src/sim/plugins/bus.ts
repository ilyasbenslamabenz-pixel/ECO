/**
 * Module de simulation « bus » (vague 3 : transports en commun tracés par le joueur, docs/TRANSPORTS_COMMUN.md).
 * Le calcul vit dans `BusSystem` (src/sim/transit/system.ts) ; ce module le branche sur les crochets de `SimPlugin` :
 *  - service `bus` : `attachCore({ demography, traffic })` appelé par la simulation (comme le module `services`) ; il
 *    pose les crochets de la démographie (couverture du jour, satisfaction, portée d'embauche, aide de croissance) ;
 *  - chaque jour : choix modal, fréquentation, charge, recettes et entretien, facteur voiture du trafic ;
 *  - commandes : `state`, `stats`, `snap`, `preview`, `createLine`, `updateLine`, `deleteLine`, `restoreLine`,
 *    `addStop`, `moveStop`, `removeStop`, `renameStop`, `stop` (fiche), `calque` (carte de couverture) ;
 *  - tramway : `mode: 'tram'` sur `snap`, `preview`, `createLine` ; voies : `track` (pose, site propre, retrait),
 *    `tracks` (liste).
 * Sans ligne : aucun delta, aucune section de sauvegarde, aucun effet sur la simulation (seule l'aide de croissance
 * peut suggérer d'en tracer quand les routes saturent).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { PALIERS_SERVICE, type PaliersService } from '../../shared/milestones';
import { PLUGIN_TRANSFER_KEY } from '../../shared/protocol';
import { BUS_SAVE_VERSION, migrateBus } from '../save-sections/bus';
import { BusSystem, type BusResult, type TransitCore } from '../transit/system';
import type { PluginCommandResult, PluginContext, SimPlugin } from './types';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const out = <T>(r: BusResult<T>): PluginCommandResult => (r.ok ? { ok: true, data: r.data } : { ok: false, code: r.code, message: r.message });

export interface BusApi { attachCore(core: TransitCore): void; readonly system: BusSystem }

export function createBusPlugin(): SimPlugin & { readonly system: BusSystem } {
  const sys = new BusSystem();
  let ctxRef: PluginContext | null = null;
  const api: BusApi = {
    system: sys,
    attachCore(core) {
      sys.attach(core);
      const d = core.demography;
      if (!d) return;
      d.transitPrepare = () => { if (ctxRef) sys.prepareDay(ctxRef); };
      d.transitSatisfaction = (id) => sys.satisfactionOf(id);
      d.transitReach = (id) => sys.jobReachOf(id);
      d.transitServes = (h, j) => sys.serves(h, j);
      d.extraGrowthHint = () => sys.hint;
    },
  };
  return {
    id: 'bus',
    saveVersion: BUS_SAVE_VERSION,
    system: sys,
    init(ctx) { ctxRef = ctx; ctx.provide('bus', api); },
    onNewGame(ctx) { ctxRef = ctx; sys.reset(); },
    onTick(ctx) { if (ctx.inGame) sys.tick(ctx); },
    onDayStart(ctx) { sys.dailyDemand(ctx); },
    onMonthStart() { if (sys.active) sys.onMonth(); },
    takeDelta(ctx) {
      const d = sys.takeDelta(ctx);
      if (d?.layer) (d as unknown as Record<string, unknown>)[PLUGIN_TRANSFER_KEY] = [d.layer.quality.buffer];
      return d;
    },
    snapshot(ctx) { return sys.snapshot(ctx); },
    save() { return sys.save(); },
    load(ctx, data, version) { sys.load(ctx, migrateBus(data, version)); },
    command(ctx, name, payload): PluginCommandResult {
      if (!ctx.inGame) return { ok: false, code: 'NO_GAME', message: 'Aucune partie en cours' };
      const p = isObj(payload) ? payload : {};
      const x = num(p.x), z = num(p.z);
      const mode = p.mode === 'tram' ? 'tram' : 'bus';
      switch (name) {
        case 'state': return { ok: true, data: sys.state(ctx) };
        case 'stats': return { ok: true, data: sys.summary(ctx) };
        case 'snap':
          if (x === undefined || z === undefined) return { ok: false, code: 'INVALID_ARGS', message: 'x et z attendus' };
          return out(sys.snap(ctx, x, z, mode));
        case 'preview': {
          const pts = Array.isArray(p.stops) ? (p.stops as unknown[]).filter((s): s is { x: number; z: number } => isObj(s) && num(s.x) !== undefined && num(s.z) !== undefined) : [];
          return out(sys.preview(ctx, pts, mode));
        }
        case 'createLine': {
          // Déblocages progressifs (module `paliers`) : nombre de lignes autorisé selon les paliers franchis.
          const lock = ctx.use<PaliersService>(PALIERS_SERVICE)?.busLineLock(sys.lineCount + 1);
          if (lock && p['dryRun'] !== true) return { ok: false, code: 'INVALID_ARGS', message: lock };
          return out(sys.createLine(ctx, p));
        }
        case 'updateLine': return out(sys.updateLine(ctx, p));
        case 'deleteLine': return out(sys.deleteLine(ctx, num(p.id) ?? -1));
        case 'restoreLine': return out(sys.restoreLine(ctx, p.line));
        case 'addStop':
          if (x === undefined || z === undefined) return { ok: false, code: 'INVALID_ARGS', message: 'x et z attendus' };
          return out(sys.addStop(ctx, num(p.lineId) ?? -1, x, z, num(p.index)));
        case 'moveStop':
          if (x === undefined || z === undefined) return { ok: false, code: 'INVALID_ARGS', message: 'x et z attendus' };
          return out(sys.moveStop(ctx, num(p.stopId) ?? -1, x, z));
        case 'removeStop': return out(sys.removeStop(ctx, num(p.stopId) ?? -1));
        case 'renameStop': return out(sys.renameStop(num(p.stopId) ?? -1, p.name));
        case 'stop': return out(sys.stopCard(ctx, num(p.stopId) ?? -1));
        case 'track':
          return out(sys.setTrack(ctx, {
            segId: num(p.segId), x, z, on: p.on !== false,
            dedicated: typeof p.dedicated === 'boolean' ? p.dedicated : undefined, dryRun: p.dryRun === true,
          }));
        case 'tracks': return { ok: true, data: sys.trackList(ctx) };
        case 'calque': {

          sys.setLayer(p.on !== false);
          return { ok: true, data: p.on !== false ? sys.layer(ctx) : null };
        }
        default: return { ok: false, code: 'INVALID_ARGS', message: `Commande inconnue du module bus : ${name}` };
      }
    },
  };
}

export const busPlugin = createBusPlugin();
