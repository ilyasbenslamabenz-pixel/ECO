# Simulation — moteur, économie, démographie, sauvegarde

Tout ce module est du TypeScript pur (`src/sim/**`) : il n'importe ni three ni le DOM, ce que vérifie
`tests/unit/architecture.test.ts`. Il tourne dans le worker `dist/sim.worker.js`. Le stockage navigateur
est dans `src/save/**` (thread principal).

## Boucle et temps
- `loop.ts` : pas fixe de 100 ms (`SIM_TICKS_PER_SECOND = 10`) à accumulateur, découplé du rendu. Chaque pas
  exécute `speed` ticks (0, 1, 2 ou 4). Au plus 5 pas sont rattrapés, puis le retard est abandonné (pas de spirale).
- Un tick = 2 minutes de jeu. `clock.ts` gère un calendrier de 12 mois de 30 jours, des semaines qui commencent
  le lundi, les saisons et la date en français.
- `scheduler.ts` : tas binaire d'événements (minute, ordre d'insertion), ponctuels ou récurrents, sauvegardés.
  Événements récurrents :
  - `DayStart` : démographie quotidienne ;
  - `MonthStart` : clôture économique ;
  - `YearStart` ;
  - `Migration` : toutes les 6 h de jeu ;
  - `TrafficSync` : toutes les heures, transmet les occupants réels au trafic.
- `rng.ts` : PRNG sfc32 à état sérialisé. Une partie rechargée se poursuit à l'identique ; le test
  « aller-retour v2 » le vérifie sur 35 jours de jeu.

## Données (SoA)
- **Bâtiments** (`ecs.ts`) : `BuildingStore` (avec `roadAccess`, `residents`, `workers`) et `RoadGraph`.
- **Index spatial par chunk** (`ChunkIndex`, cellules de 256 m) pour les bâtiments, les tronçons et les nœuds.
  Il remplace les parcours en O(n) pour les collisions, l'accrochage des nœuds, l'accès route, la recherche
  d'emploi et la couverture des services.
- **Population** (`population.ts`) : `SoaTable` générique (typed arrays, suppression par permutation,
  table id -> index, sérialisation par colonnes). Trois tables :
  - **citoyens** : id, ménage, sexe, prénom, naissance, éducation, rôle, logement, emploi, école, revenu,
    bonheur, distance du trajet, horaires, activité, LOD, poids (simulation agrégée, voir « Grandes villes ») ;
  - **ménages** : nom, logement, taille, emménagement, mois de mécontentement ;
  - **entreprises** : une par bâtiment d'emploi, avec secteur, chiffre d'affaires et bénéfice.
- **Noms** (`names.ts`) : tables de prénoms et de noms français. Les citoyens ne stockent que des index.

## Démographie (`demography.ts`)
- **Accès route** : un bâtiment est desservi si une route passe à 8 m ou moins de son empreinte.
  Sans accès, il n'a ni habitant, ni emploi, ni couverture de services.
- **Immigration** (toutes les 6 h) : le nombre d'arrivées vaut logements libres / 2,6 × attractivité × 0,12,
  avec au plus 60 ménages par vague.
  - Les ménages sont tirés au sort : personne seule, couple, famille, parent seul, retraités.
  - L'éducation des adultes est tirée selon une distribution.
  - L'attractivité dépend des emplois libres, du bonheur moyen, de la couverture des services, des
    équipements `attractivite:N` et du taux d'imposition résidentiel.
