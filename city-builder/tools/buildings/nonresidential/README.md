# Bâtiments non résidentiels

Ce dossier génère 23 bâtiments : commerces, bureaux, gratte-ciel, industrie, équipements publics et un parc. Ils sont
construits avec le kit modulaire `tools/buildings/kit`, documenté dans `docs/BUILDING_KIT.md`, et complétés par les
briques de `parts.ts`. Toute la géométrie est produite par du code (Node, sans Blender), avec des UV en mètres. Les
textures sont des jeux PBR Poly Haven (CC0), partagés entre tous les bâtiments et jamais dupliqués dans les GLB.

```
npx tsx tools/buildings/nonresidential/build.ts           # GLB LOD0/1/2 + assets/catalog.buildings.other.json
ONLY=public_gare npx tsx tools/buildings/nonresidential/build.ts
npx tsx --test tests/buildings-other/*.test.ts            # 53 tests
npx tsx tools/buildings/nonresidential/showcase/run.ts --sheet=planche_non_residentiel   # captures rapprochées
```

## Fichiers
| fichier | contenu |
|---|---|
| `commerce.ts` | boulangerie, supermarché avec parking, café-brasserie à terrasse, station-service, centre commercial |
| `offices.ts` | immeuble de bureaux à brise-soleil, tour vitrée à mur-rideau, gratte-ciel Art déco à retraits, tour torsadée à couronne |
| `industry.ts` | manufacture à sheds et cheminée, entrepôt logistique à quais, château d'eau, silos de coopérative, atelier |
| `public.ts` | hôtel de ville, école, caserne de pompiers, commissariat, hôpital, musée-bibliothèque, église, gare, parc à kiosque |
| `parts.ts` | briques ajoutées au kit (voir ci-dessous) et palette `npPalette` (rôles : sols, marquages, végétal, lettrages…) |
| `font.ts` | police matricielle 5×7 originale (CC0) pour les enseignes en relief |
| `index.ts` / `build.ts` | export et fragment de catalogue ; recentrage des points d'accès (`withCenteredFrontage`) |
| `showcase/` | vitrine rapprochée : caméra libre, vrai rendu instancié du jeu, échec si un modèle ne se charge pas |

## Briques ajoutées (`parts.ts`)

**Façades**
- lettrages en relief : `lettering`, `signPanel` ;
- murs-rideaux et fenêtres filantes : `curtainWall`, `ribbonFloors` ;
- baies particulières : `archWindow` (plein cintre), `oculus` (rosace) ;
- horloges : `clockFace` ;
- ordres classiques : `column`, `pediment` ;
- `steps`, `stripedAwning`, `fireEscape`, `wallAC` ;
- repères de façade sur un polygone quelconque : `edgeFrame`, `polyFrames`, `regularPoly`.

**Industrie**
- `sawtoothRoof`, `factoryChimney`, `loadingDock`, `hCylinder` ;
- formes de révolution : `dome`, `spire`.

**Abords**
- sols : `parkingLot`, `slab`, `mark` ;
- mobilier : `lampPost`, `flagPole`, `bench`, `terraceSet`, `planter`, `fence`, `pallet` ;
- végétation : `shrub`.

Chaque brique a trois niveaux de détail :
- **LOD0** : complet ;
- **LOD1** : allégé (petits éléments supprimés, montants espacés) ;
- **LOD2** : aplats et silhouette.

Les graines d'allumage nocturne des vitrages sont calculées par hachage (`litSeed`) et ne consomment pas `ctx.r()`. Les
trois LOD tirent donc exactement la même suite aléatoire.

## Métadonnées de jeu
Chaque bâtiment porte les données suivantes :
- coût, entretien, emplois et densité ;
- empreinte en cases de 8 m ;
- points d'accès : piéton, véhicule ou livraison ;
- au moins 3 variantes, qui jouent sur les matériaux, les couleurs ou la hauteur ;
- des tags normalisés :
  - `service:<type>`, présent sur tous les bâtiments ;
  - `rayon:<m>` et `capacite_service:<n>` pour les équipements ;
  - `attractivite:<n>` et `pollution:<n>` quand ils s'appliquent.

Le contrat du catalogue n'a pas encore de champ « service ». La proposition est décrite dans `docs/requests/buildings-other.md`.
