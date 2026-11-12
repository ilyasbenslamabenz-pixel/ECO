# Demandes de l'artiste BÂTIMENTS NON RÉSIDENTIELS

Livré : `tools/buildings/nonresidential/**` (23 bâtiments), `assets/buildings/nonresidential/*.glb` (LOD0/1/2) et
`assets/catalog.buildings.other.json` (`{ assets, textureSets }`, même format que le fragment résidentiel).
Régénération : `npx tsx tools/buildings/nonresidential/build.ts` (≈ 1 s, aucun téléchargement si le cache Poly Haven existe).

Ces demandes n'empêchent ni la compilation ni les tests. Sans elles, les bâtiments existent sur disque mais **ne sont pas
encore dans `assets/catalog.json`**, donc pas encore dans le jeu ni dans la porte visuelle.

## 1. Agent ASSETS (propriétaire de `tools/generators/index.ts` et `tools/pipeline.ts`)
1. **Enregistrer le générateur** : appeler `generateNonResidential({ assetsDir })`, exporté par
   `tools/buildings/nonresidential/index.ts`, dans le registre. Fusionner ensuite `assets` et `textureSets` dans
   `assets/catalog.json`, comme pour le fragment résidentiel. Les `textureSets` du fragment sont les 6 jeux du kit, identiques
   à ceux du fragment résidentiel : il faut les dédoublonner par `id`.
2. **Licences** : ajouter à `assets/LICENSES.md` une ligne par bâtiment. Le champ `license` de chaque entrée suffit :
   `CC0-1.0`, source `tools/buildings/nonresidential/<fichier>.ts#<fonction>`, auteur « Projet Aube Urbaine (kit bâtiments
   procédural) ». Toutes les textures référencées sont des jeux Poly Haven CC0 déjà présents dans le catalogue ou dans le kit.
   La police matricielle des enseignes (`font.ts`) a été dessinée pour le projet (CC0).
3. **Budget** : les 69 GLB pèsent environ 10 Mo. Un test échoue au-delà de 12 Mo. Si le total de `dist` approche 60 Mo, je peux
   alléger les LOD1, qui représentent environ 30 % du poids.

## 2. Architecte : contrat du catalogue (`src/shared/catalog.ts`)
1. **Service rendu par les équipements** : le contrat n'a pas de champ pour cela. J'utilise donc des tags normalisés :
   - `service:<type>` sur les 23 bâtiments ;
   - `rayon:<m>` et `capacite_service:<n>` pour les équipements à zone d'effet ;
   - `attractivite:<n>` et `pollution:<n>` le cas échéant.

   Je propose un champ optionnel, rétro-compatible :
   `service?: { kind: string; radiusM?: number; capacity?: number; attractiveness?: number; pollution?: number }`.
   Le générateur le remplirait à partir de ces tags.
2. **Catégorie « parc »** : `public_parc_kiosque` est rangé dans `public` avec le tag `parc`. Ajouter une catégorie `park`, ou
   une étiquette d'usage, aiderait l'interface (onglet « Loisirs »).

## 3. Propriétaire du kit (`tools/buildings/kit/building.ts`)
- **`frontage` non recentré** : `exportBuilding` recentre la géométrie (centre de l'emprise en 0,0), mais recopie
  `def.frontage` tel quel. `docs/BUILDING_KIT.md` dit pourtant « coordonnées avant recentrage ». Un bâtiment qui déclare
  ses accès et dont l'emprise n'est pas centrée reçoit donc des accès décalés.
  - Contournement de mon côté : `withCenteredFrontage()` dans `nonresidential/index.ts` applique la translation avant l'export.
  - Proposition : appliquer `dx`/`dz` aux `frontage` dans `exportBuilding`. Je retirerai alors mon contournement.

## 4. Intégration et scène de démonstration
- **Arbres du parc** : `public_parc_kiosque` contient pelouses, allées, fontaine, kiosque, aire de jeux, haies, massifs, bancs
  et lampadaires, mais **aucun arbre**. Les arbres sont des modèles Poly Haven séparés et instanciés, qu'il vaut mieux ne pas
  dupliquer dans un GLB de 30 m. Dans la démo, il faudrait semer 6 à 10 arbres du catalogue (`tree`) dans les quatre quartiers
  de pelouse, autour de (±11, ±6) et (±6, ±11) en coordonnées locales, en évitant le kiosque à (−9,5 ; −9,5) et l'aire de jeux
  à (9,5 ; −9,5).
- **Repères visuels** : `tour_iconique_couronne` (233 m), `gratte_ciel_retraits` (170 m), `tour_vitree_mur_rideau` (116 m),
  `public_eglise`, `industrie_chateau_eau` et `industrie_silos_cooperative` font de bons points de repère pour la vue aérienne.
- **Rendu** : les distances de LOD de ces bâtiments vont jusqu'à `[350, 1600]` m. Elles sont fixées dans
  `lodDistances` pour que les tours restent détaillées de loin.

## 5. QA
- **Tests** : ajouter `tests/buildings-other/*.test.ts` au script `npm test`, par exemple
  `"test": "tsx --test tests/unit/*.test.ts tests/buildings-other/*.test.ts …"`. Aujourd'hui : 53 tests, tous verts.
- **Vitrine rapprochée** : je propose un script `"buildings:other:showcase": "tsx tools/buildings/nonresidential/showcase/run.ts --sheet=planche_non_residentiel"`.
  Il produit les captures dans `tests/buildings-other/out/`.
