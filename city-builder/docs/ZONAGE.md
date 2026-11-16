# Zonage et croissance automatique (phase 2B)

Module `zonage` : on peint des zones le long des routes, la simulation y fait pousser des bâtiments du catalogue
selon la demande (R / C / B / I), puis densifie les quartiers valorisés. Mécaniques inspirées des city-builders
modernes (zones peintes sur une grille, jauge de demande, niveaux de bâtiments), sans reprise de contenu.

| Fichier | Rôle |
|---|---|
| `src/shared/protocol-ext/zonage.ts` | types de zones, couleurs, libellés, charges `delta.ext.zonage` / `snapshot.ext.zonage`, commandes, encodage en plages |
| `src/sim/zoning/grid.ts` | grille des zones (cases de 8 m, un octet par case), peinture, desserte |
| `src/sim/zoning/roads.ts` | polylignes des routes (cache par `roads.version`), route desservante la plus proche |
| `src/sim/zoning/catalog.ts` | bâtiments autorisés par zone et leur niveau 1 à 3 |
| `src/sim/zoning/demand.ts` | modèle de demande pur et réglable (`computeDemand`, `DEFAULT_DEMAND_TUNING`) |
| `src/sim/zoning/system.ts` | `ZoningSystem` : demande horaire, croissance, densification, valeur de quartier, réseau, sauvegarde |
| `src/sim/zoning/save.ts`, `src/sim/save-sections/zonage.ts` | section de sauvegarde versionnée (v1) et migration |
| `src/sim/plugins/zonage.ts` | `SimPlugin` (crochets, commandes) |
| `src/client/zoning-view.ts` | état côté navigateur partagé par le rendu et l'interface |
| `src/render/zoning/overlay.ts`, `src/render/plugins/zonage.ts` | superposition colorée (instanciation + shader), cercle du pinceau |
| `src/ui/panels/zonage.ts` | tiroir « Zones » de la barre de construction, jauge R/C/B/I, panneau du tableau de bord |
| `tests/zonage/*.test.ts`, `tests/zonage/e2e.mjs` | tests unitaires, sauvegarde/migration, parcours e2e avec captures (`docs/captures-zonage/`) |
| `src/sim/ressources/*`, `src/sim/plugins/ressources.ts`, `src/shared/protocol-ext/ressources.ts` | zones spécialisées (§8) : forêt, agricole, mixte — production, économie, section `ressources` |
| `src/render/plugins/ressources.ts`, `src/ui/panels/ressources.ts` | teinte des bâtiments spécialisés, arbres retirés des cases déboisées ; panneau « Ressources » |

## 1. Outil Zones

Onglet **Zones** de la barre d'outils (le badge « 2B » disparaît : l'outil est actif). Le tiroir propose :
résidentiel faible / moyen / dense, commerces, bureaux, industrie, **Forêt**, **Agricole**, **Mixte** (zones
spécialisées, §8), **Retirer**, la **profondeur** des bandes (1 à 4 cases de 8 m, 3 par défaut), **Croissance : oui /
pause**, et la jauge de demande R / C / B / I dans l'en-tête. La zone « Spécial » reste affichée comme prévue (grisée).

- **Peindre** : souris (clic-glisser) ou un doigt. Le pinceau est un cercle de rayon `(profondeur + 1) × 8 m` ; en
  suivant l'axe d'une rue on zone les deux côtés sur toute la profondeur. Seules les cases dont le centre est à
  1 m au moins du bord de la chaussée et à `profondeur × 8 m` au plus d'une route **desservante** prennent la zone :
  jamais sur la chaussée, jamais sur l'eau, jamais le long d'une autoroute (aucun accès riverain) ni d'une rue
  piétonne. Deux doigts déplacent / zooment la caméra pendant que l'outil est ouvert.
- **Retirer** : efface toutes les cases sous le pinceau. Les bâtiments déjà construits restent (ils ne se densifient plus).
- **Superposition** : visible seulement avec l'outil. Cases colorées par type (trois verts pour le résidentiel,
  bleu commerces, violet bureaux, jaune industrie), liseré plus opaque ; une case qui n'est plus desservie (route
  démolie) est hachurée et pâle.

