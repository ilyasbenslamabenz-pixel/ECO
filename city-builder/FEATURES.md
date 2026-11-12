# FEATURES — état réel des fonctionnalités d'« Aube Urbaine »

Règle : une ligne n'est marquée **Terminé** que si une preuve automatisée ou une vérification documentée existe
(colonne « Preuve »). Ce qui fonctionne seulement en partie est dans « Partiel », avec la limite exacte.
Tout le reste est « À faire » avec sa phase. Dernière mise à jour : intégration phase 1 (directeur technique), 2026-11-12.

Commandes de preuve : `npm run typecheck`, `npm test` (unitaires + intégration), `npm run test:assets`,
`npm run build`, `npm run e2e`, `npm run e2e:game`, `npm run validate:visual`, `npm run stress`, `npm run assets`.
Les captures citées sont dans `tests/e2e/out/` et ont été regardées.

## Terminé (vérifié)

### Bibliothèque d'assets 3D (priorité client)
| Fonctionnalité | Preuve |
|---|---|
| **40 bâtiments différents** (silhouettes et hauteurs toutes distinctes, 7 à 233 m) : 7 maisons individuelles de styles variés, 2 rangées de maisons mitoyennes, 2 petits immeubles, 2 immeubles moyens avec commerces, 4 immeubles haute densité, 3 gratte-ciel, 6 commerces (dont bureaux), 5 bâtiments industriels, 9 équipements publics (dont un parc) | `tests/integration/integration.test.ts` « catalogue fusionné » (40 bâtiments, 9 familles, dimensions toutes différentes) ; `tests/buildings/*.test.ts`, `tests/buildings-other/*.test.ts` (102 tests, `npm run test:assets`) ; planche `tests/e2e/out/planche-contact.png` |
| Chaque bâtiment : 3 LOD (triangles strictement décroissants), 3 ou 4 variantes (textures, teintes, hauteur), métadonnées (coût, entretien, habitants, emplois, accès) | `npm run assets` (validateur : LOD, bornes, licences) ; tests des modules bâtiments |
| 15 véhicules GLB (citadine, berline, break, SUV, coupé, monospace, pick-up, taxi, police, utilitaire, ambulance, camion, bus, pompiers, benne), 3 LOD, 2 à 6 peintures | validateur `npm run assets` ; `tests/vehicles/traffic.test.ts` ; planche-contact |
| Végétation et décor : 6 essences d'arbres (4 Poly Haven + épicéa et peuplier générés), arbustes, fleurs, rochers, 12 éléments de mobilier urbain (lampadaire, banc, poubelle, borne incendie, table, terrasse, poteaux, armoires…), fontaine générée | validateur ; planche-contact ; démo (square, parc) |
| Textures PBR (albedo, normale, ARM) : 39 jeux Poly Haven CC0 + textures générées (véhicules, arbres) ; 2 HDRI ; aucune autre source externe ; licence et source de chaque asset dans `assets/LICENSES.md` | `npm run assets` (« Validation du pipeline : OK », contrôle des licences et des sources autorisées) |
| Catalogue fusionné automatiquement par `npm run assets` (4 générateurs enregistrés : résidentiel, non résidentiel, véhicules, environnement) — 88 assets | `tools/generators/index.ts` ; sortie du pipeline (POLYHAVEN_OFFLINE=1) |
| Porte de validation visuelle `npm run validate:visual` : chaque asset réellement chargé dans Chromium (GLB compressés comme en production), triangles ≥ seuil, boîte non triviale, pas de boîte-placeholder, textures décodées + normal maps, couverture de pixels ; planche-contact ; démo : tous les bâtiments posés, chargements sans erreur, véhicules, végétation, décor, captures aérienne et rue non vides et différentes | `tests/e2e/validate-visual.mjs` ; résultat de la dernière exécution dans `PROJECT_STATUS.md` ; `npm run e2e:gate` (la porte rejette un cube et un modèle non texturé) |

### Scène de démonstration
| Fonctionnalité | Preuve |
|---|---|
| Accessible par le menu (« Scène de démonstration ») et par `?demo` | `tests/e2e/validate-visual.mjs` (`?demo`) ; bouton activé dans `src/ui/hud.ts` via `onDemo` |
| Ville construite **par la simulation avec les opérations du joueur** (`buildCity` : `buildRoad` / `placeBuilding`, toutes validations) : ~119 bâtiments, **les 40 modèles** au moins une fois avec variantes, 42 tronçons (boulevard, avenues, rues, rue piétonne, sens unique, routes courbes, ponts), quartiers (affaires, collectif, pavillons, activités), habitants installés, ~140 véhicules réels au départ | `tests/integration/integration.test.ts` « ville de démonstration » et « déterministe » ; `tests/e2e/out/demo-rapport.json` |
| Caméra aérienne et caméra rue (hauteur piéton) basculables par bouton et touche V ; survol cinématique (touche C) | capture `tests/e2e/out/demo-aerien.png`, `demo-rue.png` ; bascule par bouton vérifiée par la porte visuelle ; e2e smoke (bouton + V) |
| Square (fontaine, bancs, jardinières, lampadaires, table, terrasse) et arbres du parc | `demo-rapport.json` (`props`) ; captures |

