# Aube Urbaine — Architecture

City-builder 3D original. Ce document fixe les choix techniques et les contrats entre modules.
Toute modification d'un contrat (`src/shared/contracts.ts`, `src/shared/protocol.ts`,
`src/shared/catalog.ts`) doit être validée par l'architecte et répercutée ici.

## 1. Choix de plateforme : Web + Three.js

| Contrainte | Conséquence |
|---|---|
| Environnement de dev Linux sans GPU, sans Unity/Blender/.NET | Moteur web : Three.js (épinglé `0.187.0`), TypeScript strict, esbuild. Tests WebGL par Chromium + SwiftShader (rendu logiciel, ~2-5 i/s : **les performances mesurées en CI ne sont pas représentatives**). |
| Livrable hébergé en page statique (index.html + fragment artifact.html) | Bundle ESM unique `game.js` + worker classique `sim.worker.js`, assets chargés en chemins relatifs à `import.meta.url`. Pas de SharedArrayBuffer (pas de COOP/COEP). |
| Souris/clavier + tactile iPhone | Pointer Events unifiés, `touch-action: none`, zones sûres `env(safe-area-inset-*)`. |
| Migration future Unity/Unreal | Simulation, formats et protocole indépendants du moteur (voir §7). |

## 2. Découpage

```
src/
  shared/   données et contrats PURS (ni three, ni DOM) : constantes, maths, catalogue,
            contrats (types + interfaces de rendu neutres), protocole, génération de terrain
  sim/      simulation (worker) : ECS SoA, horloge, économie, démographie, trafic,
            pathfinding, sauvegarde ; world.ts = état + commandes validées ; worker.ts = boucle
  client/   pont main-thread <-> worker (SimBridge), état local d'interface
  render/   Three.js : scène, environnement, terrain, eau, routes, bâtiments, véhicules,
            bibliothèque d'assets (GLB + cache), validation visuelle
  input/    caméra (aérienne / rue), outils de construction
  ui/       balisage HTML, CSS (thème sombre), HUD
  save/     sauvegardes : SaveStore local (IndexedDB + gzip), cloud.ts = en ligne dans l'artifact (docs/SAUVEGARDES.md)
  main.ts   amorçage et câblage
tools/      pipeline d'assets Node (générateurs GLB, inspection gltf-transform, validation)
assets/     sources : catalog.json, models/, textures/, hdri/, LICENSES.md
tests/      unit (node:test via tsx), e2e (Playwright/Chromium)
```

Garde-fou automatique : `tests/unit/architecture.test.ts` échoue si `src/sim` ou `src/shared`
importe three, un module navigateur, ou utilise une API DOM.

## 3. Séparation simulation / rendu

- La **simulation** est la seule source de vérité. Elle tourne dans un Web Worker
  (`dist/sim.worker.js`), à pas fixe de 100 ms (`SIM_TICKS_PER_SECOND = 10`), `speed` ticks par pas
  (vitesses 0/1/2/4) ; un tick = 0,2 min de jeu (journée = 12 min réelles à x1). Elle valide chaque commande (coût, collisions, pente, eau, limites).
- Le **rendu** ne modifie jamais l'état du jeu : il applique un **instantané** complet
  (après `newGame`/`load`) puis des **deltas** (ajouts/suppressions de routes et bâtiments,
  trame véhicules, statistiques).
- Le terrain est généré de façon déterministe (`shared/terrain-gen.ts`) dans le worker et
  sa carte de hauteurs est **transférée** au rendu ; `terrainHeightAt` est la même fonction des deux côtés.

## 4. Protocole (`src/shared/protocol.ts`, version `PROTOCOL_VERSION = 1`)

Main -> worker : `{ kind:'cmd', reqId, name, args }`. Chaque commande reçoit exactement une
réponse `{ kind:'result', reqId, ok:true, data }` ou `{ ok:false, error:{ code, message, phase? } }`.