- **Chaque jour** :
  - **Décès** : mortalité de Gompertz, 0,0004·e^{0,095(âge−30)} par an, réduite de 30 % sous couverture santé.
  - **Retraite** à 64 ans, avec une pension.
  - **Scolarité** de 6 à 17 ans, dans l'école la plus proche qui couvre le logement et a de la place
    (`capacite_service`). Diplômes à 11 ans, 16 ans, puis bac pour 80 % des élèves à 18 ans.
  - **Recherche d'emploi** : emploi libre le plus proche, par anneaux de chunks, à moins de 4 km. Les bureaux
    exigent le bac et les services publics le brevet, sauf s'il n'existe aucun autre emploi. Au plus 4 000
    recherches par jour, et aucune s'il n'y a pas d'emploi libre.
  - **Bonheur** : emploi, services (éducation pour les enfants, santé, sécurité, incendie, loisirs),
    attractivité locale, pollution (`pollution:N` à moins de 400 m), longueur du trajet, impôts, accès route.
  - **Naissances** : ménage d'au moins deux adultes avec une femme de 18 à 42 ans et de la place dans le
    logement. Probabilité de 9 % par an × (0,5 + bonheur/100).
  - **Décohabitation** : un jeune adulte actif part avec une probabilité de 30 % par an, s'il trouve un logement libre.
- **Chaque mois** : les ménages dont le bonheur moyen reste sous 30 pendant 3 mois quittent la ville.
  Les comptes des entreprises sont tenus, puis les assiettes fiscales calculées.
- **Démolition** : les ménages sont relogés ailleurs s'il y a de la place, sinon ils partent ; les employés
  sont licenciés.
- **Emploi du temps** : horaires individuels tirés au sort (réveil 5 h 30 – 8 h, début du travail 45 à 95 min après le réveil, journée de 7 h 30 à 9 h,
  coucher 21 h 30 – 24 h). Activités : sommeil, maison, trajet aller, travail, pause de 12 h à 13 h, trajet
  retour, loisirs, école. Le trajet dure 5 min + distance à 27 km/h. Pas de travail le week-end.
- **LOD de simulation**, selon la distance entre le logement et le point focal (`setFocus`) :
  - **détaillé** (moins de 600 m) : activité évaluée à chaque tick et trajets individuels transmis au trafic
    (`TrafficSystem.spawnTrip`) ;
  - **simplifié** (moins de 1 500 m) : activité évaluée toutes les 30 min de jeu, sans trajet individuel ;
  - **statistique** : activité non suivie, estimée par échantillonnage d'un citoyen sur 8 pour les statistiques.

  La demande statistique du trafic est réduite de la part des citoyens détaillés, pour ne pas compter deux fois.
  Le cycle de vie (âge, emploi, naissances, décès, migrations) est simulé pour tous les citoyens.

## Économie (`economy.ts`)
- **Impôts** : il y en a quatre, résidentiel, commerces, industrie et bureaux. Le taux par défaut est de 9 %,
  réglable de 0 à 25 %.
  - L'assiette résidentielle vaut 25 % des revenus des ménages : salaires et pensions.
  - Les entreprises sont imposées sur 50 % du bénéfice positif. Le bénéfice vaut chiffre d'affaires − salaires
    réels − 10 % de frais.
  - Le chiffre d'affaires est le produit des employés par la productivité du secteur. Pour les commerces, il est
    aussi modulé par la clientèle : habitants + 0,5 × actifs, avec 1 emploi commercial pour 20 clients.
- **Dépenses** :
  - entretien des bâtiments et des routes ;
  - salaires des services publics (agents employés × 2 300 × 6 % à la charge de la commune) ;
  - échéances d'emprunt.
- **Emprunts** :
  - taux de 3,5 %, plus 1,5 % par emprunt en cours, plus 2 % en cas de déficit ;
  - durée de 12 à 240 mois, mensualité constante (annuité) ;
  - capacité de 1 M plus 36 mois de recettes moyennes, moins la dette ;
  - remboursement anticipé sans pénalité.
- **Faillite** : au bout de 3 clôtures mensuelles consécutives avec une trésorerie négative, constructions et
  emprunts sont suspendus. La ville sort de faillite dès que la trésorerie redevient positive.
- **Prévision** : bilan du mois et projection de la trésorerie sur 12 mois, avec amortissement réel des emprunts.
- **Historique** : bilan mensuel détaillé (240 mois au plus).
- **Économie vivante** (`src/sim/economie/`, détails dans `docs/ECONOMIE_VIVANTE.md`) : loyers dérivés de la valeur
  foncière, ménages en difficulté (relogement, départ), comptes des entreprises nets du loyer, fermetures avec raison et
  reprises, chômage par quartier, adéquation éducation / emploi ; pression progressive (30 j de grâce + 30 j de montée).
