import type { Mesh } from '@babylonjs/core';

/**
 * Fixe le nombre d'instances fines dessinées d'un gabarit. Avec 0 instance, Babylon considère que le
 * maillage n'a plus d'instances fines (`hasThinInstances` faux) et dessine la géométrie du gabarit
 * elle-même, à sa matrice monde (l'origine) : un gabarit unitaire (1 unité = 1 km) apparaît alors
 * comme un objet géant près du point (0, 0). On masque donc le gabarit tant qu'il n'a rien à dessiner.
 * (`isVisible` plutôt que `setEnabled`, que d'autres modules utilisent déjà pour l'alternance jour/nuit.)
 */
export function setThinCount(mesh: Mesh, n: number) {
  mesh.thinInstanceCount = n;
  mesh.isVisible = n > 0;
}