Intégration à l'interface (API minimales) : la barre de construction accepte un **tiroir fourni par un module**
(`DrawerProvider`, `src/ui/buildbar.ts`) ; le contrôleur d'outils accepte une **capture temporaire des gestes**
(`ToolController.setPointerOverride`, `src/input/tools.ts`) — choisir un autre outil, fermer le tiroir ou Échap
rend la main.

## 2. Croissance

Chaque heure de jeu, pour chaque type de zone dont le secteur a une demande ≥ `demandeMin`, la simulation fait
`demande × naissancesParHeure` tentatives (partie fractionnaire tirée au sort avec le PRNG du module). Une tentative :

1. tire une case zonée de **première rangée** (centre à moins de 9,5 m du bord de la route), libre et desservie ;
2. prend un modèle du **niveau 1** de la zone (les modèles les moins présents dans la ville sont favorisés) ;
3. l'oriente **façade vers la route**, exactement comme l'outil de pose du joueur (`src/client/tools/snapping.ts`) :
   façade perpendiculaire à la tangente locale (angle libre, routes courbes comprises), recul de 0,6 m après le trottoir ;
   La position le long de la route est **recalée sur la trame locale de la route** (§2 bis) : côtés de l'emprise sur
   les lignes du quadrillage affiché (case la plus proche puis ses voisines), positions d'origine en dernier recours ;
   les rangées intérieures ont leur façade sur une ligne de la trame (0,6 m + k × 8 m depuis le trottoir) ;
4. vérifie que l'emprise tient dans des cases de la même zone (ou dans la bande non zonable du bord de route) ;
5. le pose par l'API d'écriture de la simulation de base (ci-dessous) : contrôles de collision, de route, de pente et
   d'eau de `placeBuilding`. Le module **chantiers**, s'il est actif, ouvre aussitôt un chantier sur le bâtiment.

La croissance attend quand `maxChantiers` chantiers sont déjà ouverts. Correspondance des zones et du catalogue
(`src/sim/zoning/catalog.ts`) : faible = maisons ; moyen = mitoyennes et petits immeubles ; dense = immeubles moyens
et haute densité ; commerces = commerces (hors étiquettes `bureaux`/`tertiaire`) ; bureaux = bureaux et gratte-ciel ;
industrie = industrie hors ouvrages de réseau (centrales, postes, château d'eau). Niveau = tiers de la capacité
(habitants + emplois) dans la zone.

**API d'écriture minimale** (`PluginContext.development`, implémentée par `Simulation.placePrivateBuilding` /
`demolishPrivateBuilding`) : promotion privée — mêmes contrôles que la pose du joueur, mais la construction n'est
pas payée par la ville et la démolition ne rembourse rien et ne notifie pas. Le bâtiment est ensuite un bâtiment
ordinaire (entretien mensuel, habitants, emplois, impôts, deltas, sauvegarde de base). Les commandes du joueur sont
inchangées (même code, même coût).

## 2 bis. Quadrillage local des routes (trame de construction)

Retour joueur (PC 1280×800) : « le quadrillage de la map n'est pas assez précis et les bâtiments ont l'air de
déborder ». **Mesure** (`tests/e2e/grille-captures.mjs` ; `docs/captures-grille/mesures-avant.json` pour le
quadrillage d'origine, `mesures-apres.json` pour la pose rendue, dont le code n'a pas changé) sur une vingtaine de
bâtiments (zonage et pose à la main, rue droite en z = 3 et rue en biais à 27°) :

- modèle rendu ↔ emprise simulée : **aucun décalage** — angle identique (écart 0°), origine du modèle au centre de
  l'emprise (sauf l'avancée voulue des maisons de ville vers la rue, 0,48 m, `frontShift`), modèle à l'intérieur de
  l'emprise de 0,3 à 1,8 m ;
- emprise ↔ quadrillage : le quadrillage était dessiné sur les **axes du monde** (multiples de 8 m) alors que les
  bâtiments s'alignent sur la **route** (façade à demi-largeur + 0,6 m de l'axe, position libre le long de la voie) :
  bords avant/arrière à **1,8 m et 3,8 m** des lignes (rue de 6,2 m de demi-largeur en z = 3 : façades en z = −3,8 et
  9,8), côtés jusqu'à **4 m** (une demi-case) des lignes, et **27°** de biais sur la rue oblique : les lignes
  traversaient les bâtiments.

