/**
 * Module « secteurs » : zones rectangulaires créées par le joueur, avec des politiques locales (src/shared/secteurs.ts).
 * Effets : bonheur et pollution subie des bâtiments du secteur (lus par la démographie via le service `secteurs`) ;
 * coût prélevé chaque mois (ligne « Services »). Sans secteur : aucun delta, aucune section, aucun effet.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { DISTRICT_POLICIES, SECTEUR_LIMITS, type SecteursState, type SecteurView } from '../../shared/secteurs';
import { runMigrations } from '../save-sections/types';
import type { PluginCommandResult, PluginContext, SimPlugin } from './types';

export const SECTEURS_SAVE_VERSION = 1;
export interface SecteurSave { id: number; name: string; x0: number; z0: number; x1: number; z1: number; policies: string[] }
export interface SecteursSave { next: number; secteurs: SecteurSave[] }
export const emptySecteursSave = (): SecteursSave => ({ next: 1, secteurs: [] });

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function migrateSecteurs(data: unknown, from: number): SecteursSave {
  const o = runMigrations(data, from, SECTEURS_SAVE_VERSION, {}, 'secteurs') as Partial<SecteursSave>;
  const known = new Set(DISTRICT_POLICIES.map((p) => p.id));
  const secteurs: SecteurSave[] = [];
  for (const s of Array.isArray(o.secteurs) ? o.secteurs : []) {
    if (!s || typeof s !== 'object' || !fin(s.id) || !fin(s.x0) || !fin(s.z0) || !fin(s.x1) || !fin(s.z1)) continue;
    secteurs.push({ id: s.id | 0, name: typeof s.name === 'string' ? s.name.slice(0, 40) : `Secteur ${s.id}`, x0: s.x0, z0: s.z0, x1: s.x1, z1: s.z1, policies: Array.isArray(s.policies) ? s.policies.filter((p): p is string => typeof p === 'string' && known.has(p)) : [] });
  }
  const next = fin(o.next) ? Math.max(o.next, ...secteurs.map((s) => s.id + 1), 1) : secteurs.reduce((m, s) => Math.max(m, s.id + 1), 1);
  return { next, secteurs };
}

/** Service lu par la démographie (bonheur, pollution subie) ; `version` change à chaque modification. */
export interface SecteursService {
  happinessOf(buildingId: number): number; pollutionFactorOf(buildingId: number): number; version(): number;
  /** Secteur contenant le bâtiment (statistiques par quartier de l'économie vivante) ; null hors secteur. */
  sectorOf?(buildingId: number): { key: number; name: string } | null;
}

