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
    bonheur, distance du trajet, horaires, activité, LOD ;
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
- Ces mesures ne valent pas pour les cibles de 100 000 citoyens et plus : elles n'ont pas été mesurées.

## Portage Unity / Unreal
Les tables SoA deviennent des `NativeArray<T>` (Unity, Jobs/Burst) ou des `TArray` (Unreal). Le PRNG sfc32,
la loi de mortalité, les formules d'économie et le planificateur se transcrivent tels quels. Le format de
sauvegarde JSON v2 est indépendant du moteur, et les tests `tests/sim/*.test.ts` servent de spécification.