**Correction** (`src/shared/road-grid.ts`, pur TypeScript partagé) : avec l'outil Bâtiment, le quadrillage au sol
suit la **route la plus proche du curseur** (à moins de 40 m de son bord ; au-delà, pose libre : axes du monde).
Repère : T = tangente de la route (sens canonique, indépendant du sens de tracé), N = normale ; lignes en
`|P·N − O·N| − (demi-largeur + 0,6 m) = k × 8 m` (la 1re est la ligne des façades, des deux côtés de la rue, rien sur
la chaussée ni le trottoir) et en `P·T − phase = k × 8 m`. La trame le long de la route est mesurée depuis l'origine
du monde (une rue droite coupée par des carrefours garde la même trame) ; sa `phase` est celle des côtés du
**bâtiment parallèle à la route le plus proche** (façade sur une ligne de la trame, à moins de 48 m le long de la voie)
— les bâtiments des **sauvegardes existantes** tombent donc sur les lignes affichées sans rien reconstruire — et 0
sinon. Rendu : uniformes `uGridRoad` / `uGridRoad2` du matériau de terrain (`src/render/terrain/material.ts`),
mis à jour par `src/main.ts` (`localRoadGrid`, `src/client/tools/road-grid.ts`) quand le curseur bouge.

Ce que montre le quadrillage est l'endroit où l'on construit : l'**aimantation** de l'outil de pose (activée par
défaut) recale le bâtiment sur la trame le long de la route (case la plus proche puis ses voisines ; le voisin aimanté
garde la priorité ; sans place sur la trame, position du curseur) ; la croissance des zones fait de même (§2). Lignes
redessinées : antialiasées, ≈ 1,6 px à l'écran mais jamais moins de 10 cm au sol (visibles de près), plus opaques,
liseré sombre discret pour la lisibilité sur l'herbe claire. Après correction, écart des 20 bâtiments mesurés aux
lignes affichées : **0,00 m** (≤ 0,01 m), `docs/captures-grille/mesures-apres.json`. Captures avant / après (même vue) :
`docs/captures-grille/rue-{droite,biais}{,-dessus}-{avant,apres}.png`. Tests : `tests/construction/road-grid.test.ts`.

Limites : les cases de **zonage** restent des cases de 8 m alignées sur les axes du monde (donnée sauvegardée,
superposition de l'outil Zones) ; sur une route courbe, la trame est droite (tangente au point le plus proche du
curseur) et n'est exacte qu'au voisinage du curseur ; les maisons individuelles gardent leur écart minimal de 1 m
(`HOUSE_GAP`) : deux maisons côte à côte sur la trame laissent une case libre, ou se posent hors trame en repli.

## 3. Demande (modèle simple, prêt pour l'économie)

Entrées lues chaque heure dans la simulation de base : population, actifs (`laborForce` de la démographie), emplois
par secteur (capacités des bâtiments reliés à la route), logements (capacité, libres), taux d'imposition.

```
G = actifs − emplois                                         (> 0 chômage, < 0 postes vacants)
R = baseR + attraitEmploiR · (−G) / max(échelleMin, actifs)
        − pousséeVacanceR · (logements libres / max(échelleVacance, capacité) − vacanceCible) − sensImpôt · (tauxR − tauxRéf)
C = (commercesParHabitant · population − emploisC) / max(échelleMinC, ½ · cible) − sensImpôt · (tauxC − tauxRéf)
I = baseI + partIndustrie · G / max(échelleMin, 0,3 · actifs) − sensImpôt · (tauxI − tauxRéf)
B = rampe · (baseB + partBureaux · G / max(échelleMin, 0,3 · actifs)) − …     rampe = min(1, population / popMinBureaux)
```

Chaque valeur est bornée à [−1, 1] puis lissée (moyenne exponentielle `lissage` par heure). Boucle obtenue : ville
vide → R et I positifs ; les habitants créent la demande de commerces ; le chômage relance industrie et bureaux ; les
postes vacants relancent le logement ; des logements vides freinent le résidentiel ; un impôt élevé freine son secteur.

**Branchement futur** : un module (économie) peut publier le service `zonage:demande` (`DemandProvider`,
`demand(inputs) → {R, C, B, I} | null`) ; sa valeur remplace alors le modèle (`inputs.source = 'externe'`).

## 4. Densification