| Commande | Arguments | Réponse | Validation côté sim |
|---|---|---|---|
| `init` | protocolVersion, catalog | protocolVersion | version |
| `newGame` | seed, mapChunks, startMoney, cityName | seed (+ instantané) | bornes |
| `buildRoad` | type (hérité), kind (6 types), points[x,z,…], control? (courbe quadratique si 2 points), dryRun? | edgeIds, cost | limites, pente par type, eau (ponts automatiques), carrefours automatiques, collision bâtiments, fonds |
| `removeRoad` | edgeId | refund (25 %) | existence |
| `upgradeRoad` | edgeId, kind?, reverse?, dryRun? | edgeId (nouveau), kind, cost, refund | existence, type ≠ actuel ou inversion (sens unique seulement), emprise élargie libre (bâtiment nommé dans le refus, routes voisines), rayon, pente et ponts du nouveau type, raccord autoroute ; coût = différence de prix (ponts compris), déclassement remboursé à 25 % — `src/sim/roads/upgrade.ts` |
| `placeBuilding` | assetId, x, z (au cm, pas de grille), rot (quarts de tour, **décimal autorisé** : 0,5 = 45°), variant?, dryRun? | buildingId, cost | asset bâtiment, empreinte ORIENTÉE (`src/shared/footprint.ts`) : collision bâtiments (séparation par axes) et routes courbes (distance segment/rectangle orienté), relief, eau, fonds |
| `demolish` | buildingId | refund (25 %) | existence |
| `setSpeed` | 0/1/2/4 | speed | valeur |
| `terraform` | x, z, radius, delta | — | **NOT_IMPLEMENTED (phase 2)** |
| `save` | slot | SaveFile JSON | partie en cours |
| `load` | SaveFile | buildings (+ instantané) | format, version, assets connus |
| `pluginCommand` | plugin, name, payload? | data? | forme (§9), module enregistré, puis le module |

Worker -> main : `ready`, `result`, `snapshot`, `delta` (≈10/s), `log`.
Feux tricolores (ajout rétrocompatible, QA n° 2) : `DeltaMessage.signals?: SignalFrame` = `{ version, states: Uint8Array
(0 vert, 1 orange, 2 rouge, un octet par bras régulé), layout?: { version, heads: Float32Array (SIGNAL_HEAD_STRIDE = 8
flottants par bras : pied du poteau x/y/z, cap du trafic entrant, portée vers le centre des voies, voies, rayon du
carrefour, index du carrefour), nodeIds: Int32Array } }`. La disposition n'est envoyée qu'après un changement de réseau
ou un instantané ; les états seulement quand ils changent (aucun octet en régime établi). Rendu :
`src/render/traffic/signals.ts` (7 `InstancedMesh`).
Transferables : `terrain.heights.buffer` (instantané), `vehicles.positions/assetIndices` et `signals.*` (delta),
listés par `collectTransferables()`. Les arguments sont revalidés à l'exécution par
`validateCommandMessage()` (le worker ne fait pas confiance au thread principal).

## 5. Données ECS (structure-de-tableaux)

`src/sim/ecs.ts` : `BuildingStore`, `RoadGraph` (nœuds + arêtes), `VehicleStore`.
Typed arrays denses, suppression par permutation avec le dernier, table id -> index,
croissance par doublement. Les boucles de tick n'allouent pas (seul `takeDelta()` crée les
buffers véhicules qui sont ensuite transférés). Grille d'occupation `Int32Array` (1 case = 8 m).

