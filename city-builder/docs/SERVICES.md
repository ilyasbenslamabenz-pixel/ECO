# Services qui comptent (vague 2)

Criminalité, incendies et santé, avec capacité, coût d'entretien et cartes d'information. Mécaniques inspirées des
city-builders modernes ; formules, textes et valeurs propres au jeu.

| Fichier | Rôle |
|---|---|
| `src/sim/services/tuning.ts` | réglages (`DEFAULT_SERVICES_TUNING`), formules pures, tirage déterministe `hash01` |
| `src/sim/services/city-services.ts` | `CityServices` (dans la démographie) : calcul quotidien, incendies horaires, rapport, fiche, sauvegarde |
| `src/sim/plugins/services.ts` | module `services` : pilote les incendies chaque heure, notifications, carte, commandes, service lu par `alertes` |
| `src/sim/demography.ts` | qualité de couverture, mortalité, malades absents, satisfaction, attractivité, évacuation d'un bâtiment |
| `src/sim/population.ts` | colonne facultative `sick` (jours de maladie restants) ; colonnes en « propriétés rapides » (§9) |
| `src/sim/world.ts` | branchements : criminalité dans la valeur foncière, lots privés, rattachement du système au module |
| `src/shared/protocol-ext/services.ts` | carte d'information (grille de cellules de 32 m) |
| `src/render/plugins/services.ts` | rendu des cartes (maillage drapé, couleurs de sommets) — nouveau fichier, aucun fichier cœur du rendu modifié |
| `src/ui/services.ts`, `city-panels.ts`, `markup.html` | onglet **Population › Services**, lignes de l'aperçu |
| `src/ui/panels.ts`, `hud.ts` | fiche du bâtiment (criminalité, risque, santé, état) et bouton **Reconstruire** |
| `src/ui/layers-menu.ts` | calques **Criminalité**, **Risque d'incendie**, **Santé** (légende) |
| `src/shared/protocol-ext/alertes.ts`, `src/sim/plugins/alertes.ts`, `src/render/plugins/alertes.ts` | icônes **en feu**, **ruine**, **criminalité élevée** |
| `tests/jeu/services.test.ts` | formules, grâce, criminalité et police, incendies avec et sans caserne, santé, carte, sauvegarde, ancienne sauvegarde |

## 1. Pression progressive

Tout suit la rampe commune « sans service » : **30 jours de grâce puis 30 jours de montée**. Pendant la grâce : aucun
délit, aucun départ de feu, aucune maladie (cible de criminalité multipliée par la pression). Les événements utilisent un
**hachage déterministe** (id, jour ou heure, sel) et jamais le PRNG de la partie : la simulation de base est identique
pendant la grâce et une partie rechargée reproduit les mêmes événements.