Chaque jour, un bâtiment **né du zonage** (jamais un bâtiment posé par le joueur) est candidat s'il a au moins
`ageMinJours` jours, si sa case porte toujours sa zone, si son secteur a une demande ≥ `demandeMinDensification`,
s'il n'est pas en chantier, et si la **valeur du quartier** dépasse le seuil de son niveau (`seuilNiveau2`,
`seuilNiveau3`). Valeur (0..1) : `0,2 + 0,25 · occupation + 0,2 · services publics à 350 m (/3) + 0,2 · bâtiments à
80 m (/8) + 0,15 · demande du secteur − 0,3 · industrie à 140 m (/2, zones non industrielles)`. Un candidat sur
`probaDensification` est remplacé (au plus `maxDensificationsParJour` par jour) par un modèle du niveau supérieur de
la même zone, aligné sur la **même façade**, s'il tient dans la zone sans toucher ses voisins ; si la pose échoue
(pente…), l'ancien bâtiment est reposé à l'identique.

## 5. Réglages (commande `tuning`)

| Clé | Défaut | Effet |
|---|---|---|
| `baseR`, `attraitEmploiR`, `pousseeVacanceR`, `vacanceCible`, `echelleVacance` | 0,35 / 0,9 / 2 / 0,06 / 80 | résidentiel |
| `commercesParHabitant`, `echelleMinC` | 0,08 / 10 | commerces |
| `baseI`, `partIndustrie`, `baseB`, `partBureaux`, `popMinBureaux`, `echelleMin` | 0,25 / 0,6 / 0,1 / 0,45 / 300 / 40 | industrie, bureaux |
| `sensibiliteImpot`, `tauxRef`, `lissage` | 3 / 0,09 / 0,25 | impôts, lissage |
| `naissancesParHeure`, `maxParHeure`, `demandeMin`, `maxChantiers` | 1,2 / 3 / 0,05 / 16 | croissance |
| `ageMinJours`, `seuilNiveau2`, `seuilNiveau3`, `probaDensification`, `maxDensificationsParJour`, `demandeMinDensification` | 20 / 0,6 / 0,72 / 0,35 / 2 / 0,1 | densification |

Les écarts aux valeurs par défaut sont sauvegardés avec la partie.

## 6. Protocole, sauvegarde, rendu

- Commandes `pluginCommand { plugin: 'zonage', name, payload }` : `paint { points, zone | null, depth?, radius? }`
  (renvoie les cases changées, même en pause), `state`, `cellAt { x, z }`, `setGrowth { enabled }`, `tuning { … }`,
  `grow { attempts?, densify? }` (tentatives immédiates : tests, démonstration).
- `delta.ext.zonage` : cases modifiées `[index, code, …]` (code = zone | 16 si desservie), demande, entrées, statistiques,
  réglages ; `snapshot.ext.zonage` : grille complète encodée en plages. **Sans zone peinte, le module est inerte** :
  aucun delta, aucun instantané, aucune section, aucun tirage (vérifié par `tests/plugins/plugins.test.ts`).
- Sauvegarde `save.plugins.zonage`, version 1 : zones (plages), bâtiments nés du zonage (id, zone, niveau, naissance),
  demande lissée, croissance, réglages modifiés, compteurs ; PRNG du module. Les **anciennes sauvegardes** (sans section,
  ou au format v1 du jeu) se chargent avec un zonage vide ; une section illisible ou trop récente est notifiée et
  conservée telle quelle, le reste de la partie est chargé (`tests/zonage/save.test.ts`).
- Rendu : **un seul maillage instancié** (4 sommets par case, centre + hauteurs du terrain aux 4 coins + couleur par
  instance) et un shader minimal (liseré, hachures) ; pas d'ombre, pas d'écriture de profondeur, pas de texture ;
  hauteurs relues à chaque ouverture de l'outil. Même chemin en mode allégé iPhone.

## 7. Limites connues

- La demande est un modèle d'attente : elle ne lit ni les revenus des entreprises ni les trajets domicile-travail.
- La croissance ne remplit que la première rangée et ce que les emprises profondes atteignent ; une 3e ou 4e rangée
  reste vide derrière de petites maisons (lots arrière : à faire).
- La valeur de quartier est calculée par le module ; elle n'utilise pas encore la grille `valeur_fonciere` du contrat municipal.
- Pas d'abandon de bâtiments (logements vides durablement, pollution) ni de dé-densification.
- Zones spéciales (quartiers à thème) : non implémentées (tuile grisée).

