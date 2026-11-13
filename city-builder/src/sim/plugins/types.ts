/**
 * Points d'extension de la SIMULATION (phase 2, §0 de docs/ROADMAP_PHASE2.md).
 *
 * Un module de phase 2 (bâtiments, circulation, piétons, chantiers) s'ajoute à la simulation sous la forme
 * d'un `SimPlugin` déclaré dans SON fichier `src/sim/plugins/<module>.ts`. La simulation (`world.ts`) appelle
 * ses crochets aux bons moments ; le module ne modifie aucun fichier commun.
 *
 * Cycle de vie (ordre garanti, voir tests/plugins/plugins.test.ts) :
 *  1. `init(ctx)`        : une fois, au premier `setCatalog` (commande `init` du worker), avant toute partie ;
 *  2. `onNewGame(ctx)`   : à chaque nouvelle partie ET au début de chaque chargement (remise à zéro de l'état
 *                          du module ; le terrain et les paramètres sont disponibles, réseau et bâtiments vides) ;
 *  3. `load(ctx, data, version)` : juste après, lors d'un chargement, si la sauvegarde contient la section
 *                          du module (`version` = version écrite ; migrer avec `src/sim/save-sections/<module>.ts`) ;
 *  4. à chaque tick : événements planifiés du tick (`onDayStart`, `onMonthStart` après le traitement de base),
 *     puis `onTick(ctx, minutes)` après démographie et trafic ;
 *  5. `takeDelta(ctx)`   : à chaque delta envoyé au rendu (≈ 10/s) ; renvoyer `undefined` quand rien n'a changé
 *                          (le module n'apparaît alors pas dans `delta.ext`) ;
 *  6. `snapshot(ctx)`    : à chaque instantané complet (après newGame / load / buildCity) ; le rendu repart de zéro ;
 *  7. `save(ctx)`        : à chaque sauvegarde ; `undefined` = pas de section ; écrit sous `save.plugins[id]`
 *                          avec `v = saveVersion ?? 1` ;
 *  8. `command(ctx, name, payload)` : commande `pluginCommand { plugin: id, name, payload }` du thread principal.
 *
 * Toute exception levée par un crochet est attrapée, journalisée (console + notification unique) et n'interrompt
 * ni la boucle de simulation ni les autres modules.
 *
 * Données échangées : uniquement des valeurs sérialisables (structured clone pour les deltas, JSON pour la
 * sauvegarde). Les tableaux typés d'un delta sont COPIÉS ; pour les transférer, les lister sous la clé
 * `PLUGIN_TRANSFER_KEY` ('$transfer') de la charge utile (buffers neufs à chaque envoi, voir protocol.ts).
 *
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { AssetCatalog, CatalogAsset } from '../../shared/catalog';
import type { BuildingRecord, NewGameParams } from '../../shared/contracts';
import type { Season } from '../clock';
import type { DemographyReport } from '../demography';
import type { MonthRecord, TaxSector } from '../economy';
import type { BuildingStore } from '../ecs';
import type { RoadNetwork } from '../roads';
import type { Rng } from '../rng';
import type { SimNotice } from '../sim-protocol';

/** Résultat d'une commande de module (`code` libre ; repris tel quel s'il fait partie de CommandErrorCode). */
export type PluginCommandResult = { ok: true; data?: unknown } | { ok: false; code: string; message: string };

/** Horloge de jeu (lecture seule). */
export interface PluginClock {
  /** Minutes de jeu depuis le début de la partie. */
  readonly totalMinutes: number;
  /** Heure décimale du jour (0..24). */
  readonly hourOfDay: number;
  readonly minuteOfDay: number;
  readonly dayIndex: number;
  readonly monthIndex: number;
  /** Mois 1..12, année 1.. */
  readonly month: number;
  readonly year: number;
  readonly season: Season;
  /** Jour de la semaine 0..6 (0 = lundi). */
  readonly weekday: number;
}

/**
 * Réseau routier en lecture seule : sous-ensemble des méthodes de consultation de `RoadNetwork`
 * (src/sim/roads/network.ts). Aucune méthode de modification n'est exposée. `version` change à chaque
 * modification du réseau (invalidation des caches du module).
 */
export type PluginRoads = Readonly<Pick<RoadNetwork,
  | 'version' | 'nodeCount' | 'segCount'
  | 'hasNode' | 'nodePos' | 'incident' | 'nodeNear' | 'nodeIds'
  | 'hasSegment' | 'kindOf' | 'endpoints' | 'curve' | 'length' | 'profile' | 'segmentsIn' | 'segmentNear' | 'segmentIds' | 'totalLength'
>>;

/**
 * Bâtiments en lecture seule. `store` donne accès SANS ALLOCATION aux colonnes (structure de tableaux,
 * index 0..count-1) : les tableaux typés sont modifiables par nature, mais un module ne doit JAMAIS y écrire
 * (la simulation de base en est la seule propriétaire). Les index changent à chaque suppression : conserver
 * les identifiants (`store.id[i]`), pas les index.
 */
