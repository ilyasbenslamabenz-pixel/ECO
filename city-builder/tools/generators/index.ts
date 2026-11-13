/**
 * Registre des générateurs d'assets procéduraux (exportés en GLB par nos propres outils).
 * Chaque générateur écrit ses GLB sous assets/** et renvoie les entrées de catalogue correspondantes
 * (licence CC0, source = fichier générateur exact). Les jeux de textures sont dédoublonnés par id par le pipeline.
 *
 * Enregistrés par l'intégration (demandes docs/requests/{buildings-residential,buildings-other,vehicules-trafic,terrain}.md).
 */
import type { CatalogAsset, TextureSet } from '../../src/shared/catalog';
import { generateResidential } from '../buildings/residential/index';
import { generateNonResidential } from '../buildings/nonresidential/index';
import { generateVehicles } from '../vehicles/build';
import { environmentGenerator } from './environment';
import { generateTransport } from '../transport/build';

export interface GeneratorOutput {
  assets: CatalogAsset[];
  textureSets: TextureSet[];
}

export type Generator = (ctx: { assetsDir: string }) => Promise<GeneratorOutput>;

/** Liste ordonnée des générateurs. */
export const GENERATORS: { name: string; run: Generator }[] = [
  { name: 'Bâtiments résidentiels (kit, 17 modèles)', run: (ctx) => generateResidential(ctx) },
  { name: 'Bâtiments non résidentiels (kit, 23 modèles)', run: (ctx) => generateNonResidential(ctx) },
  { name: 'Véhicules (15 modèles, LOD0/1/2)', run: (ctx) => generateVehicles(ctx) },
  { name: 'Environnement (arbres procéduraux, rochers, fleurs, fontaine)', run: environmentGenerator },
  // Port et aéroport (35 modèles) ; entrées de construction des pôles : tools/transport/catalog.ts (module hubs).
  { name: 'Transport : port et aéroport (35 modèles, LOD0/1/2)', run: (ctx) => generateTransport(ctx) },
];
