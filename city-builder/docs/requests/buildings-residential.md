# Demandes du directeur artistique / artiste bâtiments résidentiels

Livré : kit modulaire `tools/buildings/kit/**` (API : `docs/BUILDING_KIT.md`), 17 bâtiments résidentiels
`tools/buildings/residential/**` → `assets/buildings/residential/*.glb` (LOD0/1/2) + fragment
`assets/catalog.buildings.residential.json` (`{ assets, textureSets }`), 6 jeux de textures Poly Haven du kit
(`assets/buildings/textures/`), rendu instancié `src/render/buildings/**` (`InstancedBuildingRenderer`).
Le jeu compile et tourne sans ces demandes, mais **les bâtiments n'apparaissent dans le jeu qu'une fois les points 1 à 3 faits**.

## 1. Propriétaire de `tools/generators/index.ts` (agent assets) — enregistrer le générateur
```ts
import { generateResidential } from '../buildings/residential/index';
// dans GENERATORS :
{ name: 'Bâtiments résidentiels (kit)', run: (ctx) => generateResidential(ctx) },
```
`generateResidential` lit `assets/catalog.json` (jeux de textures), construit les jeux du kit (cache Poly Haven, `POLYHAVEN_OFFLINE=1`
compatible), écrit les GLB et renvoie `{ assets, textureSets }` (17 bâtiments + 6 jeux). Durée ≈ 1 s (hors premier téléchargement).

## 2. Propriétaire de `tools/assets/validate.ts` (technical artist) — sources autorisées
`checkLicense` n'accepte que `^tools/generators/` comme source interne. Les bâtiments du kit déclarent
`tools/buildings/residential/<fichier>.ts#<fonction>` (traçabilité exacte). Demande : accepter aussi `^tools/buildings/`.
Rien d'autre à changer : bornes, triangles, textures (externes, résolues par NodeIO), licences passent (vérifié par
`tests/buildings/residential.test.ts`, qui reproduit ces contrôles sur le fragment).

## 3. Agent INTÉGRATION (`src/render/index.ts`) — brancher le rendu instancié
```ts
import { InstancedBuildingRenderer } from './buildings/renderer';
const buildings = new InstancedBuildingRenderer(ctx.scene, assetLibrary);   // AssetLibrary implémente ModelSource
buildings.attachCamera(ctx.camera);                                        // culling par instance
// chaque frame :
buildings.update(cam.x, cam.y, cam.z);
buildings.setNight(InstancedBuildingRenderer.nightFactorForHour(stats.date.hour)); // ou le facteur de l'agent ciel
// démo : buildings.preloadAll(); await buildings.whenReady(); avant demoReady
```
Il implémente `IBuildingRenderer` (add / remove / update / count / dispose) : remplacement direct de `BuildingRenderer`
(`src/render/buildings.ts`, à retirer ou à faire déléguer). Conseil : `THREE.Cache.enabled = true` pour que GLTFLoader ne
re-télécharge pas les textures externes partagées entre GLB (le rendu instancié, lui, reconstruit des matériaux partagés et
charge chaque image une seule fois).

## 4. Architecte (`package.json`) — scripts et tests
- `"test"` : ajouter `tests/buildings/*.test.ts` (49 tests, ≈ 20 s : la relecture des 51 GLB domine).
- `"buildings:residential": "tsx tools/buildings/residential/build.ts"` et `"buildings:showcase": "tsx tools/buildings/showcase/run.ts"`.

## 5. Budget disque (architecte / QA)
Résidentiel : **8,5 Mo** de GLB (LOD0 5,2 · LOD1 2,2 · LOD2 1,1) + 1,9 Mo de textures du kit (comptées dans la part Poly Haven,
≈ 33,7 / 35 Mo). Avec les ~32 Mo actuels, `dist` atteint ≈ 43 Mo avant les bâtiments non résidentiels et les véhicules.
Leviers si le budget de 55 Mo d'assets est menacé : compression `EXT_meshopt_compression` (÷ 2 à 3, nécessite
`MeshoptDecoder` dans GLTFLoader et dans la porte QA), ou LOD1 allégé (le kit le permet en un endroit : `ctx.lod`).

## 6. QA (`FEATURES.md`)
À inscrire, preuves à l'appui : `tests/buildings/*.test.ts`, planches `tests/buildings/out/planche_residentiel.png`,
`planche_lods.png`, `planche_variantes.png`, `porte_qa_planche.png`, `rue_*.png` (jour / nuit, vue aérienne / rue).
