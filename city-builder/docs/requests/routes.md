# Demandes de l'agent ROUTES (infrastructures + système routier)

Modules livrés : `src/sim/roads/**` (TypeScript pur) et `src/render/roads/**` (+ `src/render/roads.ts`).
Le jeu compile et tourne sans ces demandes, mais le réseau du jeu reste celui de l'ancien `world.ts`
(tronçons droits, 3 types, sans pont ni découpe). Ces demandes branchent le nouveau module.

## 1. Architecte — contrats (`src/shared/**`, `package.json`)
1. **Types de routes** : remplacer `RoadTypeId`/`ROAD_TYPES` par les 6 types de `src/sim/roads/types.ts`
   (`street`, `avenue`, `boulevard`, `oneway`, `pedestrian`, `highway`), idéalement en déplaçant
   `src/sim/roads/{types,bezier,profile,junction}.ts` vers `src/shared/roads/` (ils sont purs ; le rendu les importe
   aujourd'hui depuis `src/sim/roads`, ce que le test d'architecture n'interdit pas).
2. **`RoadEdgeRecord`** : ajouter les champs optionnels de `RoadEdgeRecordEx` (`src/sim/roads/index.ts`) :
   `kind?: RoadKindId`, `c1?: [x, z]`, `c2?: [x, z]` (points de contrôle de la Bézier), `profile?: number[]`
   (hauteurs de la chaussée au pas de 4 m, au cm) et `bridgeRuns?: number[]` (plages de pont). Rétro-compatible ;
   `networkRecords()` les remplit et le rendu les utilise tels quels (il ne recalcule pas le profil sur un terrain
   peut-être déjà nivelé). Coût : ~26 nombres pour 100 m de route.
3. **Commande `buildRoad`** : `args` + `control?: [x, z]` (tracé courbe) ; le résultat garde `edgeIds` (les
   tronçons découpés partent dans `roadEdgesRemoved` / `roadEdgesAdded` du delta, déjà prévu).
   Codes d'erreur utilisés par le planificateur : `INVALID_ARGS`, `OUT_OF_BOUNDS`, `COLLISION`, `TOO_STEEP`,
   `UNDER_WATER`, `NOT_IMPLEMENTED` (phase 4 : échangeurs / croisement d'autoroute).
4. **Sauvegarde** : stocker `roads` au format `RoadNetworkJson` (`src/sim/roads/serialize.ts`, versionné,
   courbes comprises) → `SAVE_FORMAT_VERSION` 2.
5. **Terrain nivelé** : nouveau champ de delta `terrainPatch?: { i0, j0, i1, j1, heights: Float32Array }`
   (transférable) pour envoyer au rendu la zone nivelée sous une route (`gradeTerrainForRoads` renvoie la boîte).
6. **Scripts npm** : `"test": "tsx --test tests/unit/*.test.ts tests/roads/*.test.ts"` et
   `"roads:demo": "tsx tests/roads/capture.ts"`.

## 2. Agent SIMULATION (`src/sim/world.ts`)
- Remplacer le stockage `RoadGraph` + `buildRoad`/`removeRoad` par `RoadNetwork` :
  `planRoad(net, { kind, start, end, control }, { bounds, blocked })` (dryRun = ne pas appeler commit),
  puis `commitRoadPlan(net, plan)` ; `net.takeChanges()` donne nœuds/tronçons ajoutés et supprimés pour le delta,
  `networkRecords(net, nodeIds, segIds)` produit les enregistrements étendus.
- `blocked(curve, halfWidth)` : collision avec les bâtiments (aujourd'hui `distSegmentRect` sur la droite ; utiliser
  `polyline(curve, n)` pour les courbes).
- Après commit : `gradeTerrainForRoads(terrain, net, segIds)` sur la carte de hauteurs de la simulation, puis
  `terrainPatch` dans le delta. ATTENTION : planifier sur le terrain **naturel** (garder une copie) pour que les
  profils restent stables quand le terrain est nivelé.
- Coût : `plan.cost` (ponts inclus) ; entretien : `ROAD_KINDS[kind].upkeepPerMeterMonth`.
- Remboursement de démolition : `removeSegment(id)` renvoie les nœuds orphelins supprimés.

## 3. Agent VÉHICULES / TRAFIC (`src/sim/traffic.ts`, `src/sim/pathfinding.ts`)
- `PathPlanner` (A* + cache LRU invalidé par version du réseau), `HierarchicalPlanner` (HPA*, même coût que l'A*
  plat, vérifié), `LaneGraph` (voies + connexions de manœuvre, sens uniques, pas de demi-tour hors impasse,
  `laneOffset` pour la position latérale). `src/sim/pathfinding.ts` (ancien A* sur `RoadGraph`) devient redondant.

## 4. Agent INTÉGRATION (`src/render/index.ts`)
- `new RoadRenderer(ctx.scene, heightAt, { lib })` (la bibliothèque d'assets sert aux textures PBR et aux
  lampadaires/arbres GLB ; sans elle : couleurs unies et pas de décor — c'est le cas aujourd'hui).
- Chaque frame : `roads.update(cam.x, cam.y, cam.z)` (LOD du décor, sans allocation).
- Nuit : `roads.setNight(RoadRenderer.nightFactorForHour(stats.date.hour))` (ou le facteur de l'agent ciel).
- `await roads.whenReady()` avant `demoReady`.

## 5. Agent CONSTRUCTION / UI
- Outil route : 6 types, mode courbe (point de contrôle), aperçu = `planRoad` en dryRun (coût, longueur de pont,
  message de refus en français). Les types non constructibles à niveau renvoient `NOT_IMPLEMENTED` phase 4.

## 6. Agent TERRAIN
- Appliquer `terrainPatch` (remaillage des seuls chunks touchés).
