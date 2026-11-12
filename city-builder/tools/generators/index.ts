/**
 * Registre des générateurs d'assets procéduraux (exportés en GLB par nos propres outils).
 * PROPRIÉTAIRE : agent assets. Chaque générateur écrit ses GLB dans assets/models/**
 * et renvoie les entrées de catalogue correspondantes (licence CC0, source = fichier générateur).
 *
 * Fondation : aucun générateur n'est encore enregistré (la bibliothèque de 30+ bâtiments
 * est le livrable de l'agent assets en phase 1). Aucun modèle factice n'est produit ici.
 */
import type { CatalogAsset, TextureSet } from '../../src/shared/catalog';

export interface GeneratorOutput {
  assets: CatalogAsset[];
  textureSets: TextureSet[];
}

export type Generator = (ctx: { assetsDir: string }) => Promise<GeneratorOutput>;

/** Liste ordonnée des générateurs. */
export const GENERATORS: { name: string; run: Generator }[] = [];