Limites connues (à lever avant de viser des dizaines de milliers d'entités) :
collisions route/bâtiment et accrochage de nœuds en O(n) → index spatial par chunk prévu (phase 2).

## 6. Budget de performance (cible matériel PC milieu de gamme, 1080p)

| Poste | Cible |
|---|---|
| Frame | ≤ 16,6 ms (60 i/s), ≤ 1 500 draw calls |
| Bâtiments | 10 000+ via `InstancedMesh` par (asset, sous-maillage, LOD) ; LOD0 < 150 m, LOD1 < 600 m, LOD2 au-delà |
| Véhicules | 5 000 instanciés, positions transférées (16 o/véhicule/trame) |
| Terrain | chunks de 256 m, un maillage par chunk (culling natif), LOD de chunk prévu |
| Tick sim | ≤ 4 ms à x4 pour 10 000 bâtiments (mesuré : `stats.tickMs`) |
| Assets | GLB ≤ 2 Mo/LOD0 bâtiment, textures 1K (2K pour les héros), budget dist 60 Mo |
| Chargement | catalogue puis GLB à la demande (cache + dédoublonnage), streaming par proximité caméra (phase 1-2) |

Mesures réelles : à faire sur GPU réel (impossible dans l'environnement CI actuel).

## 7. Migration vers Unity / Unreal

Convention de rotation des bâtiments (sauvegarde, protocole) : `rot` en quarts de tour autour de l'axe vertical,
sens trigonométrique vu du dessus, monde = (lx·cosθ + lz·sinθ, −lx·sinθ + lz·cosθ), θ = rot·π/2 (identique à
`rotation.y` de three). Unity (main gauche, Y en haut) : `Quaternion.Euler(0, -θ·Rad2Deg, 0)` après inversion de Z ;
Unreal (Z en haut, cm) : yaw = −θ en degrés, x/z ×100. Les empreintes orientées (`src/shared/footprint.ts`, ≈ 150 lignes)
se transposent telles quelles.


Ce qui est portable tel quel : le **catalogue JSON** (`AssetCatalog`), les **GLB** (importables
nativement dans Unity via glTFast et dans Unreal via Interchange/glTF), les **textures PBR** et
HDRI, le **format de sauvegarde** (`SaveFile`, versionné), le **protocole de messages**.

Ce qui se réécrit : `src/sim/**` + `src/shared/**` sont du TypeScript sans dépendance
(≈ 1 500 lignes) → transposition directe en C# (Unity : `struct`/`NativeArray` SoA, Jobs/Burst
au lieu du Worker) ou C++ (Unreal : `TArray` SoA, tâche sur thread dédié). Les interfaces
`IRenderTerrain`, `IRoadRenderer`, `IBuildingRenderer`, `IVehicleRenderer`, `IAssetLibrary`,
`ICameraController`, `IToolController` n'utilisent que des nombres, typed arrays et identifiants :
elles deviennent des interfaces C#/C++ implémentées par des `MonoBehaviour`/`Actor`
(InstancedMesh → `Graphics.RenderMeshInstanced` / `UInstancedStaticMeshComponent` + HLOD).

Procédure : (1) importer `assets/` et le catalogue via un script d'éditeur ; (2) porter
`shared` + `sim` et rejouer les tests unitaires (mêmes cas, mêmes valeurs attendues :
le terrain et le PRNG sont déterministes) ; (3) implémenter les interfaces de rendu ;
(4) vérifier qu'une sauvegarde JSON produite par la version web se charge à l'identique.

## 8. Intégration phase 1 (directeur technique, 2026-11-12)

- **Contrats fusionnés** (rétro-compatibles) : `RoadKindId` (6 types) et champs facultatifs de `RoadEdgeRecord`
  (`kind`, `c1`/`c2` Bézier, `profile`, `bridgeRuns`) ; `buildRoad` accepte `kind` et `control` ; `NewGameParams`
  accepte `terrain` (options de carte) et `startHour` ; `VehicleFrame` porte `ids`/`variants`/`flags` (transférés) ;
  `DeltaMessage` porte `terrainPatch` (zone nivelée, transférée) et `report` (`SimReport`) ; l'instantané transfère toutes
  les couches du `WorldTerrain` ; `SAVE_FORMAT_VERSION = 2`. Commandes étendues (`sim-protocol.ts`) appelées par
  `SimBridge.sendExt`, dont `buildCity` (ville de démonstration / de charge construite par les opérations du joueur).
- **Simulation** : `world.ts` utilise `generateWorld` (eau par `waterSurface`), le `RoadNetwork` du module routes
  (planification, découpe, ponts ; profils calculés sur le terrain NATUREL), le nivellement `gradeTerrainForRoads`
  recalculé depuis le terrain naturel pour TOUTES les routes (résultat indépendant de l'ordre : identique après
  chargement), le trafic sur `inputFromRoadNetwork` (les véhicules suivent les courbes).
- **Rendu** (`src/render/index.ts`) : SkySystem, TerrainSystem, WaterSystem, VegetationSystem, RoadNetworkRenderer
  (avec la bibliothèque : textures PBR et décor), InstancedBuildingRenderer, InstancedVehicleRenderer, PropLayer (décor
  de démonstration). L'ancien rendu de fondation (`terrain.ts`, `water.ts`, `environment.ts`, `buildings.ts`,
  `vehicles.ts`) n'est plus utilisé par le jeu (conservé pour l'historique ; à supprimer).
- **Build** : les GLB de `dist/assets` sont compressés `EXT_meshopt_compression` (`scripts/optimize-glb.mjs`, cache
  `.cache/glb-opt`) : 44 → 26 Mo, textures partagées conservées par URI. `AssetLibrary` enregistre `MeshoptDecoder`
  et convertit en float32 les attributs géométriques quantifiés (les UV restent quantifiées : le rendu des
  bâtiments applique sa plage `uvq`).
- **Tests en rendu logiciel** : `?norender` empêche la boucle d'affichage de démarrer ; les tests rendent les images à la
  demande (`__aube.renderNow`), car une image de la démo coûte 1 à 4 minutes sous SwiftShader.

## 9. Points d'extension (phase 2)

Préparation §0 de `docs/ROADMAP_PHASE2.md` : chaque module de phase 2 (`batiments`, `circulation`, `pietons`,
`chantiers`) possède SES fichiers ; les registres communs (une ligne par module) existent déjà. Modules vides =
aucun effet : la simulation est identique tick à tick avec ou sans registre (`tests/plugins/plugins.test.ts`).

