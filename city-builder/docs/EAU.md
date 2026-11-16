# Eau et assainissement (phase 2B, sous-étape 5)

Service de l'eau potable et des eaux usées branché sur le contrat municipal (`docs/MUNICIPAL.md`) : réseaux
`eau` et `egouts`, grilles d'indicateurs, lignes budgétaires du service `eau`, registre d'effets, ordonnanceur.
Simulation TypeScript pur dans le worker, déterministe (aucun tirage), sauvegardée.

| Fichier | Rôle |
|---|---|
| `src/shared/water-network/types.ts` | installations (`WATER_FACILITIES`), réglages, bilans, calques |
| `src/shared/protocol-ext/eau.ts` | `EauDelta`, `EauSnapshot`, `EauCommands` |
| `src/sim/water-network/model.ts` | modèle physique : consommation horaire, nappe, financement, pression, qualité, satisfaction |
| `src/sim/water-network/river.ts` | `RiverRouter` : cellules en eau, sens d'écoulement (priority-flood), accumulation, routage aval |
| `src/sim/water-network/system.ts` | `WaterSystem` : topologie, pas horaire / journalier / mensuel, réglages, sauvegarde |
| `src/sim/water-network/save.ts`, `src/sim/save-sections/eau.ts` | section de sauvegarde v1 |
| `src/sim/plugins/eau.ts` | module `eau` (`SimPlugin`), service `eau` (`growthAllowed`, `buildingState`) |
| `src/render/water-network/overlay.ts`, `view.ts`, `src/render/plugins/eau.ts` | calque souterrain, bouton « Eau » |
| `src/ui/panels/eau.ts` | panneau « Eau & égouts » |
| `tools/water-network/{models,build}.ts` | 5 modèles GLB originaux LOD0/1/2 (kit procédural) |
| `src/sim/hydro/fill.ts`, `src/sim/hydro/system.ts` | eau de surface dynamique : sources, retenues des barrages, creux remplis (§8) |
| `tests/eau/*.test.ts`, `tests/eau/capture.mjs` | 19 tests (modèle, hydrographie, module, sauvegarde, 4 tests d'effet) ; captures du vrai jeu (`npm run eau:captures`) |

## 1. Installations (bâtiments `public` du catalogue)

| Modèle | Rôle | Capacité nominale (financement 100 %) |
|---|---|---|
| `eau_station_pompage` (3×3) | captage : eau de surface si l'eau est à ≤ 56 m, sinon forage (rendement de nappe 0,15..1 × 0,45) | 160 m³/h |
| `eau_usine_potabilisation` (5×4) | traite l'eau pompée de sa composante ; abattement 97 % | 220 m³/h |
| `eau_chateau_eau` (2×2) | stock 900 m³, sortie 140 m³/h, charge = sol + 32 m (pression) | — |
| `eau_station_epuration` (6×5) | épure les eaux usées ; abattement 92 % (96 % à 150 %) | 180 m³/h |
| `eau_emissaire` (2×2) | rejet BRUT dans l'eau la plus proche (≤ 120 m) | illimité |

Le service est **dormant** (aucune grille, aucun réseau, aucun `ext`, aucune section) jusqu'à la première
installation : les parties existantes sont identiques tick à tick (test).

## 2. Réseaux (contrat municipal)

Canalisations et égouts suivent la voirie : un nœud par carrefour, une arête par tronçon (capacité eau
boulevard 420, avenue 320, rue 160, piétonne 90 m³/h ; égouts × 1,5 ; fuites 0,4 %/tronçon). Chaque bâtiment est
branché à l'extrémité la plus proche du tronçon qui le dessert (≤ 80 m), les consommations sont agrégées par
nœud. Réseaux `eau` (producteurs : usines coût 1, pompages sans usine coût 2, châteaux coût 3) et `egouts`
(exutoires : stations d'épuration coût 1, émissaires coût 10 ; consommateurs = eaux usées). Topologie reconstruite
quand la voirie ou les bâtiments changent.

### Canalisations intégrées aux routes (rappel, 16/11)

Il n'y a **aucun tuyau à poser** : chaque route porte une conduite d'eau et un égout. Une station de pompage, une
usine ou une station d'épuration à moins de 80 m d'une route dessert tout le réseau routier connecté ; un bâtiment
au bord d'une route desservie est branché automatiquement. Installation à plus de 80 m de toute route : alerte du
panneau et notification unique « … isolée : reliez-la à une route… » (réarmée quand elle est reliée puis isolée de
nouveau). Le calque « Eau : desserte » montre les conduites alimentées (bleu) ou à sec (gris) le long des voies.

## 3. Pas horaire

1. Demande par bâtiment : (0,05 + 0,15 m³ × habitants + emplois × 0,3 industrie / 0,04 commerce / 0,06 public)
   par jour × profil horaire (creux 3 h ≈ 0,28, pointes 7-8 h et 19 h ≈ 1,6) × élasticité au tarif × restrictions.
2. Production par composante routière : eau brute (pompages) → usines (capacité × financement, qualité =
   1 − (1 − qualité brute) × (1 − abattement)) ; sans usine, l'eau brute est distribuée non traitée.
3. Répartition `eau` ; les châteaux se vident à la pointe et se remplissent avec l'excédent de capacité.
4. Pression : charge maximale atteignable à chaque nœud (Dijkstra multi-sources ; châteaux sol + 32 m, usines
   +22 m ; pertes 0,004 m/m × (0,25 + utilisation²)) ; pression = (charge − altitude du bâtiment) / 10,2 bar ;
   facteur de service nul sous 0,3 bar, plein dès 1,5 bar. Desserte = part reçue × facteur de pression ;
   « desservi » ≥ 50 %.
5. Eaux usées = 90 % de l'eau reçue → `egouts` : stations (capacité et abattement × financement : sous-financée,
   elle épure partiellement), puis émissaires (brut), sinon débordement (eau la plus proche à ≤ 200 m, sinon
   `pollution_sol`).
6. Rejets → charge par cellule → routage vers l'aval → `pollution_eau` (réponse 50 %/h). La qualité de l'eau
   captée en surface dépend de `pollution_eau` à la prise : pomper en aval d'un rejet dégrade l'eau distribuée.

Hydrographie (`river.ts`) : cellule en eau si ≥ 3 de ses 9 échantillons le sont ; sens d'écoulement par
priority-flood depuis les exutoires (bords de carte, sinon point bas), exutoires « amont » raccordés à leur voisin
plus bas ; concentration = charge / (accumulation × 0,6), autoépuration 0,4 %/cellule ; indice = 100·(1 − e^−c).

## 4. Effets (pas journalier) et tests d'effet

Grilles écrites (contributions remplacées chaque jour, jamais cumulées) : `satisfaction` (−30 non desservi,
−20 × (1 − qualité), −6 sans égout, tarif > 2 : −2,5/¢, restrictions −3), `eau:desserte`, `eau:qualite`,
`eau:risque_sanitaire`. Registre d'effets : causes `penurie_eau`, `rejet_eaux_usees` (mesure de `pollution_eau`
à J+1), `reglage_eau` (décision du joueur, mesures à J+1 de `pollution_eau`, `satisfaction`, `eau:desserte`).

