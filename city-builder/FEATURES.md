# FEATURES — état réel des fonctionnalités d'« Aube Urbaine »

Règle : une ligne n'est marquée **Terminé** que si une preuve automatisée ou une vérification documentée existe
(colonne « Preuve ») ET que cette preuve passe à la date indiquée. Ce qui fonctionne seulement en partie est dans
« Partiel », avec la limite exacte. Tout le reste est « À faire » avec sa phase.
Dernière mise à jour : corrections après la recette QA n° 2 de la phase 1 (feux tricolores, horloge, terrain,
chargement), 2026-11-13. Résultats chiffrés et liste
des captures regardées : `PROJECT_STATUS.md`.

Commandes de preuve : `npm run typecheck`, `npm test` (unitaires + intégration), `npm run test:assets`,
`npm run build`, `npm run e2e`, `npm run e2e:gate`, `npm run e2e:game`, `npm run e2e:play`, `npm run validate:visual`,
`npm run stress`, `node tests/e2e/demo-night.mjs`, `npm run e2e:signals` (feux), `node tests/e2e/qa2-fixes.mjs`. Les captures citées sont dans `tests/e2e/out/` et ont été regardées.

## Terminé (vérifié)

### Bibliothèque d'assets 3D (priorité client)
| Fonctionnalité | Preuve |
|---|---|
| **40 bâtiments différents** (silhouettes et hauteurs toutes distinctes, 7 à 233 m) : 7 maisons individuelles de styles variés, 2 rangées de maisons mitoyennes, 2 petits immeubles, 2 immeubles moyens avec commerces, 4 immeubles haute densité, 3 gratte-ciel, 6 commerces (dont bureaux), 5 bâtiments industriels, 9 équipements publics (dont un parc) | `tests/integration/integration.test.ts` « catalogue fusionné » ; `npm run test:assets` (102 tests) ; planche `tests/e2e/out/planche-contact.png` |
| Chaque bâtiment : 3 LOD (triangles strictement décroissants), 3 ou 4 variantes (textures, teintes, hauteur), métadonnées (coût, entretien, habitants, emplois, façade/accès) | `npm run assets` (validateur : LOD, bornes, licences) ; tests des modules bâtiments |
| 15 véhicules GLB, 3 LOD, 2 à 6 peintures (la planche-contact les montre dans leur matériau de base, blanc/gris : la peinture est appliquée par instance dans le jeu) | validateur ; `tests/vehicles/traffic.test.ts` ; planche-contact ; captures de la démo |
| Végétation et décor : 6 essences d'arbres (4 Poly Haven + 2 générées), arbustes, fleurs, rochers, 12 éléments de mobilier urbain, fontaine | validateur ; planche-contact ; démo |
| Textures PBR (albedo, normale, ARM) : jeux Poly Haven CC0 + textures générées ; 2 HDRI ; aucune autre source externe ; licence et source de chaque asset dans `assets/LICENSES.md` | `npm run assets` (contrôle des licences et des sources autorisées) |
| Porte de validation visuelle `npm run validate:visual` (88 assets chargés dans Chromium, triangles, boîte, textures décodées, normal maps, planche-contact, démo aérienne et rue) | `tests/e2e/validate-visual.mjs` ; `npm run e2e:gate` (rejette un cube et un modèle non texturé) |

### Scène de démonstration
| Fonctionnalité | Preuve |
|---|---|
| Accessible par le menu et par `?demo` | `validate-visual.mjs` (`?demo`), e2e smoke |
| Ville construite **par la simulation avec les opérations du joueur** : ~119 bâtiments, les 40 modèles, 42 tronçons (6 types, courbes, ponts), quartiers, ~3 900 habitants, ~140 véhicules ; trésorerie restante crédible (≈ 12 M ¢ : budget de départ 150 M ¢, ville ≈ 138 M ¢) | `tests/integration/integration.test.ts` ; `tests/e2e/out/demo-rapport.json` |
| Caméra aérienne et caméra rue (hauteur piéton) basculables par bouton et touche V ; survol cinématique (touche C) | `demo-aerien.png`, `demo-rue.png` ; porte visuelle ; e2e smoke |
| Éclairage selon l'heure de la simulation, y compris en vue aérienne (nuit sombre, jour clair ; le défaut « plein jour à 00:10 » signalé par la QA n'a pas été reproduit) | `node tests/e2e/demo-night.mjs` (`demo-nuit-aerien.png` / `demo-jour-aerien.png`, luminance comparée) |

