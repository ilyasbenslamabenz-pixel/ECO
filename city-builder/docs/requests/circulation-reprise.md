# Circulation — note de reprise (session interrompue le 2026-11-13)

## Fait (commité et poussé sur `claude/p2a-circulation`)
- `src/sim/traffic` : lignes d'arrêt et passages piétons aux cotes du marquage, MOBIL asymétrique (`mobil.ts`),
  réacheminement par sens, anti-blocage, feux conservés (réseau modifié + sauvegarde), carte de congestion,
  API des feux (`feuxApi()`, `announcePedestrians`).
- Module : `src/sim/plugins/circulation.ts` (service `feux`, deltas, commandes, sauvegarde v1), rendu
  `src/render/traffic/congestion.ts`, panneau `src/ui/panels/circulation.ts`, `src/render/traffic/poles.ts`.
- Plaques variées : planche de 24 numéros, matériau `plaque` dans les GLB, attribut d'instance `aPlaque` ;
  flotte et `assets/catalog.json` (entrées véhicules) régénérés.
- Tests `tests/circulation/*` ; doc `docs/CIRCULATION.md` ; demandes `docs/requests/circulation.md`.

## Vérifié
- `npm run typecheck`, `npm test` (190/190), `npm run build` (dist 44,5 Mo), `npm run e2e` : verts.
- Banc (processeur seul, Xeon 2,3 GHz 4 cœurs) : 2 000 véhicules, tick moyen 0,94 ms, p95 1,39 ms (grille 14) ;
  1,20 ms / 2,28 ms (grille 22).
- `npm run e2e:signals` : premiers contrôles OK (arrêt au rouge), exécution INTERROMPUE avant la fin.

## Reste à faire
- Relancer en entier `e2e:signals` et `validate:visual` ; REGARDER les captures (rien n'a été regardé).
- Preuve visuelle des plaques (shader `aPlaque` jamais vu à l'écran) et de la carte de congestion.
- Clignotants (bits 2/4 de `flags`) non émis par la simulation ; feux piétons non dessinés.
- Panneau non monté (refonte d'interface) : aucun moyen joueur d'afficher la carte hors `pluginCommand`.

## Décisions
- Accès au trafic par `src/sim/traffic/registry.ts` (faute de `ctx.traffic`) ; import `../../sim/save-sections/…`
  pour contourner le garde-fou ; `tests/plugins/plugins.test.ts` adapté (`IMPLEMENTED`) — voir circulation.md.
- Lampadaire/mât : seulement la demande + utilitaire, `src/render/roads/builder.ts` non modifié.