Mesures (`npx tsx --test tests/eau/effets.test.ts`, 2026-11-13) :
1. Financement eau coupé : desserte 1,00 → 0,00 ; satisfaction des cellules de logements 43,9 → 14,0 ;
   24/24 bâtiments non desservis ; `growthAllowed` faux pour tous les logements.
2. Émissaire sans station : rejet brut 0,96 m³/h ; `pollution_eau` le long de l'aval 32,5 / 23,0 / 17,7 / 9,2 /
   4,2 / 1,5 / 0,4 (cellules 0, 1, 2, 5, 10, 20, 39) ; toutes les cellules hors aval restent à 0.
3. Station à 100 % puis à 35 % : rendement 92 % → 32 % ; charge rejetée 0,061 → 0,519 u/h ; somme de la
   pollution sur 30 cellules aval 8,5 → 70,0.
4. Pompage en aval d'un émissaire (sans usine) : pollution captée 0 → 12,4 ; qualité 0,70 → 0,58 ;
   risque sanitaire 0,30 → 0,48 ; satisfaction 44,0 → 40,5.

## 5. Budget, réglages, protocole

Réglages (`pluginCommand { plugin: 'eau', name: 'settings', payload }`) : `fundingWater`, `fundingSewer`
(0..1,5), `tariff` (0..6 ¢/m³), `restrictions`. Lignes mensuelles du service `eau` : `vente:eau`,
`exploitation:{pompage,potabilisation,epuration,chateaux}`, `entretien:canalisations` (180 ¢/km/mois). Non
appliquées à la trésorerie tant que docs/requests/municipal.md §3.2 n'est pas fait.

