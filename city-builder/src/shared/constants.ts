/**
 * Constantes partagées simulation / rendu.
 * AUCUN import de three ni du DOM ici (portable vers Unity/Unreal).
 * Unités : 1 unité monde = 1 mètre. Axe Y vertical. Le plan du sol est XZ.
 */

/** Nom original du jeu (fixé par l'architecte). */
export const GAME_NAME = 'Aube Urbaine';
export const GAME_VERSION = '0.1.0';

/** Taille d'une case de la grille de simulation (mètres). */
export const TILE_SIZE = 8;
/** Nombre de cases par côté d'un chunk de terrain. */
export const CHUNK_TILES = 32;
/** Taille d'un chunk en mètres. */
export const CHUNK_SIZE = TILE_SIZE * CHUNK_TILES; // 256 m
/** Taille par défaut de la carte, en chunks par côté. */
export const DEFAULT_MAP_CHUNKS = 8; // 8 x 256 m = 2 048 m
/** Résolution de la carte de hauteurs : un échantillon par coin de case. */
export const HEIGHT_SAMPLES_PER_TILE = 1;
/** Niveau de l'eau (mètres). */
export const WATER_LEVEL = 2;
/** Hauteur maximale du relief généré (mètres). */
export const MAX_TERRAIN_HEIGHT = 60;

/** Fréquence de la simulation (ticks par seconde à vitesse x1). */
export const SIM_TICKS_PER_SECOND = 10;
/** Minutes de jeu écoulées par tick à vitesse x1. */
export const GAME_MINUTES_PER_TICK = 2;
/** Vitesses de simulation autorisées (0 = pause). */
export const SIM_SPEEDS = [0, 1, 2, 4] as const;
export type SimSpeed = (typeof SIM_SPEEDS)[number];

/** Pente maximale (dénivelé / distance horizontale) acceptée sous l'empreinte d'un bâtiment. */
export const MAX_BUILDING_SLOPE = 0.25;
/** Pente maximale acceptée pour une route. */
export const MAX_ROAD_SLOPE = 0.12;

/** Argent de départ par défaut (en « crédits », monnaie fictive du jeu). */
export const DEFAULT_START_MONEY = 500_000;

/** Version du format de sauvegarde (incrémenter à chaque changement incompatible). */
export const SAVE_FORMAT_VERSION = 2;
/** Version du protocole de messages main <-> worker. */
export const PROTOCOL_VERSION = 1;
/** Version du schéma du catalogue d'assets. */
export const CATALOG_SCHEMA_VERSION = 1;

/** Capacités initiales des tableaux SoA (agrandis par doublement). */
export const INITIAL_BUILDING_CAPACITY = 1024;
export const INITIAL_VEHICLE_CAPACITY = 2048;
export const INITIAL_ROAD_NODE_CAPACITY = 1024;
export const INITIAL_ROAD_EDGE_CAPACITY = 1024;

/** Nombre de floats par véhicule dans le buffer de positions transféré : x, y, z, cap (rad). */
export const VEHICLE_STRIDE = 4;
