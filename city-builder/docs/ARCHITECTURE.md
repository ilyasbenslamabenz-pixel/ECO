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
  save/     stockage local des sauvegardes JSON
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
  (vitesses 0/1/2/4). Elle valide chaque commande (coût, collisions, pente, eau, limites).
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
| `buildRoad` | type, points[x,z,…], dryRun? | edgeIds, cost | limites, pente ≤ 12 %, eau (ponts : phase 3), collision bâtiments, fonds |
| `removeRoad` | edgeId | refund (25 %) | existence |
| `placeBuilding` | assetId, x, z, rot(0..3), variant?, dryRun? | buildingId, cost | asset bâtiment, grille, collision bâtiments/routes, pente ≤ 25 %, eau, fonds |
| `demolish` | buildingId | refund (25 %) | existence |
| `setSpeed` | 0/1/2/4 | speed | valeur |
| `terraform` | x, z, radius, delta | — | **NOT_IMPLEMENTED (phase 2)** |
| `save` | slot | SaveFile JSON | partie en cours |
| `load` | SaveFile | buildings (+ instantané) | format, version, assets connus |

Worker -> main : `ready`, `result`, `snapshot`, `delta` (≈10/s), `log`.
Transferables : `terrain.heights.buffer` (instantané), `vehicles.positions/assetIndices` (delta),
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