**Vente d'eau aux villes voisines (16/11)** — chaque heure, la capacité **potable** restante des usines de
potabilisation (composantes avec usine : ni livrée, ni stockée — les **châteaux d'eau sont remplis d'abord**) est
vendue, plafonnée à **60 m³/h**, au prix de **0,5 CHF/m³** (`WATER_EXPORT`, src/shared/water-network/types.ts) :
au-dessus du coût de production (pompage 0,08 + potabilisation 0,18 CHF/m³, payé sur le volume vendu, qui compte
comme pompé et traité), bien sous le prix d'achat au voisin (1,2 CHF/m³). Conditions : ville reliée à l'extérieur
— **raccordement au réseau d'eau voisin actif, ou connexion extérieure par route reliée** (même règle que
l'électricité, `linkedToNeighbours`, src/sim/connexions/lien.ts) —, aucune eau achetée cette heure-ci, financement
de l'eau > 0, réglage `vente` non désactivé (`settings { vente: false }` ; absent = activé). Recette versée chaque
heure à la trésorerie (`applyService(…, 'vente_eau_exterieure')`, poste détaillé du bilan financier), ligne
`vente:eau_exterieure` du budget du service (inscrite au grand livre à la clôture). Bilan horaire : `exported`,
`sellable` (m³/h, absents sans lien avec l'extérieur). Notification unique à la première vente
(`exportNotified`, champ facultatif de la sauvegarde, comme `settings.vente`). Panneau Eau : ligne « Vente d'eau
(villes voisines) » et case « Vendre le surplus d'eau potable aux villes voisines ». Tests : tests/eau/vente.test.ts.

Commandes : `settings`, `state`, `building { id }`, `history`. `delta.ext.eau` après chaque pas horaire (géométrie
des canalisations seulement quand la voirie change) ; `snapshot.ext.eau` complet (canalisations, cellules en eau).

## 6. Rendu et interface

Bouton « 💧 Eau » (en jeu) → panneau « Eau & égouts » (valeurs reçues de la simulation uniquement) et calque
souterrain : voile sombre sur la surface, conduites d'eau (bleu = alimentée, gris = à sec) et égouts (brun) de
part et d'autre de l'axe des voies, pastilles de desserte des bâtiments ; modes Desserte / Pression / Pollution
(cellules des cours d'eau colorées par `pollution_eau`). `window.__aube.eau` : `stats()`, `setMode()`, `open()`,
`last()` (e2e).

## 7. Limites connues

- La croissance bloquée et la satisfaction ne sont pas encore consommées par la démographie du cœur
  (docs/requests/eau.md §2–3) ; le service les calcule et les expose (testé).
- Pas de pompage hors composante : l'eau brute ne rejoint une usine que par la même composante routière.
- Débit des rivières approximé par l'accumulation de cellules en eau (le tracé réel n'est pas exposé aux modules).

## 8. Eau de surface dynamique : sources, retenues, creux (2026-11-16)

Distinct du service eau potable ci-dessus : module `src/sim/hydro` (détails et utilisation : `docs/TERRAFORMATION.md`).

- **Couches** : eau DE BASE (mer, lacs et rivières de la carte, canaux et rivières creusés : jamais modifiée par le
  module) et surface COMBINÉE `terrain.waterSurface` = max(base, eau dynamique), celle que voient le rendu, `isWet`, la
  pose des bâtiments et les modules (dont `RiverRouter`). Tant qu'aucune source, aucun barrage ni creux relié à l'eau
  n'existe, il n'y a qu'une couche : parties existantes identiques.
- **Modèle « remplir puis déborder »** (`fill.ts`, file de priorité sur la cote du fond) : chaque alimentation (source,
  rivière barrée) remplit sa cuvette par niveaux ; le volume délivré (débit × temps de jeu écoulé, quantifié à
  6 minutes) fait monter le niveau ; au col le plus bas l'eau déborde, suit la plus grande pente (ruisseau d'une case,
  0,35 m) jusqu'au creux suivant, une eau de base (exutoire) ou le bord de la carte. Une case CREUSÉE sèche plus basse
  qu'une eau voisine se remplit à son niveau. Bâtiments et chaussées : barrières. Déterministe : l'état ne dépend que
  des éditions et de la minute de jeu.
