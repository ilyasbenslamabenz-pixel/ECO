# Zonage (phase 2B) — état et reste à faire

Documentation du module : `docs/ZONAGE.md`. Captures : `docs/captures-zonage/`.

## Livré
- Parcours `npm run e2e:zonage` entièrement vert (bureau + peinture au doigt sur iPhone).
- Outil Zones (souris et doigt), 6 types, Retirer, profondeur 1–4 cases, croissance oui/pause, jauge R/C/B/I.
- Superposition par instanciation + shader, visible seulement avec l'outil (mode allégé iPhone compris).
- Croissance façade vers la route (règle de l'outil de pose), chantiers ouverts automatiquement, demande par secteur.
- Densification des quartiers valorisés (niveaux 1→2→3, même zone, même façade).
- Section de sauvegarde v1 + migration ; anciennes sauvegardes chargées (tests `tests/zonage/save.test.ts`).
- API d'écriture minimale du cœur : `PluginContext.development` (promotion privée sans coût).

## Demandes au superviseur / API du cœur
1. `PluginContext.development` (place / demolish privés) ajouté dans `src/sim/plugins/types.ts`, `host.ts`, `world.ts`
   (`placePrivateBuilding`, `demolishPrivateBuilding`) : à valider comme API commune.
2. Points d'extension UI ajoutés : `DrawerProvider` (`src/ui/buildbar.ts`) et `ToolController.setPointerOverride`
   (`src/input/tools.ts`).

## Reste à faire
- iPhone : le bouton provisoire « ⚡ Énergie » (module électricité) recouvre la droite de l'en-tête du tiroir Zones
  (jauge partiellement masquée) — à arbitrer lors de la refonte du montage des panneaux.
- Lots arrière : remplir la 3e / 4e rangée derrière les petites maisons.
- Brancher la demande sur l'économie (service `zonage:demande`) et la valeur de quartier sur la grille municipale `valeur_fonciere`.
- Abandon / dé-densification (logements vides durablement, pollution).
- Zones agricole et spéciales (tuiles encore grisées).
- Commerces : peu de croissance quand les immeubles denses à rez-de-chaussée commercial couvrent déjà la demande C (réglage à affiner).
