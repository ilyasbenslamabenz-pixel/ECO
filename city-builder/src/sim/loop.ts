/**
 * Boucle de simulation à PAS FIXE découplée du rendu (accumulateur de temps).
 * Un pas = 1000 / SIM_TICKS_PER_SECOND ms réelles ; à chaque pas, `speed` ticks de jeu
 * (0 = pause, 1, 2, 4, 8, 16). Si le worker prend du retard (onglet en arrière-plan, machine lente),
 * au plus MAX_CATCHUP_STEPS pas sont rattrapés puis le retard est abandonné (pas de « spirale »).
 * Testable en Node : l'horloge réelle est injectée.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { SIM_TICKS_PER_SECOND } from '../shared/constants';

export const STEP_MS = 1000 / SIM_TICKS_PER_SECOND;
export const MAX_CATCHUP_STEPS = 5;

export interface LoopTarget {
  readonly speed: number;
  tick(): void;
  tickMs: number;
}

export class FixedStepLoop {
  private acc = 0;
  private last: number;
  steps = 0;

  constructor(private readonly target: LoopTarget, private readonly now: () => number) {
    this.last = now();
  }

  /** Avance la boucle selon le temps réel écoulé ; renvoie le nombre de pas exécutés. */
  pump(): number {
    const t = this.now();
    this.acc += Math.min(1000, Math.max(0, t - this.last));
    this.last = t;
    let n = 0;
    while (this.acc >= STEP_MS && n < MAX_CATCHUP_STEPS) {
      this.acc -= STEP_MS;
      n++;
      const s = this.target.speed;
      if (s <= 0) continue;
      const t0 = this.now();
      for (let i = 0; i < s; i++) this.target.tick();
      this.target.tickMs = this.target.tickMs * 0.9 + ((this.now() - t0) / s) * 0.1;
    }
    if (n === MAX_CATCHUP_STEPS && this.acc >= STEP_MS) this.acc = 0;
    this.steps += n;
    return n;
  }
}