## 8. Zones spécialisées : forêt, agricole, mixte

Codes de zone 7 à 9 ajoutés EN FIN de `ZONE_TYPES` (codes existants inchangés : les sauvegardes restent lisibles).
Bâtiments : modèles EXISTANTS du catalogue (`specialZonesForAsset`, un modèle garde aussi sa zone ordinaire) ; le
rendu les distingue par une teinte légère (`SPECIAL_TINTS`, `InstancedBuildingRenderer.setBuildingTint`).

| Zone | Terrain admis (peinture) | Modèles | Croissance (demande) |
|---|---|---|---|
| **Forêt** (exploitation forestière) | forêt naturelle ≥ `foretMin` (0,25) | industrie `bois` / `artisanat`, entrepôts non logistiques, sans pollution | demande « forêt » (service `ressources:demande`) |
| **Agricole** | fertilité ≥ `fertiliteMin` (0,35) : terre fertile du générateur ou humidité, × planéité (pente ≤ 0,12) | industrie `agriculture`, `service:stockage_agricole`, ateliers (hangars) | demande « agricole » |
| **Mixte** | comme le résidentiel | immeubles et commerces AVEC logements ET emplois (hors bureaux) | ½ (R⁺ + C⁺) ; négative si R et C le sont |

Façade de terrain : `PluginTerrain.forestAt` / `fertilityAt` (facultatifs, `src/sim/plugins/host.ts`). Les zones
spécialisées ne subissent pas la nuisance industrielle dans la valeur de quartier ; la mixte, si.

**Module « ressources »** (`SimPlugin` après le zonage ; lit le service `zonage:etat`, publie `ressources:demande`) :

- **Forêt** : chaque case forestière a un stock (capacité = densité de forêt naturelle au zonage). Chaque jour : repousse
  logistique (`repousse` 3 %/j + semis 0,2 %/j de la capacité) ; chaque exploitation reliée à la route coupe
  `coupeParEmploye` × employés (en cases pleines) dans un rayon de 72 m, cases les plus fournies d'abord, au plus 6 % de
  la capacité par case et par jour ; bois = 25 m³ par case pleine. Case sous 15 % : **déboisée** (le rendu retire ses
  arbres) ; au-dessus de 60 % : **repoussée** (visible au rechargement : la végétation n'a pas d'ajout en direct).
- **Agricole** : nourriture (t/j) = employés × 0,35 × fertilité moyenne des cases agricoles à 56 m × min(1, champs libres
  / 12) × saison (printemps 0,8, été 1,2, automne 1, hiver 0,3).
- **Économie** : consommation de bois = 0,02 m³/j par emploi industriel (hors spécialisés) + 0,002 par habitant ;
  nourriture = 0,0015 t/j par habitant. L'excédent est exporté ; la ville perçoit chaque jour
  `valeur exportée × taux industriel × 2,5` (bois 70 CHF/m³, nourriture 420 CHF/t) par `economy.applyService`.
  Demande des zones forêt / agricole = `0,15 + 0,4 · I + 0,6 · (consommation − production) / max(1, consommation,
  production / 2)`, bornée et lissée par le zonage. Les emplois des exploitations et fermes comptent dans l'industrie,
  ceux de la zone mixte dans le commerce, ses logements dans l'offre résidentielle (demande R).
- **Protocole** : `delta.ext.ressources` / `snapshot.ext.ressources` (bilans, teintes `[id, code]`, centres des cases
  déboisées / repoussées) ; commandes `state`, `simulate { days }` ; `delta.ext.zonage.special` (demandes forêt,
  agricole, mixte). Panneau « Ressources » (tableau de bord Ville) ; demande des zones spécialisées dans le panneau Zonage.
- **Sauvegarde** : section facultative `save.plugins.ressources` v1 (stocks des cases, cases déboisées, bilans, recettes) ;
  champ facultatif `special` dans la section zonage. Sans zone spécialisée : aucune section, aucun delta, aucune recette.
  Une ancienne sauvegarde se charge telle quelle (stocks relus sur le terrain au premier jour).
- Limites : pas de transport physique des marchandises (camions) ni de stock tampon ; la repousse n'est pas animée en
  direct ; le bois et la nourriture n'entrent pas dans les comptes des entreprises de l'économie vivante (seulement
  la recette municipale et la demande).