- **Services qui comptent** (`src/sim/services/`, module `services`, détails dans `docs/SERVICES.md`) : criminalité par
  bâtiment (chômage, pauvreté, densité, police), incendies (risque, pompiers, dégâts, ruines, reconstruction), santé des
  logements et maladies (pollution, âge, soins) ; même pression progressive ; cartes d'information dans le menu Calques.
- **Progression** (modules `paliers`, `objectifs`, `evenements`, détails dans `docs/PROGRESSION.md`) : points d'expansion,
  paliers et déblocages (parties neuves), objectifs selon les problèmes de la ville, réalisations, événements annoncés.

## Sauvegarde
- **Format** (`save-format.ts`) : JSON v2 = v1 (paramètres, horloge, bâtiments, routes, identifiants) + économie
  complète + population en colonnes + état du PRNG et du planificateur.
  - Migrations successives : `MIGRATIONS[1]` convertit la v1 en v2, avec une population vide.
  - Une version future est refusée explicitement.
  - **Validation stricte** des types, bornes, doublons, références (nœuds, bâtiments, ménages) et compteurs.
    Une erreur donne un message en français, jamais une exception.
  - Au chargement, les chevauchements et les empreintes hors carte restaurent la partie en cours.
- **Stockage** (`src/save/`) :
  - gzip via `CompressionStream` (environ 4× plus petit) ;
  - IndexedDB, avec repli sur localStorage en base64 puis sur la mémoire ;
  - emplacements multiples, avec métadonnées séparées pour lister sans décompresser ;
  - export et import de fichiers `.aube.gz` ou `.aube.json` ;
  - sauvegarde automatique en rotation sur `auto-1` à `auto-3`.

## Performances mesurées (Node 22, ce conteneur, sans GPU)
- **Ville de 6 000 citoyens, tous en LOD détaillé** :
  - tick monde d'environ 0,2 à 0,3 ms, soit environ 1,2 ms par pas à ×4 ;
  - passe quotidienne d'environ 6 à 12 ms ;
  - rapport d'environ 1 ms ;
  - sauvegarde de 8,8 ms pour 590 Ko de JSON.