Ancienne sauvegarde (sans services) : criminalité nulle, personne n'est malade, aucun feu, et une **montée propre de
30 jours à partir du chargement** (le joueur n'avait aucune raison de bâtir ces services).

## 2. Couverture et capacité

Couverture existante de la démographie (rayon, capacité `capacite_service` × habitants par unité, logements les plus
proches d'abord, améliorations : rayon +25 %, capacité +50 % par niveau), complétée par une **qualité** :
`q = 1 − 0,5 · distance / rayon` de l'équipement couvrant le plus proche (0 si non couvert).

| Service | Unité | Habitants par unité | Exemple (catalogue) |
|---|---|---|---|
| Police | patrouille | 600 | commissariat : 6 patrouilles → 3 600 hab., 340 000, entretien 1 600 / mois |
| Pompiers | engin | 900 | caserne : 4 engins → 3 600 hab., 370 000, entretien 1 700 / mois |
| Santé | lit | 20 | centre de santé : 90 lits → 1 800 hab., 322 000 ; hôpital : 260 lits → 5 200 hab. |

Police, pompiers et centre de santé sont constructibles dès le début (l'hôpital se débloque au palier Bourg dans une partie en déblocages progressifs, docs/PROGRESSION.md). Leur entretien et les
salaires des agents passent par le budget existant (entretien des bâtiments, salaires des services publics) ; l'onglet
Services affiche l'entretien de catalogue par service.

## 3. Criminalité (0..100 par bâtiment, chaque jour)

```
propre   = base (logement 6, commerce 10, industrie 7, bureaux 4)
         + 45 · part de chômeurs parmi les actifs du logement + 30 · part de ménages en difficulté de loyer
         + 7 · (niveau − 1)                                         (densité : petits immeubles 2, tours 3)
cible    = (0,65 · propre + 0,35 · moyenne de l'îlot de 128 m) · (1 − 0,75 · q_police) · pression
criminalité += 12 % de l'écart chaque jour                          (bâtiment vide : retour à 0)
```

Effets : satisfaction (facteur « Police ») `−14 · criminalité / 100` ; valeur foncière `−0,25 · criminalité / 100`
(indice, donc loyers) ; attractivité `−0,15 · criminalité moyenne / 100`. Délits : `criminalité / 100 · occupants ·
0,003` par jour et par bâtiment (comptés par mois) ; notification quand il y en a au moins 3 dans la journée ou qu'un
bâtiment dépasse 45 ; icône « criminalité élevée » au-delà de 45.

## 4. Incendies (chaque heure)

```
risque   = facteur (logement 1, commerce 1,2, bureaux 0,8, industrie 2,2 ; usine/énergie 3 ; public 0,5)
         · (1 + 0,25 · (niveau − 1)) · (1 + âge / 25 ans) · (1 − 0,6 · q_pompiers)       (affiché : 25 · risque, borné à 100)
départ   : probabilité horaire 0,0000015 · risque · pression (bâtiments occupés, ni en feu ni en ruine)
pompiers : caserne couvrante la plus proche avec un engin libre ; arrivée après 0,3 + 1,6 · (1 − q) h ;
           sans engin libre : attente ; aucune caserne : aucun secours
dégâts   : +1 / (6 h · (1 + 0,3 · (niveau − 1))) par heure, ×0,4 une fois les pompiers sur place ; extinction 1 h après l'arrivée
issue    : dégâts < 35 % : légers ; sinon « endommagé » 10 jours (pas de nouveaux habitants, −8 de satisfaction) ;
           dégâts 100 % : RUINE (habitants relogés sinon partis, employés licenciés, ni logement ni emploi)
propagation : feu non maîtrisé à plus de 50 % de dégâts -> voisins à moins de 24 m, 3 % par heure (index spatial)
ruine    : démolir (outil existant) ou Reconstruire (30 % du coût du modèle) ; lot privé : reconstruit par son promoteur après 20 jours
```

Chaque départ, extinction et destruction est notifié ; les bâtiments en feu et les ruines portent une icône.

## 5. Santé

```
santé du logement = 84 − min(30, 6 · pollution subie) − 0,5 · max(0, âge moyen − 40) + (soins ? 12 · q_soins : −12)   (5..100)
maladie (par jour) = 0,0015 · facteur d'âge (enfant < 5 : 1,5 ; 50-64 : 1,6 ; 65-79 : 2,6 ; 80+ : 3,6) · (1 + (100 − santé) / 35) · pression
durée = 4 jours avec soins, 9 sans ; mortalité d'un malade × 2,5 avec soins, × 6 sans (en plus du −30 % de la couverture santé)
```

Un malade reste chez lui : il ne travaille pas (chiffre d'affaires de l'entreprise réduit, salaire maintenu), ne va ni à
l'école ni en loisirs. Satisfaction (facteur « Santé ») : `−10` pour un malade, `−0,25 · (60 − santé) · pression` sous 60.
Attractivité : `−0,3 · part de malades`.

## 6. Rapport, cartes et interface

- `report.demography.cityServices` : pression ; criminalité (moyenne pondérée par les occupants, bâtiments élevés, délits
  du jour, 5 secteurs les plus touchés) ; incendies (en feu, endommagés, ruines, risque moyen, bâtiments occupés hors de
  portée des pompiers) ; santé (moyenne, malades, habitants sans soins) ; couverture des habitants ; équipements par
  service (nombre, unités, capacité, entretien) ; compteurs du mois et du mois précédent ; 12 derniers événements.
  Mis en cache (recalculé à chaque événement ou heure de jeu).
- `inspectBuilding(...).safety` : criminalité, risque, santé, malades, état (`normal` / `feu` / `endommage` / `ruine`),
  qualité de couverture police / pompiers / soins, coût de reconstruction ou délai du promoteur.
- Commandes du module `services` : `etat`, `batiment { buildingId }`, `calque { on }` (renvoie la carte), `reconstruire
  { buildingId }`, `incendie { buildingId }` (diagnostic).
- Carte (`delta.ext.services.layer`, seulement quand une carte est affichée, au plus une fois par changement) : grille de
  32 m, `Uint8Array` transférés : criminalité max, risque max, santé min des logements, état, couverture par service.
- Interface : onglet **Population › Services** (où ça manque, sécurité, incendies, santé, équipements, événements),
  lignes de l'aperçu, fiche du bâtiment, menu **Calques** (3 cartes et légende), icônes d'alerte.

## 7. Réglages (`demography.services.tuning`, non sauvegardés)

| Clé | Défaut | Effet |
|---|---|---|
| `crimeBase*`, `crimeChomage`, `crimePauvrete`, `crimeDensite` | 6/10/7/4, 45, 30, 7 | criminalité propre |
| `crimeVoisinage`, `crimeIlotM`, `crimePolice`, `crimeInertie` | 0,35, 128, 0,75, 0,12 | voisinage, police, inertie |
| `crimeSatisfaction`, `crimeFoncier`, `crimeAttractivite`, `delitsParOccupant`, `crimeEleve` | 14, 0,25, 0,15, 0,003, 45 | effets et délits |
| `feuProbaHeure`, `feuPrevention`, `feuAgeAns`, `feuDureeH` | 0,0000015, 0,6, 25, 6 | départs et durée |
| `feuDelaiBaseH`, `feuDelaiDistanceH`, `feuExtinctionH`, `feuSeuilDegats`, `feuReparationJours` | 0,3, 1,6, 1, 0,35, 10 | secours et dégâts |
| `feuPropagation`, `feuVoisinM`, `reconstructionPart`, `reconstructionPriveeJours`, `feuSatisfaction` | 0,03, 24, 0,3, 20, 8 | propagation, ruines |
| `santeBase`, `santePollution`, `santePollutionMax`, `santeAge`, `santeSoins`, `santeSansSoins` | 84, 6, 30, 0,5, 12, 12 | santé du logement |
| `maladieProba`, `maladieDureeSoins`, `maladieDureeSans`, `maladieMortaliteSoins`, `maladieMortaliteSans` | 0,0015, 4, 9, 2,5, 6 | maladies |
| `maladieSatisfaction`, `santeSatisfaction`, `maladieAttractivite`, `rampeChargementJours` | 10, 0,25, 0,3, 30 | effets, ancienne sauvegarde |

## 8. Sauvegarde

Format inchangé (v2). Champ facultatif `population.services` : par bâtiment `[id, criminalité ×1000, construit à, risque
×10 000, santé ×100]` (valeurs quantifiées dans la simulation même : restitution exacte), feux en cours / endommagés /
ruines, compteurs, événements récents, malades et délits du jour. Colonne citoyenne facultative `sick` (jours de maladie
restants, 0 si absente). La reprise d'une partie rechargée est identique (test).

## 9. Coût

Par jour : O(bâtiments + citoyens) (agrégats par logement, criminalité, risque, santé, délits, maladies). Par heure :
O(bâtiments) pour les départs de feu, plus les feux en cours (voisinage par l'index spatial, envoi des pompiers sur la
liste des casernes). Aucune boucle en n². Rapport mis en cache (une fois par heure de jeu ou par événement).

Mesures (Node 22, ce conteneur, ville de charge `buildCity stress` : 500 bâtiments, 21 111 habitants, 90 jours, mesures
alternées avant / après) :

| Poste | Avant | Après |
|---|---|---|
| tick de 0,2 min (moyenne) | 2,50 – 2,64 ms | 2,47 – 2,78 ms |
| dont `demography.tick` | 0,72 ms | 0,70 ms |
| passe quotidienne (`daily`) | 84 – 126 ms | 85 – 87 ms (dont services 7,4 – 7,7 ms) |
| heure de jeu des services (`hourly`, aucun feu) | — | 0,08 – 0,09 ms |
| clôture mensuelle | 6,8 – 7,4 ms | 7,0 – 7,1 ms |
| rapport des services (recalcul) | — | 0,35 – 0,38 ms |

`SoaTable` (`src/sim/population.ts`) : l'objet des colonnes, construit par clés dynamiques, passait en mode dictionnaire
du moteur V8 avec une colonne de plus (`sick`) et doublait le coût des boucles par citoyen (`demography.tick` 0,72 ->
1,6 ms) ; il est désormais forcé en « propriétés rapides » (`fastProperties`), sans effet sur les valeurs.

## 10. Limites connues

- Pas d'affichage 3D des ruines ni des flammes (icônes seulement ; le rendu des bâtiments n'est pas modifié).
- Patrouilles et engins abstraits (pas de véhicules dans le trafic).
- La demande du zonage ne voit pas les ruines (une ruine privée est reconstruite par son promoteur).
- Réglages non sauvegardés (constantes du code).
