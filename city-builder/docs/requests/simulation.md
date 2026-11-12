# Demandes de l'agent SIMULATION / ÉCONOMIE / DÉMOGRAPHIE / SAUVEGARDE

Modules livrés (fichiers possédés) : `src/sim/{world,ecs,clock,economy,demography,handler,worker}.ts`
+ nouveaux `src/sim/{rng,names,scheduler,population,save-format,sim-protocol,loop}.ts`, `src/save/**`,
tests `tests/sim/**` (35 tests), banc d'essai navigateur `tests/sim/demo/` + `tests/sim/capture.mjs`.
Documentation du module : `docs/SIMULATION.md`.

Le jeu compile et tourne sans ces demandes (les 19 tests QA et l'e2e passent). Mais tant qu'elles ne sont pas
traitées, **la population, l'économie détaillée et la sauvegarde v2 ne sont pas visibles dans l'interface** :
on ne les voit que dans le banc d'essai (`node tests/sim/capture.mjs` après `npm run build`).

## 1. Architecte — contrats (`src/shared/**`)
1. **Commandes étendues** : fusionner `ExtCommandMap` (`src/sim/sim-protocol.ts`) dans `CommandMap`
   (`setTaxRate`, `loanOffer`, `takeLoan`, `repayLoan`, `getReport`, `inspectBuilding`, `inspectCitizen`,
   `setFocus`, `settle`) et sa validation `validateExtCommand` dans `validateCommandMessage`.
   Même enveloppe `{ kind:'cmd', reqId, name, args }` : c'est rétro-compatible. En attendant, `handler.ts` les
   reconnaît déjà, et le thread principal peut appeler `bridge.send('getReport' as never, {} as never)`.
2. **`DeltaMessage.report?: SimReport`** (type dans `sim-protocol.ts`). Le worker le joint déjà au delta,
   environ une fois par seconde (`DeltaMessageExt`).
3. **`SAVE_FORMAT_VERSION = 2`** dans `constants.ts`, et **`SaveFile`** étendu comme `SaveFileV2`
   (`src/sim/save-format.ts`) : `economy` complet, `population` en colonnes, `sim` (PRNG + planificateur).
   La simulation écrit déjà la v2 (`CURRENT_SAVE_VERSION`) et migre la v1.
4. **Trames véhicules** : `world.takeDelta()` envoie maintenant `TrafficSystem.takeFrame()`, avec en plus
   `ids`, `variants` et `flags`. `collectTransferables` ne transfère que `positions` et `assetIndices` :
   les trois autres tableaux sont **copiés** (ça marche, mais ce n'est pas optimal). Il faut les ajouter, comme
   demandé au point 3 de `vehicules-trafic.md`.
5. **`SimStats.jobs`** vaut maintenant le total des emplois des bâtiments desservis par une route (avant : 0).
   Préciser ce sens dans le commentaire du contrat.

## 2. Intégration (`src/main.ts`, `src/render/index.ts`, `src/render/demo.ts`)
1. **Sauvegardes** : remplacer `save/storage.ts` (localStorage, JSON brut, un seul emplacement) par
   `SaveStore` + `Autosaver` (`src/save/index.ts`).
   ```ts
   const store = await SaveStore.open();               // IndexedDB -> localStorage -> mémoire
   await store.save('partie-1', (await bridge.send('save', { slot: 'partie-1' })).data);
   const r = await store.load('partie-1'); if (r.ok) await bridge.send('load', { data: r.value }); else ui.toast(r.message);
   const auto = new Autosaver(async () => (await bridge.send('save', { slot: 'auto' })).data, store, { onError: ui.toast });
   auto.start();                                       // toutes les 3 min, rotation auto-1..3
   const { blob, filename } = await store.exportFile(data); downloadBlob(blob, filename);   // export
   const imp = await store.importFile(file);           // <input type=file> ; imp.ok ? load : message
   ```
2. **LOD de simulation** : envoyer `setFocus { x, z }` (point visé par la caméra) quand la caméra s'est
   déplacée de plus de 50 m environ. Sans cet appel, le point focal reste (0, 0).
3. **Scène de démonstration** : après avoir posé les bâtiments, appeler `settle { waves: 30 }` pour peupler la ville
   tout de suite. Ce sont de vraies vagues d'immigration, seulement accélérées. Sinon la ville se remplit par vagues
   toutes les 6 h de jeu, soit 18 s réelles à ×4.
4. **Catalogue** : le banc d'essai doit fusionner en mémoire `assets/catalog.buildings.*.json` et
   `catalog.vehicles.json`, car `dist/assets/catalog.json` ne contient encore **aucun bâtiment ni véhicule**.
   Sans fusion, aucun habitant ni véhicule n'existe dans le jeu.

## 3. Construction / UI (`src/ui/**`)
Les panneaux à brancher sur `d.report` (`SimReport`) :
- **Budget** : `economy.forecast` (recettes par secteur, dépenses détaillées, projection sur 12 mois),
  `history` (bilans mensuels), curseurs d'impôts (`setTaxRate`, 0–25 %), emprunts (`loanOffer`, puis `takeLoan`
  et `repayLoan`), alerte de faillite (`bankrupt`, `monthsInDeficit`) ;
- **Population** : pyramide des âges, éducation, chômage, bonheur, couverture des services, demande RCI+B
  (`demography.demand`), activités en cours ;
- **Inspection d'un bâtiment** : `inspectBuilding` (habitants et employés nommés, entreprise, services) ;
- **Notifications** : `notices`.
Le banc d'essai `tests/sim/demo/dashboard.ts` montre un rendu possible de toutes ces données.

## 4. QA (`package.json`, `FEATURES.md`)
- `"test"` += `tests/sim/*.test.ts` ; script `"sim:demo": "node tests/sim/capture.mjs"`
  (à lancer après `npm run build`).
- Preuves pour FEATURES.md : les 35 tests de `tests/sim/*.test.ts` ; les captures `tests/sim/out/dashboard.png`,
  `dashboard-en-cours.png` et `dashboard-iphone.png` ; le rapport `tests/sim/out/rapport.json` (19 contrôles
  réussis dans Chromium, worker réel, IndexedDB + gzip).

## 5. Ce qui n'est PAS branché (décision de contrat préalable requise)
- **Routes** (`docs/requests/routes.md` §2) : le monde utilise toujours `RoadGraph` (segments droits, 3 types).
  Brancher `RoadNetwork` impose de changer d'abord `RoadTypeId`, `RoadEdgeRecord` et le format des routes dans la
  sauvegarde. Je pourrai le faire dès que l'architecte aura tranché.
- **Terrain** (`docs/requests/terrain.md` §2) : `generateWorld()` et le test d'eau par `waterSurface` ne sont pas
  branchés. Il faut d'abord valider `collectTransferables` pour les couches et la carte de hauteurs dans la
  sauvegarde. La terraformation renvoie toujours `NOT_IMPLEMENTED` (phase 2).