- **Banc d'essai Chromium** (1 087 habitants) : 112 Ko de JSON deviennent 28 Ko en gzip.
- Grandes villes (54 000 à 1 million d'habitants) : voir la section suivante.

## Grandes villes : passage à l'échelle et simulation agrégée

### Banc de charge (`npm run bench:population -- <habitants> [--roads=N] [--days=N] [--individuel] [--logement=tour] [--json]`)
`tests/perf/population-bench.ts` (Node, sans navigateur) construit une ville synthétique sur une carte plate de
32 chunks : quadrillage de rues tous les 176 m tracé par `buildRoad`, îlots de 16 immeubles de 46 habitants (un
immeuble de bureaux ou un centre commercial par îlot) plus une école et un hôpital ou commissariat posés par
`placeBuilding`, puis ménages créés directement (composition de l'immigration, même règle de poids) et emplois
attribués par la recherche d'emploi de la démographie, sans plafond quotidien. Il mesure ensuite le tick qui franchit
minuit (`DayStart` + modules), la passe `daily()`, le tick ordinaire, le rapport, la clôture mensuelle et la
sauvegarde. `--roads=N` prolonge le réseau jusqu'à N tronçons (durée de `buildRoad` par tranche de taille du réseau,
puis 20 tracés isolés suivis chacun d'un tick, qui reconstruit le graphe de circulation).

### Mesures brutes (moyenne / p95 / max en ms)
Machine : Intel Xeon @ 2,30 GHz × 4 (conteneur Linux), 16 Go, Node v22.23.4, tsx (sans minification). « Avant » =
commit 5ae2ea4, même script.

| Scénario | Habitants (lignes) | Tick de minuit | `daily()` | Tick ordinaire | Rapport | Sauvegarde | Tas |
|---|---|---|---|---|---|---|---|
| 54 k avant | 57 336 | 686 / 728 / 728 | 649 / 712 / 712 | 1,10 / 1,87 / 5,65 | 14,8 | 189 ms, 9,2 Mo | 84 Mo |
| 54 k après | 57 336 | 150 / 165 / 165 | 101 / 109 / 109 | 0,98 / 1,56 / 4,06 | 14,1 | 220 ms, 9,5 Mo | 96 Mo |
| 200 k avant | 203 284 | 12 788 / 14 664 / 14 664 | 12 686 / 14 496 / 14 496 | 2,74 / 4,89 / 9,26 | 24,8 | 592 ms, 26,6 Mo | 145 Mo |
| 200 k après, individuel | 203 284 | 321 / 369 / 369 | 245 / 262 / 262 | 2,07 / 2,73 / 5,86 | 17,6 | 494 ms, 27,5 Mo | 133 Mo |
| 200 k après, agrégé | 203 325 (153 221) | 282 / 322 / 322 | 217 / 229 / 229 | 1,86 / 3,03 / 5,88 | 14,7 | 370 ms, 22,4 Mo | 140 Mo |
| 1 M après, individuel | 977 984 | 1 878 / 1 921 / 1 921 | 1 628 / 1 674 / 1 674 | 5,85 / 8,74 / 18,1 | 88,6 | 2 221 ms, 125,6 Mo | 705 Mo |
| 1 M après, agrégé | 977 259 (343 656) | 796 / 1 056 / 1 056 | 650 / 815 / 815 | 3,72 / 5,08 / 17,6 | 37,9 | 906 ms, 53,7 Mo | 344 Mo |

« Avant » à 1 M n'a pas été mesuré (passe quotidienne de 12,8 s dès 200 k, construction du réseau trop longue).
Les villes 54 k et 200 k individuelles ont exactement la même population avant et après (mêmes tirages).

Création de route (réseau de 2 501 tronçons, ville de 54 k) :

| | `buildRoad` à 0–500 tronçons | 1 000–2 000 | 2 000–3 000 | tracé isolé à 2 501 | tick suivant (graphe de circulation) |
|---|---|---|---|---|---|
| avant | 19,5 | 123,4 | 180,4 | 211,6 / 263,7 / 263,7 | 871 / 1 007 / 1 007 |
| après | 1,17 | 2,22 | 2,16 | 0,72 / 1,39 / 1,39 | 107 / 1 190 / 1 190 (1er tick : cache vide ≈ 1,1 s ; ensuite ≈ 50 ms) |

### Optimisations (résultat identique, testé)
- **Nivellement local des routes** (`Simulation.regradeRoadRegion`) : un tracé ou une suppression ne re-nivelle plus
  toute la carte à partir de toutes les routes, mais la région touchée (tronçons ajoutés / retirés et voisins de leurs
  extrémités, élargie de la portée du talus), avec les seules routes qui l'atteignent. Test : hauteurs identiques à
  l'octet près à celles d'un nivellement complet (rechargement) après tracés, découpes, courbes et suppressions.
- **Graphe de circulation** : conversion du réseau différée au prochain pas (`TrafficSystem.setNetworkSource`, une
  seule conversion pour plusieurs tracés) ; conflits entre connecteurs mémorisés par carrefour et réutilisés quand la
  géométrie du carrefour est inchangée (`ConflictCache`). Test : conflits identiques au calcul complet.
- **Recherche d'école** : liste des écoles relevée une fois par jour au lieu d'une requête spatiale de 7 km par élève
  sans école (≈ 400 ms par jour à 54 k quand les écoles sont pleines). Seul l'ordre entre deux écoles exactement
  équidistantes peut différer.
- **Recherche d'emploi** : cellules de l'index spatial réduites aux bâtiments d'emploi ouverts et desservis pendant la
  passe quotidienne (les logements ne sont plus parcourus) ; mêmes candidats dans le même ordre.
- **Recherche de logement** : capacité filtrée (accès, incendie, réseaux des modules) relevée une fois par vague
  d'immigration et par passe de décohabitation, au lieu d'appeler les filtres des modules pour chaque bâtiment et
  chaque ménage ; occupation relue en direct, même tirage.

### Simulation agrégée (ménages agrégés pondérés)
- **Principe** : une ligne de ménage (et chacun de ses membres) peut représenter `poids` ménages identiques logés dans
  le même bâtiment (colonne facultative `weight` des tables citoyens et ménages ; 0 = 1). Toutes les sommes sont
  pondérées : occupation des bâtiments (`residents`, `workers`), élèves, population, ménages, actifs, chômeurs,
  revenus et assiettes fiscales, salaires et sous-qualification des entreprises, clientèle, statistiques du rapport,
  facteurs de satisfaction, criminalité / santé par logement, loyers et difficultés (un ménage représentatif, comptes
  pondérés), navetteurs du bus, compteurs du mois. Les tirages (décès, naissance, maladie…) restent un par ligne : même
  espérance, variance plus forte à petite échelle.
- **Activation automatique et progressive** : sous `AGGREGATE_THRESHOLD` = 100 000 habitants, rien ne change (poids 1,
  aucun tirage supplémentaire : parties identiques). Au-delà, les ménages immigrants ont le poids
  ⌈population / 100 000⌉ (plafond 16) ; le nombre d'arrivées reste compté en ménages réels (même plafond de 60 ménages
  par vague). Naissances et décohabitations héritent du poids du ménage. Un ménage agrégé trop grand pour les
  logements libres voit son poids réduit ; un emploi qui n'a pas assez de places pour tout le poids détache une partie
  du ménage (`splitHousehold`, totaux inchangés). Les ménages déjà présents ne sont pas fusionnés (non fait).
- **Agents visibles** : une ligne agrégée n'est jamais en LOD détaillé ; ses déplacements passent par la demande
  statistique du trafic (piétons et véhicules visibles restent échantillonnés comme avant). Les fiches d'un bâtiment
  listent les lignes (habitants représentatifs) ; leurs compteurs sont pondérés.
- **Sauvegardes** : la colonne `weight` n'est écrite que si au moins une ligne est agrégée (format v2 inchangé pour
  les autres villes) ; une sauvegarde sans colonne se charge avec le poids 1 partout ; l'occupation est recomptée au
  chargement à partir des poids.
