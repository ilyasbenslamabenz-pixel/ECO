# Économie vivante (vague 1)

Loyers, ressources et difficultés des ménages, emploi et chômage par quartier, éducation et adéquation aux emplois,
comptes complets des entreprises avec fermetures et reprises. Mécaniques inspirées des city-builders modernes ;
formules et valeurs propres au jeu.

| Fichier | Rôle |
|---|---|
| `src/sim/economie/tuning.ts` | réglages (`DEFAULT_LIVING_TUNING`), formules pures (valeur foncière, loyers, seuils), raisons |
| `src/sim/economie/living.ts` | `LivingEconomy` : calcul quotidien, déménagements / départs, clôture des entreprises, rapport, sauvegarde |
| `src/sim/demography.ts` | appels (`daily`, `computeTaxBase`, `monthly`), facteur de satisfaction « Coût du logement », emplois des locaux fermés retirés, éducation |
| `src/sim/population.ts` | colonnes nouvelles (ménages : `rent`, `distressDays` ; entreprises : `rent`, `tax`, `customers`, `lossMonths`, `status`, `reason`, `closedAt`) |
| `src/sim/world.ts` | branchements : grille municipale `valeur_fonciere`, secteurs (quartiers), taux d'imposition des entreprises |
| `src/ui/economie.ts` | onglet **Population › Économie** ; lignes de l'aperçu ; fiche du bâtiment (`src/ui/panels.ts`) |
| `tests/jeu/economie-vivante.test.ts` | formules, grâce et pression, relogement, fermetures, quartiers, ancienne sauvegarde |

L'économie vivante fait partie de la démographie (elle a besoin des tables citoyens / ménages / entreprises) : elle
n'est pas un `SimPlugin`. Les modules l'alimentent par les services existants (municipal, secteurs).

## 1. Pression progressive

Toute la pression (difficultés des ménages, effet sur la satisfaction, pertes et fermetures d'entreprises, nouvelles
aides de croissance) suit la rampe « sans service » : **30 jours de grâce puis 30 jours de montée** depuis le début de
la partie. Pendant la montée, le seuil de difficulté part de `partSoutenable + 0,6` et descend jusqu'à
`partSoutenable`. Une entreprise ne compte ses pertes qu'après `ageMinEntrepriseJours` jours d'existence et ne ferme
qu'à pleine pression.

## 2. Valeur foncière et loyers (chaque jour)

```
V (indice, 0,4..1,6) = 0,75 + 0,06 · services couvrant le bâtiment (0..5 : éducation, santé, police, pompiers, loisirs)
                     + min(0,2 ; 0,05 · équipements remarquables proches) − min(0,35 ; 0,07 · pollution subie)
                     + (grille valeur_fonciere − 100) / 200, borné à ±0,3   (nuisances des déchets, bruit des pôles)
marché  = borné(1 + sensibiliteMarche · (vacanceCible − logements libres / capacité), marcheMin, marcheMax)
loyer d'un logement = loyerBase · V · (1 + loyerParNiveau · (niveau − 1)) · marché
loyer d'un ménage   = loyer du logement · (0,75 + 0,1 · min(6, taille du ménage))
loyer d'un local    = loyerParPoste · V · (1 + loyerParNiveau · (niveau − 1)) · postes (capacité, occupés ou non)
```

Niveau du bâtiment : maisons 1, petits et moyens immeubles 2, grands immeubles et tours 3 ; locaux d'activité selon
leurs postes (≥ 40 : 2, ≥ 150 : 3). La valeur foncière affichée est `100 · V`.

## 3. Ménages : ressources, effort, difficultés

- **Ressources** = salaires + pensions + `allocationChomage` par adulte d'âge actif sans emploi ni études (l'allocation
  n'entre pas dans l'assiette de l'impôt résidentiel).
- **Effort** = loyer / ressources. Au-delà du seuil (§1), le ménage compte un **jour de difficulté** (sinon −3 par jour).
- Après `joursAvantDemenagement` jours : il cherche le logement libre le **moins cher** qu'il peut payer
  (loyer ≤ `partSoutenable` · ressources) et au moins 8 % moins cher que le sien ; sans solution, il **quitte la ville**
  après `joursAvantDepart` jours. Plafonds : `maxDemenagementsParJour`, `maxDepartsParJour`.
- **Satisfaction** (facteur « Coût du logement ») : `−min(12 ; 30 · (effort − part soutenable))` au-delà de la part
  soutenable, `+1,5` sous la moitié de celle-ci ; × rampe.
- **Attractivité** : −0,1 × part des ménages en difficulté.

## 4. Emploi et chômage

Population active = adultes de 18 à 63 ans hors études. Le chômage retire 18 points de satisfaction (inchangé) et
remplace le salaire par l'allocation. Les **postes vacants** réduisent la production : le chiffre d'affaires est
proportionnel aux employés effectifs. Chômage **par quartier** : secteurs du joueur s'il y en a (service `secteurs`,
`sectorOf`), sinon îlots de 500 m (« Îlot G14 »). Les emplois d'une entreprise **fermée** ne sont plus offerts.

## 5. Éducation

Niveaux simplifiés : **sans diplôme** (aucun, primaire), **secondaire** (brevet / CAP, bac), **supérieur**.
Emplois : commerce et petite industrie sans exigence ; industrie avancée (usines, manufactures, énergie) et services
publics le brevet ; bureaux le bac ; tours de bureaux le supérieur. L'embauche préfère un candidat qualifié et se
rabat sur un non-qualifié faute de mieux (comme avant). Un employé **sous-qualifié** produit
`productiviteSousQualifie` (65 %) ; un diplômé du supérieur dans un emploi sans exigence perd 3 points de satisfaction.
Les écoles existantes élèvent le niveau des jeunes (brevet à 16 ans, bac à 18 ans pour 80 %, inchangé) et, en plus :
**supérieur** à 21 ans pour `probaSuperieur` des bacheliers dont le logement est couvert par une école ; **formation
continue** des adultes sans emploi de moins de 45 ans en quartier couvert (`probaFormationAn` par an, un niveau).

