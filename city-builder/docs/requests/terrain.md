# Demandes de l'agent TERRAIN / ENVIRONNEMENT

Les modules sont prêts et testés hors jeu (démo `src/render/terrain/demo/`). Le branchement dans le jeu
passe par des fichiers qui ne m'appartiennent pas. Chaque demande ci-dessous dit quel fichier, quoi changer et pourquoi.

## 1. Intégration (`src/render/index.ts`, `src/main.ts`) — prioritaire

Remplacer les rendus de fondation (`terrain.ts`, `water.ts`, `environment.ts`, qui restent fonctionnels
en attendant) par les nouveaux systèmes :

```ts
import { TerrainSystem } from './terrain/renderer';
import { WaterSystem } from './water/water-system';
import { SkySystem } from './sky/sky-system';
import { VegetationSystem } from './nature/vegetation';

const sky = await SkySystem.create({ renderer: ctx.renderer, scene: ctx.scene, sun: ctx.sun, hemi: ctx.hemi, catalog, assetsBase });
const terrain = new TerrainSystem(ctx.scene, { catalog, assetsBase });   // implémente IRenderTerrain
const water = new WaterSystem(ctx.scene);
const veg = new VegetationSystem(ctx.scene, lib, { heightAt: (x, z) => terrain.heightAt(x, z), renderer: ctx.renderer });
await veg.load(); veg.syncLights(ctx.sun, ctx.hemi, sky.ambientSky, sky.ambientGround);

// applySnapshot :
terrain.build(s.terrain); water.build(s.terrain); if (isWorldTerrain(s.terrain)) veg.scatter(s.terrain);
// chaque image :
terrain.update(ctx.camera); water.update(dt); sky.update(dt, ctx.camera); veg.update(ctx.camera);
// suivi des ombres (remplace env.follow) :
sky.followView(pose.targetX, pose.targetY, pose.targetZ, pose.distance);
// heure simulée -> lumière :
sky.setTimeOfDay(stats.date.hour + stats.date.minute / 60); veg.syncLights(ctx.sun, ctx.hemi, sky.ambientSky, sky.ambientGround);
```

- `scene.ts` : `scene.fog` et `scene.background` sont repris par `SkySystem` (brouillard exp² accordé au ciel).
  La caméra doit avoir `far` >= 9000 pour voir l'anneau d'horizon ; 6000 suffit avec un brouillard plus dense.
- Construction : appeler `veg.removeInFootprint(...)` à l'ajout d'un bâtiment et `veg.removeAlongSegment(...)`
  à l'ajout d'une route (deltas `buildingsAdded` / `roadEdgesAdded`).
- Scène de démonstration : `veg.plant([{x, z, assetId: 'arbre_peuplier'}, ...])` pour les alignements de rue.

## 2. Simulation (`src/sim/world.ts`, `src/sim/handler.ts`) — agent simulation

- Génération : remplacer `generateTerrain(seed, mapChunks)` par
  `generateWorld({ seed, mapChunks, ...paramsCarte })` (`src/sim/terrain`). Le résultat est un `TerrainData`
  (mêmes champs, pas de 8 m par défaut) enrichi de `waterSurface`, `moisture`, `forest`, `resources` et `rivers`.
  Les dimensions restent compatibles avec `tilesPerSide = samplesX - 1`.
- Validation « sous l'eau » : utiliser `waterSurface[k] > heights[k]` au lieu de `h < waterLevel` : les rivières
  et les lacs d'altitude sont au-dessus du niveau de la mer.
- Instantané : transférer aussi les couches avec `worldTransferables(world)` à la place de `[heights.buffer]`.
- Terraformation (phase 2) : la commande `terraform` peut appeler
  `applyTerraform(world, { kind, x, z, radius, strength })`, qui renvoie la région modifiée et le volume déplacé
  (pour le coût). Il faut aussi :
  - refuser l'opération sous un bâtiment ou une route ;
  - envoyer `extractPatch(world, rect)` au rendu.

## 3. Architecte (`src/shared/protocol.ts`, `contracts.ts`)

- **Message `terrainPatch`** (worker -> main) : `{ kind: 'terrainPatch', patch: TerrainPatch }`.
  `patch.heights.buffer` et `patch.waterSurface.buffer` sont transférés. Côté rendu :
  `terrain.applyPatch(p)` puis `water.applyPatch(p)`.
- **Commande `terraform`** : ajouter `kind: 'raise' | 'lower' | 'flatten' | 'smooth'` (aujourd'hui seul `delta` existe).
- **`NewGameParams`** : ajouter les paramètres de carte facultatifs `hydrology`, `relief`, `forest`, `rivers`,
  `maxAltitude` et `resources` (voir `WorldGenParams`).
- **`SaveFile` v2** : sauvegarder la carte de hauteurs modifiée (patchs de terraformation ou heights complet en base64),
  et `waterSurface`.
- **`collectTransferables`** : accepter les couches supplémentaires d'un `WorldTerrain`.

## 4. Agent assets (`tools/generators/index.ts`)

Enregistrer mon générateur :

```ts
import { environmentGenerator } from './environment';
GENERATORS.push({ name: 'environnement (arbres procéduraux, rochers, fleurs)', run: environmentGenerator });
```

Il produit `assets/models/nature/**` :
- `arbre_epicea` et `arbre_peuplier`, générés par nos outils ;
- `rocher_mousse`, `rocher_granite`, `buisson_sauvage`, `fleurs_gazania` et `herbes_hautes`, issus de Poly Haven
  (CC0) et traités par `tools/assets/models.ts`.

Avec les 4 arbres de la sélection, cela donne 6 essences. Le poids ajouté est d'environ 2,3 Mo.
Merci de revendiquer `assets/models/nature/**` comme dossier de l'agent environnement.

## 5. QA (`package.json` scripts, `tests/`)

- Ajouter `tests/terrain/*.test.ts` à `npm test`, par exemple avec
  `"test": "tsx --test tests/unit/*.test.ts tests/terrain/*.test.ts"`.
- Script de démo facultatif :
  `"demo:env": "node src/render/terrain/demo/build-demo.mjs && node src/render/terrain/demo/capture.mjs"`.

## 6. Build (`scripts/build.mjs`) — facultatif

Pour les aperçus de carte dans l'écran « Nouvelle partie », ajouter une entrée de bundle :
`src/sim/terrain/gen.worker.ts` -> `dist/terrain-gen.worker.js` (format iife). Le maillage des chunks
n'en a pas besoin : son worker est créé depuis un Blob.
