# Prochaines étapes (brief pour une nouvelle session)

Jeu : `city-builder/` ; branche `claude/amazing-meitner-vtryts` ; artifact joueur https://claude.ai/artifact/YTQu5U1EvibeTY3fRQpexH (v36).
Publication : `npm run build`, `node scripts/pack-artifact.mjs dist <dossier>`, publier `artifact.html` + fichiers modifiés.
Règles : ne rien supprimer, ne pas changer l'architecture sans accord, aucun résultat inventé, tsc + tests avant commit.

## Demandé par le joueur
1. FAIT (publié en v35) — menu de construction : surface mate, onglets homogènes, raccourcis en pointillés ; sur téléphone
   les boutons Calques/Carte ne recouvrent plus le tiroir et les onglets Services tiennent sur une rangée.
2. FAIT (publié en v35) — cartes détaillées : badges empreinte/variantes, coût + entretien, chiffres clés en pastilles
   (`card-info.ts` › `stats`), dépendance en note neutre ; sous-catégories titrées (`src/ui/build-groups.ts`).
   Captures : `node tests/e2e/cap-tiroirs.mjs <préfixe> [dossier]`.
   Reste possible : le reste des fenêtres (panneaux) avec le même langage.

## Travail prêt mais non publié (worktrees `.claude/worktrees/`)
- Terrain à débloquer (carte 6 km, parcelles) : branche `worktree-agent-aaf084691e1b985a0` — à vérifier en jeu et en perf.
- Paysage, prise en main, gorge du fleuve, barrage 3D : agents arrêtés (travail partiel dans leurs worktrees).

