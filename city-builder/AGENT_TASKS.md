# Répartition du travail entre agents

Règle d'or : **chaque agent ne modifie que ses fichiers possédés**. Un besoin de changement
ailleurs passe par une demande au propriétaire (ou à l'architecte pour `src/shared/**`).
Aucune commande git. Avant de rendre la main : `npm run typecheck && npm test && npm run build && npm run e2e`
doivent passer, et FEATURES.md doit refléter la réalité (preuve pour chaque « terminé »).

## Contrats (propriétaire : ARCHITECTE)
`src/shared/**` (constants, math, catalog, contracts, protocol, terrain-gen), `tsconfig.json`,
`package.json` (dépendances), `docs/ARCHITECTURE.md`. Toute évolution de contrat est
rétro-compatible ou accompagnée d'une hausse de version (`PROTOCOL_VERSION`, `SAVE_FORMAT_VERSION`,
`CATALOG_SCHEMA_VERSION`).

## 1. Agent ASSETS (bibliothèque 3D) — priorité client n°1
Possède : `tools/generators/**`, `tools/polyhaven.ts`, `tools/lib/**` (hors `glb-inspect.ts` partagé en lecture),
`assets/models/**`, `assets/textures/**` (hors terrain), `assets/LICENSES.md`, `docs/ASSET_PIPELINE.md`.
`assets/catalog.json` n'est **jamais** édité à la main : il est produit par `npm run assets`.
Livrables phase 1 :
- ≥ 30 bâtiments **différents** (silhouettes distinctes) : maisons individuelles (≥ 6 styles),
  mitoyennes (≥ 3), petits/moyens/haute densité résidentiels (≥ 6), gratte-ciel (≥ 3),
  commerces (≥ 4), industriels (≥ 4), publics (≥ 4 : mairie, école, hôpital, caserne…).
- Véhicules (≥ 6 : citadine, berline, utilitaire, bus, camion, véhicule de service),
  arbres (≥ 5 essences), végétation (≥ 3), mobilier urbain (≥ 8 : lampadaire, banc, abribus, poubelle, feu, borne…).
- Textures PBR Poly Haven (albedo + normal + ARM) ; ≥ 1 variante par bâtiment ; 2-3 LOD par modèle.
- `npm run validate:assets` vert.

## 2. Agent TERRAIN / ENVIRONNEMENT
Possède : `src/render/terrain.ts`, `src/render/water.ts`, `src/render/environment.ts`,
`src/render/vegetation.ts` (à créer : semis d'arbres hors ville, instancié), `assets/hdri/**`,
`assets/textures/terrain_*/**`, `tools/generators/environment.ts`.
Livrables phase 1 : splatting PBR (herbe/terre/roche/sable Poly Haven), HDRI Poly Haven pour
réflexions + ciel, eau animée (normales), ombres cadrées sur la vue, forêts instanciées, LOD de chunks.

## 3. Agent ROUTES
Possède : `src/render/roads.ts` (+ `src/render/roads/**`).
Livrables phase 1 : maillage de chaussée + trottoirs + bordures, marquages, carrefours
(nœuds de degré ≥ 3), raccords aux terrains, textures asphalte PBR, lampadaires instanciés
le long des voies (assets du catalogue). Lit les deltas `roadNodesAdded/roadEdgesAdded/roadEdgesRemoved`.

## 4. Agent BÂTIMENTS (rendu)
Possède : `src/render/buildings.ts` (+ `src/render/buildings/**`).
Livrables phase 1 : LOD par distance (bascule d'instances entre lots LOD0/1/2), variantes
(couleur d'instance, jeux de textures, échelle verticale), culling par chunk, fondations
sous les bâtiments en pente, animation de construction. `update()` sans allocation.

## 5. Agent VÉHICULES / TRAFIC
Possède : `src/sim/traffic.ts`, `src/sim/pathfinding.ts`, `src/render/vehicles.ts`.
Livrables phase 3 (préparation phase 1 : rendu instancié des véhicules de la démo) :
trajets domicile-travail via A*, files sur voies, carrefours, interpolation des trames côté rendu.

## 6. Agent CONSTRUCTION / CAMÉRA / UI
Possède : `src/input/**`, `src/ui/**`, `src/client/state.ts`.
Livrables phase 1 : outils route (tracé, aperçu avec `dryRun`, coût), placement de bâtiment
(catalogue illustré par vignettes, rotation, aperçu vert/rouge selon la réponse du worker),
démolition, sélection/inspection ; caméra rue améliorée (collisions bâtiments) ; ergonomie iPhone.

## 7. Agent SIMULATION / ÉCONOMIE / DÉMOGRAPHIE / SAUVEGARDE
Possède : `src/sim/{world,ecs,clock,economy,demography,handler,worker}.ts`, `src/save/**`.
Livrables : phase 1 — index spatial par chunk, accès route des bâtiments (frontage) ;
phase 2 — démographie (emménagements, emplois), impôts, demande RCI, budget détaillé,
terraformation (avec carte de hauteurs dans la sauvegarde → `SAVE_FORMAT_VERSION` 2).

## 8. Agent INTÉGRATION
Possède : `src/main.ts`, `src/render/index.ts`, `src/render/scene.ts`, `src/render/assets.ts`,
`src/render/demo.ts` (à créer), `src/client/sim-bridge.ts`, `scripts/build.mjs`.
Livrables phase 1 : **scène de démonstration** (`?demo` + bouton du menu) : ville construite
via de vraies commandes worker montrant toute la bibliothèque, caméra aérienne (survol) et rue,
bascule bouton + touche V ; `window.__aube.demoReady = true` quand tous les modèles visibles sont chargés.
Streaming des assets par proximité caméra.

## 9. Agent QA
Possède : `tests/**`, `src/render/validation.ts`, `tools/validate-models.ts`, `FEATURES.md`, `PROJECT_STATUS.md`.
Livrables : porte `npm run validate:visual` tenue à jour, **lecture effective des captures**
(planche-contact, démo aérienne, démo rue), tests unitaires des modules, FEATURES.md exact.

## Critères de validation de la PHASE 1 (tous requis)
1. `npm run typecheck`, `npm test`, `npm run build`, `npm run e2e` verts.
2. `npm run validate:assets` vert : ≥ 30 bâtiments différents couvrant les 9 catégories,
   véhicules, arbres, mobilier ; aucun échec de seuil/texture.
3. `npm run validate:visual` vert ; planche-contact et captures démo **regardées** et jugées
   sans cube/placeholder (compte rendu écrit dans PROJECT_STATUS.md).
4. Scène de démo accessible par le menu et `?demo`, deux caméras basculables (bouton + V).
5. En partie : tracer des routes, poser/démolir des bâtiments du catalogue, coûts débités,
   refus expliqués (collision, pente, eau, fonds), sauvegarde/chargement aller-retour.
6. dist ≤ 60 Mo, aucun fichier > 15 Mo, `index.html` et `artifact.html` fonctionnels.
7. Aucun bouton sans action ; fonctions futures désactivées avec « Phase N ».
