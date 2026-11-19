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
