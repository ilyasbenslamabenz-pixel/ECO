# FEATURES — état réel des fonctionnalités

Règle : une ligne n'est marquée **Terminé** que si une preuve automatisée ou une vérification
documentée existe (colonne « Preuve »). Tout le reste est « À faire » avec sa phase.
Dernière mise à jour : fondations (architecte), 2026-11-12.

## Terminé (vérifié)

| Fonctionnalité | Preuve |
|---|---|
| Build `dist/index.html` (page complète, `lang="fr"`) + `dist/artifact.html` (fragment commençant par `<title>` et `<meta viewport>`) + `game.js` + `sim.worker.js` + `assets/` | `npm run build` ; contrôle budget 60 Mo / 15 Mo par fichier intégré au build |
| Simulation dans un Web Worker, séparée du rendu (aucun import three/DOM dans `src/sim`, `src/shared`) | `tests/unit/architecture.test.ts` ; `npm run e2e` (message `ready`, instantané, deltas) |
| Protocole typé avec réponses ok/erreur, validation des arguments côté worker, Transferables (carte de hauteurs, trames véhicules) | `tests/unit/shared.test.ts` (validation, transferables), `tests/unit/sim.test.ts` (handler) |
| Stockage ECS en structure-de-tableaux (bâtiments, graphe routier, véhicules), croissance sans réallocation dans les ticks | `tests/unit/sim.test.ts` « ECS » |
| Terrain déterministe partagé sim/rendu (relief, plaine centrale, rivière), rendu par chunks avec normales continues | `tests/unit/shared.test.ts` « terrain » ; captures `tests/e2e/out/smoke-*.png` |
| Commande `placeBuilding` : grille 8 m, rotation 1/4 de tour, collisions bâtiments/routes, pente, eau, limites, fonds, coût débité, `dryRun` | `tests/unit/sim.test.ts` (placement ×4) |
| Commande `buildRoad` / `removeRoad` : coût au mètre, pente ≤ 12 %, eau refusée (ponts phase 3), collision bâtiments, raccord aux nœuds existants, remboursement 25 % | `tests/unit/sim.test.ts` « routes » |
| `demolish` (libère la grille, remboursement 25 %, entretien retiré) | `tests/unit/sim.test.ts` « démolition » |
| Horloge (calendrier 12×30 j), vitesses 0/1/2/4, entretien mensuel prélevé | `tests/unit/sim.test.ts` « horloge et économie » ; e2e « l'horloge avance » |
| Sauvegarde/chargement JSON versionné (aller-retour identique, refus de version inconnue) ; bouton Sauvegarder (localStorage) + Continuer au menu | `tests/unit/sim.test.ts` « sauvegarde » ; boutons câblés dans `main.ts` (pas encore de test e2e du bouton) |
| Pathfinding A* (temps de parcours selon type de voie) | `tests/unit/sim.test.ts` « pathfinding » |
| Caméra aérienne (déplacer/pivoter/incliner/zoom souris, clavier ZQSD/WASD + A/E + R/F, tactile 1-2 doigts) et caméra rue (hauteur 1,70 m), bascule bouton + touche V | e2e : bascule par bouton et touche V, captures `smoke-*-rue.png` / `smoke-*-aerien.png` ; **tactile non testé sur iPhone réel** |
| Interface française, thème sombre, menu principal, barre d'état (date, budget, bilan, habitants), outils futurs désactivés avec « Phase N » | captures e2e ; `src/ui/markup.html` |
| Bibliothèque d'assets : chargement GLB (GLTFLoader) avec cache et dédoublonnage ; rendu des bâtiments par `InstancedMesh` | code `src/render/assets.ts`, `buildings.ts` ; **non exercé en jeu faute d'assets** |
| Porte de validation visuelle (`npm run validate:visual`) : chargement réel, triangles/boîte/dimensions, textures décodées + normalMap, vignettes, planche-contact, captures démo | `npm run e2e:gate` prouve qu'elle rejette un cube et un modèle non texturé et accepte un modèle détaillé texturé (`tests/e2e/out/gate-selftest.png`) |
| Pipeline d'assets (`npm run assets`) et validation Node (`npm run validate:assets`) | exécutés ; échouent honnêtement tant que la bibliothèque est vide |

## À faire

| Fonctionnalité | Phase | Responsable |
|---|---|---|
| **Bibliothèque ≥ 30 bâtiments différents** (9 catégories), véhicules, arbres, végétation, mobilier, textures PBR Poly Haven, variantes, LOD | 1 | assets |
| **Scène de démonstration** (`?demo` + bouton menu, actuellement désactivé « Phase 1 ») | 1 | intégration |
| `npm run validate:visual` vert (aujourd'hui : ÉCHEC — 0 bâtiment, démo absente) | 1 | QA + tous |
| Terrain texturé PBR (splatting), HDRI Poly Haven, eau animée, forêts | 1 | terrain/environnement |
| Routes : trottoirs, marquages, carrefours, textures (actuel : ruban d'asphalte uni) | 1 | routes |
| Bâtiments : LOD par distance, variantes, culling par chunk | 1 | bâtiments |
| Outils routes / bâtiments / démolition dans l'interface (actuellement désactivés) | 1 | construction/UI |
| Index spatial (collisions O(n) aujourd'hui), accès route des bâtiments | 1-2 | simulation |
| Démographie (population = 0 tant que non implémentée), impôts, demande RCI, budget détaillé | 2 | simulation |
| Terraformation (commande renvoie NOT_IMPLEMENTED phase 2) | 2 | simulation + UI |
| Trafic : véhicules simulés et rendus (aucun véhicule aujourd'hui), ponts | 3 | véhicules/trafic |
| Streaming des assets / chunks par proximité caméra | 1-2 | intégration |
| Mesures de performance sur GPU réel (10 000 bâtiments) | 2 | QA |
| Test tactile sur iPhone réel | 1 | construction/UI |
| HUD compact sur iPhone (aujourd'hui il occupe ~20 % de la hauteur en portrait, capture `tests/e2e/out/iphone.png`) | 1 | construction/UI |
