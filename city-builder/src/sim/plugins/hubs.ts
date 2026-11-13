/**
 * Module de simulation « hubs » : port et aéroport (phase 2C, ROADMAP §7) — propriété de la branche p2c-port-aeroport.
 * Le cœur du module est dans src/sim/hubs/** (validation, activité, mouvements, nuisances) ; ce fichier le
 * branche sur les crochets de `SimPlugin`. Services publiés : `port`, `aeroport` (HubFreightApi : capacité, coût,
 * délai, réservations pour les exportations), `servitudes` (HubEasementApi). Utilise le service `municipal`
 * s'il est enregistré (grilles partagées), sinon une instance de repli du contrat municipal.
 * Sans pôle construit : aucun delta, aucune section, aucune écriture dans l'état de base.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { HubsSystem } from '../hubs/system';
import { HUBS_SAVE_VERSION, migrateHubs } from '../hubs/save';
import { hubTypeOfAsset, HUB_SPECS, type HubType } from '../../shared/hubs/types';
import type { PluginCommandResult, SimPlugin } from './types';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Codes du module ramenés aux codes standard (le message garde la raison précise, lisible tel quel). */
const STANDARD = new Set(['NO_GAME', 'INVALID_ARGS', 'UNKNOWN_ASSET', 'OUT_OF_BOUNDS', 'INSUFFICIENT_FUNDS', 'COLLISION', 'TOO_STEEP', 'UNDER_WATER', 'NOT_FOUND']);
const std = (r: { code: string; message: string }): PluginCommandResult => ({ ok: false, code: STANDARD.has(r.code) ? r.code : 'INVALID_ARGS', message: r.message });
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Fabrique une instance du module (le registre utilise `hubsPlugin` ; les tests créent la leur). */
export function createHubsPlugin(): SimPlugin & { readonly system: HubsSystem } {
  const sys = new HubsSystem();
  return {
    id: 'hubs',
    saveVersion: HUBS_SAVE_VERSION,
    system: sys,
    init(ctx) { sys.init(ctx); },
    onNewGame(ctx) { sys.newGame(ctx); },
    onTick(ctx, minutes) { sys.driveOwnScheduler('tick', ctx, minutes); sys.tick(ctx, minutes); },
    onDayStart(ctx) { sys.driveOwnScheduler('day', ctx); },
    onMonthStart(ctx) { sys.driveOwnScheduler('month', ctx); },
    takeDelta(ctx) { return sys.takeDelta(ctx.speed); },
    snapshot(ctx) { return sys.snapshot(ctx.speed); },
    save() { return sys.save(); },
    load(ctx, data, version) { sys.load(ctx, migrateHubs(data, version)); },
    command(ctx, name, payload): PluginCommandResult {
      const p = isObj(payload) ? payload : {};
      switch (name) {
        case 'place': {
          const x = num(p.x), z = num(p.z), rot = num(p.rot) ?? 0;
          const key = typeof p.assetId === 'string' ? p.assetId : typeof p.type === 'string' ? p.type : '';
          if (x === undefined || z === undefined) return { ok: false, code: 'INVALID_ARGS', message: 'x et z (nombres) attendus' };
          const r = sys.place(ctx, key, x, z, rot, p.dryRun === true);
          return r.ok ? { ok: true, data: { id: r.id, cost: r.cost, y: r.y, type: r.type } } : std(r);
        }
        case 'remove': {
          const id = num(p.id);
          if (id === undefined) return { ok: false, code: 'INVALID_ARGS', message: 'id attendu' };
          const r = sys.remove(ctx, id);
          return r.ok ? { ok: true, data: { refund: r.refund } } : r;
        }
        case 'checkBuilding': {
          const x = num(p.x), z = num(p.z), rot = num(p.rot) ?? 0;
          if (typeof p.assetId !== 'string' || x === undefined || z === undefined) return { ok: false, code: 'INVALID_ARGS', message: 'assetId, x, z attendus' };
          // Un pôle n'est pas soumis aux servitudes (il est validé par `place`).
          if (hubTypeOfAsset(p.assetId)) return { ok: true, data: { limit: Infinity } };
          const msg = sys.checkBuilding(ctx, p.assetId, x, z, rot, num(p.variant) ?? -1);
          return msg ? { ok: false, code: 'INVALID_ARGS', message: msg } : { ok: true, data: { limit: Number.POSITIVE_INFINITY } };
        }
        case 'summary': {
          const port = sys.freightApi('port').capacity();
          const aeroport = sys.freightApi('aeroport').capacity();
          return { ok: true, data: { hubs: sys.summaries(), port, aeroport, violations: sys.violations(ctx).slice(0, 20), sharedMunicipal: sys.usesSharedMunicipal } };
        }
        case 'probe': {
          const x = num(p.x), z = num(p.z);
          if (x === undefined || z === undefined) return { ok: false, code: 'INVALID_ARGS', message: 'x et z attendus' };
          const g = sys.muni.grids;
          const limit = ctx.use<{ limitAt(x: number, z: number): number }>('servitudes')?.limitAt(x, z) ?? Infinity;
          return { ok: true, data: { noise: sys.noiseAt(x, z), limit, satisfaction: g.read('satisfaction', x, z), landValue: g.read('valeur_fonciere', x, z), bruit: g.read('bruit', x, z) } };
        }
        case 'suggest': {
          // Emplacements valides (balayage de la carte) : aide au joueur et aux tests visuels.
          const type = (typeof p.type === 'string' && p.type in HUB_SPECS ? p.type : 'port_commerce') as HubType;
          const step = Math.max(16, num(p.step) ?? 48), max = Math.max(1, Math.min(50, num(p.max) ?? 5));
          const rots = Array.isArray(p.rots) ? (p.rots as unknown[]).filter((r): r is number => typeof r === 'number') : [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5];
          const b = ctx.terrain.bounds();
          const out: { x: number; z: number; rot: number }[] = [];
          if (b) {
            for (let z = b.minZ + step; z < b.maxZ - step && out.length < max; z += step) {
              for (let x = b.minX + step; x < b.maxX - step && out.length < max; x += step) {
                for (const rot of rots) if (sys.check(ctx, type, x, z, rot).ok) { out.push({ x, z, rot }); break; }
              }
            }
          }
          return { ok: true, data: out };
        }
        case 'movements':
          return { ok: true, data: sys.movementStates() };
        default:
          return { ok: false, code: 'INVALID_ARGS', message: `Commande inconnue du module hubs : ${name}` };
      }
    },
  };
}

export const hubsPlugin = createHubsPlugin();

/** Types de pôles constructibles (catalogue de construction, catégorie transport). */
export const HUB_BUILD_TYPES: readonly HubType[] = Object.keys(HUB_SPECS) as HubType[];
