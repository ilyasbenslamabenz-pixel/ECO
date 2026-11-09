// Bibliothèque de modèles Blender (modelLibrary.ts) branchée sur la ville : chargement unique et asynchrone,
// diffusion aux systèmes (circulation, mobilier urbain, avions et navires, portiques) qui gardent leurs
// modèles procéduraux tant que la bibliothèque n'est pas prête, ou pour tout modèle absent (GLB manquant).
// Les feux des modèles (phares, feux arrière, lanternes, vitrages) suivent la nuit et l'heure dorée.
import type { Scene } from '@babylonjs/core';
import { loadModelLibrary, type ModelLibrary, type ModelTemplate } from './modelLibrary';
import { ENV } from './terrain';

let lib: ModelLibrary | null = null;
let pending: ((l: ModelLibrary) => void)[] = [];
let token = 0;

/** Appelle `cb` dès que la bibliothèque est chargée (immédiatement si elle l'est déjà). */
export function whenModels(cb: (l: ModelLibrary) => void) {
  if (lib) cb(lib);
  else pending.push(cb);
}

/** Gabarit `id` s'il a été chargé. */
export function modelTemplate(id: string): ModelTemplate | undefined {
  return lib?.get(id);
}

/**
 * Niveau d'allumage des feux des modèles : pleine nuit = 1 ; phares et réverbères s'allument déjà
 * à l'heure dorée (soleil bas), à mi-intensité.
 */
export function lightsLevel(): number {
  const elev = Math.sin((ENV.time - 0.25) * Math.PI * 2);
  const dusk = Math.max(0, Math.min(1, (0.22 - elev) / 0.22)) * 0.55;
  return Math.max(ENV.night, dusk);
}

/** Lance le chargement (une fois par scène). Ne bloque pas l'affichage : les systèmes s'abonnent avec whenModels. */
export function startCityModels(scene: Scene) {
  const my = ++token;
  lib = null;
  pending = [];
  loadModelLibrary(scene)
    .then((l) => {
      if (my !== token || scene.isDisposed) { l.dispose(); return; }
      if (l.errors.size) console.warn('[modèles] repli procédural pour', Object.fromEntries(l.errors));
      lib = l;
      let last = -1;
      const obs = scene.onBeforeRenderObservable.add(() => {
        const v = lightsLevel();
        if (Math.abs(v - last) > 0.01) {
          last = v;
          l.setNightLevel(v);
          // au crépuscule, les faces émissives (dessinées par-dessus le corps) gardent une teinte de jour
          // au lieu de virer au noir tant que l'émission est faible
          const base = Math.max(0, 0.75 - v);
          l.lightsMaterial.diffuseColor.set(base, base, base);
        }
      });
      scene.onDisposeObservable.addOnce(() => { scene.onBeforeRenderObservable.remove(obs); if (lib === l) lib = null; });
      const cbs = pending;
      pending = [];
      for (const cb of cbs) {
        try { cb(l); } catch (e) { console.warn('[modèles] intégration impossible, repli procédural', e); }
      }
    })
    .catch((e) => console.warn('[modèles] bibliothèque indisponible, modèles procéduraux conservés', e));
}
