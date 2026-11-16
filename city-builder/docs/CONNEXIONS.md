# Connexions extérieures

Une route du joueur qui aboutit au bord de la carte relie la ville au reste du pays. Mécaniques inspirées des
city-builders modernes ; formules, textes et valeurs propres au jeu.

| Couche | Fichiers |
|---|---|
| Partagé | `src/shared/protocol-ext/connexions.ts` (types, réglages `DEFAULT_CONNEXIONS_TUNING`) |
| Simulation | `src/sim/connexions/system.ts` (`ConnexionsSystem`), module `src/sim/plugins/connexions.ts` |
| Sauvegarde | `src/sim/save-sections/connexions.ts` (section `connexions` v1) |
| Cœur (ajouts minimes, neutres par défaut) | `traffic/system.ts` (`setGates`, `externalShare`, `externalFreightShare`, compteurs, `spawnFromOutside`), `demography.ts` (`externalImmigrationFactor`, `onImmigrantHousehold`), `world.ts` (rattachement, une ligne) |
| Rendu | `src/render/plugins/connexions.ts` (portique et panneau fléché à chaque connexion) |
| Interface | `src/ui/panels/transports.ts` (panneau « Connexions extérieures » du tableau de bord Transports) |
| Tests | `tests/jeu/connexions.test.ts` |

## 1. Détection

Une impasse du réseau (nœud d'un seul tronçon ouvert aux véhicules) à moins de 60 m du bord de la carte est une
connexion (le tracé d'une route s'arrête à 24 m du bord, plus sa demi-largeur). Type : autoroute ou route. Elle est
**reliée** si son réseau (composante connexe des routes ouvertes aux véhicules) dessert au moins un bâtiment. Recalcul à
chaque version du réseau et à chaque changement du nombre de bâtiments (contrôle en O(1) sinon). Rien n'existe au début
d'une partie : le joueur prolonge une route jusqu'au bord.

## 2. Trafic entrant et sortant

Les connexions reliées sont données au trafic (`TrafficSystem.setGates`) : deux accès par connexion (voie entrante près
du bord, voie sortante). Une part des trajets générés (3 % par route, 6 % par autoroute, 18 % au plus) passe par une
connexion : navetteurs extérieurs (vers les emplois le matin, retour le soir), visiteurs des commerces, et poids lourds
d'import / export (part = camions de 18 t du fret du jour, entre 5 et 60 %). Le nombre total de voitures visé ne change
pas (ces trajets remplacent des trajets internes). Sans connexion reliée, aucun tirage supplémentaire : la simulation
du trafic est identique.

## 3. Marchandises (une fois par jour)

Production : 0,06 t par emploi industriel occupé, 0,004 t par emploi de bureau. Consommation : 0,004 t par habitant,
0,03 t par emploi commercial. Seuls les bâtiments desservis par le réseau d'une connexion reliée échangent avec
l'extérieur : les échanges locaux d'abord, puis export du surplus et import du manque, chacun plafonné par la capacité
des connexions (400 t/j par route, 2 500 t/j par autoroute). Le reste est **invendu** ou **manque**. La ville perçoit
des droits (3 CHF par tonne exportée, 1,5 CHF par tonne importée, `applyService`, ligne « Services ») ; la balance
commerciale (240 CHF/t exportée, 280 CHF/t importée) est affichée.

## 4. Migrants

Chaque ménage qui s'installe (`DemographySystem.migrationWave`) est acheminé par une connexion reliée (tirage du PRNG
du module) : compté par connexion et par mois, et un camion de déménagement part de la connexion vers le logement (si le
logement est déjà relié au trafic). Une ville reliée attire un peu plus : arrivées × (1 + 5 % par route, 12 % par
autoroute, 25 % au plus).

## 5. Interface, rendu, protocole, sauvegarde

- Panneau « Connexions extérieures » (tableau de bord Transports) : synthèse (véhicules, part des trajets,
  marchandises, droits, migrants) puis une section par connexion.
- Rendu : portique et panneau fléché vers l'extérieur, vert si reliée, gris sinon (4 `InstancedMesh`).
- `delta.ext.connexions` à chaque changement (liste des connexions et comptes du jour). Commandes : `state`, `stats`.
- Section `save.plugins.connexions` v1 (absente sans connexion) : réglages appliqués au trafic et à l'immigration (reprise
  identique, testée), comptes du jour, du mois et du mois précédent. Les connexions sont recalculées depuis le réseau
  rechargé ; une ancienne sauvegarde se charge et sa connexion éventuelle est détectée.

## 6. Limites

Pas de connexions ferroviaires, maritimes ou aériennes propres à ce module (le port et l'aéroport ont leur propre fret,
docs/HUBS.md) ; les marchandises ne modifient pas les comptes des entreprises (seuls les droits vont au budget) ; les
véhicules entrés / sortis sont répartis entre connexions au prorata de leur poids ; pas de connexions préexistantes en
début de partie.
