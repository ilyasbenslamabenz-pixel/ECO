# Kit modulaire de bâtiments (`tools/buildings/kit`)

Propriétaire : directeur artistique / artiste bâtiments résidentiels. Utilisé par **tous** les générateurs de
bâtiments (résidentiel, commerces, industrie, équipements publics, gratte-ciel). Node pur (pas de Blender,
pas de three) : géométrie en code, UV réelles, matériaux PBR du pipeline, export GLB LOD0/1/2.

```ts
import { basePalette, volume, row, bays, rectAt, hipRoof, gableRoof, flatRoof, chimney,
         exportBuilding, buildKitTextureSets, mergeTextureSets, type BuildingDef, type Ctx } from '../kit/index';
```

## 1. Principe
Un bâtiment est un objet `BuildingDef` (`kit/building.ts`) :

| champ | rôle |
|---|---|
| `id`, `nameFr`, `category` | identifiant `[a-z0-9_]+`, nom affiché, catégorie du catalogue |
| `footprint {tilesX, tilesZ}` | empreinte en cases de 8 m (le modèle doit tenir dedans, +0,5 m de tolérance) |
| `cost`, `upkeepPerMonth`, `residents`, `jobs` | métadonnées de jeu |
| `density` | `faible` / `moyenne` / `forte` / `tres_forte` (→ tag `densite:…`) |
| `style` | étiquette de style (→ tag `style:…`) |
| `palette` | matériaux par **rôle** (voir §3) |
| `variants` | ≥ 1 variante : `materialOverrides` par rôle (`{ textureSet?, color? }`) et/ou `heightScale` |
| `lodDistances` | `[maxLOD0, maxLOD1]` en m (défaut `[150, 600]`) |
| `frontage` | accès (défaut : piéton au milieu de la façade +Z) |
| `source` | `fichier#fonction` (licence/traçabilité) |
| `build(ctx)` | fonction **déterministe** qui pose les composants ; appelée 3 fois (`ctx.lod` = 0, 1, 2) avec la même graine `ctx.r()` |

`exportBuilding(def, assetsDir, relDir, sets)` construit les 3 LOD, **recentre** (centre de l'emprise du LOD0 en (0,0),
base à y = 0), vérifie empreinte et LOD strictement décroissants, écrit `assets/<relDir>/<id>_lod{0,1,2}.glb` et
renvoie l'entrée `CatalogAsset` (dimensions mesurées, triangles, jeux de textures, licence CC0, tags).

Conventions : mètres, Y vers le haut, **façade principale (rue) vers +Z**, origine au centre de l'emprise.

## 2. Format GLB produit (`kit/glb.ts`)
- 1 nœud, 1 maillage, **1 primitive par rôle** (nom du matériau glTF = rôle).
- Textures **externes partagées** : les images pointent (URI relative) vers les WebP des jeux de textures
  (`assets/textures/…`, `assets/buildings/textures/…`) : aucun pixel n'est dupliqué dans les GLB.
  `EXT_texture_webp` (requis) ; `KHR_texture_transform` (échelle = 1 / `tileSizeM`, UV en mètres).
- Quantification `KHR_mesh_quantization` (native dans GLTFLoader / glTFast / Unreal Interchange) : positions int16
  normalisées (échelle + translation sur le nœud), normales int8, UV uint16 normalisées sur la plage de chaque primitive ;
  la déquantification des UV passe par `KHR_texture_transform` (offset/scale, combinée à 1/`tileSizeM`). Sommets soudés.
  ≈ 16 octets par sommet (contre 32 en flottants).
- `extras.aube = { set, uv, kind, uvq }` sur chaque matériau (`uvq` = [minU, minV, plageU, plageV] en mètres) ;
  attribut `_LIT` (float) sur les verres (graine 0..1 par fenêtre, 2 = vitrine, −1 = jamais allumé).
- Lisible par `@gltf-transform` (validateurs du pipeline) et par `GLTFLoader` (jeu, porte visuelle).

## 3. Matériaux par rôle (`kit/materials.ts`)
`basePalette(over)` renvoie une palette complète ; surcharger les rôles voulus :

