# Demandes de l'agent VÉHICULES 3D + TRAFIC ROUTIER

Livré (fichiers possédés) :
- `tools/vehicles/**` : générateur de 15 véhicules GLB (LOD0/1/2) + textures PBR générées
  → `assets/vehicles/*.glb`, `assets/vehicles/textures/*.webp`, fragment `assets/catalog.vehicles.json` (`{ assets, textureSets }`) ;
- `src/sim/traffic/**` (+ `src/sim/traffic.ts`) : simulation de trafic en TypeScript pur (worker) ;
- `src/render/vehicles/**` : rendu instancié `InstancedVehicleRenderer` (implémente `IVehicleRenderer`) + scène de test ;
- `tests/vehicles/**` : 16 tests unitaires, captures de la scène de test.

Le jeu compile et tourne sans ces demandes, mais **ni les véhicules ni le trafic n'apparaissent dans le jeu tant que
les points 1 à 4 ne sont pas faits** (ils sont visibles dans la vitrine et la scène de test du module).

## 1. Propriétaire de `tools/generators/index.ts` (agent assets) — enregistrer le générateur
```ts
import { generateVehicles } from '../vehicles/build';
// dans GENERATORS :
{ name: 'Véhicules (15 modèles, LOD0/1/2)', run: (ctx) => generateVehicles(ctx) },
```
Durée ≈ 5 s, sans réseau. Écrit les GLB + textures et renvoie `{ assets, textureSets }` (15 véhicules, 2 jeux de textures).
Équivalent manuel : `npx tsx tools/vehicles/build.ts` (écrit aussi `assets/catalog.vehicles.json`).

## 2. Propriétaire de `tools/assets/validate.ts` (technical artist) — source autorisée
`checkLicense` n'accepte que `^tools/generators/`. Les véhicules déclarent `tools/vehicles/models.ts#<id>` et leurs textures
`tools/vehicles/textures.ts#writeVehicleTextures` (traçabilité exacte). Demande : accepter aussi `^tools/vehicles/`
(même demande que les bâtiments pour `^tools/buildings/`).

## 3. Architecte — protocole (`src/shared/protocol.ts`), rétro-compatible
1. `VehicleFrame` : champs optionnels `ids?: Uint32Array` (identifiant stable, indispensable à l'interpolation entre deux
   ticks), `variants?: Uint8Array` (variante de peinture), `flags?: Uint8Array` (1 freinage, 8 urgence).
   Ils sont déjà émis par `TrafficSystem.takeFrame()` (type `TrafficVehicleFrame`) et lus par `InstancedVehicleRenderer.setFrame()`.
2. `collectTransferables` : transférer aussi `ids`, `variants`, `flags` quand ils sont présents (sinon ils sont copiés).
3. Optionnel (cartes de chaleur, feux) : `DeltaMessage.traffic?: { signals?: Uint8Array; density?: { edgeIds: Int32Array; density: Float32Array; speed: Float32Array } }`
   (≈ 1 fois par seconde pour la densité). Producteurs : `TrafficSystem.signalStates()` / `densityFrame()`.
4. `package.json` : `"test"` += `tests/vehicles/*.test.ts` ; scripts
   `"vehicles:build": "tsx tools/vehicles/build.ts"`, `"vehicles:showcase": "tsx tools/vehicles/showcase/run.ts"`,
   `"vehicles:demo": "tsx tests/vehicles/capture.ts"`.

## 4. Agent SIMULATION (`src/sim/world.ts`) — brancher `TrafficSystem`
```ts
import { TrafficSystem, inputFromRoadGraph, buildingsFromStore } from './traffic';   // (ou inputFromRoadNetwork si le module routes est branché)
readonly traffic = new TrafficSystem({ seed: 1, maxVehicles: 3000 });
setCatalog(cat)      -> this.traffic.setCatalog(cat);
newGame / fromSave   -> this.traffic.clear(); this.traffic.setNetwork(inputFromRoadGraph(this.roads)); this.traffic.setBuildings(buildingsFromStore(this.buildings, this.catalog!));
après buildRoad / removeRoad      -> this.traffic.setNetwork(inputFromRoadGraph(this.roads));        // reconstruit au pas suivant, véhicules reportés
après placeBuilding / demolish    -> this.traffic.setBuildings(buildingsFromStore(this.buildings, this.catalog!));
tick()     -> remplacer updateTraffic(...) par : this.traffic.step(0.1, this.clock.date.hour + this.clock.date.minute / 60);
takeDelta  -> vehicles = this.traffic.takeFrame();   // trame étendue (ids, variantes, états), à la place de la recopie de VehicleStore
getStats   -> s.vehicles = this.traffic.actCount;
```
Notes : le trafic avance en temps PHYSIQUE (0,1 s par tick × vitesse de jeu) alors que l'horloge du jeu est accélérée
(2 min par tick) — comme tous les city-builders, sinon une voiture parcourrait 1,6 km par tick. La demande est
modulée par l'heure du jeu (pointes 8 h et 17 h). `VehicleStore` (ecs.ts) devient inutile pour le trafic.
`TrafficSystem.stats` (véhicules, arrivées, vitesse moyenne, feux, bâtiments reliés…) peut alimenter l'interface.

## 5. Agent INTÉGRATION (`src/render/index.ts`, démo)
```ts
import { InstancedVehicleRenderer, nightFactorForHour } from './vehicles/renderer';
const vehicles = new InstancedVehicleRenderer(ctx.scene, lib);   // AssetLibrary convient (catalog, load, url)
vehicles.attachCamera(ctx.camera);                               // culling + LOD par distance
applyDelta : if (d.vehicles) vehicles.setFrame(d.vehicles);      // (setVehicles reste valable sans ids)
chaque frame : vehicles.update(dt); vehicles.setNight(nightFactorForHour(stats.date.hour)); // phares + halos
démo : vehicles.preloadAll(); await vehicles.whenReady(); avant demoReady
```
Les véhicules ont besoin de `catalog.vehicles.json` fusionné dans `catalog.json` (point 1).

## 6. Agent ROUTES — feux tricolores
`TrafficSystem.signalStates()` donne, pour chaque bras régulé, `{ nodeId, arc, state }` (0 vert, 1 orange, 2 rouge).
La scène de test dessine des feux procéduraux simples ; un modèle de feu du catalogue posé par le module routes
pourrait être piloté par ces états (point 3.3 pour les transmettre).

## 7. Budget disque
Véhicules : **≈ 4,0 Mo** (15 modèles × 3 LOD ≈ 3,7 Mo de géométrie quantifiée + 0,3 Mo de textures partagées).
L'ensemble `assets/` dépasse déjà 55 Mo avec les bâtiments en cours. Leviers : `EXT_meshopt_compression`
(÷ 2 à 3, décodeur à ajouter dans GLTFLoader et la porte QA), ou LOD0 allégés.

## 8. QA (`FEATURES.md`)
Preuves : `tests/vehicles/traffic.test.ts` (16 tests), planches `tests/vehicles/out/planche_*.png` (vitrine, 15 modèles,
LOD, nuit, variantes) et captures `tests/vehicles/out/demo_*.png` (vue aérienne, carrefour à feux, dessus, rue, avenue,
densité, nuit) avec `demo_rapport.json`.
