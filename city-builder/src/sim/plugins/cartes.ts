/**
 * Module de simulation « cartes » (vague 5, docs/INTERFACE.md) : cartes d'information nouvelles — valeur foncière,
 * pollution de l'air, bruit, chômage par quartier, éducation, satisfaction par logement, couverture des écoles,
 * remplissage des bacs à déchets. Une seule carte à la fois, calculée seulement quand elle est affichée :
 *  - commande `calque { kind | null }` → la grille tout de suite (affichage immédiat) ;
 *  - puis une grille par jour de jeu dans `delta.ext.cartes` tant qu'elle reste affichée (aucun coût sinon).
 * Lecture seule : la démographie est rattachée par la simulation (`attachCore`), les autres modules sont lus par
 * leurs services (`municipal` pour les grilles de pollution et de bruit, `dechets` pour les bacs). Rien n'est
 * sauvegardé, rien n'est tiré au hasard : la simulation est identique avec ou sans ce module.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { PLUGIN_TRANSFER_KEY } from '../../shared/protocol';
import { CARTE_KINDS, CARTE_NO_DATA, CARTE_PALETTE, carteScale, clampCarte, type CarteKind, type CarteLayer, type CartesDelta } from '../../shared/protocol-ext/cartes';
import { MINUTES_PER_DAY } from '../clock';
import { Service, type DemographySystem } from '../demography';
import type { PluginCommandResult, PluginContext, SimPlugin } from './types';

/** Taille des cellules de la carte (m) : même grille que les cartes des services. */
const CELL = 32;
/** Îlots de 500 m (quartiers par défaut, comme l'économie vivante). */
const BLOCK_M = 500;

type Grid = { at(x: number, z: number): number };
type Muni = { grids: { get(id: string): Grid | undefined } };
type Dechets = { binLevel?(id: number): number };

/** Construit la grille d'une carte (pur vis-à-vis de la simulation : lecture seule). */
export function buildCarte(ctx: PluginContext, demo: DemographySystem, kind: CarteKind): CarteLayer | null {
  const bd = ctx.terrain.bounds();
  if (!bd) return null;
  const cols = Math.max(1, Math.ceil((bd.maxX - bd.minX) / CELL)), rows = Math.max(1, Math.ceil((bd.maxZ - bd.minZ) / CELL));
  const n = cols * rows;
  const values = new Uint8Array(n).fill(CARTE_NO_DATA);
  // Moyenne par cellule pour la palette « valeur », pire bâtiment pour les cartes de problèmes.
  const avg = CARTE_PALETTE[kind] === 'valeur';
  const sum = avg ? new Float32Array(n) : null, cnt = avg ? new Uint16Array(n) : null;
  const st = ctx.buildings.store;
  const now = ctx.clock.totalMinutes;
  const muni = ctx.use<Muni>('municipal');
  const air = kind === 'pollution' ? muni?.grids.get('pollution_air') : undefined;
  const noise = kind === 'bruit' ? muni?.grids.get('bruit') : undefined;
  const nuisance = kind === 'bruit' ? muni?.grids.get('dechets:nuisance') : undefined;
  const waste = kind === 'dechets' ? ctx.use<Dechets>('dechets') : undefined;
  const agg = kind === 'chomage' || kind === 'education' || kind === 'satisfaction' ? demo.residentAggregates(now) : null;
  // Chômage par quartier : secteurs du joueur, sinon îlots de 500 m.
  let districtRate: Map<number, number> | null = null;
  const districtKey = (i: number): number => demo.districtOf(st.id[i]!)?.key ?? 1e7 + Math.floor(st.x[i]! / BLOCK_M) * 1000 + Math.floor(st.z[i]! / BLOCK_M);
  if (kind === 'chomage' && agg) {
    const lab = new Map<number, number>(), un = new Map<number, number>();
    for (let i = 0; i < ctx.buildings.count; i++) {
      if (!agg.labor[i]) continue;
      const k = districtKey(i);
      lab.set(k, (lab.get(k) ?? 0) + agg.labor[i]!);
      un.set(k, (un.get(k) ?? 0) + agg.unemployed[i]!);
    }
    districtRate = new Map();
    for (const [k, l] of lab) districtRate.set(k, (un.get(k) ?? 0) / l);
  }
  let used = 0, total = 0;
  for (let i = 0; i < ctx.buildings.count; i++) {
    const ci = Math.floor((st.x[i]! - bd.minX) / CELL), cj = Math.floor((st.z[i]! - bd.minZ) / CELL);
    if (ci < 0 || cj < 0 || ci >= cols || cj >= rows) continue;
    const id = st.id[i]!;
    const housing = demo.housingCapacityAt(i) > 0;
    const occupied = st.residents[i]! + st.workers[i]! > 0;
    let v = -1;
    switch (kind) {
      case 'foncier': { const l = i < demo.living.land.length ? demo.living.land[i]! : 0; if (l > 0) v = carteScale.foncier(l); break; }
      case 'pollution': if (occupied || housing) v = carteScale.pollution(demo.pollutionOf(i), air ? air.at(st.x[i]!, st.z[i]!) : 0); break;
      case 'bruit': if (occupied || housing) v = carteScale.bruit(noise ? noise.at(st.x[i]!, st.z[i]!) : 0, nuisance ? nuisance.at(st.x[i]!, st.z[i]!) : 0); break;
      case 'chomage': if (agg!.labor[i]) v = carteScale.chomage(districtRate!.get(districtKey(i)) ?? 0); break;
      case 'education': if (agg!.adults[i]) v = carteScale.education(agg!.eduSum[i]! / agg!.adults[i]!); break;
      case 'satisfaction': if (agg!.count[i]) v = carteScale.satisfaction(agg!.happy[i]! / agg!.count[i]!); break;
      case 'ecoles': if (housing) v = carteScale.ecoles(demo.coverageQuality(Service.Education, i)); break;
      case 'dechets': { const f = waste?.binLevel?.(id) ?? -1; if (f >= 0) v = carteScale.dechets(f); break; }
    }
    if (v < 0) continue;
    const q = clampCarte(v);
    const k = cj * cols + ci;
    used++; total += q;
    if (sum && cnt) { sum[k]! += q; cnt[k]!++; values[k] = clampCarte(sum[k]! / cnt[k]!); }
    else values[k] = values[k] === CARTE_NO_DATA ? q : Math.max(values[k]!, q);
  }
  return { kind, originX: bd.minX, originZ: bd.minZ, cellSize: CELL, cols, rows, values, buildings: used, mean: used ? Math.round(total / used) : 0, day: Math.floor(now / MINUTES_PER_DAY) };
}

