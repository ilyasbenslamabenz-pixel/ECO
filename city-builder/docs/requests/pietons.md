# Demandes du module Piétons (p2a-pietons) hors de sa propriété

1. **Interface (§1bis) — compteur et panneau.** `src/ui/panels/pietons.ts` implémente `mount` (compteur, détail par
   état et motif, feux, coût par tick, réglages actif / plafond) mais rien ne monte encore les panneaux du registre.
   En attendant, le rendu (`src/render/plugins/pietons.ts`) ajoute une pastille `#hud-pietons` au groupe
   `#hud .hud-group.stats`. À l'intégration : monter le panneau, déplacer la pastille dans `markup.html` / `hud.ts`
   (style `.pill-pietons`, masquée sur iPhone portrait si la barre déborde) et retirer l'injection DOM du rendu.
2. **Circulation — service `feux`.** Les piétons consomment `ctx.use('feux')` (adaptateur `src/sim/pedestrians/feux.ts`,
   forme attendue documentée dans ce fichier). Sans lui : traversée prudente partout (`stats.feux = false`).
3. **Circulation — service `trafic`** (créneaux entre véhicules sur un tronçon, pour les passages non régulés) :
   sans lui les piétons ne « voient » pas les voitures. Forme attendue : voir `src/sim/pedestrians/feux.ts`.
   Réciproquement, le module publie `ctx.provide('pietons', …)` (occupation des passages) pour que les véhicules
   cèdent le passage.
4. **Tests communs (`tests/plugins/plugins.test.ts`).** L'assertion « registres vides » compare `Object.keys(plugin)`
   à `['id']` ; les modules piétons (simulation et rendu) sont des classes, l'assertion passe mais ne vérifie plus rien
   pour eux. À revoir à l'intégration (de même que le faux positif `../save-sections` du garde-fou d'architecture).
5. **Porte visuelle / banc de captures.** Ajouter une vue « piétons » au banc commun (`tests/e2e/captures.mjs`) ;
   le module fournit en attendant `tests/pietons/capture.mjs` et le diagnostic `window.__pietons`.