| rôle | défaut | usage |
|---|---|---|
| `facade`, `facade_b` | enduit blanc / bardage bois | murs |
| `soubassement` | pierre de taille grise | socles, seuils, marches |
| `encadrement` | pierre de taille claire | encadrements, appuis, bandeaux, corniches, chaînages |
| `toiture` | tuiles | couvertures |
| `rive` | bois peint blanc | sous-faces, rives, planches |
| `menuiserie` | bois peint blanc | dormants, petits bois |
| `volet`, `porte` | bois peint (teinte) | volets battants, portes |
| `porte_garage` | porte de garage (UV 0..1) | |
| `garde_corps` | métal sombre | garde-corps, ferronneries, ferrures |
| `dalle` | béton | balcons, auvents, socles techniques |
| `zinc` | zinc | gouttières, descentes, couvertines, brisis zinc |
| `cheminee`, `poterie` | brique / terre cuite | souches, mitrons, arêtiers, génoises |
| `store` | rideau métallique | volets roulants, rideaux de boutique |
| `terrasse` | gravillons | toitures-terrasses |
| `equipement` | tôle | CTA, climatisation |
| `bois` | lames de terrasse | charpente apparente, balcons bois |
| `enseigne` | enduit teinté | bandeaux d'enseigne, stores bannes |
| `verre`, `verre_gc` | verre (sans texture) | vitrages (allumés la nuit) / garde-corps vitrés |

