# Transports en commun : lignes de bus (vague 3)

Le joueur trace ses lignes de bus ; les habitants choisissent entre voiture, marche et bus. Mécaniques inspirées des
city-builders modernes ; formules, textes et valeurs propres au jeu.

| Couche | Fichiers |
|---|---|
| Partagé | `src/shared/protocol-ext/bus.ts` (types, réglages `DEFAULT_BUS_TUNING`, palette, limites) |
| Simulation | `src/sim/transit/route.ts` (accroche des arrêts, boucle par le plus court chemin), `src/sim/transit/system.ts` (`BusSystem`), module `src/sim/plugins/bus.ts` |
| Sauvegarde | `src/sim/save-sections/bus.ts` (section `bus` v1) |
| Cœur (ajouts minimes) | `demography.ts` (crochets neutres `transit*`, compteurs), `traffic/system.ts` (champ `carFactor`), `world.ts` (rattachement, trajets détaillés), `city-builder.ts` (quartier du dépôt) |
| Rendu | `src/render/plugins/bus.ts` (nouveau ; seul le registre `src/render/plugins/index.ts` gagne une ligne) |
| Interface | `src/ui/bus-editor.ts` (outil), `src/ui/buildbar.ts` (onglet « Lignes de bus »), `src/ui/panels/transports.ts` (panneau « Bus »), `src/ui/layers-menu.ts` (calque), `src/ui/satisfaction.ts` (aides), `src/input/tools.ts` (`capturesAt` transmis à l'outil d'un module) |
| Catalogue | `assets/catalog.json` : entrée `depot_bus` |
| Tests | `tests/jeu/bus.test.ts` (9 tests), `tests/e2e/bus-iphone.mjs` (`npm run e2e:bus`, inclus dans `npm run e2e:mobile`) |

## 1. Outil « Lignes de bus »

Barre d'outils › Transports (sur téléphone : Réseaux › Transports) › onglet **Lignes de bus**, ou bouton « Tracer ou
modifier une ligne » du panneau Bus.

- **Nouvelle ligne** : chaque toucher sur une route pose l'arrêt suivant, dans l'ordre. La simulation accroche l'arrêt
  à la route praticable la plus proche (28 m ; ni rue piétonne, ni autoroute) et calcule la boucle (retour au premier
  arrêt) : l'aperçu (ruban translucide, anneaux blancs, longueur, durée d'un tour, coût des abribus) s'affiche **avant**
  « Valider la ligne ». Un arrêt se déplace en le faisant glisser, se sélectionne d'un toucher (« Retirer l'arrêt »).
- **Ligne existante** : toucher une route ajoute un arrêt là où il allonge le moins la boucle ; glisser déplace ;
  toucher ouvre la **fiche d'arrêt** (nom modifiable, rang, montées et descentes par jour, habitants et emplois à 400 m,
  attente moyenne, « Retirer l'arrêt »). Nom, couleur (10 pastilles), nombre de bus (− / +), tarif (pas de 0,25 CHF,
  0 à 5 CHF), suppression (deux touchers).
- **Annulation** : chaque modification empile son inverse dans l'historique existant (`ConstructionTools.undo`, étapes
  `plugin`) : création ↔ `deleteLine`, suppression ↔ `restoreLine`, arrêt ajouté ↔ `removeStop`, déplacé ↔ `moveStop`,
  retiré ↔ `addStop` au même rang, réglages ↔ `updateLine` aux valeurs d'avant. Ctrl+Z ou bouton Annuler.
- **Au doigt** : boutons et pastilles d'au moins 44 px ; un doigt sur la carte la déplace, sauf s'il commence sur un
  arrêt (glisser) ; un toucher bref pose ; deux doigts gardent la caméra (`setPointerOverride` + `capturesAt`).
- **Débloquage** : disponible dès le début de la partie (aucun palier ne verrouille d'outil dans ce jeu,
  `src/shared/milestones.ts`) ; les aides de croissance le suggèrent quand c'est utile (§5).

## 2. Tracé (`src/sim/transit/route.ts`)

Le pathfinding du trafic est réutilisé tel quel : `RoutingGraph` + `AStar` (`src/sim/roads/routing.ts`, sens uniques
respectés, rues piétonnes exclues), sur une vue du réseau construite depuis la façade en lecture seule des modules ; le
graphe n'est reconstruit qu'à chaque version du réseau. Entre deux arrêts, les quatre combinaisons (sortie par une
extrémité du tronçon, entrée par une extrémité du suivant, plus le trajet direct sur le même tronçon) sont comparées.
Géométrie : polyligne sur la voie de droite (8 m), hauteur de la chaussée (ponts, tunnels). Quand le réseau change, les
arrêts sont réaccrochés à la route la plus proche et la boucle recalculée ; sinon la ligne est signalée (« Arrêt 3
injoignable… », « plus de route praticable »).

## 3. Dépôt de bus

Aucun modèle de dépôt de bus n'existe dans le catalogue : **le modèle du dépôt de camions-bennes est réutilisé**
(`depot_bus`, livrée « bandeau bleu », étiquettes `transport`, `depot_bus`, `bus:20`, `reutilise:dechets_depot_camions`) :
260 000 CHF, entretien 1 200 CHF/mois, 30 emplois, 20 bus. Il apparaît dans Transports › Gares et dépôts. Sans dépôt
relié à la route, aucune ligne ne roule ; au-delà de la capacité totale, les bus sont répartis au prorata. Entretien
d'un bus en service : 1 600 CHF/mois (débité chaque jour) ; abribus : 600 CHF par arrêt créé (prix du catalogue).

## 4. Demande (une fois par jour, sans agent par passager)

