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
| Panne du réseau voisin | électricité achetée au raccordement | 2 j / 2 j | capacité du raccordement −50 % |
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

MESURES

## 6. Coût

COUT
