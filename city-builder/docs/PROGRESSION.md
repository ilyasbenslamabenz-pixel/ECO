# Progression, objectifs et événements (vague 4)

Paliers à points d'expansion, déblocages, objectifs qui se renouvellent, réalisations, événements annoncés, et
équilibrage du trafic. Mécaniques inspirées des city-builders modernes ; noms, textes et valeurs propres au jeu.

| Couche | Fichiers |
|---|---|
| Partagé | `src/shared/milestones.ts` (paliers, déblocages, verrous), `src/shared/protocol-ext/objectifs.ts`, `src/shared/protocol-ext/evenements.ts`, `src/shared/governance.ts` (modificateurs d'événements) |
| Simulation | `src/sim/plugins/paliers.ts` (v2), `src/sim/plugins/objectifs.ts`, `src/sim/plugins/evenements.ts` ; sections `src/sim/save-sections/{objectifs,evenements}.ts` |
| Crochets (ajouts minimes) | verrous : `world.ts` (pose du joueur), `zonage`, `politiques`, `ameliorations`, `bus` ; effets : `economy.ts` (`loanBonus`), `demography.ts` (`immigrationFactor`), `services/city-services.ts` (feu, maladie), `waste/system.ts` (camions), `power/system.ts` (raccordement) ; météo : service `meteo` en lecture seule |
| Trafic | `traffic/system.ts` (`demandCeiling`), `world.ts` (plafond des trajets détaillés) |
| Interface | tableau de bord **Progression** (`src/ui/panels/{paliers,objectifs,evenements}.ts`), `src/client/progression-view.ts`, rappel dans l'encadré des Premiers pas (`src/ui/tutorial.ts`), notifications « Voir » (`src/ui/notify.ts`, `hud.ts`), cadenas (`buildbar.ts`, `panels/zonage.ts`, `panels/gouvernance.ts`), Options › Événements, case « Déblocages progressifs » de Nouvelle partie |
| Tests | `tests/jeu/progression.test.ts` (8 tests), `tests/e2e/progression-iphone.mjs` (dans `npm run e2e:mobile`) |

## 1. Points d'expansion et paliers

Chaque jour : **croissance** = 1 point par habitant au-delà du record de population ; **bonheur** =
`habitants × 0,001 × clamp((satisfaction − 45) / 15, 0, 2)` (dès 50 habitants) ; plus les **objectifs** et
**réalisations** (§3). Les points requis valent l'ancien seuil de population : une ville franchit chaque palier au plus
tard comme avant, plus tôt si elle est heureuse et remplit ses objectifs. Chaque palier verse sa prime (inchangée) et
annonce ses déblocages.

| Palier | Points | Prime | Débloque |
|---|---|---|---|
| Hameau | 100 | 100 000 | 3 lignes de bus, politique « Tri obligatoire », emprunt +150 000 |
| Village | 500 | 250 000 | zone de bureaux, centre de tri, amélioration niveau 2, « Soutien au commerce », 4 lignes, emprunt +300 000 |
| Bourg | 1 500 | 400 000 | zone résidentielle dense, hôpital, centrale au gaz, médiathèque, « Aide au logement », 6 lignes, emprunt +600 000 |
| Petite ville | 3 000 | 600 000 | incinérateur, gare, musée et bibliothèque, amélioration niveau 3, « Ville verte », « Filtres industriels », 8 lignes, emprunt +1 M |
| Ville | 6 000 | 900 000 | hôtel de ville, barrage, tours de bureaux, 12 lignes, emprunt +2 M |
| Grande ville | 12 000 | 1,4 M | tour iconique, centre commercial, 16 lignes, emprunt +3,5 M |
| Cité régionale | 25 000 | 2,2 M | 24 lignes, emprunt +6 M |
| Agglomération | 50 000 | 3,5 M | 32 lignes, emprunt +10 M |
| Métropole / Mégapole | 100 000 / 200 000 | 5 M / 8 M | emprunt +15 M / +25 M |

Au départ d'une partie en déblocages progressifs : routes, zones R faible et moyenne, commerce, industrie, école,
centre de santé, police, pompiers, parc, éolienne, solaire, poste, eau, dépôt et décharge, dépôt de bus, 2 lignes,
niveau 1 des équipements, politiques non listées ci-dessus (restrictions d'eau et sobriété restent libres : ce sont des
réponses aux événements).

**Verrous : seulement pour les nouvelles parties.** Commande `paliers.mode { verrous }`, acceptée seulement sur une ville
vide ; l'écran Nouvelle partie l'envoie (case cochée par défaut ; `?autostart` seulement avec `?paliers`). Partie de
test, ville de démonstration, ancienne sauvegarde (sans section, ou section v1) : **tout reste débloqué**. La capacité
d'emprunt supplémentaire s'applique à toutes les parties (bonus additif). Refus côté simulation (pose du joueur — la
promotion privée du zonage n'est pas concernée —, zone, politique, niveau, ligne) avec le palier requis ; cadenas et nom
du palier dans l'interface.

Sauvegarde : section `paliers` v2 (points, détail par source, record de population, verrous). Une section v1 garde ses
paliers et reprend ses points au record de population (source « Acquis »).

## 2. Interface

- **Progression** (menu latéral) : onglets **Paliers** (« Prochain palier : X — a / b points », barre, « Débloque : … ;
  prime », points d'hier, origine des points, liste des paliers), **Objectifs** (en cours, derniers accomplis,
  réalisations), **Événements** (annoncé / en cours, dates, effets chiffrés, « Que faire », historique, fréquence).
- **Rappel** : une fois les Premiers pas terminés ou masqués, leur encadré affiche l'objectif le plus avancé (avancement,
  tenue, récompense, palier suivant, boutons « Voir » et « Progression ») ; sans objectif, le palier suivant.
- **Notifications** : événements, objectifs, réalisations et paliers portent un bouton **Voir** (44 px) vers l'onglet.
- **Options › Événements** : Normal / Rares / Désactivés (mémorisé dans le navigateur, envoyé à chaque partie).
- iPhone (390 px) : vérifié par `tests/e2e/progression-iphone.mjs` (aucun débordement, cibles ≥ 44 px).

## 3. Objectifs et réalisations (module `objectifs`)

Dès 150 habitants, au plus **3 objectifs** ; un nouveau au plus tous les 2 jours, choisi par **gravité du problème
actuel** (rapports de la démographie, des services, du bus, de l'électricité, des déchets, du budget) ; départage par le
flux propre au module. Un objectif est accompli quand sa condition tient 3 jours (électricité : 7 jours ; budget :
3 mois) ; il verse `(25 000 + 20 × habitants) × difficulté` CHF (≤ 2 M) et `8 % × écart du palier × difficulté` points.
Un modèle accompli revient au plus tôt 15 jours après ; « Autre objectif » une fois par semaine de jeu.

Modèles : chômage sous 5 %, couverture police / pompiers / soins / écoles à 80 %, voyageurs en bus par jour (15 % des
habitants), satisfaction (+4 à +8 points, 60 à 80), budget 3 mois de suite, criminalité sous 12, ménages en difficulté de
loyer sous 5 %, entreprises en difficulté sous 8 %, aucune coupure d'électricité 7 jours, bacs pleins sous 2 %,
malades sous 2 %, et en dernier recours un objectif de population.

Réalisations (points une seule fois, 14) : 100 / 1 000 / 5 000 / 20 000 habitants, plein emploi, ville heureuse, ville
sûre, tous à l'école, première ligne, 1 000 voyageurs par jour, 12 mois d'excédent, 5 et 20 objectifs, crise surmontée.

## 4. Événements (module `evenements`)

Tirage : flux aléatoire **propre au module** (jamais le PRNG de la partie). Aucun événement les 45 premiers jours (ni
45 jours après le chargement d'une ancienne sauvegarde), puis chance quotidienne 1/16 (Rares : 1/45), répit de 18 jours
(Rares : 50) après le précédent, jamais deux fois de suite le même, aucun événement négatif pour une ville en faillite ou
sous 40 de satisfaction. Chaque événement est **annoncé** (préavis) avec ce qu'il faut faire ; effets bornés, puis
notification de fin avec l'issue mesurée.

| Événement | Condition | Préavis / durée | Effet |
|---|---|---|---|
| Canicule | juin–août, temps sec, ≥ 20 °C (météo), 400 hab. | 2 j / 4 j (fin si pluie ou orage) | électricité +15 %, eau +25 %, risque de feu ×2, satisfaction −1 |
| Panne du réseau voisin | électricité achetée au raccordement | 2 j / 2 j | capacité du raccordement −35 % |
| Épidémie de grippe | 1 000 hab. (plus probable en hiver) | 3 j / 6 j | maladie ×2,5, satisfaction −1 |
| Grève des éboueurs | dépôt de camions-bennes | 2 j / 4 j | un camion sur quatre en service |
| Afflux d'habitants | ≥ 20 logements libres | 1 j / 5 j | arrivées ×1,8, demande résidentielle +0,25 |
| Investisseur | un objectif en cours | aussitôt / 30 j | prime = 1,5 × récompense de l'objectif le plus avancé, s'il est atteint à temps (sinon rien) |

Désactiver les événements annule un événement annoncé ; un événement déjà en cours va à son terme. Commande de
diagnostic `declencher { kind }`.

## 5. Trafic : constat et correctif

Constat (avant) : la saturation n'était **pas** un artefact du seul script de test. Une minute de jeu ne dure que 0,1 s
de conduite ; les habitants **détaillés** (à moins de 600 m du point focal, c'est-à-dire de la caméra) émettaient chacun
leur voiture, sans plafond, et ces voitures restaient des heures de jeu sur la chaussée. Toute ville vue de près se
bloquait ; la même ville loin du point focal (demande statistique seule) roulait normalement. Correctif : les trajets
détaillés remplissent le **même nombre de voitures simultanées** que la demande statistique (`demandCeiling`, profil
horaire × habitants × facteur bus), au-delà ils ne vont pas sur la chaussée simulée. Capacités, IDM, carrefours et feux
inchangés (docs/CIRCULATION.md §1).

Mesures (Node, catalogue réel, graine 42, impôt résidentiel 11 %, 360 jours, moyennes des jours 120 à 360 à la pointe
7 h 30–9 h et 17 h–18 h 30, une minute de jeu par tick comme dans le jeu ; avant / après) :

| Ville | Véhicules à la pointe | Vitesse moyenne | Réseau saturé |
|---|---|---|---|
| Partie type de la vague 3 (grille 7 × 7 au pas de 160 m + avenue, 2 lignes de bus), point focal au centre | 1 842 / 103 | 4,0 / 24,8 km/h | 91,7 / 9,3 % |
| Même ville, point focal loin (demande statistique seule) | 112 / 111 | 25,5 / 25,3 km/h | 10,3 / 10,3 % |
| Ville « comme un joueur » (2 avenues + rues de desserte) | 1 029 / 129 | 2,9 / 17,3 km/h | 97,1 / 17,7 % |
| Ville de démonstration (`buildCity demo`, 2 869 hab.) | 491 / 113 | 7,2 / 18,3 km/h | 82,6 / 29,2 % |
| Protocole d'origine de la vague 3 (pas de 10 min, pointe 6 h–9 h), jour 360 | 2 217 / 112 | 2,5 / 22,3 km/h | 97,6 / 11,9 % |

Partie type complète (avant / après, vague 3 au centre) : population moyenne 2 765 / 2 734 (fin 2 797 / 2 770),
satisfaction 61,3 / 65,2, chômage moyen 1,4 / 2,6 %, trésorerie au jour 360 2,18 M / 2,85 M CHF, paliers atteints
Bourg / Petite ville (5 465 points d'expansion), 5 objectifs
accomplis, 7 réalisations, 7 événements (2 investisseurs non suivis par le script, panne du réseau voisin — jusqu'à 65 %
des bâtiments coupés, le script ne réagit pas —, 2 grèves tenues, 2 épidémies de 103 et 132 malades), voyageurs en bus
586 / 596 par jour. Le script ne réagit à rien : les objectifs restants (écoles, soins, électricité) et les investisseurs
demandent un joueur.

## 6. Coût


Ville de charge (`buildCity stress` : 500 bâtiments, 21 034 habitants, 30 jours à une minute par tick, Node 22, ce
conteneur ; avant / après) : tick moyen 2,86 / 1,60 ms (p95 5,93 / 1,83 ms) ; tick du début de jour 129 / 107 ms en
moyenne (médiane 108 / 100 ms) ; clôture mensuelle 233 / 162 ms. La baisse vient du trafic : 2 068 / 448 véhicules à
8 h au quatrième jour (5,1 / 17,4 km/h), le plafond des trajets détaillés retirant l'excès de voitures. Coût propre des
modules par appel : `paliers.onDayStart` 4,9 ms (rapport de la démographie, partagé avec les objectifs),
`objectifs.onDayStart` 0,17 ms, `evenements.onDayStart` 0,008 ms, `onTick` et `takeDelta` < 0,001 ms ; aucune boucle
par citoyen, une boucle par bâtiment par jour (bacs pleins).

## 7. Limites connues

- Les verrous ne valent que pour les poses du joueur : la croissance des zones (promotion privée) n'est pas filtrée.
- Les cadenas du tiroir de construction se mettent à jour à la prochaine ouverture du tiroir.
- La première notification d'une partie n'est jamais affichée (règle existante de `main.ts`) ; elle reste dans l'onglet.
- Pas d'achat de cases de carte (ce système n'existe pas dans le jeu).
- Réglages (fréquences, récompenses) non sauvegardés : constantes du code.

## 8. Arbres de développement (module `developpement`)

Chaque palier franchi rapporte des **points de développement** (Hameau 1, Village 2, Bourg 2, Petite ville 3, Ville 3,
Grande ville 4, Cité 4, Agglomération 5, Métropole 5, Mégapole 6 : 35 au total), déduits des paliers atteints (rien à
sauvegarder : une ancienne partie dispose aussitôt des points de ses paliers). Ils se dépensent dans six arbres
(électricité, eau, transports, santé, éducation, police ; 4 nœuds chacun, 1 à 3 points, prérequis dans l'arbre ;
42 points pour tout : il faut choisir). Effets permanents (`src/shared/development.ts`) :

- modificateurs combinés avec politiques, recherche et événements (`governanceModifiers`, service `developpement`) :
  demande d'électricité et d'eau, production renouvelable, raccordement, entretien des routes, demande de zones,
  maladies, bonheur ;
- équipements de santé, d'éducation et de police : rayon et capacité (×, `demography.devRadius` / `devCapacity`) ;
  criminalité cible (`services.devCrimeFactor`) ; études supérieures et formation (`demography.educationFactor`) ;
- bâtiments spéciaux débloqués avant leur palier (déblocages progressifs) : centrale au gaz, barrage, gare, hôpital,
  médiathèque, musée et bibliothèque (`paliers.assetLock` et cadenas de l'interface).

Commandes `state`, `unlock { id, dryRun? }` ; notification à chaque palier qui apporte des points. Interface : onglet
**Développement** du tableau de bord Progression (`src/ui/panels/developpement.ts`). Sauvegarde : section
`developpement` v1 (`unlocked`), absente sans déblocage. Tests : `tests/jeu/developpement.test.ts`.