Un rôle peut être ajouté librement (`palette.mon_role = { set, color }`). `uv: 'unit'` = image 0..1 sur la face
(portes de garage). Les **variantes** du catalogue ciblent ces noms : `materialOverrides: { facade: { textureSet: 'brique_orange' }, volet: { color: '#3f6b4a' } }`
(la couleur **remplace** la teinte d'origine).

Jeux de textures disponibles : ceux du catalogue (`assets/catalog.json` : briques, enduits, bardages, bétons,
toitures, métaux, voirie) + ceux du kit (`kit/textures.ts`, Poly Haven CC0, dans `assets/buildings/textures/`) :
`pierre_taille`, `pierre_moellons`, `pierre_rustique`, `bois_volet`, `porte_garage`, `bois_terrasse`.
Obtenir la table : `mergeTextureSets(catalog, await buildKitTextureSets(assetsDir))`.

**Astuce teinte** : un albedo sombre teinté reste sombre. Pour une peinture de couleur, partir d'un jeu clair
(`enduit_blanc`, `bardage_blanc`, `pierre_taille`) et teinter.

## 4. Géométrie (`kit/mesh.ts`)
`MeshBuilder` : `poly`, `polyFacing(mat, pts, dir)` (oriente automatiquement), `quad`, `tri`, `box(mat, x0,y0,z0,x1,y1,z1, skip)`
(`skip` ⊂ `'px nx py ny pz nz'`), `obox`, `cylinder`, `tube(a, b, r, seg, open)` (open = demi-tube inférieur : gouttière),
`extrude(poly XZ, y0, y1)` (triangulation par oreilles, polygones concaves acceptés), `smooth` ;
pile de transformations `push(tx, ty, tz, rotY)` / `pop()`. UV : projection planaire **en mètres** dans l'espace
du modèle (faces coplanaires raccordées sans couture). `ctx.mb.lit = x` fixe la graine `_LIT` des verres suivants.

## 5. Façades (`kit/facade.ts`)
Repère de façade `Frame` : `sideFrame(x0, z0, x1, z1, y0, y1, side)` avec `side` ∈ `S` (+Z), `E` (+X), `N` (−Z), `W` (−X) ;
coordonnées `(u, v, d)` : u vers la droite vu de l'extérieur, v vers le haut (relatif à y0), d en saillie (> 0) ou en retrait (< 0).
`P(f, u, v, d)`, `fq`, `ft`, `fbox(ctx, mat, f, u0, u1, v0, v1, d0, d1, skip)` (`skip` ⊂ `front back left right top bottom`).

| fonction | contenu |
|---|---|
| `volume(ctx, { x0,x1,z0,z1, y0, h, wallMat, sides: {S: [...], E, N, W}, hidden, sideMat, plinth, quoins, bands, cornice })` | pavé de murs percés + modénature ; renvoie les 4 repères |
| `facade(ctx, f, wallMat, openings)` | mur percé + ouvertures (`OpeningSpec`) |
| `OpeningSpec` | `{kind:'window', r, o?: WindowOpts}`, `'door'` (`DoorOpts`), `'garage'`, `'shop'` (`ShopOpts`), `'loggia'`, `'blind'` |
| `row(us, w, v0, h, mk)`, `bays(w, n, margin)`, `rectAt(uc, w, v0, h)` | mise en page des travées |
| `window` | tableaux, dormant, vantaux, petits bois (`bars`), imposte, appui, encadrement (`surround`, `keystone`, `lintel`), volets `battants` (ouverts/fermés aléatoires) ou `roulant` (abaissés aléatoirement), balconnet (`railing`) |
| `door` | styles `panneaux` / `vitree` / `double` / `moderne`, imposte, marches (`steps` = hauteur à franchir), marquise `verre` / `dalle` / `tuiles` |
| `garage`, `shopfront` (vitrine allumée la nuit, porte, enseigne en relief, store banne, rideau) | |
| `balcony(ctx, f, u0, u1, v, { depth, rail, consoles, sides, deck })`, `loggia`, `railing(A, B, h, style)` | styles `barreaux`, `fer`, `verre`, `plein`, `bois` |
| `band`, `cornice(profile [[h, saillie]…])`, `plinth`, `quoins`, `pilaster`, `downpipe` | modénature, eaux pluviales |

## 6. Toitures (`kit/roofs.ts`)
`gableRoof` (pignons, débords, rives, gouttières, faîtage, `timber` : pannes/chevrons apparents), `hipRoof` (croupes,
sous-faces caissonnées, arêtiers en tuiles rondes), `shedRoof` (mono-pente + murs latéraux), `flatRoof` (acrotère,
couvertine), `mansardRoof` (brisis + terrasson zinc), `dormer` (lucarne à fronton ou rampante), `chimney` (chapeau, mitrons),
`genoise`, `rooftopUnit`, `stairHouse`, `mast`. Elles renvoient `{ ridgeY, eaveY }` quand c'est utile (cheminées, descentes).

## 7. LOD (automatiques)
Toutes les fonctions lisent `ctx.lod` :
- **LOD0** : tout (petits bois, encadrements, ferronneries, chevrons, mitrons, consoles…) ;
- **LOD1** : sans petits bois, encadrements, ferrures, frises ; barreaux espacés ×3 ;
- **LOD2** : murs pleins, baies en aplats (verre / volets / portes à 3 cm du mur), toitures sans accessoires.
Les LOD doivent être strictement décroissants en triangles (vérifié à l'export).

## 8. Rendu (`src/render/buildings/`)
`InstancedBuildingRenderer` (implémente `IBuildingRenderer`) lit ces GLB : un `InstancedMesh` par (asset, variante, LOD, rôle),
matériaux reconstruits et partagés depuis `extras.aube` (variantes sans duplication de géométrie), fenêtres allumées la nuit
(`setNight`), patine par instance, LOD par distance avec chargement progressif. Tout GLB produit par le kit est donc
directement compatible.

## 9. Vérifications
- `exportBuilding` refuse : modèle hors empreinte, LOD non strictement décroissants, jeu de textures inconnu.
- Tests : `npx tsx --test tests/buildings/*.test.ts` (orientation des faces, triangulation, murs percés, relecture GLB par
  gltf-transform, diversité / anti-placeholder / variantes de la bibliothèque, fragment de catalogue, rendu instancié).
- Vitrine : `npx tsx tools/buildings/showcase/run.ts` — options `--ids=a,b --views=front,back,aerial,street --lods --variants
  --night --street --gate --frags=catalog.<module>.json --tag=nom --cols=n`. `--gate` applique la porte visuelle du QA
  (`validateAllAssets` de `src/render/validation.ts` : vrai GLTFLoader, textures décodées, couverture en pixels) aux bâtiments
  générés et écrit `tests/buildings/out/porte_qa_planche.png`. Planches dans `tests/buildings/out/` : à REGARDER.

## 10. Exemple minimal
```ts
export const exemple: BuildingDef = {
  id: 'exemple_atelier', nameFr: 'Atelier', category: 'industrial', footprint: { tilesX: 2, tilesZ: 2 },
  cost: 30000, upkeepPerMonth: 80, residents: 0, jobs: 12, density: 'faible', style: 'atelier',
  source: 'tools/buildings/<module>/<fichier>.ts#exemple',
  palette: basePalette({ facade: { set: 'brique_parement' }, toiture: { set: 'toit_bac_acier' } }),
  variants: [{ id: 'origine', nameFr: 'Brique' }, { id: 'beton', nameFr: 'Béton', materialOverrides: { facade: { textureSet: 'beton_facade' } } }],
  build(ctx) {
    volume(ctx, { x0: -7, x1: 7, z0: -6, z1: 6, h: 6, wallMat: 'facade',
      sides: { S: [{ kind: 'garage', r: rectAt(4, 3.5, 0, 3.6) }, ...row(bays(14, 4), 1.6, 2.5, 2.2).slice(2)] },
      plinth: { h: 0.4 } });
    gableRoof(ctx, { x0: -7, x1: 7, z0: -6, z1: 6, y: 6, pitch: 18, axis: 'x' });
  },
};
// puis : exportBuilding(exemple, assetsDir, 'buildings/industrial', sets)
```
Vitrine : `npx tsx tools/buildings/showcase/run.ts --frags=<votre fragment>.json --views=front,back,aerial [--lods] [--variants] [--night] [--street]`.
