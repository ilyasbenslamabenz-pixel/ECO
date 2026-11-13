# Déchets (phase 2B, sous-étape 6)

Module de simulation `dechets`, branché sur le contrat municipal (docs/MUNICIPAL.md) : production par bâtiment,
bacs locaux, tournées de camions-bennes, filières (tri, recyclage, incinération, décharge), pollution et nuisances,
budget, registre d'effets ; rendu (camions, tumulus, panache, conteneurs, calque) et panneau « Déchets ».

| Fichier | Rôle |
|---|---|
| `src/shared/waste/types.ts` | réglages, paramètres du modèle, synthèse, repères des modèles 3D |
| `src/sim/waste/system.ts` | `WasteSystem` : production, bacs, planification et avancement des tournées, filières, pollution, effets, budget |
| `src/sim/waste/graph.ts` | `TruckGraph` : graphe routier des camions (arrêts insérés sur les tronçons), Dijkstra, tracés |
| `src/sim/waste/save.ts`, `src/sim/save-sections/dechets.ts` | section de sauvegarde versionnée (v1) |
| `src/sim/plugins/dechets.ts` | le `SimPlugin` : tâches de l'ordonnanceur municipal, deltas, instantané, commandes |
| `src/shared/protocol-ext/dechets.ts` | `DechetsDelta`, `DechetsSnapshot`, `DechetsCommands` |
| `src/render/waste/layers.ts`, `src/render/plugins/dechets.ts` | rendu : camions (LOD), tumulus, panache, conteneurs, calque |
| `src/ui/panels/dechets.ts` | panneau « Déchets » |
| `tools/waste/models.ts`, `tools/waste/build.ts` | modèles GLB originaux (kit de bâtiments), `npm run waste:build` |
| `tests/dechets/*.test.ts`, `tests/dechets/e2e.mjs` | 10 tests (dont les 3 tests d'effet), parcours e2e avec captures |

## 1. Installations (bâtiments du catalogue, onglet « Services publics »)

Reconnues par leurs étiquettes : `dechets:depot` (+ `camions:N`), `dechets:tri` / `dechets:incinerateur`
(+ `capacite_jour:kg`), `dechets:decharge` (+ `capacite_totale:kg`). Une installation est « reliée » si un tronçon
carrossable passe à moins de 70 m.

| Modèle | Rôle | Capacité | Coût / entretien (¢) |
|---|---|---|---|
| `dechets_depot_camions` | dépôt, 4 camions-bennes | 4 camions × 8 t | 900 000 / 1 500 |
| `dechets_centre_tri` | tri de la part triée à la source ; 70 % recyclés (recettes), refus vers l'incinérateur | 30 t/j | 1 800 000 / 2 500 |
| `dechets_incinerateur` | combustion, énergie 0,55 MWh/t (recettes), pollution de l'air | 60 t/j | 4 500 000 / 5 000 |
| `dechets_decharge` | enfouissement ; pleine → débordement | 3 000 t | 1 200 000 / 1 200 |

Décor : `dechets_tumulus` (relief de la décharge, mis à l'échelle par le rendu), `dechets_conteneurs_tri`
(points d'apport au bord des rues, un groupe par îlot de 96 m habité, quand la part de tri est > 0).

## 2. Modèle

- **Production** (tâche horaire) : `habitants × 1,2 kg/j + emplois × kg/j par catégorie` (commerce 1,0 ; industrie
  2,5 ; public 0,6…), répartie entre part triée (`réglage`) et résiduelle. **Bacs** : capacité = 4 jours de
  production (30 kg minimum) ; au-delà, le surplus déborde = **non collecté**.
- **Collecte** : les jours de collecte (1 à 7 passages par semaine), départ à 6 h. Camions en service =
  `⌊flotte × financement⌋`. Les arrêts (bâtiments ayant ≥ 20 kg) sont répartis équitablement entre camions ; chaque
  camion va à l'arrêt le plus proche **en temps de trajet** (Dijkstra sur le graphe routier : vitesse commerciale
  18 km/h bornée par la voie, sens uniques respectés, rues piétonnes exclues), charge 1 min + 0,8 min / 100 kg,
  vide au centre de tri (part triée) puis à l'incinérateur (s'il a de la capacité) ou à la décharge (part
  résiduelle), au plus 2 vidages par service de 7 h, puis rentre au dépôt. Les ramassages ont lieu quand le camion
  arrive (horloge de jeu) : les bacs se vident au fil de la tournée.
- **Clôture journalière** : tri (30 t/j, 70 % recyclés), incinération (60 t/j ; file > 2 jours → décharge),
  enfouissement ; pollution : air (incinérateur), sol + eau (décharge, débordement), sol + nuisances (bacs qui
  débordent) ; **nuisances → satisfaction (−0,25/point) et valeur foncière (−0,3 ¢/m² par point)**, décalage
  réversible (la contribution précédente est remplacée, rien ne s'accumule quand la collecte reprend).
- **Budget** (mois) : exploitation des camions = `flotte × 1 800 ¢ × financement` (ligne `dechets:collecte`) ;
  recettes `dechets:recyclage` (60 ¢/t), `dechets:energie` (45 ¢/MWh). Lignes postées dans le contrat municipal
  (non appliquées à la trésorerie tant que le cœur ne le permet pas : docs/requests/municipal.md §3.2).
- **Registre d'effets** : causes `reglage_dechets` (joueur : effets sur les camions en service, le budget, puis
  chaque jour non-collecte et tournées), `dechets_non_collectes` (pollution du sol mesurée sur la grille, masse),
  `decharge_pleine` (pollution du sol mesurée, masse débordée ; notification).

Limites connues : camions simulés par le module (pas dans le trafic de base : pas d'embouteillage, API demandée
dans docs/requests/dechets.md §2) ; graphe en double sens sauf sens uniques, abscisse de Bézier ≈ abscisse
curviligne ; part triée collectée par les mêmes bennes (bi-compartiment).

## 3. Protocole

`delta.ext.dechets` : `trucks` (Float32Array `[x, z, cap, charge]`, à chaque delta pendant une tournée, transféré),
`summary` + `layer` (grille des nuisances et du sol, bacs `[x, z, remplissage]`) + `containers`, au plus une fois
par heure de jeu. `snapshot.ext.dechets` : tout. Commandes `pluginCommand { plugin: 'dechets' }` : `etat`,
`reglages { collectsPerWeek?, sortShare?, funding? }` (bornés), `collecter` (lance les tournées maintenant),
`bacs { buildingId }`. Sans le service `municipal`, le module est inactif (aucun `ext`, aucune section,
commandes → `NOT_IMPLEMENTED`).

## 4. Rendu et interface

Camions : modèle `vehicule_benne_ordures` (peinture « vert propreté »), LOD0/1/2 par distance, posés à la hauteur du
terrain, cap = direction du trajet. Tumulus : `dechets_tumulus` × 5 en emprise, hauteur = remplissage de la
décharge. Panache : bouffées de fumée au sommet de la cheminée quand l'incinérateur a brûlé la veille. Calque :
grille drapée sur le terrain (vert → rouge selon nuisances / pollution du sol) + colonnes au-dessus des bâtiments
(hauteur et couleur = remplissage des bacs). Panneau : production, collecte, stocks, filières, pollution, budget,
réglages (fréquence, part de tri, financement), case du calque. Montage provisoire : touche J (Maj+J : calque).

## 5. Preuves

Voir le compte rendu de la branche (commandes et résultats). Tests d'effet : `tests/dechets/effets.test.ts`.