Chaque actif ou élève (domicile → travail ou école) choisit par logit sur un coût généralisé
`CHF = 0,25 × minutes + coût monétaire` (sensibilité 0,55 par CHF) :

- **voiture** : distance × 1,3 à la vitesse moyenne observée du trafic en journée (6 km/h au moins) + 4 min ; 0,30 CHF/km
  + 1 CHF de stationnement − 0,6 CHF de confort ;
- **marche** : distance × 1,25 à 75 m/min ;
- **bus** (si une même ligne en service dessert les deux bâtiments à moins de 400 m de marche) : marche jusqu'à l'arrêt,
  attente = moitié de l'intervalle (≤ 30 min), trajet le long de la boucle (22 km/h × ralentissement dû aux bouchons,
  20 s par arrêt), marche finale ; aller et retour peuvent emprunter des arrêts différents ; tarif.

Les probabilités sont sommées par arrêt (montées, descentes) et par tronçon de ligne (différences cumulées). Charge =
16 % des voyages du tronçon le plus chargé / capacité horaire (bus × 60 places × 60 / durée du tour) ; au-delà de 100 %,
l'excédent reste en voiture (« refusés »). Week-end : 45 % des voyages.

## 5. Effets

- **Trafic** : `TrafficSystem.carFactor = voitures avec bus / voitures sans bus` multiplie la demande automobile ; les
  trajets détaillés (LOD) sont filtrés par le même facteur (tirage déterministe, PRNG de la partie intact).
- **Budget** : recettes des tarifs − entretien des bus, chaque jour (`applyService`, ligne « Services »).
- **Emploi** (économie vivante) : un logement desservi étend la portée de la recherche d'emploi de 3 km × qualité de
  desserte, vers les emplois desservis par la même ligne (au-delà des 4 km de base). Compteurs : `transitHires`,
  recherches sans emploi accessible `jobNoReachDay`.
- **Satisfaction** : facteur « Temps de trajet » + 4 × qualité de desserte du logement (qualité = (1 − ½ marche / 400 m)
  × min(1, 10 min / intervalle)).
- **Aides de croissance** : `need-transit` (chômage > 8 % dont au moins 30 % de recherches sans emploi à portée ; prioritaire
  sur « créez des emplois »), `traffic-jam` (plus de 25 % du réseau saturé, 300 habitants au moins).

## 6. Interface, rendu, protocole

- Panneau **Bus** (tableau de bord Transports) : réseau (lignes, dépôts, bus, voyages, parts modales, trafic évité,
  couverture, embauches, recettes et coût), puis chaque ligne et ses arrêts.
- Calque **Transports en commun** (menu Calques) : bâtiments occupés à moins de 400 m d'un arrêt en service (bleu, plus
  intense si fréquent) ou non (rouge), grille de 32 m.
- Rendu : ruban coloré par ligne, arrêts (poteau, panneau et pastille de la couleur de la ligne : 3 `InstancedMesh`),
  bus (caisse colorée + bandeau vitré : 2 `InstancedMesh`) placés à chaque image depuis le temps physique (0,1 s par minute
  de jeu, comme le trafic) avec arrêt aux stations : aucune trame de positions transférée.
- `delta.ext.bus` : lignes et arrêts à chaque changement, géométrie seulement quand un tracé change, temps physique
  ≈ 1 fois par seconde réelle ; rien sans ligne. Commandes : `state`, `stats`, `snap`, `preview`, `createLine`,
  `updateLine`, `deleteLine`, `restoreLine`, `addStop`, `moveStop`, `removeStop`, `renameStop`, `stop`, `calque`.

## 7. Sauvegarde

Section `save.plugins.bus` v1 (absente sans ligne) : lignes (nom, couleur, bus, tarif, arrêts avec identifiant, position,
nom), comptes du mois, facteur voiture et vitesse de référence (reprise identique, testée). Une ancienne sauvegarde se
charge sans ligne ; une section illisible est signalée et la partie se charge sans ligne.

## 8. Mesures et limites

Partie type (Node, catalogue réel, graine 42, carte de 8 tronçons sans eau, impôt résidentiel 11 %, grille de rues 7 × 7,
deux lignes de 10 et 12 arrêts à 6 bus chacune posées au jour 38 avec un dépôt) — moyennes des jours 120 à 360, sans / avec :
population 2 712 / 2 780, chômage 2,5 / 2,0 %, satisfaction 58,1 / 61,3, véhicules à la pointe 2 286 / 2 198, réseau saturé
96,4 / 95,8 % ; part du bus 13 %, facteur voiture 0,87, ≈ 590 voyages par jour, recettes ≈ 21–23 k CHF / entretien 19,2 k CHF par
mois ; trésorerie au jour 360 : 2,57 M / 2,33 M (investissement initial dépôt + abribus ≈ 0,27 M). Ville de charge (500 bâtiments,
21 000 habitants, trois lignes) : module par tick ≈ 0,001 ms ; passe quotidienne du module 3 à 5 ms (10 à 12 ms les premiers
jours, avant compilation) ; tick moyen et clôture mensuelle sans écart au-delà du bruit de mesure. Rendu : 20 bus mis à jour en
0,06 ms par image (Chromium logiciel), 5 appels de dessin + 1 par ligne.

Limites : bus non simulés dans le trafic (ils
ne bloquent ni ne subissent individuellement les carrefours ; leur vitesse suit la vitesse moyenne des voitures) ; un
arrêt appartient à une seule ligne (pas de correspondances) ; au plus 32 lignes de 40 arrêts ; la portée d'embauche ne
change rien tant que la ville tient dans un rayon de 4 km ; réglages non sauvegardés.
