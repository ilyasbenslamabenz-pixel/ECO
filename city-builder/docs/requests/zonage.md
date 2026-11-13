# Zonage (phase 2B) — état et reste à faire

Documentation du module : `docs/ZONAGE.md`. Captures : `docs/captures-zonage/`.

## Livré
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
- Parcours e2e `npm run e2e:zonage` : vert sur bureau (peinture souris, retrait, jauge, croissance en jeu, densification,
  sauvegarde) ; le passage tactile iPhone a été corrigé (trait limité à l'écran) et doit être revalidé de bout en bout.
- Lots arrière : remplir la 3e / 4e rangée derrière les petites maisons.
- Brancher la demande sur l'économie (service `zonage:demande`) et la valeur de quartier sur la grille municipale `valeur_fonciere`.
- Abandon / dé-densification (logements vides durablement, pollution).
- Zones agricole et spéciales (tuiles encore grisées).
- Commerces : peu de croissance quand les immeubles denses à rez-de-chaussée commercial couvrent déjà la demande C (réglage à affiner).
