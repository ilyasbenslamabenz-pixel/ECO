# Demandes de la branche p2c-port-aeroport (module `hubs` : port et aéroport) au superviseur

Branche : `claude/p2c-port-aeroport` (partie de `claude/p2b-municipal`, fusion de `claude/p2c-assets-transport`).
Documentation : `docs/HUBS.md`.

## 0. Modifications faites HORS de mon périmètre (minimales, à relire)

| Fichier | Modification | Raison |
|---|---|---|
| `src/sim/plugins/index.ts`, `src/sim/save-sections/index.ts`, `src/render/plugins/index.ts`, `src/ui/panels/index.ts` | une ligne d'import + une ligne d'enregistrement chacun | registres (autorisé) |
| `src/shared/protocol-ext/index.ts` | `'hubs'` dans `PHASE2_MODULES`, `export type *`, une entrée par table (delta, instantané, commandes) | registre (autorisé) |
| `tests/plugins/plugins.test.ts` | la règle « plugin vide » exempte les modules listés dans `ACTIVE = ['hubs']` | le test figeait 4 modules **vides** ; le test « modules vides : identique tick à tick » passe toujours (hubs sans pôle = aucun effet, aucun `ext`, aucune section) |
| `src/shared/catalog.ts` | catégorie `transport` (`OTHER_CATEGORIES`) et seuil `MIN_TRIANGLES_LOD0.transport = 200` | demande §1 de `docs/requests/assets-transport.md` |
| `src/ui/buildbar.ts` | onglet « Transports » dans le tiroir Services (entrées tag `hub` seulement) ; libellé `CATEGORY_FR.transport` ; bouton actif | entrées Port / Aéroport du catalogue de construction |
| `src/client/tools/machine.ts` (outil de pose) | ≈ 40 lignes : `isHubAsset` ; un asset tag `hub` se valide / se pose par `pluginCommand hubs.place` (au lieu de `placeBuilding`), en placement libre, rotation par huitièmes de tour ; les bâtiments ordinaires passent `hubs.checkBuilding` (servitudes) avant pose et dans l'aperçu (si le module est absent, aucune contrainte) | **aucune modification dans `src/input/**`** (l'aimantation de l'autre session n'est pas touchée) |
| `tools/assets/validate.ts` | `PLAUSIBLE.transport = [0.05, 90, 260]`, source `tools/transport/` acceptée, quille des navires (`origine:flottaison`) jusqu'à −10,6 m | demande §1-2 de `assets-transport.md` |
| `tools/generators/index.ts` | générateur `generateTransport` enregistré | demande §3 de `assets-transport.md` |
| `assets/catalog.json`, `assets/LICENSES.md` | 35 pièces transport + 3 entrées de construction (`hub_port`, `hub_port_passagers`, `hub_aeroport`) | fusion par `tools/transport/catalog.ts` (sans relancer Poly Haven) |
| `package.json` | `tests/hubs` dans `npm test`, `tests/transport-assets` dans `test:assets`, scripts `transport:build`, `transport:showcase`, `hubs:captures` | |

## 1. Veto de pose dans le cœur (servitudes appliquées par la simulation elle-même)

Aujourd'hui la servitude est vérifiée par la simulation (`pluginCommand hubs.checkBuilding`) et appliquée par l'outil
de pose ; une commande `placeBuilding` envoyée directement (annulation Ctrl+Z, script) n'est pas contrôlée.
Proposition (cœur : `src/sim/plugins/types.ts`, `host.ts`, `world.ts`) :

```ts
// SimPlugin
validatePlacement?(ctx: PluginContext, p: { assetId: string; x: number; z: number; rot: number; variant: number; heightM: number }): string | null;
// world.ts placeBuilding, après les contrôles de base et avant dryRun :
const veto = this.plugins.validatePlacement({ assetId, x, z, rot, variant, heightM });
if (veto) return fail('COLLISION', veto);
```
Le module `hubs` l'implémenterait en une ligne (`sys.checkBuilding(...)`). Le contrôle côté outil pourra alors être retiré.

## 2. Économie : coût de construction, entretien et recettes appliqués à la trésorerie

Le module ne peut ni dépenser ni encaisser (`PluginContext` n'expose pas l'économie). Les montants sont **postés
dans le budget municipal** (`construction:port`, `entretien:aeroport`, `droits:port`… service `transports`) :
ils seront appliqués avec les lignes des modules (`docs/requests/municipal.md` §3.2). En attendant, poser un port
ne débite pas la trésorerie (affiché dans le panneau Transports : recettes − entretien).

## 3. Emplois

Les emplois directs (380 à 650 par pôle) sont calculés par le module mais ne sont pas offerts à la démographie de
base. Demande : `ctx.demography.addExternalJobs(moduleId, x, z, jobs)` (ou équivalent) pour que les habitants
y travaillent (trajets, chômage).

## 4. Trafic de camions autour du port / de l'aéroport

Le module calcule les camions par jour (fret / 18 t) mais la circulation n'expose pas d'API pour injecter des
poids lourds (`circulationPlugin` vide, trafic de base non accessible). Demande au module circulation :
`provide('trafic', { spawnTrips(originX, originZ, kind: 'truck', perDay) })`. Dès qu'elle existe, `hubs` l'appellera
chaque jour depuis la sortie du terre-plein vers les sorties de carte / zones industrielles.

## 5. Terrain : surface de l'eau et terrassement

- `PluginTerrain` n'expose pas `waterSurface` : la profondeur n'est contrôlée qu'en mer (fond sous le niveau de la
  mer) ; en rivière, la largeur du chenal fait foi et la ligne de flottaison est estimée. Demande :
  `terrain.waterSurfaceAt(x, z)`.
- Le terrain n'est pas aplani sous un pôle (pas d'accès au terrassement) : le terre-plein portuaire est une dalle
  avec mur jusque sous l'eau (dénivelé ≤ 8 m), les pièces de l'aéroport suivent le terrain (dénivelé ≤ 6 m).
  Demande : `terrain.flatten(obb, y)` pour les modules.

## 6. Montage du panneau

`transportsPanel` (`src/ui/panels/transports.ts`, id `hubs`, titre « Transports ») implémente `mount(root, api)` ;
il apparaîtra quand l'interface montera les panneaux du registre (§1bis).

## 7. Sélection / démolition d'un pôle à la souris

Le miroir de l'outil (`WorldMirror.pick`) ne connaît pas les pôles (ils ne sont pas des bâtiments de base) :
démolition par la commande `hubs.remove { id }` (prévue pour le panneau). Demande : prise en compte de
`snapshot.ext.hubs` / `delta.ext.hubs` par le miroir pour la sélection et le bulldozer.
