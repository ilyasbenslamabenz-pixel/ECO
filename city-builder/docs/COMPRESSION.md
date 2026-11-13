# Compression des assets publiés

Objectif : alléger `dist/` (59,2 Mo pour un budget de 60 Mo) sans retirer de contenu, pour laisser de la place
aux nouveaux modules et charger plus vite sur iPhone.

## Résultat mesuré (`npm run build`, Mo = 1024² octets, comme le build)

| | Avant | Après | Gain |
|---|---:|---:|---:|
| **dist total** | **59,21 Mo** (62 081 268 o) | **39,14 Mo** (41 038 180 o) | **−20,1 Mo (−34 %)** |
| assets/buildings | 21,88 | 7,51 | −66 % |
| assets/models | 20,21 | 16,45 | −19 % |
| assets/textures | 10,19 | 10,19 | 0 (déjà WebP, voir plus bas) |
| assets/vehicles | 2,38 | 1,40 | −41 % |
| assets/hdri | 2,48 | 1,52 | −39 % |
| GLB (633 fichiers) | 42,19 (après meshopt seul) | 23,08 | −45 % |

Marge rendue au budget : 20,9 Mo (contre 0,8 Mo).

## État de départ (constaté avant de changer quoi que ce soit)

Une partie de ce qui était demandé existait déjà :
- **meshopt** était déjà appliqué au build (`scripts/optimize-glb.mjs`, `EXT_meshopt_compression` + `KHR_mesh_quantization`),
  décodé par `MeshoptDecoder` de three (JS, aucun WASM externe à héberger) ;
- **toutes les images étaient déjà en WebP** : les 131 textures de `assets/textures` et `assets/buildings/textures`
  (1024 px, 512 px pour les ARM ; encodées depuis des JPEG 1k Poly Haven en q80-85) et les 10,6 Mo d'images
  intégrées aux GLB (Poly Haven, nature, décor).

Répartition des 44,2 Mo de GLB après meshopt : JSON glTF 9,8 Mo (bâtiments : matériaux, `KHR_texture_transform`,
URI des textures partagées), géométrie meshopt 23,8 Mo, images WebP 10,6 Mo. Le JSON et le flux meshopt
(conçu pour être suivi d'un compresseur générique) se compressent encore d'environ 2× en gzip ; les WebP non.

## Ce qui a été fait (au build, `scripts/optimize-glb.mjs`)

Pour chaque GLB de `dist/assets`, dans l'ordre :
1. **`prune` + `dedup`** de gltf-transform, en mode conservateur (attributs, index, extras, nœuds vides, textures
   unies et noms uniques conservés : le code retrouve des pièces par nom ou par `extras.aube`) ;
2. **images intégrées plafonnées** à 1024 px au LOD0 et 512 px aux LOD1/LOD2 ; seules celles qui dépassent sont
   redimensionnées (Lanczos) et réencodées en WebP (q90, cartes de normales q95, alpha q100). Concerné : 8 images
   1024 px des LOD2 de 4 arbres (imposteurs), 1,24 Mo. Les autres images ne sont pas réencodées (aucune perte ajoutée) ;
3. **meshopt** niveau `medium` (inchangé) ;
4. **enveloppe gzip** (niveau 9) du fichier entier quand elle gagne au moins 10 % : 589 GLB sur 633
   (les 44 restants sont surtout des images WebP). Les HDRI `.hdr` reçoivent la même enveloppe (−39 %).

Les fichiers gardent **leur nom et leur extension** : `catalog.json`, les manifestes (piétons, chantiers),
`render-spec` de l'électricité et les sauvegardes sont inchangés. Le client reconnaît l'enveloppe à son en-tête
gzip (`1f 8b 08`) et la retire avant l'analyse (`src/render/gzip-assets.ts`) :
- `createGltfLoader()` : `GLTFLoader` + `MeshoptDecoder` dont `parse` décompresse d'abord ; utilisé par les quatre
  chargeurs de GLB du jeu (bibliothèque d'assets, piétons, chantiers, électricité). Les chemins relatifs des
  textures partagées restent résolus depuis l'URL d'origine ;
- `loadHdrTexture()` : HDRI (ciel et environnement) ;
- décompression par `DecompressionStream` natif (Chromium, Safari ≥ 16.4), repli sur `fflate` fourni par three ;
- un fichier non compressé (build `--dev`/`--watch`, hébergeur qui aurait déjà retiré l'enveloppe) passe tel quel.

`catalog.json` (0,5 Mo, −93 % en gzip) n'est volontairement **pas** enveloppé : il est lu par `fetch().json()`
dans plusieurs bancs d'essai (simulation, véhicules) ; le gain ne justifie pas de les modifier tous.

### Pourquoi au build plutôt que dans le dépôt
Le build compressait déjà les GLB, avec un cache (`.cache/glb-opt/<sha1>.glb`, version `v2`) : c'est le chemin le
plus simple et il est reproductible sans script supplémentaire. Les sources de `assets/` restent lisibles sans
décodeur par les générateurs, les validateurs (`validate:assets`, `assets:validate`) et les tests des modules,
qui n'ont donc pas changé. Build complet sans cache : ~25 s ; avec cache : quelques secondes.

### Écarté
- **Draco** (décodeur WASM à héberger) et **KTX2** (encodeur lourd, et pas plus léger que WebP sur disque).
- **meshopt `high`** (filtre octaédrique des normales) : −1,9 Mo de plus après gzip, mais change la disposition
  des normales (attribut entrelacé) lue par plusieurs rendus ; à reconsidérer si la place manque de nouveau.
- **Réencodage des textures WebP** : elles sont déjà en 1024/512 px et q80-85 depuis des JPEG ; un second
  encodage avec perte n'apporterait qu'un gain modeste au prix d'une dégradation cumulée. Laissées intactes.

## Vérifications

- Les 633 GLB compressés, une fois décompressés et décodés (meshopt), ont exactement la même structure que leur
  source : nœuds (noms), matériaux (noms + extras), primitives (index, sommets, attributs, matériau), animations,
  peaux, URI des textures partagées. Écart : 0.
- `tests/unit/gzip-assets.test.ts` : détection, décompression native et repli fflate, règle du gain minimal,
  lecture d'un GLB gzip par le chargeur du jeu.
- Mode allégé (`device-profile.ts`, `image-cap.ts`) : il agit sur les images décodées ; le format des images n'a
  pas changé (WebP avant comme après) et la décompression gzip a lieu avant l'analyse du GLB.
- Sauvegarde / chargement : aucun format ni identifiant d'asset touché.

### Captures avant/après (`tests/e2e/compression-captures.mjs`)

Démo (`?demo`), ordinateur 1280×800 et iPhone 13 émulé en mode allégé (`?lite=1`), vues aérienne et rue,
même scène à 10 h 30. Écart mesuré par `node tests/e2e/compression-captures.mjs --compare <avant> <après>` :

(mesures en cours, ajoutées au commit suivant)
