# Demande — placement du mobilier urbain phase 2C (pour le superviseur / zone `src/render/roads/**`)

Auteur : session « p2c-mobilier ». Ce lot **ne touche pas** au rendu routier : il livre les modèles et leurs entrées de
catalogue. Le branchement se fait dans `src/render/roads/builder.ts` (`decor()`) et `renderer.ts` (`DECOR_ASSETS`).

## 0. À faire hors de ma zone (bloquant pour un vert complet)
1. **`tools/assets/validate.ts`** (`npx tsx tools/assets/validate.ts`, aussi lancé en fin de `npm run assets`) :
   ajouter `props` aux sources de générateurs autorisées. Aujourd'hui il échoue sur nos 19 entrées avec
   « source non autorisée » (c'est sa seule erreur) :
   ```ts
   const gen = /^tools\/(generators|buildings|vehicles|props)\//.test(lic.source);
   ```
2. **`package.json`** : ajouter `tests/props/*.test.ts` au script `test` (6 tests, verts : `npx tsx --test tests/props/*.test.ts`).
3. **Pipeline** (`tools/generators/index.ts`) : enregistrer le générateur pour que `npm run assets` le rejoue. Le plus simple :
   exporter depuis `tools/props/build.ts` une fonction `generateProps(ctx)` qui renvoie `{ assets, textureSets: [] }`.
   Je peux l'écrire si on me le demande ; aujourd'hui on reconstruit le lot avec `npx tsx tools/props/build.ts`.
   Les 5 modèles Poly Haven sont déjà dans `MODELS` (selection.ts) : un `npm run assets` complet les conserve à l'identique.
4. Facultatif : dans `assets/LICENSES.md` (généré par `tools/assets/licenses.ts`), ajouter `tools/props/` à la liste
   « Sources autorisées » de l'en-tête. Les lignes de chaque asset sont déjà présentes et exactes.

## 1. Conventions des modèles
- Origine : centre de l'emprise au sol, base à y = 0. **Face avant vers +Z** et longueur principale selon X
  (comme `banc_bois`). Avec la rotation de `put()` (face +Z tournée vers l'axe de la chaussée), un élément de
  trottoir présente donc sa face avant à la route.
- Tous en catégorie `street_furniture`, 3 LOD (distances dans le catalogue), un seul matériau atlas partagé par les
  19 modèles générés (`mobilier_atlas`) + `mobilier_verre` (transparent, BLEND) pour les abris : instancier par sous-maillage
  comme aujourd'hui ; le verre doit rester un `InstancedMesh` à part (tri de transparence par chunk suffisant).
- Tag commun des générés : `mobilier_p2c`.
- `potelet`, `plaque_egout`, `panneau_*`, `totem_arret` : peu de triangles, on peut en placer beaucoup.
  `velo` (2,3 k triangles au LOD0) et `arceaux_velo` (1,4 k) : à grouper avec parcimonie.

## 2. Règles de placement proposées (par élément)
Notations : `hc` demi-largeur de chaussée, `ht` demi-largeur totale, `curb` hauteur de bordure ; décalage latéral
`off` mesuré depuis l'axe ; `s` abscisse sur le tronçon ; marge de 7 m aux extrémités (comme `decor()`), plus
**aucun objet dans les 12 m d'un carrefour**, sauf mention contraire (panneaux, potelets).

| Id | Où | Règle |
|---|---|---|
| `panneau_stop` | carrefours non signalés (sans feux), bras secondaire (`street`/`oneway` qui débouche sur `avenue`/`boulevard`) | 1 par bras entrant, à droite, à la ligne d'arrêt : `off = hc + 0,5`, `y = curb`, face +Z vers le trafic **entrant** (rotation + π par rapport à `put()`). Jamais sur un bras équipé de feux (autre branche). |
| `panneau_passage_pieton` | à chaque passage piéton hors carrefour à feux | de part et d'autre de la chaussée, à 1 m avant le passage dans le sens du trafic, `off = ±(hc + 0,5)`, face vers le trafic arrivant. |
| `panneau_sens_interdit` | extrémité de sortie d'une `oneway` | aux deux bords, face vers le trafic qui arriverait à contresens. |
| `panneau_danger` | rare : avant un virage serré (rayon < 30 m) ou une fin de chaussée | 1 par sens, 50 m en amont, côté droit. |
| `abribus` | tronçons `street`/`avenue`/`boulevard` desservis par une ligne de bus (arrêt de la simulation transports) | côté trottoir, `off = ±(ht − 0,9)` (dos côté bâtiments, ouverture vers la route), longueur 4,2 m selon la route ; uniquement si `k.sidewalk ≥ 2,5 m`, sinon `totem_arret` seul. |
| `totem_arret` | tout arrêt de bus ; en tête de quai de tram | `off = ±(hc + 0,6)`, à 2 m en amont de l'abri. |
| `abri_tram` | stations de tram (quand le tram existera) | sur le quai, axe parallèle aux voies ; 6 × 2 m. |
| `poubelles_tri` | rues piétonnes, places, abords des arrêts | 1 tous les 60–80 m de rue piétonne (en alternance avec `poubelle_metal`), 1 à côté de chaque abribus (+2,5 m). |
| `banc_beton` / `banc_modulaire` | rues piétonnes, places, parcs ; trottoirs ≥ 4 m des boulevards | varier avec `banc_bois` : tirage pondéré (`banc_bois` 40 %, `banc_modulaire` 35 %, `banc_beton` 25 %), même règle que `bench` dans `decor()`. |
| `jardiniere_beton`, `jardiniere_bac_bois`, `jardiniere_haute_bois` | rues piétonnes, terrasses, entrées de place | ajouter au type `planter` (aujourd'hui `jardiniere_plante_a/b`) ; `jardiniere_beton` aussi en **protection** aux entrées de rue piétonne (2–3 en travers, espacement 1,6 m). |
| `potelet` | bords de trottoir aux carrefours et aux passages piétons, entrées de rue piétonne | tous les 1,5 m sur 6 m de part et d'autre de chaque passage piéton, `off = ±(hc + 0,3)` ; pas sur les `highway`. |
| `arceaux_velo` + `velo` | près des commerces, écoles, gares, places | groupe de 3 arceaux (1,9 m) sur le trottoir, `off = ±(ht − 1,2)`, axe des arceaux perpendiculaire à la route ; 0 à 2 `velo` contre les arceaux (vélo à x = arceau ± 0,45, même orientation que l'arceau, rotation de π/2), 1 groupe tous les 120 m en centre-ville. |
| `borne_recharge` | stationnement le long des trottoirs, parkings | à la limite trottoir/place de stationnement, `off = ±(hc + 0,4)`, face vers la place ; 1 pour 2 places. |
| `horodateur` | rues avec stationnement payant (centre) | `off = ±(ht − 0,6)` ou contre le bord de trottoir ; 1 tous les 50–70 m. |
| `fontaine_eau` | parcs, places, rues piétonnes | 1 par place / parc ; sur rue piétonne, 1 tous les 200 m. |
| `colonne_morris` | places, carrefours de centre-ville, larges trottoirs (≥ 5 m) | rare : 1 par place, à l'angle ; jamais à moins de 3 m d'une façade. |
| `kiosque_journaux` | places, débouchés de rue piétonne, abords de gares | rare : 1 par place de quartier central ; ouverture (+Z) vers le flux piéton. |
| `barriere_vauban` | chantiers (zone `src/render/construction`), événements | alignées bout à bout tous les 2,25 m autour d'une emprise, pieds vers l'extérieur ; peuvent être pivotées de ±5° pour un aspect naturel. |
| `separateur_beton_bas` | chantiers de voirie, fermetures de voie | en ligne, bout à bout (1,57 m) ; aussi aux abords de chantier côté chaussée. |
| `plaque_egout` | **chaussée** et trottoirs | sur l'axe d'une voie, tous les 40–60 m, `y = surface + 0,005` (le modèle fait 7 cm d'épaisseur : l'enfoncer de 6 cm pour qu'il affleure) ; aucune collision. Hors marquages (pas sur les passages piétons). |

Toutes ces règles sont **déterministes** : tirage aléatoire de type `(segId * a + i * b) % n`, comme dans `decor()`, pour
que le décor reste stable d'une construction à l'autre.

## 3. Proposition de structure (`renderer.ts`)
```ts
export const DECOR_ASSETS: Record<DecorKind, string[]> = {
  lamp: ['lampadaire_fonte'],
  tree: [...],
  bench: ['banc_bois', 'banc_modulaire', 'banc_beton'],
  planter: ['jardiniere_plante_a', 'jardiniere_plante_b', 'jardiniere_bac_bois', 'jardiniere_haute_bois', 'jardiniere_beton'],
  bin: ['poubelle_metal', 'poubelles_tri'],
  // nouveaux types (à ajouter à DecorKind) :
  bollard: ['potelet'], busStop: ['abribus'], stopPole: ['totem_arret'],
  signStop: ['panneau_stop'], signCrossing: ['panneau_passage_pieton'], signNoEntry: ['panneau_sens_interdit'], signDanger: ['panneau_danger'],
  bike: ['arceaux_velo'], bikeParked: ['velo'], ev: ['borne_recharge'], meter: ['horodateur'],
  fountain: ['fontaine_eau'], column: ['colonne_morris'], kiosk: ['kiosque_journaux'], manhole: ['plaque_egout'],
};
```
Dans `DecorItem`, le choix entre plusieurs ids d'un même type est déjà fait par le renderer ; garder ce mécanisme.

## 4. Reconstruction / contrôle
```
npx tsx tools/props/build.ts                 # régénère les 19 modèles + les 5 Poly Haven, met à jour catalog.json et LICENSES.md
npx tsx --test tests/props/*.test.ts         # contrôles du lot
npx tsx tools/assets/showcase/run.ts --lods --only=<ids>   # planches .cache/showcase/out/{modeles,lods}.png
```
