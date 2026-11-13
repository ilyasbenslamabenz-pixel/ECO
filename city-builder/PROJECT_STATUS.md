# État du projet — Aube Urbaine

## Phase actuelle : 1 (première ville jouable) — corrections après la recette QA n° 2 (2026-11-13)

La recette QA n° 2 (7,3/10) a relevé un défaut majeur — feux tricolores simulés mais invisibles (le seul rendu était
dans une scène de test du module véhicules, importée par rien) — et quatre défauts mineurs. **Décider si la phase 1
est close revient à la prochaine recette.**

### Corrections QA n° 2 (cause → correction → preuve)
| Problème QA | Cause trouvée | Correction | Preuve |
|---|---|---|---|
| Feux tricolores invisibles (jeu et `?demo`) | l'état des feux ne quittait pas le worker ; aucun rendu dans le jeu | protocole : `DeltaMessage.signals` (rétrocompatible : disposition à chaque changement de réseau ou instantané, états seulement quand ils changent, tampons transférés) ; `TrafficSystem.signalLayout()/signalStateArray()` ; rendu `src/render/traffic/signals.ts` : mât à potence (arrivées à 2+ voies) ou poteau simple, têtes détaillées, lentilles hors tone mapping + halo la nuit, 7 `InstancedMesh` (≤ 11 appels de rendu avec les ombres) | `tests/vehicles/signals.test.ts` (4 tests) ; `npm run e2e:signals` : 35 bras / 9 carrefours / 62 têtes dessinés dans la démo, états qui changent, véhicule n° 16 immobile en tête de file à 5,1 m du poteau d'un feu ROUGE, toujours rouge après pause ; 138 px de lentille rouge dans `feux-rue.png`, 1 147 dans `feux-rue-nuit.png` |
| (a) herbe sur la moitié d'une route fraîchement posée | le chunk nivelé était re-maillé à son LOD courant, souvent encore le maillage grossier initial (pas de 64 m) | re-maillage au LOD voulu par la caméra (0 si inconnu) | `qa2-fixes.mjs`, `qa2fix-route.png` (route sur terre ferme, chaussée nette dès la 1re image) |
| (b) rivières fragmentées et anguleuses à l'ouverture | même maillage grossier initial : il recouvrait l'eau par blocs tant que le worker n'avait pas affiné ; berges : poids de sable/gravier tout-ou-rien par sommet | `TerrainSystem.refineAround()` synchrone à l'ouverture, au chargement et dans la démo ; poids de berge progressif selon la distance à l'eau | `qa2fix-ouverture.png` (graine de la recette, 63 chunks au LOD 0 dès la 1re image, rivières continues) ; il reste des coudes au pas de la grille de 8 m |
| (c) journée de 72 s à ×1 | 2 min de jeu par tick | 1 min par tick : journée = 2 min 24 s réelles à ×1 (0,2 min essayé d'abord, abandonné : mois de 6 h) ; immigration et synchronisation du trafic en ticks (rythme réel inchangé) ; horloge arrondie (pas de dérive) ; anciennes sauvegardes : périodes remises à jour au chargement | `tests/sim/day-length.test.ts` ; `qa2-fixes.mjs` (20 min de jeu en 10 s) ; tests de l'économie et de la démographie inchangés sur le fond (avance rapide `tick(2)` dans les tests) |
| (d) caméra non recentrée après chargement | le chargement ne touchait pas la caméra | barycentre bâtiments + nœuds de routes, distance selon l'étendue, affinage du terrain | `qa2-fixes.mjs` (cible à 0,0 m du centre de la ville) ; `qa2fix-charge.png` |

Suite de (c) : le pas de 0,2 min rendait le mois de jeu long de 6 h réelles à ×1. Le pas est fixé à **1 min par tick**
(journée de 2 min 24 s à ×1, deux fois plus lente qu'au départ ; mois de 72 min à ×1, 4 min 30 à ×16) et les vitesses
×8/×16 sont ajoutées à l'interface (boutons + touches 4/5). Les feux de la vue de nuit (`feux-rue-nuit.png`) viennent d'une seconde partie de démonstration : leurs états
ne sont pas ceux de la vue de jour.

## Historique : corrections après la recette QA n° 1 (2026-11-13)

La recette QA n° 1 (score 5,5/10) a relevé un test de parcours en échec, une route qui disparaissait à l'affichage,
l'absence d'alignement des bâtiments sur les routes en biais, des impôts et emprunts inaccessibles, 3 types de route
seulement, une démographie invisible, une documentation inexacte et des performances non documentées.
Ce document liste ce qui a été corrigé, comment c'est vérifié, et ce qui reste. Le détail fonction par fonction est
dans `FEATURES.md`. **Décider si la phase 1 est close revient à la prochaine recette QA.**

### Corrections (cause → correction → preuve)
| Problème QA | Cause trouvée | Correction | Preuve |
|---|---|---|---|
| `npm run e2e:game` : 0 bâtiment posé (bloquant) | (1) le test essayait un immeuble à 620 000 ¢ avec 434 581 ¢ en caisse, en boucle ; (2) les bâtiments étaient aimantés à une grille de 8 m, ce qui pouvait les pousser sur la chaussée ; les refus à 14-18 m d'une avenue étaient physiquement justes (demi-avenue 11,5 m + demi-maison 8 m) | test corrigé (modèles abordables, refus journalisés) ; placement libre au centimètre, angle libre, empreinte orientée exacte (`src/shared/footprint.ts`) ; l'outil colle la façade au trottoir | `npm run e2e:game` : SUCCÈS (4 bâtiments) ; `npm run e2e:play` : 2 maisons à 20,1 m de l'axe d'une avenue |
| Route croisée par une courbe invisible | delta de la simulation = retrait du tronçon coupé PUIS ajout des morceaux ; le rendu supprimait les nœuds devenus orphelins au retrait, et les morceaux (qui réutilisent ces nœuds, absents de `roadNodesAdded`) étaient ignorés | le rendu garde la position des orphelins et les recrée à l'ajout (`src/render/roads/renderer.ts`) | `tests/roads/render.test.ts` ; `e2e:play` « 4 tronçons affichés / 4 simulés » ; `play-courbe-carrefour.png` |
| Pas d'alignement sur route en biais ; « Façade → route » sans effet | rotation limitée aux quarts de tour ; aimantation calculée sur l'axe droit a→b (courbes ignorées) avec les largeurs du contrat hérité | `rot` décimal (quarts de tour, sauvegardes anciennes valides) ; aimantation sur la polyligne courbe, perpendiculaire à la tangente, largeurs des 6 types ; sélection et collisions orientées côté client | `e2e:play` : route à 34°, rot 3,626, écart à la perpendiculaire 0,000, « façade côté route » ; `play-biais-apercu.png`, `play-biais-pose.png` ; test unitaire machine |
| Impôts / emprunts « Phase 2 » | interface non branchée sur `setTaxRate` / `loanOffer` / `takeLoan` / `repayLoan` | panneau Finances : recettes, salaires, échéances, curseurs d'impôts par secteur, offre et emprunt, remboursement (`src/ui/city-panels.ts`) | `e2e:play` : impôt 14 % relu dans la simulation, emprunt 200 000 ¢ (trésorerie +200 000) ; `play-finances-*.png` |
| 3 types de route | tiroir sur l'ancien contrat `ROAD_TYPES` | tiroir sur les 6 types de la simulation (coupes SVG d'après le profil réel) ; la courbe est envoyée comme vraie Bézier (`control`) | `e2e:play` (6 cartes) ; `play-tiroir-routes.png` |
| Habitants « phase 2 », emploi/trajets invisibles | rapport `demography` non affiché | panneau Population (clic sur « Habitants ») ; libellés « phase 2 » supprimés ; flux d'immigration de base pour les petites villes | `e2e:play` ; `play-population.png` |
| Démo : 1 861 585 305 ¢ | budget de départ de 2 Md ¢ | budget 150 M ¢ (la ville coûte ≈ 138 M ¢ : reste ≈ 11,6 M ¢) | `demo-aerien.png` |
| Démo : plein jour à 00:10 en vue aérienne | **non reproduit** : le code d'éclairage n'a pas été modifié | test ajouté : la nuit (01:56) la luminance moyenne de la vue aérienne est 23,9 contre 106,6 le jour | `node tests/e2e/demo-night.mjs` ; `demo-nuit-aerien.png` |
| iPhone : barre d'outils de 630 px sur 390 | une seule rangée défilante sans indice | 2 rangées de 5 sous 520 px ; panneaux, tiroir et options remontés au-dessus | `e2e:play` (9 outils dans 374 px, panneau sans recouvrement) ; `play-iphone.png` |
| Pincer perdu sans image rendue (`?norender`) | pincement traité une fois par image uniquement | le pincement en attente est appliqué au lever des doigts | `e2e:game` : 420 → 140 m, inclinaison 0,69 → 0,21 |
| `npm run stress` sans rapport | la capture pendant la boucle de rendu logiciel dépassait 30 s | capture et mesure d'image boucle suspendue | `tests/e2e/out/stress-rapport.json` (ci-dessous) |
| Forêts sombres vues de haut | — | sous-bois teinté vert mousse (amélioration partielle) | `demo-aerien.png` — les imposteurs restent des silhouettes sombres |

### Résultat des commandes après les corrections QA n° 2 (2026-11-13)
| Commande | Résultat |
|---|---|
| `npm run typecheck` | OK |
| `npm test` | OK, 148/148 (dont 4 nouveaux tests des feux et 4 de la durée de journée) |
| `npm run build` | OK, 389 fichiers, 41,80 Mo |
| `npm run e2e` | SUCCÈS |
| `npm run e2e:gate` | SUCCÈS |
| `npm run validate:visual` | SUCCÈS : 88 assets, 40 bâtiments ; démo 119 bâtiments, 141 véhicules, 42 tronçons ; aérien 2 987 appels (avant : 2 966), rue 2 155 |
| `npm run e2e:signals` (nouveau) | SUCCÈS (12 contrôles, jour et nuit) |
| `node tests/e2e/qa2-fixes.mjs` (nouveau) | SUCCÈS (6 contrôles) |
| non relancés cette fois | `test:assets`, `e2e:game`, `e2e:play`, `stress`, `demo-night.mjs` (résultats ci-dessous : tour QA n° 1) |

Captures regardées : `feux-rue.png` (mât à potence, tête suspendue et répétiteur au rouge derrière un véhicule
arrêté), `feux-rue-nuit.png` (halos rouges), `feux-aerien.png` (carrefour d'avenues, mâts aux quatre coins ; petits à
85 m), `qa2fix-ouverture.png`, `qa2fix-route.png`, `qa2fix-charge.png`, `demo-rue.png`.

### Résultat des commandes (tour QA n° 1, 2026-11-13)
| Commande | Résultat |
|---|---|
| `npm run typecheck` | OK |
| `npm test` | OK, 140/140 |
| `npm run test:assets` | OK, 102/102 |
| `npm run build` | OK, 389 fichiers, 41,78 Mo (budget 60 Mo), aucun fichier > 15 Mo |
| `npm run e2e` | SUCCÈS |
| `npm run e2e:gate` | SUCCÈS |
| `npm run e2e:game` | SUCCÈS (18 contrôles) |
| `npm run e2e:play` (nouveau, à la souris) | SUCCÈS (22 contrôles) |
| `npm run validate:visual` | SUCCÈS : 88 assets, 40 bâtiments ; démo 119 bâtiments, 40 modèles, 141 véhicules, 42 tronçons |
| `node tests/e2e/demo-night.mjs` | SUCCÈS |
| `npm run stress` | OK |

### Performances mesurées (`tests/e2e/out/stress-rapport.json`)
Ville de test : 500 bâtiments (40 modèles), 166 tronçons, 1 008 véhicules au départ (1 343 après 600 pas), ≈ 6 200 habitants.
| Mesure | Valeur | Remarque |
|---|---|---|
| Génération du terrain (Node) | 0,8 s | carte 10×10 chunks |
| Construction de la ville (Node) | 1,7 s | opérations du joueur, toutes validations |
| Tick de simulation (Node, 600 pas) | moyenne 0,7 ms, p95 1,0 ms, max 15 ms | budget fixé à 100 ms (très large) |
| Tick rapporté par le worker (Chromium) | 1,1 ms | |
| Tas JS (Node / Chromium) | 63 Mo / 368 Mo | |
| Image de la vue aérienne (Chromium) | 2 706 appels de rendu, 6,1 M triangles | **rendu logiciel** SwiftShader : 9,8 s par image, 0 i/s en boucle — non représentatif d'un GPU |
| Mise à jour CPU du rendu par image | 6,6 ms | LOD, culling, interpolation véhicules |
| Démo (validate:visual) | aérien : 2 966 appels, 2,6 M triangles ; rue : 2 159 appels, 5,8 M triangles | |
Lecture : la simulation tient largement la charge visée ; le rendu émet trop d'appels (bâtiments multi-matériaux,
un appel par sous-maillage et par LOD) — la fusion des matériaux en atlas est la priorité perf de la phase 2.
Aucune mesure sur GPU réel ni sur iPhone réel n'a pu être faite dans cet environnement.

### Revue visuelle (captures regardées le 2026-11-13)
`planche-contact.png` (88 assets, 40 bâtiments distincts texturés, aucun cube ; véhicules dans leur matériau de base
blanc, la peinture étant appliquée par instance), `demo-aerien.png`, `demo-rue.png`, `demo-nuit-aerien.png`,
`play-courbe-carrefour.png`, `play-biais-apercu.png`, `play-biais-pose.png` (porte et garage côté rue, vérifié aussi
dans le GLB), `play-batiments.png`, `play-finances-emprunt.png`, `play-population.png`, `play-iphone.png`,
`play-iphone-population.png`, `stress-aerien.png`.
Défauts visibles restants : forêts lointaines en silhouettes sombres, berges anguleuses par endroits, flèches des
gratte-ciel vitrés très claires la nuit.

### Reste à faire / fragile
- Rien n'a été vérifié sur un vrai GPU ni sur un vrai iPhone (émulation Chromium + rendu logiciel uniquement).
- L'annulation d'une construction ne rembourse que 25 %.
- Autoroute : pas de croisement à niveau, échangeurs en phase 4.
- Phase 2 : zonage, terraformation, atlas de matériaux, décors placés par le joueur (voir `docs/ROADMAP_PHASE2.md`).