| Couche | Fichier du module (propriété `p2a-<module>`) | Registre / hôte commun |
|---|---|---|
| Simulation | `src/sim/plugins/<module>.ts` (`SimPlugin`) | `src/sim/plugins/index.ts` (`SIM_PLUGINS`), `types.ts`, `host.ts` (`PluginHost`) |
| Protocole | `src/shared/protocol-ext/<module>.ts` (`<M>Delta`, `<M>Snapshot`, `<M>Commands`) | `src/shared/protocol-ext/index.ts` (`PHASE2_MODULES`, `deltaExt`, `snapshotExt`) |
| Sauvegarde | `src/sim/save-sections/<module>.ts` (`<M>_SAVE_VERSION`, `migrate<M>`) | `src/sim/save-sections/index.ts` (`SAVE_SECTIONS`), `types.ts` (`runMigrations`) |
| Rendu | `src/render/plugins/<module>.ts` (`RenderPlugin`) | `src/render/plugins/index.ts` (`RENDER_PLUGINS`, `RenderPluginHost`) |
| Interface | `src/ui/panels/<module>.ts` (`UiPanel`) | `src/ui/panels/index.ts` (`UI_PANELS` ; importer `ui/panels/index`, `src/ui/panels.ts` existe) |
| Tests | `tests/<module>/*.test.ts` | script `npm test` (inclut aussi `tests/plugins`) |

**Simulation** (`SimPlugin`, tous crochets facultatifs) : `init(ctx)` au premier catalogue ; `onNewGame(ctx)` à chaque
nouvelle partie et au début d'un chargement ; `load(ctx, data, version)` ensuite si la sauvegarde contient la section ;
par tick : `onDayStart` / `onMonthStart` (après le traitement de base de l'événement) puis `onTick(ctx, minutes)` (après
démographie et trafic) ; `takeDelta(ctx)` → `delta.ext[id]` ; `snapshot(ctx)` → `snapshot.ext[id]` ; `save(ctx)` →
`save.plugins[id] = { v: saveVersion ?? 1, data, rng }` ; `command(ctx, name, payload)`. Toute exception est attrapée
(journal console une fois par module et crochet, une notification joueur par module), jamais propagée à la boucle.

**Façade `PluginContext`** (lecture seule) : `clock` (minutes, heure, jour, mois, saison, jour de semaine), `params`,
`inGame`, `catalog` / `getAsset`, `terrain` (`heightAt`, `isWet`, `bounds`), `roads` (méthodes de consultation de
`RoadNetwork`, dont `version`), `buildings` (colonnes SoA sans allocation, `indexOf`, `record`, `assetOf`, `query` par
index spatial), `demography` (`population`, `households`, `report()`), `speed`, `rng` (PRNG **propre au module**, semé
par la graine de la partie et l'id, sauvegardé avec la section : il ne perturbe jamais le PRNG de base), `notify`,
`provide` / `use` (services inter-modules, ex. API des feux publiée par la circulation pour les piétons). Aucun objet
interne mutable (économie, planificateur, PRNG de base) n'est exposé ; besoin supplémentaire → `docs/requests/<module>.md`.

**Protocole** (ajouts rétrocompatibles) : `DeltaMessage.ext?` (clé absente si aucun module n'envoie rien),
`SnapshotMessage.ext?`, commande `pluginCommand { plugin, name, payload? } -> { data? }` (forme validée par
`validateCommandMessage` ; module non enregistré → `INVALID_ARGS « Module inconnu »` ; module sans commandes →
`NOT_IMPLEMENTED` ; code d'erreur hors `CommandErrorCode` → `INVALID_ARGS` avec le code en préfixe). Les tableaux typés
d'une charge utile sont copiés, sauf ceux listés sous `$transfer` (`PLUGIN_TRANSFER_KEY`), transférés.

**Sauvegarde** : champ facultatif `plugins` (format v2 inchangé : les anciennes sauvegardes se chargent ; aucun champ
écrit par des modules vides). Section d'un module inconnu ou de version plus récente : conservée telle quelle et
réécrite. Section illisible ou `load` en erreur : notification, module remis à neuf, section d'origine conservée, le
reste de la partie est chargé.

**Rendu** (`RenderPlugin`) : `init({ scene, camera, renderer, sun, catalog, lib, heightAt, nightFactor })` après les
systèmes de base ; `applySnapshotExt(snapshot.ext?.[id])` à chaque instantané (aussi avec `undefined`) ;
`applyDeltaExt(payload)` quand `delta.ext[id]` est présent ; `frame(dt)` à chaque image ; `dispose()`. Exceptions
attrapées (console.error une fois par module et crochet).

**Banc de captures** : `npm run captures` (`tests/e2e/captures.mjs`) — 15 vues de la démo (aérien, horizon, rue,
carrefour à feux, 4 quartiers, nuit, iPhone portrait) dans `tests/e2e/out/captures/` ; échec sur image quasi uniforme
(écart-type < 10), erreur de page / console / requête ou modèle manquant.