### Jeu jouable (première ville)
| Fonctionnalité | Preuve |
|---|---|
| Menu → nouvelle partie (nom, graine, taille de carte, budget) → partie ; « Charger une partie », « Options », « Quitter » | `tests/e2e/gameplay.mjs` ; `npm run e2e` |
| Terrain procédural réaliste (WorldTerrain) : relief, érosion, mer ou lac, rivières, plages, forêts, ressources ; rendu par chunks LOD en streaming (maillage en worker), PBR multi-couches, eau animée, ciel HDRI | `tests/terrain/*.test.ts` ; captures démo ; `tests/integration` (couches transférées) |
| Routes droites et **courbes** (6 types), **carrefours automatiques** (découpe des tronçons croisés), **ponts automatiques** au-dessus de l'eau, nivellement du terrain sous la chaussée transmis au rendu, profils en long calculés par la simulation | `tests/roads/*.test.ts` ; `tests/integration` « routes : courbe, carrefour, pont, nivellement » ; `tests/e2e/gameplay.mjs` (route courbe + rue transversale) |
| Bâtiments GLB posés le long des routes (outil avec aperçu fantôme, alignement façade/route, refus expliqués) | `tests/construction/*.test.ts` (3 tests contre la vraie simulation) ; `tests/e2e/gameplay.mjs` (pose par commande) |
| Démographie : emménagement si route, emploi, école, vieillissement, naissances, décès, émigration | `tests/sim/demography.test.ts` ; démo (≈ 4 000 habitants) |
| Trafic réel : véhicules sur le réseau (voies, carrefours à priorité / feux, IDM, A*), interpolés et rendus instanciés | `tests/vehicles/traffic.test.ts` ; `tests/integration` (≥ 50 véhicules, identifiants uniques) ; captures démo |
| Économie : coût débité à la construction, impôts et entretien mensuels, emprunts et faillite côté simulation | `tests/sim/economy.test.ts` ; `tests/e2e/gameplay.mjs` (trésorerie débitée) |
| Cycle jour/nuit : soleil, lune, fenêtres allumées, lampadaires et phares la nuit (heure de la simulation) | tests sky/buildings/routes des modules ; `render/index.ts` `setTimeOfDay` ; captures nuit des modules |
| Sauvegarde v2 (gzip, IndexedDB → localStorage → mémoire), emplacements nommés dans l'interface, autosauvegarde toutes les 3 min, **rechargement de la page puis chargement à l'identique** (bâtiments, routes courbes, trésorerie, date, population) | `tests/e2e/gameplay.mjs` ; `tests/sim/save.test.ts` ; `tests/integration` « sauvegarde v2 » (terrain nivelé identique) |
| Simulation en Web Worker, sans three ni DOM ; protocole typé, Transferables (terrain et ses couches, trames véhicules avec ids/variantes/drapeaux, patchs de terrain) | `tests/unit/architecture.test.ts` ; `tests/integration` « protocole » |
| Souris/clavier et tactile (pincer = zoom, deux doigts = déplacement/inclinaison/rotation) | `tests/e2e/gameplay.mjs` (iPhone 13 émulé, gestes CDP `Input.dispatchTouchEvent`) — **pas testé sur un vrai iPhone** |
| Build : `dist/index.html` + `dist/artifact.html` (fragment) + `game.js` + `sim.worker.js` + `assets/` relatifs ; GLB compressés `EXT_meshopt_compression` au build ; budget ≤ 60 Mo (≈ 42 Mo) | `npm run build` (contrôle du budget intégré) |
| Ville de test de charge (500 bâtiments, 1 000 véhicules) et mesures | `npm run stress` → `tests/e2e/out/stress-rapport.json` |

## Partiel (fonctionne, avec limites connues)
| Fonctionnalité | Limite | Phase |
|---|---|---|
| Panneau Finances | affiche l'historique de trésorerie ; curseurs d'impôts et emprunts affichés « Phase 2 » alors que la simulation les gère (`setTaxRate`, `takeLoan`) : interface non branchée | 2 |
| Rapport de simulation (`report`) | reçu ≈ 1 fois/s ; seules les notifications sont affichées (toasts) ; pyramide des âges, chômage, demande RCI : non affichés | 2 |
| Outil route de l'interface | trace des courbes en polyligne de tronçons droits (le point de contrôle Bézier est accepté par la simulation, `RoadDraft` ne l'envoie pas encore) ; choix limité aux 3 types hérités | 2 |
| Annuler (Ctrl+Z) | envoie la commande inverse : remboursement de 25 % seulement | 2 |
| Décors (arbres, mobilier) | placés par la démo (présentation, non simulés) ; placement par le joueur affiché « Phase 2 » | 2 |
| Nivellement sous les routes | la démolition d'une route restaure le terrain naturel, mais un bâtiment voisin construit sur un talus n'est pas réajusté | 2 |
| Performances | voir PROJECT_STATUS.md : ≈ 3 000 appels de rendu en vue aérienne de la démo (bâtiments multi-matériaux), non mesuré sur GPU réel | 2 |

## À faire
| Fonctionnalité | Phase |
|---|---|
| Fusion des matériaux par bâtiment (atlas) pour réduire les appels de rendu ; culling par chunk des bâtiments | 2 |
| Zonage (R/C/I) et croissance automatique ; terraformation (`terraform` renvoie NOT_IMPLEMENTED) | 2 |
| Panneaux budget / population / inspection branchés sur `report`, `inspectBuilding` | 2 |
| Lignes de bus, piétons, feux stop des véhicules, gyrophares | 3 |
| Échangeurs, passages dénivelés, autoroute constructible depuis l'interface | 4 |
| Billboards au LOD2 des arbres Poly Haven, imposteurs avec ombre | 2 |
| Mesures sur GPU réel et sur iPhone réel | 2 |