## Connu
- Corrigé : « budget serré » (seuil 430 habitants, lots calés sur la trame) ; iPhone « fiche sur 390 px » (animation
  verticale des panneaux sur téléphone) ; e2e:game / e2e:play (nom d'emplacement et « Façade » en majuscule).
- Gameplay mesuré (`tests/perf/equilibre-economie.ts --debug --sauver=…`) : passé ~1 500 habitants, l'industrie
  consomme l'essentiel du courant (12,9 MW sur 19,9 MW à 7 000 hab.) ; sans centrale à gaz, tout l'industriel est
  délesté → chômage 30–47 %, satisfaction 11–18, départs. L'indice de croissance affiche maintenant « need-power ».
  Mis à jour (v47) : déjà traité depuis — baisse de régime des lieux de travail, alerte « réserve faible », conseil
  chiffré (« Il manque X MW : une centrale thermique… »). Reste le vrai frein : la centrale au gaz (3,5 M CHF) arrive
  quand la caisse tourne autour de 100–300 k CHF ; le conseil propose désormais l'emprunt avec les montants.

## Priorité joueur (17/11) : ORDINATEUR seulement, fluidité au maximum
- Le joueur a abandonné le mobile. Machine : PC Windows, GPU Intel intégré, Edge, 1280×755 densité 1,5.
- Fait (v36) : résolution dynamique + paliers aussi en qualité Moyenne sur GPU intégré, ombres 1 image sur 2,
  baisse de régime électrique, fiche bâtiment sans chevauchement. À faire : nouvelle mesure ?bench du joueur.

## Audit complet (18/11)
- `npm run e2e:audit` (tests/e2e/audit-jeu.mjs) : 31 contrôles à la souris, tout le jeu sur ordinateur — 31/31.
- Toutes les suites e2e PC passent (smoke, interface-pc, terraform, gate, game, play, problemes, signals, routes,
  electricite, zonage, dechets, actions). Restent en échec : parties iPhone de tests/construction/demo.mjs (mobile
  abandonné par le joueur).
- Non reproduit : source d'eau « lac prévu 0 m² » dans un cratère de la partie du joueur → demander l'export .meknes.

## Identité visuelle (refonte du design)

- Feuille `src/ui/styles-identite.css`, chargée en dernier par `scripts/build.mjs` : aucune règle existante retirée ; elle redéfinit les jetons (thèmes nuit/sombre et clair) et l'habillage.
- v41 : palette chaude « Meknès » (brun, laiton) — refusée par le joueur (« j'aime pas le marron »).
- v42 : palette froide inspirée de l'esprit des city-builders récents : ardoise bleutée, texte blanc, accent cyan (sélection et action principale), vert / corail pour bon / problème, couleurs de catégorie franches sur les outils. Angles 4–6 px, en-têtes de fenêtre en bandeau, surfaces quasi opaques sans flou (fluidité iGPU), anneau cyan pour le guidage du tutoriel.
- Typographie : Barlow (interface), Barlow Condensed (chiffres, intitulés de section). Polices SIL OFL intégrées en data: URI (`src/ui/fonts/`), aucun serveur tiers.
- Vérifié : tsc, 753 tests unitaires, e2e interface PC, audit 31/31.

## Ergonomie : barre des routes contextuelle et « Ce qu'il faut faire » (v43)

- Barre d'options de l'outil Routes (`src/ui/buildbar.ts`, `sync()`) : modes (Droite, Courbe, Quadrillage, Parallèle · Améliorer, Carrefour) puis **seulement** les réglages du mode choisi (Îlot, Écart, Vers, Régime, Hauteur), en groupes insécables ; une seule rangée quand la place suffit (la barre masque moins la carte). Pont / Viaduc / Tunnel / Digue / Giratoire repliés derrière « Ouvrages · <choix en cours> ». L'aide de l'outil est dans la barre, entière (plus de « … »), accolée à « Terminer ».
- « Ce qu'il faut faire » (`src/ui/needs-advice.ts`, tests `tests/unit/conseils-besoins.test.ts`) : en tête des tableaux Énergie, Eau, Déchets, une phrase chiffrée (ex. « Il manque 11 MW : une centrale thermique (60 MW, pilotable) ou ≈ 5 éoliennes ») et un bouton « Construire › » qui ouvre le bon tiroir. Chiffres tirés du bilan et des fiches techniques partagées (FACILITY_SPECS, IMPORT_SPEC, WATER_FACILITIES, WATER_IMPORT). Les bandeaux qui disaient la même chose (« Production à 0 » sans centrale, « Collecte arrêtée ») ne sont plus affichés en double.
- e2e `road-tools.mjs` : l'élargissement d'une rue entière est débité tronçon par tronçon ; le test attend le débit complet (comme pour le quadrillage) avant de comparer au coût annoncé.

## Vers le 10/10 : cinq finitions d'ergonomie (v44)

1. **Barre de gauche** : libellé sous chaque icône (rail de 78 px ; tableaux et bas d'écran décalés en conséquence). Bouton « Construire › » dans l'en-tête des tableaux Services, Transports, Environnement, Énergie, Eau, Déchets (le tiroir de construction avait déjà « Tableau de bord »).
2. **Avertissements à la pose** (`World.siteWarnings`, aperçu avant le clic et notification de pose ; tests `tests/construction/avertissements-pose.test.ts`) : station de pompage à plus de `SURFACE_INTAKE_RADIUS` m de l'eau (forage : au plus 160 × `BOREHOLE_FACTOR` m³/h), épuration / émissaire loin de l'eau (rejet au sol), bâtiment polluant avec des logements à moins de `POLLUTION_RADIUS_M` (400 m, constante désormais partagée avec la démographie) et l'inverse. Pas de refus : c'est une mise en garde.
3. **Premiers pas** : réduit à sa ligne de titre pendant la construction (outil actif ou tiroir ouvert), détail au survol.
4. **Tableau Énergie** : sous « Ce qu'il faut faire » et les quatre indicateurs, sections repliables fermées par défaut (détail production / consommation, budget, réglages, installations et lignes, journal), état conservé entre deux relevés.
5. **Finitions** : encadré « Pourquoi » au même langage que les conseils (liseré à gauche) ; file des vignettes « dernier demandé, premier servi » (l'onglet affiché passe devant). Couleurs R/C/I/B conservées : ce sont celles des zones peintes sur la carte.

## Chargement optimisé (v45)

Mesures (Chromium sans carte graphique, réseau limité à 30 Mbit/s, latence 60 ms ; `scratchpad` : load.mjs) :

| | Avant | Après |
|---|---|---|
| Menu affiché (version publiée) | 17,3 s | **0,9 s** |
| Jeu jouable, total (version publiée) | ≈ 23 s | ≈ 14,6 s |
| Données téléchargées (version publiée) | 37 Mo | 21 Mo |
| Paquets au démarrage | 13 paquets / 25,8 Mo | 4 paquets / 7,5 Mo bruts |

Ce qui a changé :
- **Menu immédiat** (`src/main.ts`, `ui.showBootMenu`) : le menu s'affiche dès le début, avec la progression ; le formulaire « Nouvelle partie » se remplit pendant le chargement ; une action demandée avant la fin attend (`afterBoot`). Lancements automatiques (autostart, démo, banc d'essai) : écran de chargement inchangé.
- **Simulation en parallèle du rendu** : le Worker démarre pendant la préparation du rendu.
- **Végétation** : modèles de toutes les essences demandés en parallèle ; **LOD0 des arbres différé** (`VegetationSystem.loadDetail`, 4 s après le démarrage ; la case LOD0 montre le LOD1 en attendant ; test `tests/terrain/vegetation-detail.test.ts`).
- **Paquets de la version publiée** (`scripts/pack-artifact.mjs`) : ordre réel de chargement (`scripts/artifact-order.mjs` → `scripts/artifact-order.json`, à régénérer après un changement d'assets ; une liste périmée reste correcte, moins efficace) ; reste en paquets de 1 Mo par dossier ; noms à empreinte de contenu + **cache du navigateur** (Cache Storage « meknes-paquets ») : une relance ne retélécharge que les paquets modifiés ; décodage base64 natif quand disponible ; garde-fou de syntaxe de l'adaptateur.
- **Nouvelle partie** : écran « Création de la carte… » pendant la génération (≈ 2 s dans la simulation).

Non fait (à décider) : l'érosion du relief (≈ 40 % de la génération) pourrait être accélérée, mais le relief des sauvegardes est régénéré depuis la graine : tout changement d'arrondi le modifierait. Pré-générer la carte pendant que le joueur remplit le formulaire ferait gagner ≈ 2 s mais ajoute une commande au protocole de la simulation.

## Source d'eau : cours d'eau à la mesure du débit (v46)

Signalement : « ça veut pas ajouter l'eau » (source de 100 m³/s, aperçu « lac prévu 0 m² »). Reproduit : sur une pente sans creux, l'eau partait en ruisseau d'**une seule case (8 m) et 35 cm**, quel que soit le débit — à l'écran, un chenal de sable presque sec.
Correction (`src/sim/hydro/fill.ts`, `streamShape`) : largeur ≈ 2,7·Q^0,56 m et profondeur ≈ 0,39·Q^0,34 m (relations de Leopold et Maddock ; au moins 35 cm) ; le ruisseau s'élargit sur les cases voisines plus basses que sa surface (jamais à travers une barrière ni sur l'eau de base), cases marquées comme lui appartenant (pas d'exutoire prématuré). 100 m³/s : ≈ 35 m × 1,9 m ; surface en eau ×5 dans le cas reproduit. Alimentations sans débit : comportement d'origine. Test : `tests/terrain/ruisseau-debit.test.ts`.
Note : le volume d'une source croît avec le temps de jeu écoulé depuis sa pose (débit × temps) ; partie en pause, un creux ne se remplit pas.

## Jouabilité inspirée de CS2 (v47)
- Barrage : repère rouge sur le col par où l'eau contourne l'ouvrage (solveur `spills`, aperçu `spillX/spillZ`,
  `TerrainEditPreview.spill`), et la phrase « l'eau déborde par un col… (repère rouge) : prolongez le barrage jusque-là
  ou fermez ce passage par une digue ». Test : tests/terrain/col-debordement.test.ts.
- Cartes d'information (valeur foncière, pollution, bruit, chômage, éducation, satisfaction, écoles, déchets) : valeur
  en clair sous le curseur avec l'outil Sélection (`carteReadout`, inverse des échelles). Test :
  tests/unit/cartes-survol.test.ts. Les cartes pilotées par d'autres modules (électricité, eau, trafic…) n'ont pas
  encore cette lecture.
- Énergie : quand la centrale thermique dépasse la trésorerie, « Ce qu'il faut faire » donne prix et caisse et propose
  un emprunt (`setAdviceMoney`, branché dans hud.ts). Test : conseils-besoins.
- Proposé, non fait (accord nécessaire, touche l'architecture ou l'équilibre) : budget par service, suivre un
  habitant / véhicule, cimetière, université, métro / train de voyageurs, stationnement, petite centrale pilotable
  intermédiaire entre le raccordement (3 MW) et la centrale au gaz (60 MW, 3,5 M CHF).
- Satisfaction (v48, partie du joueur « Gotham Citx ») : « Eau −0,1 pt → Raccordez-vous au réseau d'eau voisin » alors
  que 587/587 bâtiments sont desservis à 100 %, tous aux égouts : le reste vient d'une qualité de 99,7–100 %. Les
  conseils ne visent plus que les facteurs d'au moins −0,5 pt (`adviceTargets`, `ADVICE_MIN_PTS`).

## Contrôle de la partie du joueur « Gotham Citx » (11 000 hab., v49)
Outils : `tests/e2e/partie-joueur.mjs <sauvegarde> [s] [vitesse]` (import par le menu, erreurs, images/s, `tickMs`,
mémoire ; `NORENDER=1` pour la seule simulation) et `tests/e2e/partie-rendu.mjs <sauvegarde>` (appels de dessin et
triangles par couche, maillages visibles des routes et des bâtiments, `ROADCHUNK=` pour comparer).
- État : aucune alerte, aucune erreur de module ni de console ; eau et électricité couvertes ; chômage 0,2 %.
- Simulation (2 jours de jeu chargés depuis la sauvegarde, Node) : 9,3 s → 5,9 s ; pics horaires 50 → 33.
  Croissance des zones pleines suspendue tant que rien ne change ; lots recomptés seulement si la ville change ;
  répartition eau/égouts en tableaux typés (identique à l'ancienne). Dans le navigateur sans rendu : ×16 tenu
  (162 min de jeu/s pour 160).
- Rendu (vue du chargement) : 948 → 708 appels de dessin (routes 377 → 137, chunks de routes de 512 m ; un tronçon
  modifié remaille ≈ 16 ms au lieu de 5) ; feux tricolores 168 000 → 93 000 triangles (lentilles 72 triangles).
- Bug corrigé : la capacité libre de la centrale au gaz était vendue 1,5 ct/kWh (prix par défaut) pour 2 ct de gaz :
  ≈ −150 000 CHF/mois. Vendue maintenant seulement au-dessus du coût du gaz (sur la partie : +5 100 CHF/jour).
- Sauvegarde : 4,8 Mo en JSON, 1 Mo compressée (format stocké) ; cache des paquets déjà purgé à chaque version.
- Reste possible : décor routier lointain (4 000 lampadaires, ≈ 90 maillages) en un seul lot ; bâtiments 265 appels.

## Fluidité : pics de simulation lissés, qualité adaptative sur téléphone (v50)
Mesure : temps de chaque tick sur 2 jours de jeu de la partie « Gotham Citx » (Node, après un jour de chauffe).
- Tick de minuit : 140–240 ms → ≈ 27 ms. Pire tick de la journée : 243 → 46 ms ; tournées de déchets (6 h) : 70–110 → ≈ 41 ms.
  - Passe démographique étalée dès 5 000 lignes de citoyens (`DAILY_SPREAD_MIN_ROWS`, 20 000 avant ; mécanisme
    existant, docs/SIMULATION.md).
  - Densification des zones reportée au tick qui suit minuit (`ZoningSystem.densifyDue` ; reprise au chargement d'une
    sauvegarde prise à minuit).
  - Électricité et eau : rattachement de chaque bâtiment à la voirie mémorisé par position tant que la voirie ne change
    pas (recherché chaque heure jusque-là) ; électricité 9 → 1 ms par heure.
  - Version de la voirie propre à chaque réseau (`RoadNetwork.version` part d'une base unique) : aucun cache indexé sur
    la version ne confond deux parties successives.
  - Zonage : cases libres recomptées seulement autour des changements (bâtiments seulement ajoutés : seules les cases
    libres sont revues) ; résultat identique.
  - Tournées de déchets : recherche du plus court chemin arrêtée dès l'arrêt le plus proche trouvé (exact : même
    arrêt, même distance, même itinéraire).
- Qualité d'affichage : paliers automatiques (véhicules, piétons, végétation, niveaux de détail, ombres) aussi sur
  téléphone en qualité Auto ; qualité Basse = palier « minimal » imposé. Tests : rendu-pc-integre.
- Reste possible : réseau d'eau (≈ 10 ms par heure, répartition des débits), décor routier en un seul lot.

## Graphismes inspirés de CS2 (v51)
Contrôlé sur la partie « Gotham Citx » (`tests/e2e/partie-captures.mjs <sauvegarde> <dossier>` : vues large, moyenne,
rue ; `VIEWS`, `WAIT` réglables ; `__aube.buildingTextures()` compte les textures encore en attente).
- Bug : routes rouges / vertes en permanence. La carte de congestion était rechargée allumée depuis la sauvegarde alors
  que le menu Cartes repart sans couche (impossible de l'éteindre). Elle repart éteinte au chargement (champ toujours
  lu et écrit). Test : circulation « carte de congestion éteinte au chargement ».
- Bug : bâtiments en blocs noirs pendant le chargement (après chaque déplacement de la caméra, surtout de loin) :
  textures sans image échantillonnées en noir (occlusion de l'ARM comprise). Image d'attente neutre de 1 pixel
  (couleur claire teintée par le matériau, relief plat, ARM neutre), puis vraie image dans une nouvelle source après
  `dispose` (three garde sinon la texture GPU de l'image d'attente).
- Ombre de contact au pied des bâtiments (occlusion au sol, `ContactShadowLayer`) : halo doux de 2,6 m, un seul
  maillage instancié, aucune texture ; masquée pendant un chantier. Test : tests/unit/ombres-contact.test.ts.
- Proposé, non fait (accord nécessaire) : cycle jour / nuit (désactivé à la demande du propriétaire ; fenêtres
  allumées déjà prêtes), occlusion ambiante plein écran (SSAO, coûteuse sur téléphone), profondeur de champ
  « maquette », décor des parcelles (clôtures, jardins arrière), variation de teinte de l'herbe.

## Effets d'image sur ordinateur : occlusion ambiante (v52)
- `src/render/post.ts` : scène rendue dans une cible HDR (MSAA ×4, profondeur en texture) → GTAO (three/addons) lu
  depuis cette profondeur (normales reconstruites, aucune seconde passe de la scène) → débruitage → copie à l'écran.
  Tone mapping, étalonnage et brouillard restent dans les shaders (cibles marquées « XR » : three les y applique comme
  à l'écran) : à intensité nulle (`?ao=0`), couleurs moyennes identiques au rendu direct (écart ≤ 0,2 / 255).
- Option « Effets d'image (occlusion ambiante) » : Auto (GPU dédié ; jamais téléphone, GPU intégré ni rendu logiciel),
  Activés, Désactivés ; `?effets=1|0` pour les mesures. Créés à la première image qui les demande. Coupés par les
  paliers automatiques « réduit » et « minimal » (`QualityTier.ao`). Test : rendu-pc-integre.
- Réglages (`AO_PARAMS`) : rayon 4,5 m, épaisseur 2,5 m, intensité 0,85. Coût non mesuré sur vrai GPU (machine de test
  sans GPU) : à vérifier avec la page `?bench`.

## Lisibilité : forêts lointaines, toits sombres, lumière du ciel (v53)
Contrôlé sur la partie « Gotham Citx » (captures large / moyenne / rue ; `tests/e2e/arbres-loin.mjs <sauvegarde>
<dossier>` : même arbre de près et de loin, couleur comparée).
- Bug : en vue aérienne lointaine, les forêts devenaient des rectangles sombres. L'imposteur lisait l'alpha dans un
  niveau de mipmap où une case de l'atlas (128 px) tient en un texel : l'alpha moyen de la case dépassait le seuil et
  tout le quad devenait opaque. Niveau de mip borné à 3 (`IMP_MAX_LOD`, case de 16 px).
- Épicéas presque noirs (luminance moyenne de l'albédo ≈ 55/255, feuillus ≈ 80) : teinte d'instance éclaircie par
  essence d'après la couleur moyenne de son atlas (`foliageGain`, cible 72, gain ≤ 2) ; modèle 3D et imposteur
  ensemble (couleurs mesurées identiques de près et de loin).
- Toits et façades : la teinte du catalogue se multiplie à une texture déjà sombre (tôle 88/255 × #7d8386 ≈ 40/255,
  ardoise × #4e5a67). Plancher de clarté par rôle (`ALBEDO_FLOOR` : toiture, zinc, façades), calculé sur la couleur
  moyenne réelle de la texture une fois chargée, sur le canal le plus fort (teintes saturées intactes) ; métaux
  (canal métal de l'ARM > 0,2) ramenés canal par canal au reflet gris d'un zinc patiné (`metalFloorColor`, 0,22 ;
  un facteur unique les rendait dorés). Qualité Basse inchangée.
- Bug : toits d'un noir pur sur une partie des maisons. Trouvé par bisection (`tintBuildingRole` : moitié des rôles en
  magenta, le reste en noir) : ces modèles couvrent leur toit avec le métal des garde-corps (« metal_larme »,
  61/255, × #3a3d40). Rôle `garde_corps` ajouté au plancher (garde-corps gris galvanisé au lieu de noir).
- Herbe plus verte (demande du joueur) : palette « vives », herbe sèche [0.17, 0.175, 0.06] → [0.095, 0.17, 0.045],
  grasse et pentes de même ; mini-carte assortie.
- Lumière du ciel (palette « vives ») : hémisphère 1,05 → 1,7 ; les versants à l'ombre ne sont plus noirs
  (toit gris à l'ombre : 47 → 73 / 255).
- Écartés après mesure : réseau d'eau (≈ 10 ms par heure de jeu, < 3 % du worker à ×16) ; étalonnage d'image (déjà
  dans la palette « vives » : balance des blancs, saturation, contraste).
- Outils de diagnostic (`__aube`) : `treeSample`, `buildingsNear(x, y)`, `buildingMaterials()`,
  `tintBuildingRole(rôle, couleur)`, `stripBuildingMaps('normal'|'arm'|'map')`, `pickMaterial(x, y)`.

## Circulation : plafond de capacité du réseau (v54)
Partie « Gotham Citx » (11 000 habitants), une journée simulée en Node à partir de la sauvegarde.
- Constat : alerte « Circulation très lente » permanente. 13,7 km/h en moyenne (minimum 9,5), moitié des voitures à
  l'arrêt, files pare-chocs contre pare-chocs (≈ 145 véh/km) sur 36 voies des axes nord-sud du quadrillage. Aucun
  véhicule bloqué plus de 150 s (pas d'interblocage). Feux ou stops partout : 12,6 / 12,4 km/h (pas mieux).
- Cause : une minute de jeu = 0,1 s de conduite. La vague du matin (plafond de demande ≈ 550 voitures, selon la
  population seule) entrait en une dizaine de secondes de conduite, bien plus vite qu'aucun carrefour ne l'écoule ;
  un trajet de 1,5 km durant ≈ 30 h de jeu, le réseau restait plein jour et nuit.
- Correction : plafond de capacité `VEH_PER_LANE_KM = 3` véhicules simultanés par km de voie (plancher 40), en plus
  du plafond de demande ; plus de routes = plus de voitures. Trajets au-delà : hors réseau (mécanisme existant).
  Résultat sur la partie : 230 voitures, 20,6 km/h en moyenne, minimum 18,4 ; 131 arrivées par jour au lieu de 108.
- Tests : circulation/plafond-capacite ; les deux tests de charge (collisions, bouchon émergent) désactivent ce
  plafond (`vehPerLaneKm: 0`) pour garder leur charge.

## Interface : objectif en cours et notifications (v54)
- Bug : sur ordinateur, les notifications recouvraient l'encadré d'objectif en haut à droite. Sa hauteur (`--obj-h`)
  était mesurée à 0 : la visibilité était testée par `offsetParent`, toujours nul pour un élément en position fixe.
  Mesure par `getClientRects` (rail.ts) : notifications placées sous l'encadré (contrôlé : encadré 64–270 px,
  notifications à partir de 276 px).
- « Premiers pas terminés » restait ouvert jusqu'au clic sur Fermer, même au chargement d'une ville déjà avancée :
  passage direct à l'objectif en cours si les étapes n'ont pas été franchies pendant la session ; sinon message de
  fin, puis repli automatique après 20 s (`TUTO_FINISH_AUTO_MS`).
- « Circulation très lente » restait dans « Problèmes à régler » tant que l'alerte n'était pas lue, même redevenue
  fluide : affiché seulement si la vitesse moyenne reste sous 18 km/h (`TRAFFIC_OK_KMH`, seuil de réarmement).
- Contrôlé : interface PC (26 OK), interface iPhone (succès), tests unitaires.