- **Barrage** : l'axe relevé jusqu'à la crête est une barrière continue ; la retenue monte jusqu'à la crête puis
  déborde ; la rivière aval reste à son niveau d'origine (test). Mesures : niveau de la retenue, aval, chute, débit
  entrant (service `hydro` pour l'électricité).
- **Sources de rivière (bord de la carte, mécanique inspirée de CS2)** :
  - *Rivières de la carte* : `riverInlets(terrain)` (`hydro/system.ts`) place une arrivée par rivière générée à son
    extrémité amont (marquée `edge` quand elle touche le bord), débit constant = largeur du lit × `DAM_FLOW_PER_M`,
    borné aux débits d'une source. Dérivées du terrain généré seul, jamais sauvegardées : identiques au rechargement,
    parties neuves et existantes (aucune édition ajoutée, rejeu inchangé). Elles ne versent pas d'eau en plus (la
    rivière est déjà de l'eau de base) : leur débit est SUIVI vers l'aval sur l'eau de base (`route`, file de priorité
    sur la cote) et compté par chaque barrage traversé, en cascade.
  - *Posées par le joueur* : outil Source d'eau, un clic à 64 m au plus du bord s'aimante sur l'échantillon du bord
    (`edgeSnap`, partagé par l'outil et la simulation) ; édition `{ k: 'source', …, e: 1 }`, débit réglable. Les cases
    du bord à moins de `INLET_GUARD` (6) cases de l'arrivée ne sont pas un exutoire : l'eau ne ressort pas par où elle
    entre. 12 sources de rivière au plus, comptées à part des 48 sources ordinaires. Refus en mer.
  - Anciennes sauvegardes : une source sans `e` reste une source ordinaire.
- **Barrage hydroélectrique** : l'ouvrage EST la centrale (`damPlantKw` = loi de la centrale au pied d'un barrage,
  `hydroDamKw` avec la puissance nominale du type : proportionnelle à chute × débit, saison, plafonnée). Chaque barrage
  traversé par un débit devient une installation du réseau électrique (identifiant négatif, `scanFacilities`),
  raccordée par une route proche de son milieu ou d'une culée. Une centrale (bâtiment) posée au pied du barrage le
  remplace : pas de double comptage. Entretien mensuel au prorata de la puissance au débit de printemps (5 000 CHF
  pour la puissance nominale, 1 000 CHF au moins, 0 sans débit), ligne `entretien:barrages_hydro`. L'aperçu de
  l'outil Barrage donne la puissance prévue (MW, saison en cours) ; sans débit : « Aucun débit ici : posez d'abord
  une source (ou une source de rivière au bord de la carte) ou choisissez la rivière ».
- **Mesures (tests `tests/terrain/sources-riviere.test.ts`, carte seed 7)** : barrage de vallée + source 60 m³/s :
  chute 14,1 m → 36,0 MW (hiver), aperçu à vide 0 MW ; barrage sur la rivière 0 de la carte : débit suivi 29 m³/s,
  chute 4,6 m → 5,7 MW ; source de rivière 40 m³/s dans une vallée fermée partant du bord : eau à 240 m en aval
  dès le premier jour, niveau stable sur 3 jours (lac plein, 77 m).
- **Rendu** : patchs de terrain existants (`terrainPatch`, drapeau `waterOnly` pendant un remplissage : pas de
  remaillage) ; le maillage des eaux intérieures de `WaterSystem` affiche lacs et retenues tels quels.
- **Coût** (ville de charge, Node) : 2,9 ms par calcul pendant un remplissage (un calcul toutes les 6 minutes de jeu),
  rien en régime établi.

## 9. Mesures et preuves (2026-11-13)

- Pas horaire, ville « stress » (500 bâtiments, 166 tronçons, Node, conteneur cloud) : 29 ms en moyenne sur 30 h,
  122 ms au premier pas (construction de la topologie et de l'hydrographie) ; pas journalier 3,4 ms.
- Budget ajouté au build : GLB compressés meshopt 1,17 Mo (1,79 Mo bruts), JS +21 Ko (principal) et +68 Ko
  (worker, contrat municipal compris) : ≈ 1,26 Mo ≤ 2 Mo.
- `npm run validate:visual` : les 5 modèles inspectés OK (6 112 / 9 108 / 4 856 / 10 068 / 2 032 triangles LOD0),
  tous posés dans la démo.
