# Piétons animés — générateur Blender (bpy)

Génère les personnages piétons du city-builder : 12 personnages européens contemporains, 3 LOD chacun,
squelette commun de 17 os, clips `marche` et `attente`, et un `manifest.json` (palettes, métadonnées).
Tout est ORIGINAL et procédural (aucune ressource externe) — licence **CC0-1.0**, auteur « Aube Urbaine »,
source `tools/pedestrians/generate_pedestrians.py`.

## Régénérer

```bash
# une fois : Blender en module Python
python3 -m venv /tmp/bpyenv && /tmp/bpyenv/bin/pip install bpy numpy      # bpy 5.x, Python 3.13

# tout régénérer (≈ 10 s) dans assets/models/pedestrians/
/tmp/bpyenv/bin/python tools/pedestrians/generate_pedestrians.py
#   --only id1,id2      ne régénère que ces personnages (le manifest conserve les autres entrées)
#   --out DIR           dossier de sortie
#   --anims-all-lods    embarque aussi les clips dans les LOD1/LOD2 (par défaut : LOD0 seulement)

node tools/pedestrians/validate.mjs            # contrôle du contrat (code de sortie ≠ 0 en cas d'échec)
node tools/pedestrians/showcase/run.mjs        # planches-contact PNG dans tools/pedestrians/showcase/out/
#   les deux acceptent --dir DIR ; run.mjs accepte --only id1,id2
```

Le générateur est déterministe (graine fixe `GRAINE`, aucun tirage ailleurs que dans les palettes) :
deux exécutions produisent des fichiers identiques octet pour octet.

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `generate_pedestrians.py` | fiches des personnages, modelage, LOD, skin, animations, écriture GLB + manifest |
| `validate.mjs` | validateur Node (`@gltf-transform/core`) du contrat ci-dessous |
| `showcase/run.mjs`, `showcase/page.js` | rendu three (Chromium headless + SwiftShader via Playwright, bundle esbuild) |

## Contrat des sorties (`assets/models/pedestrians/`)

- `<id>_lod0.glb`, `<id>_lod1.glb`, `<id>_lod2.glb` + `manifest.json`.
- Mètres, Y vers le haut, pieds sur y = 0, origine entre les pieds, le personnage regarde vers **+Z**
  (sa gauche = +X). Aucune transformation de nœud hors translations de repos des os.
- Un maillage skinné, une primitive, un matériau `pieton_palette` (blanc, metallic 0, roughness 0.85, sans texture).
- Attributs : `POSITION`, `NORMAL`, `TEXCOORD_0`, `COLOR_0` (occlusion cuite, gris 0.55..1, octets normalisés RGBA),
  `JOINTS_0` (octets), `WEIGHTS_0` (flottants, ≤ 4 influences, normalisés).
- `TEXCOORD_0` = index de palette : `u = (partie + 0.5) / 8`, `v = 0.5`. Parties :
  0 peau, 1 cheveux, 2 haut, 3 bas, 4 chaussures, 5 accessoire, 6 haut secondaire, 7 détail sombre.
  Couleur finale attendue : `palette[rangée][partie] × COLOR_0`.
- Squelette (ordre des joints du skin, identique pour tous les personnages et tous les LOD) :
  `hanches, colonne, poitrine, cou, tete, bras_g, avant_bras_g, main_g, bras_d, avant_bras_d, main_d,
  cuisse_g, tibia_g, pied_g, cuisse_d, tibia_d, pied_d`. Rotations de repos = identité (axes des os = axes monde),
  seules les translations de repos varient d'un personnage à l'autre. Les accessoires sont pondérés sur ces os.
- Animations (LOD0 ; cuites à 30 i/s, LINEAR, rotations des 17 os + translation de `hanches` en Y seulement) :
  - `marche` : cycle sur place bouclable (première image = dernière), 2 pas, 1.0–1.3 s. Le pied d'appui recule à
    `walkSpeed` (cinématique inverse) : jouer le clip à la vitesse `v / walkSpeed` en avançant de `v` évite le patinage ;
    un cycle complet = `strideM` mètres.
  - `attente` : boucle de 3.6–4 s (respiration, transfert de poids, regard).
  Les LOD1/LOD2 n'embarquent pas les clips (mêmes noms d'os : les clips du LOD0 s'y appliquent tels quels).
- LOD : LOD0 3 000–6 000 triangles, LOD1 800–1 500, LOD2 150–350 ; distances conseillées 35 / 110 / 320 m.
- `manifest.json` : `schemaVersion`, `generator`, `license`, `bones`, `parts`, `palettes` (52 rangées de 8 couleurs),
  `models[]` (`id`, `nameFr`, `age`, `genre`, `height`, `radius`, `walkSpeed`, `strideM`, `palettes`, `lods`, `animations`).

## Comment c'est fait

1. **Modelage par sections lissées** : chaque volume (torse, tête, bras, mains, jambes, chaussures, cheveux, jupes,
   sacs…) est une peau tendue sur des sections super-elliptiques clés, interpolées par Catmull-Rom. Les vêtements
   sont la surface elle-même (surépaisseur, ourlets en marche d'escalier, bandes frontales chemise/cravate), le
   visage a mâchoire, nez, oreilles, yeux, sourcils et bouche.
2. **LOD paramétriques** : moins de sections et de segments, pas de décimation aveugle — skin et silhouette propres.
3. **Blender (bpy)** : arêtes vives par angle + normales de coins (`set_sharp_from_angle`, `corner_normals`),
   occlusion ambiante par lancer de rayons sur le BVH (`mathutils.bvhtree`), sol compris.
4. **Animations** procédurales : cinématique inverse des jambes vers des appuis qui reculent à la vitesse nominale,
   déroulé talon/pointe, hauteur du bassin déduite de l'extension des jambes (rebond à 2 cycles), bras opposés,
   variantes par personnage (senior voûté à petits pas, enfants vifs, mallette, main sur la bandoulière, canne…).
5. **GLB écrit à la main** pour garantir le contrat (ordre des joints, un seul matériau, pas de nœud parasite).

## Ajouter un personnage

Ajouter une fiche `P(id='pieton_…', …)` dans `fiches()` (proportions en fractions de la taille, `haut`, `bas`, `pan`,
`cheveux`, `chapeau`, `acc`, `anim`, `groupes` de palettes), régénérer, valider, regarder la planche.
