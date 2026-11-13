# Demandes de la branche p2b-eau (eau et assainissement) au superviseur

Branche : `claude/p2b-eau` (base `claude/p2b-municipal`). Code : `src/sim/water-network/**`,
`src/shared/water-network/**`, `src/render/water-network/**`, `tools/water-network/**`,
`assets/models/water-network/**`, fichiers de plugin `eau`, `tests/eau/**`. Documentation : `docs/EAU.md`.

## 1. Test des registres (`tests/plugins/plugins.test.ts`, fichier superviseur) — SEUL échec de `npm test`

Le module `eau` est enregistré (une ligne dans chaque registre, `PHASE2_MODULES` compris). Le test
« registres : les quatre modules sont enregistrés partout, vides… » exige `Object.keys(p) == ['id']` pour chaque
module de simulation : il échoue sur `eau : plugin vide attendu` (vérifié le 2026-11-13, toutes les autres
assertions de ce test passent, ainsi que « modules vides : simulation identique tick à tick », car `eau` reste
dormant sans installation d'eau). Proposition :

```diff
-  for (const p of SIM_PLUGINS) assert.deepEqual(Object.keys(p), ['id'], `${p.id} : plugin vide attendu`);
+  /** Modules livrés (phase 2B) : non vides, mais dormants tant que le joueur ne les utilise pas. */
+  const DELIVERED = ['eau'];
+  for (const p of SIM_PLUGINS) if (!DELIVERED.includes(p.id)) assert.deepEqual(Object.keys(p), ['id'], `${p.id} : plugin vide attendu`);
```

Le titre « les quatre modules » devient « les modules ». À l'intégration du contrat municipal (docs/requests/municipal.md
§1–2), `municipal` doit être placé **avant** `eau` dans `SIM_PLUGINS` : `eau` appelle `ctx.use('municipal')` dans `init`.
Sans `municipal` enregistré, `eau` fonctionne avec un contrat PRIVÉ (testé : `tests/eau/plugin.test.ts`, sauvegarde
aller-retour dans les deux modes) ; une fois `municipal` enregistré, grilles / réseaux / budget / effets deviennent
partagés sans changement de code.

## 2. Croissance bloquée des bâtiments non desservis (cœur : `src/sim/demography.ts`, `src/sim/plugins/types.ts`)

Le module publie le service `eau` : `growthAllowed(buildingId)` (vrai tant que le service n'existe pas ; sinon vrai
seulement si le bâtiment reçoit ≥ 50 % de son besoin avec une pression suffisante). Testé (`tests/eau/effets.test.ts`
effet 1 : financement coupé → tous les logements `growthAllowed = false`). La démographie ne le consulte PAS encore
(aucun accès des modules à l'écriture du cœur). Diff proposé — un crochet générique, utilisable aussi par
l'électricité :

```diff
--- a/src/sim/demography.ts
+++ b/src/sim/demography.ts
+  /** Filtres de croissance des modules (eau, électricité…) : faux = le bâtiment n'accueille pas de nouveaux ménages. */
+  growthGates: ((buildingId: number) => boolean)[] = [];
   private freeHousingAt(bi: number): number {
     const m = this.metaOfIndex(bi);
     if (!m || m.resCap <= 0 || !this.ctx.buildings.roadAccess[bi]) return 0;
+    const id = this.ctx.buildings.id[bi]!;
+    for (const g of this.growthGates) if (!g(id)) return 0;
     return Math.max(0, m.resCap - this.ctx.buildings.residents[bi]!);
   }
--- a/src/sim/plugins/types.ts (PluginContext)
+  /** Enregistre un filtre de croissance (appelé dans `init`). */
+  addGrowthGate(gate: (buildingId: number) => boolean): void;
```

et dans `src/sim/plugins/eau.ts` (`init`) : `ctx.addGrowthGate?.((id) => system.growthAllowed(id))`. Effet de bord
nul tant qu'aucune installation d'eau n'existe (tous les filtres renvoient vrai) : parties existantes inchangées.
Un test de non-régression devra montrer qu'une ville sans installation d'eau garde la même population au tick près.

## 3. Satisfaction → démographie

Le module écrit sa contribution dans la grille municipale standard `satisfaction` (−30 points non desservi,
−20 × (1 − qualité), −6 sans égout, tarif > 2 et restrictions) et la grille `eau:risque_sanitaire`. Ces grilles ne
sont consommées par aucun système du cœur aujourd'hui (même situation pour tous les indicateurs du contrat) : à
brancher lors de la sous-étape 2B-2 (« Simulation économique et sociale », déménagements selon la qualité de vie).

## 4. Budget du service appliqué à la trésorerie

Les recettes (vente d'eau au tarif) et dépenses (pompage, potabilisation, épuration, châteaux, entretien des
canalisations) sont postées chaque mois dans le budget municipal (service `eau`). Leur application à
`Economy.money` dépend de docs/requests/municipal.md §3.2 (sous-étape « Fiscalité et budget »). Le panneau le dit.

## 5. Montage du panneau (refonte §1bis)

`UI_PANELS` n'est monté nulle part. En attendant, `src/render/plugins/eau.ts` ajoute un bouton « Eau » (visible
seulement quand la barre `#hud` l'est) et monte `eauPanel` avec une `UiPanelApi` adaptée (commandes via
`window.__aube.send('pluginCommand', …)`). À retirer dès que l'interface monte les panneaux du registre :
supprimer `mountUi()` et le code DOM de `src/render/plugins/eau.ts` (le calque 3D reste).

## 6. Générateur d'assets

`tools/water-network/build.ts` écrit ses GLB et met à jour ses seules entrées de `assets/catalog.json`. Pour le
pipeline complet (`npm run assets`), ajouter au registre `tools/generators/index.ts` :

```diff
+import { buildWaterModels } from '../water-network/build';
+  { name: 'Eau et assainissement (5 modèles, LOD0/1/2)', run: async (ctx) => { buildWaterModels(ctx.assetsDir); const c = JSON.parse(readFileSync(join(ctx.assetsDir, 'catalog.json'), 'utf8')); return { assets: c.assets.filter((a) => a.id.startsWith('eau_')), textureSets: [] }; } },
```

## 7. Terrain : tracé des rivières pour les modules

`PluginTerrain` n'expose que `isWet` / `heightAt` : le sens d'écoulement est reconstruit sur la grille municipale
(priority-flood, `src/sim/water-network/river.ts`), robuste mais approximatif. Exposer `rivers()` (polylignes
amont → aval de `WorldTerrain.rivers`) et `waterSurface(x, z)` permettrait un débit réel par tronçon.

## 8. FEATURES.md / PROJECT_STATUS.md

Entrées proposées (fichiers communs) : « Eau et assainissement (2B.5) : captage surface / forage, potabilisation,
châteaux d'eau, canalisations et égouts sur la voirie (réseaux municipaux), pression, qualité, épuration, pollution
des cours d'eau propagée vers l'aval, panneau Eau & égouts, vue souterraine. Tests : tests/eau (dont 4 tests d'effet). »