export function createSecteursPlugin(): SimPlugin & { readonly state: () => SecteursSave } {
  let s = emptySecteursSave();
  let version = 0, sent = -1, everSent = false;
  let ctxRef: PluginContext | null = null;
  // Cache bâtiment -> secteur (index dans s.secteurs, -1 hors secteur) avec la position mémorisée : vidé à chaque
  // modification des secteurs (création, suppression, politiques, chargement) ; une entrée est recalculée si le
  // bâtiment a bougé (outil Déplacer) ; un bâtiment nouveau (même s'il en remplace un autre) est calculé à la
  // demande. (L'ancienne clé « version:nombre de bâtiments » ratait les démolitions suivies d'une pose et les
  // déplacements : politiques appliquées au mauvais bâtiment.)
  let cacheVersion = -1;
  const cache = new Map<number, { k: number; x: number; z: number }>();
  const sectorIndex = (ctx: PluginContext, id: number): number => {
    if (cacheVersion !== version) { cache.clear(); cacheVersion = version; }
    const i = ctx.buildings.indexOf(id);
    if (i < 0) return -1;
    const st = ctx.buildings.store;
    const x = st.x[i]!, z = st.z[i]!;
    const e = cache.get(id);
    if (e && e.x === x && e.z === z) return e.k;
    const k = s.secteurs.findIndex((d) => x >= d.x0 && x <= d.x1 && z >= d.z0 && z <= d.z1);
    cache.set(id, { k, x, z });
    return k;
  };
  const effect = (id: number, kind: 'happiness' | 'pollution'): number => {
    if (!ctxRef || !s.secteurs.length) return kind === 'happiness' ? 0 : 1;
    const k = sectorIndex(ctxRef, id);
    if (k < 0) return kind === 'happiness' ? 0 : 1;
    let v = kind === 'happiness' ? 0 : 1;
    for (const pid of s.secteurs[k]!.policies) {
      const p = DISTRICT_POLICIES.find((x) => x.id === pid);
      if (!p) continue;
      if (kind === 'happiness') v += p.happiness; else v *= p.pollution;
    }
    return v;
  };
  const counts = (ctx: PluginContext): number[] => {
    const n = s.secteurs.map(() => 0);
    const st = ctx.buildings.store;
    for (let i = 0; i < ctx.buildings.count; i++) { const k = sectorIndex(ctx, st.id[i]!); if (k >= 0) n[k]!++; }
    return n;
  };
  const costOf = (d: SecteurSave, buildings: number): number => Math.round(d.policies.reduce((a, pid) => a + (DISTRICT_POLICIES.find((p) => p.id === pid)?.costPerBuilding ?? 0), 0) * buildings);
  const view = (ctx: PluginContext): SecteursState => {
    const n = counts(ctx);
    const secteurs: SecteurView[] = s.secteurs.map((d, k) => ({ ...d, policies: [...d.policies], buildings: n[k]!, monthlyCost: costOf(d, n[k]!) }));
    return { secteurs, totalCost: secteurs.reduce((a, d) => a + d.monthlyCost, 0), max: SECTEUR_LIMITS.max };
  };
  const service: SecteursService = {
    happinessOf: (id) => effect(id, 'happiness'), pollutionFactorOf: (id) => effect(id, 'pollution'), version: () => version,
    sectorOf: (id) => {
      if (!ctxRef || !s.secteurs.length) return null;
      const k = sectorIndex(ctxRef, id);
      const d = k >= 0 ? s.secteurs[k] : undefined;
      return d ? { key: d.id, name: d.name } : null;
    },
  };
  const bad = (message: string): PluginCommandResult => ({ ok: false, code: 'INVALID_ARGS', message });

  return {
    id: 'secteurs',
    saveVersion: SECTEURS_SAVE_VERSION,
    state: () => s,
    init(ctx) { ctxRef = ctx; ctx.provide('secteurs', service); },
    onNewGame() { s = emptySecteursSave(); version++; everSent = false; cache.clear(); },
    onMonthStart(ctx) {
      if (!s.secteurs.length) return;
      const n = counts(ctx);
      const cost = s.secteurs.reduce((a, d, k) => a + costOf(d, n[k]!), 0);
      if (cost > 0) ctx.economy.applyService(-cost);
      version++;
    },
    takeDelta(ctx) {
      if (version === sent) return undefined;
      if (!s.secteurs.length && !everSent) { sent = version; return undefined; }
      sent = version; everSent = true;
      return view(ctx);
    },
    snapshot(ctx) { return s.secteurs.length ? view(ctx) : undefined; },
    save() { return s.secteurs.length ? { next: s.next, secteurs: s.secteurs.map((d) => ({ ...d, policies: [...d.policies] })) } : undefined; },
    load(_ctx, data, v) { s = migrateSecteurs(data, v); version++; cache.clear(); },
    command(ctx, name, payload): PluginCommandResult {
      const p = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>;
      if (name === 'state') return { ok: true, data: view(ctx) };
      if (name === 'create') {
        const x0 = Number(p['x0']), z0 = Number(p['z0']), x1 = Number(p['x1']), z1 = Number(p['z1']);
        if (![x0, z0, x1, z1].every(Number.isFinite)) return bad('Rectangle invalide');
        const r = { x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1) };
        const L = SECTEUR_LIMITS;
        if (r.x1 - r.x0 < L.minSize || r.z1 - r.z0 < L.minSize) return bad(`Secteur trop petit (${L.minSize} m de côté au moins)`);
        if (r.x1 - r.x0 > L.maxSize || r.z1 - r.z0 > L.maxSize) return bad(`Secteur trop grand (${L.maxSize} m de côté au plus)`);
        if (s.secteurs.length >= L.max) return bad(`${L.max} secteurs au plus`);
        if (s.secteurs.some((d) => r.x0 < d.x1 && r.x1 > d.x0 && r.z0 < d.z1 && r.z1 > d.z0)) return bad('Ce secteur chevauche un secteur existant');
        const id = s.next++;
        const nm = typeof p['name'] === 'string' && p['name'].trim() ? String(p['name']).trim().slice(0, 40) : `Secteur ${id}`;
        s.secteurs.push({ id, name: nm, ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.round(v)])) as { x0: number; z0: number; x1: number; z1: number }, policies: [] });
        version++;
        ctx.notify('info', `Secteur créé : ${nm}`);
        return { ok: true, data: view(ctx) };
      }
      const d = s.secteurs.find((x) => x.id === Number(p['id']));
      if (name === 'remove') {
        if (!d) return bad('Secteur inconnu');
        s.secteurs = s.secteurs.filter((x) => x !== d);
        version++;
        return { ok: true, data: view(ctx) };
      }
      if (name === 'rename') {
        if (!d) return bad('Secteur inconnu');
        if (typeof p['name'] !== 'string' || !p['name'].trim()) return bad('Nom vide');
        d.name = String(p['name']).trim().slice(0, 40);
        version++;
        return { ok: true, data: view(ctx) };
      }
      if (name === 'toggle') {
        if (!d) return bad('Secteur inconnu');
        const pol = DISTRICT_POLICIES.find((x) => x.id === p['policy']);
        if (!pol) return bad('Politique inconnue');
        const on = typeof p['on'] === 'boolean' ? p['on'] : !d.policies.includes(pol.id);
        if (on && !d.policies.includes(pol.id)) d.policies.push(pol.id);
        if (!on) d.policies = d.policies.filter((x) => x !== pol.id);
        version++;
        return { ok: true, data: view(ctx) };
      }
      return bad(`Commande inconnue : ${name}`);
    },
  };
}

export const secteursPlugin = createSecteursPlugin();
