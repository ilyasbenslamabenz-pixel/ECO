# Pipeline d'assets

## Sources autorisées
1. **Poly Haven** (CC0 1.0) — textures PBR, HDRI, modèles : `api.polyhaven.com`, `dl.polyhaven.org`,
   `cdn.polyhaven.com`. Aucune autre source externe : `tools/assets/polyhaven.ts` refuse tout autre hôte.
2. **Nos générateurs** (`tools/generators/*.ts`) — géométrie procédurale détaillée exportée en GLB
   avec `@gltf-transform/core` (CC0, auteur : projet Aube Urbaine).

Chaque modèle, jeu de textures et HDRI porte `license { spdx, source, author }` dans le catalogue.
`assets/LICENSES.md` est **régénéré** depuis le catalogue à chaque `npm run assets`
(source exacte, auteur(s), licence, date de publication Poly Haven, date d'import).

## Arborescence
```
assets/
  catalog.json                       catalogue (schéma : src/shared/catalog.ts) — produit par npm run assets
  LICENSES.md                        généré (non copié dans dist)
  textures/<set>/<set>_{albedo,normal,arm}.webp   jeux PBR (Poly Haven) — albedo/normale 1024 px, ARM 512 px
  hdri/<id>_1k.hdr                   HDRI Radiance 1k (Poly Haven)
  models/polyhaven/<catégorie>/<id>_lod{0,1,2}.glb  modèles Poly Haven optimisés
  models/<catégorie>/<id>_lod{0,1,2}.glb            modèles générés (agent assets)
.cache/polyhaven/                    cache des téléchargements bruts + JSON d'API + tampons de construction
                                     (ignoré par git, jamais copié dans dist)
.cache/showcase/out/                 planches-contacts de la vitrine
```
Le build (`scripts/build.mjs`) copie `assets/` vers `dist/assets/` (hors `.md` et `_src/`).

## Commandes
| Commande | Rôle |
|---|---|
| `npm run assets` | 0) étape Poly Haven (`tools/assets/stage.ts`) ; 1) générateurs `tools/generators` ; fusion du catalogue ; vérification structure/fichiers ; mesure des triangles ; régénération de `LICENSES.md` ; puis validateur `tools/assets/validate.ts`. Sortie 1 en cas d'erreur. |
| `npx tsx tools/assets/validate.ts` | validateur du pipeline seul (voir plus bas) |
| `npx tsx tools/assets/showcase/run.ts [--lods] [--only=id,id]` | vitrine : rend chaque modèle (et ses LOD) et chaque matériau dans Chromium, contrôle chargement/visibilité, produit les planches `.cache/showcase/out/{modeles,lods,materiaux}.png` + `rapport.json` |
| `npm run validate:assets` | contrôle QA (≥ 30 bâtiments, toutes catégories, seuils) |
| `npm run validate:visual` | porte visuelle navigateur du jeu (QA) |

