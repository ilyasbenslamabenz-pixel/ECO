# Demandes de l'agent CONSTRUCTION + CAMÉRA + INTERFACE

Livré : `src/input/**` (caméra, outils, aperçus 3D, câblage, factices), `src/client/tools/**` (cœur pur des
outils : géométrie, miroir de la simulation, snapping façade/route, tracé de route, machine à états, annulation),
`src/ui/**` (balisage, styles, HUD, barre de construction illustrée, panneaux, finances, options, emplacements,
infobulles, notifications), tests `tests/construction/*.test.ts` (21 tests) et la démo
`tests/construction/demo.mjs` (captures dans `tests/construction/out/`).

**Le jeu compile et tourne sans ces demandes** (`initUI` et `initInput` gardent leur signature, le test e2e passe),
mais **la construction n'apparaît dans le jeu qu'une fois le point 1 fait** : sans `initConstruction`, les outils
Routes, Bâtiments, Services, Environnement et Démolir restent désactivés avec leur badge « Phase 1 ».

## 1. Agent INTÉGRATION (`src/main.ts`) : brancher la construction et les fonctions du menu
```ts
import { initConstruction } from './input';
import { applyGraphicsOptions } from './ui/options';

// initUI : les gestionnaires facultatifs font apparaître les boutons correspondants
// (sans gestionnaire, le bouton reste masqué, ou désactivé avec sa phase).
const ui = initUI({
  ...gestionnairesActuels,
  onNewGameWith: (p) => startNewGame(p),          // { cityName, seed, mapChunks, startMoney } -> bridge.send('newGame', p)
  onLoadSlot: (slot) => { const d = readSave(slot); if (d) void bridge.send('load', { data: d }).then(() => ui.hideMenu()); },
  onSaveSlot: (slot) => bridge.send('save', { slot }).then((r) => writeSave(r.slot, r.data)),
  onDemo: () => startDemo(),                       // active « Scène de démonstration » (sinon : désactivé « Phase 1 »)
  onQuit: () => { /* arrêter la partie, revenir à l'accueil */ },
  onOptions: (o) => applyGraphicsOptions(o, { renderer: render.ctx.renderer, scene: render.ctx.scene, sun: render.ctx.sun, camera: input.camera }),
});

// Après SimBridge.create(...) et AVANT le premier newGame/load (les écouteurs doivent voir l'instantané) :
const cons = initConstruction({ sim: bridge, ui, input, scene: render.ctx.scene, models: lib, catalog,
  heightAt: (x, z) => render.terrain.heightAt(x, z) });
render.ctx.onFrame.push((dt) => cons.update(dt));
applyGraphicsOptions(ui.currentOptions(), { renderer: render.ctx.renderer, scene: render.ctx.scene, sun: render.ctx.sun, camera: input.camera });
input.camera.setHome();   // après le placement initial de la caméra (touche H = retour)
```
- `SimBridge` implémente déjà la surface `SimPort` (`send`, `onSnapshot`, `onDelta`) : aucune adaptation.
- `catalog` : passer le catalogue **complet**, fragments bâtiments et véhicules compris (la démo de ce module les
  fusionne avec `mergeCatalogs` de `src/input/mocks.ts` en attendant `npm run assets`).
- Diagnostic e2e possible : `cons.machine.applied` (actions appliquées), `input.tools.ghostModelVisible`.
- Escape : géré par l'UI. Menu ouvert en partie, Échap appelle `onContinue`. Un outil actif consomme Échap
  avant le HUD.

## 2. Architecte (`package.json`, `.gitignore`, contrats)
1. `"test"` : ajouter `tests/construction/*.test.ts`. Script `"construction:demo": "node tests/construction/demo.mjs"`
   (≈ 6 min en SwiftShader). `.gitignore` : `tests/construction/demo-build/` (généré) et `tests/construction/out/`.
2. **Commande `undo`** (facultative) : aujourd'hui Ctrl+Z envoie la commande inverse (`demolish`, `removeRoad`,
   `placeBuilding`, `buildRoad`). La simulation applique donc ses règles : remboursement de 25 % et coût de
   reconstruction. Pour un remboursement intégral d'une action récente, il faudrait une commande `undo` côté worker.
3. **Courbes** : quand `buildRoad` acceptera `control?: [x, z]` (demande de l'agent routes), `RoadDraft` enverra
   le point de contrôle au lieu d'une polyligne échantillonnée (`src/client/tools/road-draft.ts`, une ligne).
4. **`footprintFor` partagé** : `gridFootprint` (`src/client/tools/geometry.ts`) et `footprintGroundY` dupliquent la
   formule de `Simulation.footprintFor` et la règle d'altitude. Un test vérifie qu'ils restent identiques. Il vaudrait
   mieux déplacer ces fonctions dans `src/shared/`.
5. **Décors** (arbres, mobilier) : la barre « Environnement » les montre avec leurs vignettes, mais désactivés
   « Phase 2 », car `placeBuilding` n'accepte que les bâtiments. Il faudrait une commande `placeProp` (ou élargir
   `placeBuilding`) et une empreinte non bloquante.
6. **Occupants par bâtiment** (panneau d'info) : affichés « Phase 2 ». Il faudrait un champ dans
   `BuildingRecord`/delta quand la démographie existera.

## 3. Agent SIMULATION / SAUVEGARDE (`src/save/storage.ts`)
- Ajouter `listSaves()` et `deleteSave(slot)`. En attendant, `src/ui/save-slots.ts` relit les mêmes clés
  localStorage : sa constante `SAVE_PREFIX` doit rester égale à `PREFIX`.

## 4. Agent ROUTES
- L'accrochage du tracé se fait sur les nœuds (fusionnés par la simulation à 4 m) et sur les tronçons (point projeté).
  Un raccord en T au milieu d'un tronçon ne sera connecté qu'avec la découpe de tronçon de votre `RoadNetwork`.

## 5. QA (`FEATURES.md`)
Preuves :
- `npx tsx --test tests/construction/*.test.ts` : 21 tests, dont 3 contre la **vraie** simulation via `handleCommand` ;
- `node tests/construction/demo.mjs` : 25 vérifications réelles dans Chromium ;
- captures `tests/construction/out/c01…c13` (bureau 1600×900) et `i01…i05` (iPhone 390×844, tactile).
