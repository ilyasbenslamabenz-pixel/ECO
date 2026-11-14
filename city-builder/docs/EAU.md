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

## 8. Mesures et preuves (2026-11-13)

- Pas horaire, ville « stress » (500 bâtiments, 166 tronçons, Node, conteneur cloud) : 29 ms en moyenne sur 30 h,
  122 ms au premier pas (construction de la topologie et de l'hydrographie) ; pas journalier 3,4 ms.
- Budget ajouté au build : GLB compressés meshopt 1,17 Mo (1,79 Mo bruts), JS +21 Ko (principal) et +68 Ko
  (worker, contrat municipal compris) : ≈ 1,26 Mo ≤ 2 Mo.
- `npm run validate:visual` : les 5 modèles inspectés OK (6 112 / 9 108 / 4 856 / 10 068 / 2 032 triangles LOD0),
  tous posés dans la démo.