- **Tolérances testées** (`tests/sim/scale.test.ts`, poids 4 imposé contre simulation individuelle, moyenne de 3 à 4
  graines) : population, ménages, emplois occupés, actifs et assiette résidentielle à 6 % (ville installée, 30 jours)
  ou 10 % (ville en croissance, 4 jours) ; assiettes des entreprises à 12 % ; demandes R/C/I/O et taux de chômage à
  0,15 près ; bonheur à 4 points. Écarts mesurés à 30 jours : population 0 %, emplois 0 %, assiette résidentielle
  +0,6 %, demande résidentielle 0,033 contre 0,033.
- **Non fait** : fusion des ménages individuels existants quand la ville passe le seuil, étalement de la passe
  quotidienne sur plusieurs ticks (elle reste un pic de ≈ 0,8 s à un million d'habitants agrégés sur cette machine),
  reconstruction incrémentale complète du graphe de circulation (≈ 50 ms par tracé à 2 500 tronçons, 1,1 s au premier
  tick quand le cache est vide).

## Portage Unity / Unreal
Les tables SoA deviennent des `NativeArray<T>` (Unity, Jobs/Burst) ou des `TArray` (Unreal). Le PRNG sfc32,
la loi de mortalité, les formules d'économie et le planificateur se transcrivent tels quels. Le format de
sauvegarde JSON v2 est indépendant du moteur, et les tests `tests/sim/*.test.ts` servent de spécification.