## 6. Entreprises

```
clientèle (commerce) = 0,5 · facteur de la ville + 0,5 · facteur local
facteur local        = borné(Σ (habitants + ½ actifs) · (1 − d / 2R) / 20 / Σ employés des commerces · (1 − d / 2R), 0,25, 1,25)
                       dans le rayon d'attraction R du commerce (250 à 1 500 m), évalué à chaque clôture mensuelle
chiffre d'affaires   = (employés − 35 % · sous-qualifiés) · productivité du secteur · clientèle
bénéfice             = chiffre d'affaires − salaires − fraisGeneraux · CA − loyer du local
impôt                = taux du secteur · 50 % · max(0, bénéfice)       (assiette municipale inchangée)
```

Chaque mois : bénéfice < 0 → un mois de perte de plus (sinon −1) et état **en difficulté** avec une raison :
loyer écrasant (> 35 % du CA), manque de main-d'œuvre (< 50 % des postes), manque de clients (< 0,75), main-d'œuvre
peu qualifiée (> 35 % de sous-qualifiés), loyer trop élevé (> 25 % du CA), sinon salaires et charges. À
`moisAvantFermeture` mois, l'entreprise **ferme** (au plus `partFermeturesParMois` des entreprises par mois) : employés
licenciés, local vacant, raison et date consultables (fiche du bâtiment, onglet Économie, 24 dernières fermetures
sauvegardées). Après `joursAvantReprise` jours, une nouvelle entreprise reprend le local si la clientèle de la ville
(commerce, facteur ≥ 0,9) ou la main-d'œuvre disponible (industrie : chômeurs ; bureaux : chômeurs bacheliers ;
au moins 20 % des postes) le permet. Les services publics ne ferment jamais.

## 7. Rapport et interface

`report.demography.living` (null avant le premier jour) : pression, loyer moyen, effort moyen, ressources moyennes,
ménages en difficulté (nombre, part), valeur foncière moyenne, loyer moyen des locaux, entreprises actives / en
difficulté / fermées, raisons (difficultés, fermetures), dernières fermetures, postes vacants, quartiers (8 plus
peuplés : population, chômage, loyer), éducation (adultes, emplois et employés par niveau, sous- et surqualifiés),
compteurs du mois et du mois précédent (déménagements, départs pour loyer, fermetures, reprises, diplômés).

Autres ajouts : facteur de satisfaction `loyer` ; raison de vacance `loyerEleve` (logement vide dont le loyer dépasse
la part soutenable des ressources moyennes) ; aides de croissance `high-rent` (plus de 12 % de ménages en difficulté),
`need-jobs` (chômage > 15 %), `need-education` (plus de 35 % de sous-qualifiés dans les emplois qualifiés), à partir
de la moitié de la montée et de 150 habitants ; fiche du bâtiment : loyer, valeur foncière, état de l'entreprise.

Interface : onglet **Population › Économie** (lignes et barres existantes, lisible sur iPhone) et deux lignes dans
l'aperçu. Rien n'est affiché dans la scène 3D.

## 8. Réglages (`demography.living.tuning`, non sauvegardés)

| Clé | Défaut | Effet |
|---|---|---|
| `loyerBase`, `loyerParNiveau` | 360 / 0,12 | loyer d'un logement de niveau 1 à V = 1 ; supplément par niveau |
| `vacanceCible`, `sensibiliteMarche`, `marcheMin`, `marcheMax` | 0,06 / 2,5 / 0,8 / 1,2 | effet du marché du logement |
| `partSoutenable`, `allocationChomage` | 0,40 / 650 | part des ressources pour le loyer ; allocation d'un chômeur |
| `joursAvantDemenagement`, `joursAvantDepart` | 20 / 60 | jours de difficulté avant relogement, avant départ |
| `maxDemenagementsParJour`, `maxDepartsParJour` | 30 / 30 | plafonds quotidiens |
| `loyerParPoste`, `fraisGeneraux` | 70 / 0,10 | loyer d'un local par poste ; frais généraux |
| `moisAvantFermeture`, `ageMinEntrepriseJours`, `partFermeturesParMois`, `joursAvantReprise` | 4 / 60 / 0,05 / 45 | fermetures et reprises |
| `productiviteSousQualifie`, `probaSuperieur`, `probaFormationAn` | 0,65 / 0,45 / 0,25 | éducation |

## 9. Sauvegarde

Format inchangé (v2). Colonnes nouvelles facultatives (`OPTIONAL_COLUMNS`, `src/sim/population.ts`) : absentes d'une
ancienne sauvegarde, elles valent 0 (loyers recalculés le jour suivant, entreprises en activité, aucune difficulté).
Champ facultatif `population.living` (journal des fermetures, compteurs) ; les locaux fermés sont reconstruits depuis
la colonne `status`. Une colonne historique manquante reste refusée.

## 10. Limites connues

- La demande du zonage lit les capacités des bâtiments : elle ne voit ni les locaux fermés ni les loyers.
- Les loyers payés par les ménages ne sont pas une recette municipale ; seule l'assiette des entreprises baisse un peu
  (bénéfice net du loyer).
- Pas d'abandon visuel des bâtiments (aucun affichage dans la scène 3D) ni de démolition automatique des locaux vacants.
- Le relogement parcourt les bâtiments (plafonné à 30 ménages par jour).
- Réglages non sauvegardés et sans commande dédiée (constantes du code).
