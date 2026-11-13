# Demandes de la branche p2b-dechets (phase 2B.6 « Déchets ») au superviseur

Branche : `claude/p2b-dechets` (partie de `claude/p2b-municipal`). Code : `src/sim/waste/**`, `src/shared/waste/**`,
`src/render/waste/**`, `tools/waste/**`, `assets/models/waste/**`, fichiers de module `dechets`, `tests/dechets/**`.
Documentation : `docs/DECHETS.md`.

## 1. Enregistrements APPLIQUÉS (une ligne par registre) et adaptations de tests faites sur la branche

- `src/sim/plugins/index.ts` : `municipalPlugin` puis `dechetsPlugin` (le module déchets utilise le service
  `municipal`, publié dans `init` : `municipal` doit rester AVANT `dechets`). L'enregistrement de `municipal`
  était prêt mais non appliqué sur `p2b-municipal` (docs/requests/municipal.md §1) : il est indispensable aux déchets.
- `src/sim/save-sections/index.ts` : `municipalSaveSection`, `dechetsSaveSection`.
- `src/shared/protocol-ext/index.ts` : `'dechets'` dans `PHASE2_MODULES` + types delta / instantané / commandes.
- `src/render/plugins/index.ts` : `dechetsRenderPlugin` ; `src/ui/panels/index.ts` : `dechetsPanel`.
- `tests/plugins/plugins.test.ts` (fichier superviseur) : même adaptation que la branche p2a-circulation —
  `IMPLEMENTED = {municipal, dechets}`, contrôles « module vide » sur les autres, `municipal` module de simulation
  seul (`SIM_ONLY`, inséré avant `dechets` dans l'ordre attendu). Le test « identique tick à tick » porte sur les
  modules encore vides.
- `tests/municipal/plugin.test.ts`, `tests/municipal/effets.test.ts` (branche municipal, en pause) : ces tests
  injectent leur propre `createMunicipalPlugin()` à côté de `SIM_PLUGINS` ; avec `municipal` désormais dans le
  registre, `new Simulation([...SIM_PLUGINS, mp])` lève « double ». Changement mécanique : `SIM_PLUGINS` y désigne
  le registre filtré (sans `municipal` ni `dechets`). Aucune assertion modifiée.

Résultat : `npm test` 210/210 (dont 10 dans `tests/dechets`).

## 2. API minimale demandée au trafic (src/sim/traffic, lecture seule pour cette branche)

`TrafficSystem` sait créer un véhicule (`spawnTrip(fromK, toK, 'proprete')`, `spawnVehicle(arc, …)`) mais
**aucune** de ces méthodes n'est exposée aux modules (`PluginContext` ne donne pas accès au trafic), et il n'existe
ni tournée à arrêts multiples, ni rappel à l'arrivée. Les tournées sont donc simulées dans le module déchets
(temps de trajet sur le graphe routier, Dijkstra, `src/sim/waste/graph.ts`) et les camions dessinés par son rendu.
API minimale proposée, publiée par le cœur comme service `trafic` (`ctx.provide('trafic', api)`) :

```ts
export interface TrafficServiceForPlugins {
  /** Crée un véhicule de service suivant une suite d'arrêts (points monde, rattachés à la voie la plus proche). */
  spawnRoute(o: {
    owner: string;                  // id du module (statistiques, nettoyage à la nouvelle partie)
    assetId: string;                // ex. 'vehicule_benne_ordures'
    variant?: number;               // ex. 1 = « vert propreté »
    stops: { x: number; z: number; dwellSeconds: number; ref?: number }[];
    flags?: number;                 // ex. gyrophare orange
  }): number;                       // identifiant de véhicule, -1 si impossible
  /** Arrivées aux arrêts depuis le dernier appel : { vehicle, stopIndex, ref, at } (vidé à la lecture). */
  takeArrivals(owner: string): { vehicle: number; stopIndex: number; ref?: number; at: number }[];
  /** Temps de parcours estimé (s) entre deux points, sur le graphe des voies, sans créer de véhicule. */
  travelTime(ax: number, az: number, bx: number, bz: number): number;
  despawn(vehicle: number): void;
}
```

Avec ce service, `WasteSystem.planTours` garde sa planification (ordre des arrêts, vidages, retour) et remplace
`advanceTrucks` par `spawnRoute` + `takeArrivals` (les ramassages se font à l'arrivée réelle, embouteillages
compris) ; `TruckLayer` disparaît au profit du rendu des véhicules de base.

## 3. Validateur d'assets : autoriser la source `tools/waste/`

`tools/assets/validate.ts` (`checkLicense`) n'accepte que `tools/(generators|buildings|vehicles)/`. Les 6 modèles
déchets (source exacte `tools/waste/models.ts#…`, CC0) y échouent pour cette seule raison ; avec
`/^tools\/(generators|buildings|vehicles|waste)\//`, la validation complète est **OK** (vérifié sur une copie
temporaire du validateur : LOD, triangles, boîtes, matériaux PBR, licences).

```diff
-  const gen = /^tools\/(generators|buildings|vehicles)\//.test(lic.source);
+  const gen = /^tools\/(generators|buildings|vehicles|waste)\//.test(lic.source);
```

## 4. Registre des générateurs (`tools/generators/index.ts`)

```ts
import { generateWaste } from '../waste/build';
  { name: 'Déchets (dépôt, tri, incinérateur, décharge, tumulus, conteneurs)', run: async (ctx) => ({ assets: (await generateWaste(ctx.assetsDir)).assets, textureSets: [] }) },
```
(En attendant : `npm run waste:build` écrit les GLB, `assets/catalog.waste.json` et met à jour `catalog.json` /
`LICENSES.md` pour ces seules entrées.)

## 5. Interface : montage des panneaux du registre `UI_PANELS`

Rien ne monte encore les panneaux du registre (`src/ui/panels/types.ts`). Le panneau « Déchets » est monté à titre
PROVISOIRE par le rendu du module (touche **J**, calque **Maj+J**, `window.__dechets.openPanel()`), avec le style
`.panel` existant. À la refonte d'interface : bouton « Déchets » dans la barre des services, et suppression du
montage provisoire (`openPanel`/`onKey` de `src/render/plugins/dechets.ts`). Les installations sont posables depuis
l'onglet « Services publics » existant (catégorie `public`).

## 6. Économie et démographie (cœur)

- Lignes budgétaires du module (`dechets:collecte`, `dechets:recyclage`, `dechets:energie`) : postées dans le
  contrat municipal, **non appliquées à la trésorerie** tant que docs/requests/municipal.md §3.2 n'est pas fait.
- Grilles `satisfaction` et `valeur_fonciere` : le module y écrit (décalage réversible proportionnel aux nuisances),
  mais la démographie de base ne les lit pas encore (attractivité, déménagements) : couplage à prévoir avec la
  sous-étape 2B.2.

## 7. FEATURES.md (proposition de lignes, section « Partiel »)

| Déchets : production par bâtiment, bacs, tournées de camions-bennes sur le graphe routier, tri / recyclage / incinération / décharge, pollution et nuisances, panneau, calque | Camions simulés et dessinés par le module (pas dans le trafic : §2) ; recettes et dépenses non appliquées à la trésorerie (§6) ; panneau monté provisoirement (touche J, §5) | 2B.6 |
