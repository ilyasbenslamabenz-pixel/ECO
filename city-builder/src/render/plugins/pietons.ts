/**
 * Rendu du module « Piétons » — propriété de la branche p2a-pietons.
 * Seule cette branche modifie ce fichier. La foule est dessinée par src/render/pedestrians/crowd.ts
 * (instanciation par personnage et LOD, animation par texture d'os, imposteurs au loin).
 *
 * Compteur : en attendant le montage des panneaux du registre par la refonte d'interface (§1bis), le plugin
 * ajoute une pastille « Piétons » au groupe de statistiques du HUD (`#hud .hud-group.stats`) s'il existe —
 * voir docs/requests/pietons.md. Diagnostic e2e : `window.__pietons` (lecture seule).
 */
import { deltaExt, snapshotExt } from '../../shared/protocol-ext';
import type { PietonsStats } from '../../shared/protocol-ext/pietons';
import { PedestrianCrowdRenderer, type PedRenderStats } from '../pedestrians/crowd';
import type { RenderPlugin, RenderPluginContext } from './types';

export interface PietonsDebug {
  /** Vrai une fois les modèles chargés et cuits. */
  pret: boolean;
  /** Erreur de chargement éventuelle. */
  erreur: string | null;
  /** Dernières statistiques de simulation reçues. */
  stats: PietonsStats | null;
  /** Statistiques de rendu de la dernière image. */
  rendu: PedRenderStats;
  /** Trames reçues. */
  trames: number;
  /** Échantillon des piétons affichés (e2e, captures). */
  echantillon(n?: number): ReturnType<PedestrianCrowdRenderer['sample']>;
}

declare global { interface Window { __pietons?: PietonsDebug } }

const fmt = new Intl.NumberFormat('fr-FR');

class PietonsRenderPlugin implements RenderPlugin {
  readonly id = 'pietons';
  private crowd: PedestrianCrowdRenderer | null = null;
  private ctx: RenderPluginContext | null = null;
  private pill: HTMLElement | null = null;
  private value: HTMLElement | null = null;
  private shown = -1;
  private readonly debug: PietonsDebug = { pret: false, erreur: null, stats: null, rendu: { pietons: 0, dessines: 0, lod: [0, 0, 0, 0], appels: 0 }, trames: 0,
    echantillon: (n = 50) => this.crowd?.sample(n) ?? [],
  };

  async init(ctx: RenderPluginContext): Promise<void> {
    this.ctx = ctx;
    if (typeof window !== 'undefined') window.__pietons = this.debug;
    this.mountCounter();
    const crowd = new PedestrianCrowdRenderer(ctx.camera);
    this.crowd = crowd;
    this.debug.rendu = crowd.stats;
    ctx.scene.add(crowd.group);
    // Chargement en arrière-plan : le jeu démarre sans attendre les personnages.
    crowd.load((f) => ctx.lib.url(f)).then(() => { this.debug.pret = true; }, (e: unknown) => {
      this.debug.erreur = e instanceof Error ? e.message : String(e);
      console.error('[rendu pietons] chargement des personnages :', e);
    });
  }

  applySnapshotExt(payload: unknown): void {
    const s = snapshotExt(payload === undefined ? undefined : { pietons: payload }, 'pietons');
    this.crowd?.clear();
    this.setStats(s?.stats ?? null);
  }

  applyDeltaExt(payload: unknown): void {
    const d = deltaExt({ pietons: payload }, 'pietons');
    if (!d) return;
    if (d.frame) { this.debug.trames++; this.crowd?.applyFrame(d.frame); }
    if (d.stats) this.setStats(d.stats);
    if (d.config && !d.config.actif) this.crowd?.clear();
  }

  frame(dt: number): void {
    if (!this.crowd || !this.ctx) return;
    this.crowd.frame(Math.min(dt, 0.25), this.ctx.nightFactor());
    this.updateCounter();
  }

  dispose(): void {
    this.crowd?.dispose();
    this.crowd = null;
    this.pill?.remove();
    this.pill = null;
    if (typeof window !== 'undefined' && window.__pietons === this.debug) delete window.__pietons;
  }

  private setStats(s: PietonsStats | null): void {
    this.debug.stats = s;
    this.updateCounter();
  }

  private mountCounter(): void {
    if (typeof document === 'undefined') return;
    const host = document.querySelector('#hud .hud-group.stats');
    if (!host) return;
    const pill = document.createElement('span');
    pill.className = 'pill pill-pietons';
    pill.id = 'hud-pietons';
    pill.dataset.tip = 'Piétons actuellement dans la rue (trottoirs et passages piétons)';
    pill.setAttribute('aria-label', 'Piétons dans la rue');
    pill.innerHTML = '<span class="ico" aria-hidden="true">🚶</span><span class="lbl">Piétons</span> <b>0</b>';
    host.appendChild(pill);
    this.pill = pill;
    this.value = pill.querySelector('b');
  }

  private updateCounter(): void {
    if (!this.value) return;
    // Compteur : piétons dans la rue selon la simulation (à défaut, ceux reçus par le rendu).
    const n = this.debug.stats?.pietons ?? this.crowd?.stats.pietons ?? 0;
    if (n === this.shown) return;
    this.shown = n;
    this.value.textContent = fmt.format(n);
  }
}

export const pietonsRenderPlugin: RenderPlugin = new PietonsRenderPlugin();