export interface PluginBuildings {
  readonly count: number;
  readonly store: Readonly<Pick<BuildingStore,
    'id' | 'assetIndex' | 'variant' | 'x' | 'y' | 'z' | 'rot' | 'tilesX' | 'tilesZ' | 'residents' | 'workers' | 'roadAccess'>>;
  /** Index courant d'un bâtiment (-1 s'il n'existe pas). */
  indexOf(id: number): number;
  /** Enregistrement complet (alloue) ; null si absent. */
  record(id: number): BuildingRecord | null;
  /** Modèle du catalogue d'un bâtiment (par identifiant). */
  assetOf(id: number): CatalogAsset | undefined;
  /** Identifiants des bâtiments dont l'emprise recoupe le rectangle (index spatial par chunk ; `out` est vidé puis rempli). */
  query(minX: number, minZ: number, maxX: number, maxZ: number, out: number[]): number[];
}

/** Démographie en lecture seule (null tant que le catalogue n'est pas chargé). */
export interface PluginDemography {
  readonly population: number;
  readonly households: number;
  /** Rapport complet (alloue : à appeler au plus quelques fois par seconde). */
  report(): DemographyReport;
}

/** Terrain en lecture seule. */
export interface PluginTerrain {
  /** Hauteur du sol nivelé en (x, z) ; NaN hors carte ou sans partie. */
  heightAt(x: number, z: number): number;
  /** Vrai si de l'eau recouvre le sol en (x, z). */
  isWet(x: number, z: number): boolean;
  /** Emprise de la carte (m) ; null sans partie. */
  bounds(): { minX: number; minZ: number; maxX: number; maxZ: number } | null;
}

/** Économie en LECTURE SEULE (copies : aucun montant ne peut être modifié par un module). */
export interface PluginEconomy {
  readonly money: number;
  readonly taxRates: Readonly<Record<TaxSector, number>>;
  /** Dernier bilan mensuel clos (copie ; undefined avant le premier mois). */
  lastMonth(): MonthRecord | undefined;
}

/**
 * Façade de la simulation passée à chaque crochet. Lecture seule, minimale et typée : les modules
 * ne reçoivent aucun objet interne mutable de la simulation (économie, planificateur, PRNG de base…).
 * Besoin d'un accès supplémentaire → demande dans docs/requests/<module>.md.
 */
export interface PluginContext {
  /** Identifiant du module à qui ce contexte est confié. */
  readonly pluginId: string;
  readonly clock: PluginClock;
  /** Paramètres de la partie en cours (null avant la première partie). */
  readonly params: Readonly<NewGameParams> | null;
  /** Vrai quand une partie est en cours (terrain généré). */
  readonly inGame: boolean;
  readonly catalog: AssetCatalog | null;
  getAsset(id: string): CatalogAsset | undefined;
  readonly terrain: PluginTerrain;
  /** Réseau routier courant (l'objet change à chaque nouvelle partie : ne pas le conserver d'un crochet à l'autre). */
  readonly roads: PluginRoads;
  readonly buildings: PluginBuildings;
  readonly demography: PluginDemography | null;
  /** Économie en lecture seule (bilan mensuel : `onMonthStart` est appelé après `Economy.onMonth`). */
  readonly economy: PluginEconomy;
  /** Vitesse de simulation courante (0 = pause). */
  readonly speed: number;
  /**
   * PRNG PROPRE au module (sfc32), réinitialisé à chaque nouvelle partie depuis la graine de la partie et
   * l'identifiant du module, enregistré avec sa section de sauvegarde. Il n'influence jamais le PRNG de base :
   * ajouter un module ne change pas la simulation existante.
   */
  readonly rng: Rng;
  /** Notification joueur (bandeau de l'interface, via le rapport périodique). */
  notify(level: SimNotice['level'], message: string): void;
  /**
   * Services inter-modules : un module publie une API (ex. la circulation publie l'état des feux pour les
   * piétons) ; un autre la consulte. `use` renvoie undefined si le service n'existe pas (module absent) :
   * l'appelant doit prévoir un repli.
   */
  provide<T>(name: string, api: T): void;
  use<T>(name: string): T | undefined;
}

/** Module de simulation (tous les crochets sont facultatifs : un module vide est sans effet). */
export interface SimPlugin {
  /** Identifiant stable (clé de `delta.ext`, `snapshot.ext`, `save.plugins`, `pluginCommand.plugin`). */
  readonly id: string;
  init?(ctx: PluginContext): void;
  onNewGame?(ctx: PluginContext): void;
  onTick?(ctx: PluginContext, minutes: number): void;
  onDayStart?(ctx: PluginContext): void;
  onMonthStart?(ctx: PluginContext): void;
  takeDelta?(ctx: PluginContext): unknown | undefined;
  snapshot?(ctx: PluginContext): unknown | undefined;
  command?(ctx: PluginContext, name: string, payload: unknown): PluginCommandResult;
  save?(ctx: PluginContext): unknown;
  load?(ctx: PluginContext, data: unknown, version: number): void;
  /** Version de la section de sauvegarde écrite par `save` (défaut 1). */
  readonly saveVersion?: number;
}

/** Section de sauvegarde d'un module : version, données JSON, état du PRNG du module. */
export interface PluginSaveSection {
  v: number;
  data: unknown;
  rng?: number[];
}

/** Champ facultatif ajouté au fichier de sauvegarde (absent des anciennes sauvegardes et quand aucun module n'écrit). */
export interface PluginSaveField {
  plugins?: Record<string, PluginSaveSection>;
}

/** Erreur attrapée dans un crochet de module (diagnostic, tests). */
export interface PluginErrorRecord {
  plugin: string;
  hook: string;
  message: string;
  count: number;
}