export function createCartesPlugin(): SimPlugin & { readonly current: () => CarteKind | null } {
  let demo: DemographySystem | null = null;
  let kind: CarteKind | null = null;
  let sentDay = -1;
  return {
    id: 'cartes',
    current: () => kind,
    init(ctx) { ctx.provide('cartes', { attachCore: (d: unknown) => { demo = d as DemographySystem; } }); },
    onNewGame() { kind = null; sentDay = -1; },
    takeDelta(ctx): CartesDelta | undefined {
      if (!kind || !demo || !ctx.inGame) return undefined;
      const day = Math.floor(ctx.clock.totalMinutes / MINUTES_PER_DAY);
      if (day === sentDay) return undefined;
      sentDay = day;
      const layer = buildCarte(ctx, demo, kind);
      return layer ? { layer, [PLUGIN_TRANSFER_KEY]: [layer.values] } : undefined;
    },
    command(ctx, name, payload): PluginCommandResult {
      const p = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>;
      if (name === 'calque') {
        const k = p['kind'];
        if (k === null || k === undefined || k === false) { kind = null; return { ok: true, data: null }; }
        if (!CARTE_KINDS.includes(k as CarteKind)) return { ok: false, code: 'INVALID_ARGS', message: `Carte inconnue : ${String(k)}` };
        if (!demo) return { ok: false, code: 'NOT_IMPLEMENTED', message: 'Cartes indisponibles (catalogue non chargé)' };
        kind = k as CarteKind;
        sentDay = Math.floor(ctx.clock.totalMinutes / MINUTES_PER_DAY);
        return { ok: true, data: buildCarte(ctx, demo, kind) };
      }
      if (name === 'etat') return { ok: true, data: { kind } };
      return { ok: false, code: 'INVALID_ARGS', message: `Commande cartes inconnue : ${name}` };
    },
  };
}

/** Instance du registre (src/sim/plugins/index.ts). */
export const cartesPlugin = createCartesPlugin();