Variables d'environnement de `npm run assets` :
- `POLYHAVEN_OFFLINE=1` : aucun accès réseau, uniquement le cache (échoue si un fichier manque) ;
- `ASSETS_ONLY=id1,id2` : ne reconstruit que ces modèles (mise au point ; pas de nettoyage d'orphelins) ;
- `SKIP_POLYHAVEN=1` : saute l'étape Poly Haven (générateurs seuls).

## Étape Poly Haven (`tools/assets/`)
| Fichier | Rôle |
|---|---|
| `selection.ts` | **sélection curatée** : 31 jeux de textures, 2 HDRI, 25 modèles (id catalogue, id Poly Haven, nom FR, catégorie, budget de triangles, taille de textures, distances LOD, coût, variantes de taille) |
| `polyhaven.ts` | client API + cache disque (contrôle taille + md5 fournis par l'API), téléchargement par `curl` (respecte `HTTPS_PROXY`), repli `fetch` |
| `textures.ts` | jeux PBR : sources 1k JPEG (Diffuse, nor_gl, arm) → WebP (albedo q82, normale q80 1024 px, ARM q85 512 px) ; `tileSizeM` = dimension réelle annoncée par Poly Haven ; HDRI copiés tels quels |
| `models.ts` | modèles → GLB multi-LOD (détails ci-dessous) |
| `stage.ts` | orchestration, rapport par modèle, suppression des fichiers orphelins (modèles/jeux désélectionnés) |
| `licenses.ts` | génération de `assets/LICENSES.md` |
| `validate.ts` | validateur (ci-dessous) |
| `showcase/` | vitrine (page `showcase.ts` + pilote Playwright `run.ts`) |

### Traitement d'un modèle (`models.ts`)
1. lecture du glTF 1k en cache ; extraction des nœuds voulus (`nodes`, regex) — les packs Poly Haven
   regroupent plusieurs variantes côte à côte ;
2. `flatten` + `clearNodeTransform` (transformations cuites), `join` (une primitive par matériau), `weld` ;
3. normalisation : centre de l'empreinte en (0, 0), base à y = 0, rotation Y optionnelle (façade vers +Z) ;
   feuillages `BLEND` → `MASK` (alpha test, double face, coupure 0,45) : pas de tri de transparence sur des milliers d'instances ;
4. LOD (budgets LOD0 / ≈35 % / ≈10 %, chaque LOD ≤ 60 % du précédent) répartis entre primitives
   (poids = √triangles × classe : feuillage 2,5, tronc 2, autres 1,5) :
   - pièces pleines : simplification meshopt à erreur croissante, puis retrait des plus petits îlots
     (jamais d'îlot > 15 % — 30 % au LOD2 — de la taille de l'objet : le tronc et la base sont protégés) ;
   - feuillages : simplification meshopt à erreur 0,002 du rayon (moins de triangles par feuille ; au-delà
     meshopt supprime des feuilles entières), puis décimation d'îlots (feuilles) répartie uniformément,
     les feuilles conservées étant agrandies (×1,7 / ×2,3 / ×3 max) pour garder la couverture de la couronne ;
5. textures WebP (EXT_texture_webp, lu nativement par GLTFLoader) : `textureSize` au LOD0, /2 au LOD1, /4 au LOD2
   (min 128) ; rugosité/ARM et écorces d'arbres à moitié de cette taille ;
6. `prune` + `dedup`, écriture GLB, mesure des triangles et de la boîte englobante (transformations comprises),
   contrôle de hauteur contre les dimensions annoncées par Poly Haven (avertissement si écart > 10 %).

Pas de quantification ni de compression meshopt : les GLB restent lisibles sans décodeur (client et outils Node),
et la géométrie n'a pas de transformation de nœud (le rendu instancié peut prendre `mesh.geometry` telle quelle).
Un tampon (`.cache/polyhaven/built/<id>.json`, hash de la spec + version de l'algorithme) évite de retraiter un modèle inchangé.

### Validateur (`tools/assets/validate.ts`) — pour toutes les entrées du catalogue
- fichiers LOD présents ; ≤ 15 Mo (bloquant), > 4 Mo signalé ;
- triangles mesurés : LOD0 ≥ `MIN_TRIANGLES_LOD0[catégorie]`, LOD strictement décroissants, égaux au catalogue ;
- boîte englobante (avec transformations) = `dimensions` du catalogue (±25 %), origine centrée, base au sol
  (ni flottante > 0,25 m ni enterrée < −3 m), hauteur et emprise plausibles en mètres pour la catégorie,
  bâtiments contenus dans leur empreinte en cases, longueur des véhicules = `vehicle.lengthM` (±25 %) ;
- au moins un matériau baseColor + normal ; textures décodables (sharp), dimensions valides ;
- licence `CC0-1.0`, auteur, source exacte (`https://polyhaven.com/a/<id>` ou `tools/generators/…`), ligne dans `LICENSES.md` ;
- jeux de textures et HDRI : fichiers présents et décodables (`#?RADIANCE`), licence ;
- budgets : assets distribués ≤ 55 Mo, part Poly Haven ≤ 35 Mo.

## Bibliothèque de matériaux (`src/render/materials.ts`)
`MaterialLibrary(catalog, baseUrl, anisotropy)` : `MeshStandardMaterial` construits depuis les jeux de textures.
- `get(setId, { uv, color, tileSizeM, normalScale, side })` renvoie **toujours la même instance** pour les mêmes
  paramètres ; chaque fichier de texture est chargé une seule fois (contrôle : `stats()`).
- ARM → `aoMap` + `roughnessMap` + `metalnessMap` (canaux R/G/B, convention glTF).
- Modes d'UV : `'mesh'` (UV du maillage), `'worldXZ'` (projection verticale monde : terrain, chaussées, trottoirs),
  `'box'` (projection boîte monde selon l'axe dominant de la normale : façades, murs, toits générés ;
  l'échelle réelle `tileSizeM` est respectée quelle que soit la taille du bâtiment). Compatible `InstancedMesh`
  (`instanceMatrix`) et normal map (repère tangent dérivé des dérivées écran des UV monde).
- `glass('clair' | 'teinte' | 'eclaire')` : verres partagés sans texture ; `loadHdri(id)` : texture HDR équirectangulaire
  à passer à `PMREMGenerator` ; `whenReady()`, `loadErrors`, `dispose()`.

## Règles de qualité (bloquantes)
- Aucun cube/primitive comme modèle final ; un bâtiment doit avoir une silhouette propre
  (toiture, ouvertures, débords, détails de façade), seuils `MIN_TRIANGLES_LOD0`.
- Matériaux PBR texturés : albedo + normal (+ roughness/metalness/AO ou ARM). ≥ 50 % des triangles texturés.
- Dimensions réelles en mètres, origine au centre de l'empreinte, Y vers le haut, façade principale vers +Z.
- Dimensions du catalogue = boîte englobante mesurée (±25 %).
- Au moins une variante par bâtiment (couleurs/matériaux/hauteur).
- LOD : LOD0 détaillé, LOD1 ≈ 30-50 %, LOD2 ≈ 10 % (ou imposteur).
- Les planches de la vitrine et de `validate:visual` sont **regardées** avant chaque livraison.

## Limites connues
- Poly Haven n'a pas de bâtiments complets adaptés (seulement des kits de façades modulaires) ni de véhicules
  roulants : bâtiments et véhicules viennent des générateurs du projet.
- Les arbres Poly Haven (0,3 à 3,9 M triangles à l'origine) sont réduits à 15–28 k triangles au LOD0 :
  couronnes un peu plus clairsemées que l'original ; au LOD2 (> 260 m) la couronne est nettement ajourée.
  Un imposteur (billboard) serait préférable pour le LOD2 — non fait.
- Les feuillages restent des triangles alpha-testés (MASK) : coût de fragment notable en très grand nombre.