### Jeu jouable
| Fonctionnalité | Preuve |
|---|---|
| Menu → nouvelle partie → partie ; charger, options, quitter | `npm run e2e`, `npm run e2e:game` |
| Terrain procédural (relief, érosion, mer/lac, rivières, plages, forêts) en chunks LOD maillés en worker, PBR, eau animée, ciel HDRI | `tests/terrain/*.test.ts` ; captures |
| **Routes : les 6 types de la simulation constructibles depuis l'interface** (rue, avenue, boulevard, sens unique, rue piétonne, autoroute), droites ou **courbes (une vraie Bézier envoyée à la simulation)**, carrefours automatiques, ponts automatiques, nivellement | `npm run e2e:play` (tiroir à 6 cartes ; rue courbe tracée à la souris = tronçons courbes c1/c2) ; `tests/construction/tools.test.ts` « rue courbe = une vraie Bézier » (sens unique) ; `tests/roads/*.test.ts` |
| **Une route coupée par un carrefour reste affichée** (correction : les nœuds d'extrémité réutilisés par les morceaux n'étaient plus connus du rendu) | `tests/roads/render.test.ts` « tronçon coupé par un carrefour » ; `npm run e2e:play` « rendu = simulation : 4 tronçons affichés / 4 simulés » (`play-courbe-carrefour.png`) |
| **Placement libre des bâtiments : angle libre et position au centimètre** ; empreinte orientée exacte (collisions bâtiments par séparation d'axes, routes courbes par distance segment/rectangle orienté) | `src/shared/footprint.ts` ; `tests/construction/tools.test.ts` « position et angle libres » |
| **Aimantation façade → route** sur route droite, **en biais** ou courbe : façade exactement perpendiculaire à la route, bâtiment collé au trottoir, glisse le long de la voie, « façade côté route » au curseur ; aperçu du vrai modèle, rotation (R), variantes, démolition | `npm run e2e:play` (route à 34° : rot 3,626, |cos| = 0,000 ; 2 maisons collées à l'avenue, centre à 20,1 m de l'axe = 11,5 + 8 + 0,6) ; `play-biais-apercu.png`, `play-biais-pose.png` ; `tests/construction/tools.test.ts` |
| Pose par commandes le long des routes, trésorerie débitée, bâtiments rechargés à l'identique | `npm run e2e:game` (4 bâtiments posés ; le test essayait auparavant un immeuble à 620 000 ¢ avec 434 581 ¢ en caisse et ne posait rien) |
| **Économie dans l'interface** : recettes fiscales, salaires, échéances d'emprunt ; **impôts réglables par secteur** (0–25 %) ; **emprunts** (offre chiffrée, emprunt, remboursement anticipé) ; graphique de trésorerie | `npm run e2e:play` (impôt résidentiel 14 % relu dans la simulation ; emprunt 200 000 ¢ : trésorerie +200 000 et ligne affichée) ; `play-finances-impots.png`, `play-finances-emprunt.png` ; `tests/sim/economy.test.ts` |
| **Panneau Population** (clic sur « Habitants ») : habitants, ménages, actifs, emploi, chômage, emplois pourvus/offerts, trajets en cours, véhicules, logements, bonheur, attractivité, revenus, arrivées/départs, demande par secteur, activités, tranches d'âge — tout vient du rapport de la simulation | `npm run e2e:play` (« 8 habitants » = simulation) ; `play-population.png` |
| Démographie : emménagement si route, emploi, école, vieillissement, naissances, décès, émigration ; flux d'immigration de base pour qu'une petite ville se peuple en 1 à 2 jours de jeu | `tests/sim/demography.test.ts` ; e2e:game (25 habitants après rechargement) |
| Trafic réel (voies, carrefours à priorité / cédez-le-passage / feux, IDM, A*), véhicules instanciés | `tests/vehicles/traffic.test.ts` ; `tests/integration` |
| **Feux tricolores simulés ET dessinés** : la simulation gère les phases (vert / orange / rouge intégral) et arrête les véhicules au rouge ; elle envoie au rendu la disposition (une tête par voie d'arrivée régulée, au pied de la ligne d'arrêt sur le trottoir de droite) puis l'état de chaque bras, uniquement quand il change (`DeltaMessage.signals`, tampons transférés). Le rendu dessine un mât à potence au-dessus des voies (tête suspendue + répétiteur) pour les arrivées à plusieurs voies, un poteau simple sinon ; tête détaillée (caisson arrondi, plaque de contraste, visières, 3 lentilles) ; lentille allumée = état simulé, lisible de jour et de nuit (halo la nuit) ; 7 maillages instanciés au total. Démo : 9 carrefours à feux, 35 bras, 62 têtes | `tests/vehicles/signals.test.ts` (disposition, états = simulation, deltas compacts et transférables, « véhicule arrêté à la ligne ⇒ feu non vert ») ; `npm run e2e:signals` (35 bras dessinés, états changeants, véhicule immobile en tête de file devant un feu ROUGE, toujours rouge après pause) ; captures `feux-rue.png` (jour), `feux-rue-nuit.png`, `feux-aerien.png` |
| Cycle jour/nuit : **une journée = 12 min réelles à ×1** (0,2 min de jeu par tick ; avant 72 s) ; immigration et synchronisation du trafic gardent leur rythme réel ; anciennes sauvegardes rechargées avec les nouvelles périodes | `tests/sim/day-length.test.ts` ; `qa2-fixes.mjs` (20 min de jeu en 10 s réelles) ; `demo-night.mjs` |
| **Chargement d'une sauvegarde : caméra recentrée sur la ville** (barycentre des bâtiments et nœuds de routes, distance selon l'étendue) | `qa2-fixes.mjs` (cible à 0,0 m du centre de la ville après chargement par le chemin de l'interface) ; `qa2fix-charge.png` |
| Terrain affiné tout de suite autour de la caméra à l'ouverture d'une partie, au chargement et dans la démo ; chunk nivelé par une route re-maillé au LOD fin (l'herbe ne recouvre plus la chaussée) | `qa2-fixes.mjs` (63 chunks au LOD 0 dès la 1re image) ; `qa2fix-ouverture.png`, `qa2fix-route.png` |
| Sauvegarde v2 (gzip, IndexedDB → localStorage → mémoire), emplacements nommés, autosauvegarde 3 min, rechargement de la page puis chargement à l'identique (date exacte de l'instantané) ; anciennes sauvegardes (rotation entière) toujours valides | `npm run e2e:game` ; `tests/sim/save.test.ts` |
| Simulation en Web Worker, sans three ni DOM ; protocole typé, Transferables | `tests/unit/architecture.test.ts` ; `tests/integration` « protocole » |
| Souris/clavier et tactile : pincer = zoom, deux doigts = déplacement/inclinaison/rotation (un pincement en attente est appliqué au lever des doigts : plus de geste perdu quand aucune image n'a été rendue) | `npm run e2e:game` (iPhone 13 émulé, CDP : 420 → 140 m, inclinaison 0,69 → 0,21) — **pas testé sur un vrai iPhone** |
| iPhone : barre d'outils sur 2 rangées de 5, entièrement visible ; panneaux au-dessus de la barre ; boutons ≥ 40 px | `npm run e2e:play` (9 outils dans 374 px, panneau sans recouvrement) ; `play-iphone.png` |
| Build : `dist/index.html` + `dist/artifact.html` (fragment) + `game.js` + `sim.worker.js` + `assets/` relatifs ; budget ≤ 60 Mo (≈ 42 Mo) | `npm run build` |
| Test de charge (500 bâtiments, 1 000 véhicules) et mesures | `npm run stress` → `tests/e2e/out/stress-rapport.json` (chiffres dans `PROJECT_STATUS.md`) |

## Partiel (fonctionne, avec limites connues)
| Fonctionnalité | Limite | Phase |
|---|---|---|
| Autoroute | constructible, mais ne croise aucune route à niveau (refus expliqué) : échangeurs en phase 4 | 4 |
| Annuler (Ctrl+Z) | envoie la commande inverse : remboursement de 25 % seulement à l'annulation d'une construction | 2 |
| Décors (arbres, mobilier) | placés par la démo (présentation, non simulés) ; placement par le joueur affiché « Phase 2 » | 2 |
| Nivellement sous les routes | un bâtiment voisin construit sur un talus n'est pas réajusté après démolition de la route | 2 |
| Performances | simulation : tick moyen 0,7 ms (p95 1,0 ms) pour 500 bâtiments et 1 000+ véhicules ; rendu : 2 700 à 3 000 appels par image en vue aérienne (bâtiments multi-matériaux), mesuré en rendu LOGICIEL seulement — **aucune mesure sur GPU réel** (détail : `PROJECT_STATUS.md`) | 2 |
| Forêts vues de haut | sous-bois teinté en vert (lecture de canopée améliorée) ; les imposteurs lointains restent des silhouettes sombres découpées | 2 |
| Rivières | plus fragmentées à l'ouverture (affinage immédiat du terrain) et berges adoucies (poids de berge progressif) ; le tracé suit encore la grille de 8 m : coudes visibles par endroits (`qa2fix-ouverture.png`) | 2 |
| Économie au rythme de la nouvelle horloge | montants mensuels inchangés, mais un mois de jeu dure 6 h réelles à ×1 (1 h 30 à ×4) : vitesses ×8/×16 demandées à l'interface (`docs/requests/feux-qa2.md`) | 2 |

## À faire
| Fonctionnalité | Phase |
|---|---|
| Fusion des matériaux par bâtiment (atlas) pour réduire les appels de rendu ; culling par chunk des bâtiments | 2 |
| Zonage (R/C/I) et croissance automatique ; terraformation (`terraform` renvoie NOT_IMPLEMENTED) | 2 |
| Inspection détaillée d'un habitant / d'un bâtiment (`inspectBuilding`, `inspectCitizen` existent côté simulation) | 2 |
| Lignes de bus, piétons, feux stop des véhicules, gyrophares | 3 |
| Échangeurs, passages dénivelés | 4 |
| Billboards au LOD2 des arbres Poly Haven, imposteurs avec ombre ; berges de rivières lissées | 2 |
| Mesures sur GPU réel et sur iPhone réel | 2 |
