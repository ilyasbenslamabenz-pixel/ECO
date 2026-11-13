/** Définition d'un modèle transport (port / aéroport) pour le générateur. */
import type { AssetCategory, FrontagePoint } from '../../src/shared/catalog';
import type { MatKey } from './materials';
import type { TModel } from './mesh';

export interface TransportDef {
  id: string;
  nameFr: string;
  group: 'port' | 'aeroport';
  /** Catégorie PROVISOIRE (la catégorie `transport` est demandée : docs/requests/assets-transport.md). */
  category: AssetCategory;
  /** Type fin (tag `type:<kind>`), ex. grue, navire, conteneur, quai, piste, avion, terminal. */
  kind: string;
  lodDistances: [number, number];
  build(m: TModel): void;
  /**
   * 'sol' : base à y = 0 ; 'flottaison' : y = 0 = ligne de flottaison (coque immergée jusqu'à −tirant d'eau) ;
   * 'niveau' : y = 0 = niveau fini (dessus du quai), la structure descend jusqu'à −3 m.
   */
  origin?: 'sol' | 'flottaison' | 'niveau';
  /** Tirant d'eau (m) des navires. */
  draftM?: number;
  variants?: { id: string; nameFr: string; overrides: Partial<Record<MatKey, string>> }[];
  footprint?: { tilesX: number; tilesZ: number };
  cost?: number;
  upkeepPerMonth?: number;
  capacity?: { residents: number; jobs: number };
  frontage?: FrontagePoint[];
  vehicle?: { kind: 'car' | 'van' | 'bus' | 'truck' | 'service'; maxSpeedKmh: number };
  tags?: string[];
}
