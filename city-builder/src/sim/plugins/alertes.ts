/**
 * Module « alertes » : chaque heure de jeu, relève les problèmes visibles de chaque bâtiment (pas d'accès routier,
 * coupure d'électricité, pas d'eau, bacs pleins) d'après les services publiés par les autres modules. Lecture seule :
 * aucun effet sur la simulation, rien n'est sauvegardé (recalculé au chargement).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { isBuildingCategory } from '../../shared/catalog';
import type { ElectriciteService } from '../../shared/power/types';
import { ALERT_BITS, ALERT_KINDS, type AlertesPayload, type AlertKind } from '../../shared/protocol-ext/alertes';
import type { PluginContext, SimPlugin } from './types';

interface EauLike { growthAllowed(id: number): boolean }
interface DechetsLike { binFull(id: number): boolean }

export function computeAlerts(ctx: PluginContext): AlertesPayload {
  const power = ctx.use<ElectriciteService>('electricite');
  const eau = ctx.use<EauLike>('eau');
  const dechets = ctx.use<DechetsLike>('dechets');
  const powerOn = !!power && (power.hasNetwork?.() ?? true);
  const st = ctx.buildings.store;
  const assets = ctx.catalog?.assets ?? [];
  const items: number[] = [];
  const counts: Record<AlertKind, number> = { road: 0, power: 0, water: 0, waste: 0 };
  for (let i = 0; i < ctx.buildings.count; i++) {
    const id = st.id[i]!;
    const a = assets[st.assetIndex[i]!];
    // Bâtiments seulement (pas le décor ni les pièces des ports et aéroports).
    if (!a || !isBuildingCategory(a.category)) continue;
    let m = 0;
    if (!st.roadAccess[i]) m |= ALERT_BITS.road;
    if (powerOn && !power!.isPowered(id)) m |= ALERT_BITS.power;
    if (eau && !eau.growthAllowed(id)) m |= ALERT_BITS.water;
    if (dechets?.binFull(id)) m |= ALERT_BITS.waste;
    if (!m) continue;
    for (const k of ALERT_KINDS) if (m & ALERT_BITS[k]) counts[k]++;
    items.push(id, m, Math.round(st.x[i]! * 10) / 10, Math.round((st.y[i]! + (a.dimensions?.height ?? 10)) * 10) / 10, Math.round(st.z[i]! * 10) / 10);
  }
  return { items, counts };
}

export function createAlertesPlugin(): SimPlugin {
  let last: AlertesPayload = { items: [], counts: { road: 0, power: 0, water: 0, waste: 0 } };
  let key = '', sentKey = '', acc = 60;
  const refresh = (ctx: PluginContext): void => { last = computeAlerts(ctx); key = last.items.join(','); };
  return {
    id: 'alertes',
    onNewGame() { last = { items: [], counts: { road: 0, power: 0, water: 0, waste: 0 } }; key = ''; sentKey = ''; acc = 60; },
    onTick(ctx, minutes) {
      acc += minutes;
      if (acc < 60) return;
      acc = 0;
      refresh(ctx);
    },
    takeDelta() {
      if (key === sentKey) return undefined;
      sentKey = key;
      return last;
    },
    // Aucune alerte : rien d'émis (module inerte, simulation identique avec ou sans lui).
    snapshot(ctx) { refresh(ctx); sentKey = key; return last.items.length ? last : undefined; },
    command(ctx, name) {
      if (name === 'state') { refresh(ctx); return { ok: true, data: last }; }
      return { ok: false, code: 'INVALID_ARGS', message: `Commande inconnue : ${name}` };
    },
  };
}

export const alertesPlugin = createAlertesPlugin();
