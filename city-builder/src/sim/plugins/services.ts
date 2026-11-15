/**
 * Module de simulation « services » (vague 2 : des services qui comptent). Le calcul vit dans la démographie
 * (`CityServices`, src/sim/services/city-services.ts, rattaché par la simulation via `attachCore`) ; ce module :
 *  - fait avancer les incendies à chaque heure de jeu (départs, pompiers, dégâts, ruines) ;
 *  - relaie les événements (incendies, délits notables, reconstructions) en notifications ;
 *  - publie le service `services` lu par le module « alertes » (icônes feu, ruine, criminalité élevée) ;
 *  - envoie la carte d'information (grille criminalité / risque d'incendie / santé / couverture) quand elle est affichée ;
 *  - commandes : `etat`, `batiment`, `reconstruire`, `calque`, `incendie` (diagnostic).
 * Rien n'est sauvegardé ici (l'état est dans la section démographie, champ `services`).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { PLUGIN_TRANSFER_KEY } from '../../shared/protocol';
import { SERVICES_NO_DATA, type ServicesDelta, type ServicesLayer } from '../../shared/protocol-ext/services';
import type { CityServices } from '../services/city-services';
import type { PluginCommandResult, PluginContext, SimPlugin } from './types';

/** API publiée pour les autres modules (alertes) et la simulation (rattachement du système). */
export interface ServicesApi {
  attachCore(core: CityServices): void;
  burning(id: number): boolean;
  ruined(id: number): boolean;
  damaged(id: number): boolean;
  crimeHigh(id: number): boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Taille des cellules de la carte (m). */
const CELL = 32;

export function createServicesPlugin(): SimPlugin & { readonly core: () => CityServices | null } {
  let core: CityServices | null = null;
  let lastHour = -1;
  let layerOn = false;
  let sentVersion = -1;

  const buildLayer = (ctx: PluginContext): ServicesLayer | null => {
    const bd = ctx.terrain.bounds();
    if (!core || !bd) return null;
    const cols = Math.max(1, Math.ceil((bd.maxX - bd.minX) / CELL)), rows = Math.max(1, Math.ceil((bd.maxZ - bd.minZ) / CELL));
    const n = cols * rows;
    const crime = new Uint8Array(n).fill(SERVICES_NO_DATA), fire = new Uint8Array(n).fill(SERVICES_NO_DATA), health = new Uint8Array(n).fill(SERVICES_NO_DATA);
    const state = new Uint8Array(n), cp = new Uint8Array(n), cf = new Uint8Array(n), ch = new Uint8Array(n);
    const st = ctx.buildings.store;
    for (let i = 0; i < ctx.buildings.count; i++) {
      const id = st.id[i]!;
      const ci = Math.floor((st.x[i]! - bd.minX) / CELL), cj = Math.floor((st.z[i]! - bd.minZ) / CELL);
      if (ci < 0 || cj < 0 || ci >= cols || cj >= rows) continue;
      const k = cj * cols + ci;
      const [cr, risk, hl, s] = core.layerValues(id);
      const occupied = st.residents[i]! + st.workers[i]! > 0;
      if (occupied || cr > 0) crime[k] = Math.max(crime[k] === SERVICES_NO_DATA ? 0 : crime[k]!, Math.round(cr));
      if (risk > 0) fire[k] = Math.max(fire[k] === SERVICES_NO_DATA ? 0 : fire[k]!, risk);
      if (hl >= 0 && st.residents[i]! > 0) health[k] = Math.min(health[k]!, Math.round(hl));
      if (s > state[k]!) state[k] = s;
      const m = core.coverageMask(i);
      if (m & 1) cp[k] = 1;
      if (m & 2) cf[k] = 1;
      if (m & 4) ch[k] = 1;
    }
    return { originX: bd.minX, originZ: bd.minZ, cellSize: CELL, cols, rows, crime, fire, health, state, coverPolice: cp, coverFire: cf, coverHealth: ch };
  };

  const drain = (ctx: PluginContext): void => {
    if (!core || !core.events.length) return;
    for (const e of core.events.splice(0)) ctx.notify(e.level, e.text);
  };

  const api: ServicesApi = {
    attachCore: (c) => { core = c; },
    burning: (id) => core?.isBurning(id) ?? false,
    ruined: (id) => core?.isRuined(id) ?? false,
    damaged: (id) => core?.isDamaged(id) ?? false,
    crimeHigh: (id) => !!core && core.crimeOf(id) >= core.tuning.crimeEleve,
  };

  return {
    id: 'services',
    core: () => core,
    init(ctx) { ctx.provide('services', api); },
    onNewGame() { lastHour = -1; sentVersion = -1; if (core) core.events.length = 0; },
    onTick(ctx, _minutes) {
      if (!core || !ctx.inGame) return;
      const hour = Math.floor(ctx.clock.totalMinutes / 60);
      // Après une nouvelle partie / un chargement : référence = heure d'avant ce pas (reprise identique).
      if (lastHour < 0) lastHour = Math.floor((ctx.clock.totalMinutes - _minutes) / 60);
      if (hour !== lastHour) { core.hourly(ctx.clock.totalMinutes); lastHour = hour; }
      drain(ctx);
    },
    onDayStart(ctx) { drain(ctx); },
    takeDelta(ctx): ServicesDelta | undefined {
      if (!core || !layerOn || core.version === sentVersion) return undefined;
      sentVersion = core.version;
      const layer = buildLayer(ctx);
      if (!layer) return undefined;
      return { layer, [PLUGIN_TRANSFER_KEY]: [layer.crime, layer.fire, layer.health, layer.state, layer.coverPolice, layer.coverFire, layer.coverHealth] };
    },
    // Carte affichée seulement à la demande : rien dans l'instantané sinon (module inerte pour le rendu).
    snapshot(ctx): ServicesDelta | undefined {
      if (!core || !layerOn) return undefined;
      sentVersion = core.version;
      const layer = buildLayer(ctx);
      return layer ? { layer } : undefined;
    },
    command(ctx, name, payload): PluginCommandResult {
      if (!core) return { ok: false, code: 'NOT_IMPLEMENTED', message: 'Services indisponibles (catalogue non chargé)' };
      const p = isObj(payload) ? payload : {};
      const now = ctx.clock.totalMinutes;
      const id = typeof p.buildingId === 'number' ? p.buildingId : NaN;
      switch (name) {
        case 'etat': return { ok: true, data: core.report(now) };
        case 'batiment': {
          const r = core.inspect(id, now);
          return r ? { ok: true, data: r } : { ok: false, code: 'NOT_FOUND', message: 'Bâtiment introuvable' };
        }
        case 'calque': {
          layerOn = p.on !== false;
          sentVersion = -1;
          return { ok: true, data: layerOn ? buildLayer(ctx) : null };
        }
        case 'reconstruire': {
          if (!core.isRuined(id)) return { ok: false, code: 'INVALID_ARGS', message: 'Ce bâtiment n’est pas une ruine' };
          const cost = core.rebuildCost(id);
          if (cost === null) return { ok: false, code: 'INVALID_ARGS', message: 'Lot privé : son promoteur le reconstruira (ou démolissez la ruine)' };
          if (ctx.economy.bankrupt) return { ok: false, code: 'INSUFFICIENT_FUNDS', message: 'Ville en faillite : travaux suspendus' };
          if (ctx.economy.money < cost) return { ok: false, code: 'INSUFFICIENT_FUNDS', message: `Fonds insuffisants (${cost} crédits requis)` };
          ctx.economy.applyService(-cost, true);
          core.rebuild(id, now);
          ctx.notify('info', 'Bâtiment reconstruit : il peut de nouveau accueillir habitants et emplois.');
          return { ok: true, data: { cost } };
        }
        case 'incendie': {
          // Diagnostic (tests, démonstration) : départ de feu immédiat sur un bâtiment.
          const ok = core.ignite(id, now, false);
          drain(ctx);
          return ok ? { ok: true, data: core.inspect(id, now) } : { ok: false, code: 'INVALID_ARGS', message: 'Départ de feu impossible (bâtiment absent, déjà en feu ou en ruine)' };
        }
        default:
          return { ok: false, code: 'INVALID_ARGS', message: `Commande services inconnue : ${name}` };
      }
    },
  };
}

/** Instance du registre (src/sim/plugins/index.ts). */
export const servicesPlugin = createServicesPlugin();
