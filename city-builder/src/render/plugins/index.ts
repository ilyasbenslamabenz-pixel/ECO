/**
 * Registre des modules de RENDU de phase 2 — une ligne par module.
 * Fichier COMMUN (superviseur) : chaque branche ne modifie que `./<module>.ts`.
 */
import { batimentsRenderPlugin } from './batiments';
import { circulationRenderPlugin } from './circulation';
import { pietonsRenderPlugin } from './pietons';
import { chantiersRenderPlugin } from './chantiers';
import { weatherRenderPlugin } from './weather';
import { electriciteRenderPlugin } from './electricite';
import { dechetsRenderPlugin } from './dechets';
import type { RenderPlugin, RenderPluginContext } from './types';

export type { RenderPlugin, RenderPluginContext } from './types';

export const RENDER_PLUGINS: readonly RenderPlugin[] = [
  batimentsRenderPlugin,
  circulationRenderPlugin,
  pietonsRenderPlugin,
  chantiersRenderPlugin,
  weatherRenderPlugin,
  electriciteRenderPlugin,
  dechetsRenderPlugin,
];

/** Distribution protégée des crochets de rendu (exceptions journalisées une fois par module et crochet). */
export class RenderPluginHost {
  private readonly reported = new Set<string>();
  /** Nombre d'exceptions attrapées (diagnostic e2e). */
  errors = 0;

  constructor(readonly plugins: readonly RenderPlugin[] = RENDER_PLUGINS) {}

  private guard(p: RenderPlugin, hook: string, fn: () => void): void {
    try { fn(); } catch (e) { this.fail(p, hook, e); }
  }

  private fail(p: RenderPlugin, hook: string, e: unknown): void {
    this.errors++;
    const key = `${p.id}|${hook}`;
    if (this.reported.has(key)) return;
    this.reported.add(key);
    console.error(`[rendu ${p.id}] erreur dans ${hook} :`, e);
  }

  async init(ctx: RenderPluginContext): Promise<void> {
    for (const p of this.plugins) {
      if (!p.init) continue;
      try { await p.init(ctx); } catch (e) { this.fail(p, 'init', e); }
    }
  }

  applySnapshot(ext: Record<string, unknown> | undefined): void {
    for (const p of this.plugins) if (p.applySnapshotExt) this.guard(p, 'applySnapshotExt', () => p.applySnapshotExt!(ext?.[p.id]));
  }

  applyDelta(ext: Record<string, unknown> | undefined): void {
    if (!ext) return;
    for (const p of this.plugins) {
      const v = ext[p.id];
      if (v !== undefined && p.applyDeltaExt) this.guard(p, 'applyDeltaExt', () => p.applyDeltaExt!(v));
    }
  }

  frame(dt: number): void {
    for (const p of this.plugins) if (p.frame) this.guard(p, 'frame', () => p.frame!(dt));
  }

  dispose(): void {
    for (const p of this.plugins) if (p.dispose) this.guard(p, 'dispose', () => p.dispose!());
  }
}
