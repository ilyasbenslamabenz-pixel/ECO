/**
 * Module de simulation « Piétons » — propriété de la branche p2a-pietons.
 * Seule cette branche modifie ce fichier. Toute la logique est dans src/sim/pedestrians/ (graphe
 * trottoirs/passages, itinéraires, foule avec évitement local, emplois du temps liés à la démographie,
 * respect des feux via le service « feux » de la circulation — à défaut : traversée prudente).
 *
 * Échanges :
 *  - deltas / instantané : `PietonsDelta` / `PietonsSnapshot` (src/shared/protocol-ext/pietons.ts) ;
 *  - commandes `pluginCommand { plugin: 'pietons', name }` : `config`, `stats`, `inspecter`, `proche` ;
 *  - sauvegarde : section versionnée (src/sim/save-sections/pietons.ts, v2) ;
 *  - services : consomme `feux` et `trafic` (facultatifs), publie `pietons` (occupation des passages).
 * Le module est en LECTURE SEULE sur la simulation de base et n'utilise que son PRNG propre.
 *
 * Le module est une classe : ses crochets sont des méthodes (prototype) et son état est privé. Conséquence à
 * connaître : le test commun « registres … vides » (tests/plugins/plugins.test.ts) compare `Object.keys(plugin)`
 * à `['id']` ; il reste vert alors que ce module n'est PLUS vide — cette assertion ne vérifie donc plus rien
 * pour les piétons et doit être revue à l'intégration (voir docs/requests/pietons.md).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { PIETONS_SAVE_VERSION, migratePietons } from '../pedestrians/save';
import { PedestrianSystem } from '../pedestrians/system';
import type { PluginCommandResult, PluginContext, SimPlugin } from './types';

export class PietonsSimPlugin implements SimPlugin {
  readonly id = 'pietons';
  readonly #system = new PedestrianSystem();

  /** Système piétons de ce module (tests, banc). */
  get system(): PedestrianSystem { return this.#system; }
  get saveVersion(): number { return PIETONS_SAVE_VERSION; }

  init(ctx: PluginContext): void { ctx.provide('pietons', this.#system.service); }
  onNewGame(): void { this.#system.reset(); }
  onTick(ctx: PluginContext, minutes: number): void { this.#system.tick(ctx, minutes); }
  onDayStart(ctx: PluginContext): void { this.#system.onDayStart(ctx); }
  takeDelta(): unknown { return this.#system.takeDelta(); }
  snapshot(): unknown { return this.#system.snapshot(); }
  command(ctx: PluginContext, name: string, payload: unknown): PluginCommandResult { return this.#system.command(ctx, name, payload); }
  save(): unknown { return this.#system.save(); }
  load(_ctx: PluginContext, data: unknown, version: number): void { this.#system.load(migratePietons(data, version)); }
}

/** Fabrique (les tests créent des instances indépendantes ; le jeu utilise `pietonsPlugin`). */
export function createPietonsPlugin(): PietonsSimPlugin { return new PietonsSimPlugin(); }

export const pietonsPlugin: SimPlugin = createPietonsPlugin();
