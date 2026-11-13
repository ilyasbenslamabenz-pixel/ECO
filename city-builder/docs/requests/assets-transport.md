# Demande — assets transport (port, aéroport) — phase 2C

Session : `claude/p2c-assets-transport`. Seuls les **modèles 3D** sont livrés (aucune simulation, aucun branchement au jeu).

## Livré
- Générateur TypeScript `tools/transport/**` (sans dépendance nouvelle) :
  `build.ts` (orchestration), `port.ts`, `airport.ts`, `ship.ts` (coques), `parts.ts`, `mesh.ts`, `glb.ts`,
  `textures.ts`, `materials.ts`, `validate.ts`, `showcase/` (vitrine).
  `npx tsx tools/transport/build.ts [--only=id,…]` régénère tout (≈ 8 s, déterministe).
- 35 modèles × 3 LOD sous `assets/models/transport/_src/{port,aeroport}/<id>_lod{0,1,2}.glb`
  + textures partagées `assets/models/transport/_src/textures/` (atlas 2048² RGBA + 2 textures répétables 256²).
  Réutilise sans copie les jeux Poly Haven `sol_beton_brut`, `beton_facade`, `route_asphalte`.
- Fragment de catalogue `assets/catalog.transport.json` (`{ assets, textureSets }`, même format que
  `catalog.vehicles.json`). Chaque entrée porte les tags `transport`, `categorie:transport`, **`unused`**,
  `groupe:port|aeroport`, `type:<kind>`, `anim:<nœud>` et, selon l'origine, `origine:flottaison` + `tirant_eau:<m>`
  ou `niveau:quai_y0` / `niveau:sol_y0`.
- Licence : CC0-1.0, « œuvre originale générée par le projet », source = `tools/transport/{port,airport}.ts#<id>`
  (textures : `tools/transport/textures.ts#writeTransportTextures`). Toutes les marques sont inventées
  (AUBE AIR, AUBE CARGO, NORDA, KALIX, MERIDO, TAVRO LINES, navires AUBE HORIZON, MEKNES TRADER, VILLE DE MEKNES, AUBE ONE).
- Contrôles : `npx tsx tools/transport/validate.ts` (OK, 35 modèles) ;
  `npx tsx --test tests/transport-assets/*.test.ts` (4 tests) ;
  vitrine `npx tsx tools/transport/showcase/run.ts [--lod=n] [--pose]` → `tests/transport-assets/out/` (planches regardées).

## Poids (budget du build)
- Sources : 5,8 Mo de GLB (105 fichiers) + 0,28 Mo de textures.
- Distribué (après `scripts/optimize-glb.mjs`, meshopt) : **3,23 Mo de GLB + 0,28 Mo de textures ≈ 3,5 Mo**.
- **Aucun impact actuel** : le segment `_src` est exclu de la copie par `scripts/build.mjs`, et `catalog.*.json` aussi.

## Demandes au superviseur (fichiers hors de mon périmètre)
1. **Catégorie `transport`** dans `src/shared/catalog.ts` (`OTHER_CATEGORIES`), seuil `MIN_TRIANGLES_LOD0.transport = 200`,
   et dans `tools/assets/validate.ts` : `PLAUSIBLE.transport = [0.05, 90, 260]`. Catégories provisoires utilisées :
   `prop` (quais, grues, conteneurs, navires, avions, modules au sol, passerelle), `industrial` (entrepôt, hangar),
   `public` (capitainerie, gare maritime, aérogare, jetée, tour), `vehicle` (4 véhicules de piste).
   Les plages actuelles de `prop` (≤ 10 m de haut, ≤ 15 m d'emprise) rejetteraient grues, navires et avions.
2. `tools/assets/validate.ts` : accepter la source `^tools\/transport\/` (regex actuelle : generators|buildings|vehicles),
   et la convention d'origine `origine:flottaison` (quille à −tirant d'eau, jusqu'à −10,5 m) et `niveau:*` (base ≥ −3 m).
3. Activation (quand la simulation port/aéroport arrive) : enregistrer `generateTransport` (tools/transport/build.ts) dans
   `tools/generators/index.ts` en changeant `TRANSPORT_DIR` en `models/transport` (sans `_src`), régénérer, retirer le tag `unused`.
4. `package.json` : ajouter `tests/transport-assets/*.test.ts` à `test:assets` (ou `test`), et éventuellement
   `"transport:build": "tsx tools/transport/build.ts"`, `"transport:showcase": "tsx tools/transport/showcase/run.ts"`.

## Pièces animables (nœuds enfants, translation = pivot, `extras.aube.anim = {kind, axis, min, max, note}`)
- `port_grue_portique` : `fleche` (rotation X −80…0°), `chariot` (translation Z −34…60 m), `cables` (échelle Y 2…44 = longueur pendante),
  `palonnier` (translation Y −44…−2 m, enfant du chariot).
- `port_grue_mobile` : `tourelle` (rotation Y), `fleche` (rotation Z −25…35°, enfant de la tourelle).
- `port_quai_rampe` : `rampe` (rotation X −8…6°). `port_capitainerie` : `radar` (rotation Y continue).
- `aero_passerelle` : `tunnel` (rotation Y ±50°), `tunnel_ext` (translation Z 0…9 m), `cabine` (rotation Y ±90°).
Le nœud racine `structure` n'a aucune transformation (géométrie directement exploitable par le rendu instancié).

## Conventions
- Mètres, Y vers le haut, avant / façade vers +Z (quais et portique : mer côté +Z ; écartement des rails 20 m, rails à z = ±10).
- Navires : y = 0 = ligne de flottaison. Quais : y = 0 = dessus du quai (mur jusqu'à −3 m). Modules au sol : dessus à y = 0, pistes le long de X.

## Reste / limites
- Pas d'intérieurs ; vitrages par atlas (pas de géométrie de menuiserie au-delà du LOD0).
- Avion cargo = cellule du gros porteur sans hublots (pas de nez basculant).
- Câbles du portique : nœud à étirer ; haubans avant solidaires de la flèche (corrects flèche basse uniquement).
