# Demandes de la branche p2b-municipal (contrat municipal) au superviseur

Branche : `claude/p2b-municipal`. Code : `src/sim/municipal/**`, `src/shared/municipal/**`,
`src/sim/save-sections/municipal.ts`, `tests/municipal/**`. Documentation : `docs/MUNICIPAL.md`.

## 1. Enregistrement du module `municipal` (NON appliqué sur la branche — à appliquer avec le §2)

L'enregistrement est prêt mais **n'a pas été ajouté** : le test superviseur
`tests/plugins/plugins.test.ts` « registres : les quatre modules sont enregistrés partout, vides… » fige la liste
des modules à `PHASE2_MODULES` (4 modules) et exige des plugins vides (`Object.keys(p) == ['id']`). Avec la ligne
d'enregistrement, ce test échoue (vérifié le 2026-11-13 : `tests/plugins` + `tests/integration` → 13 réussis,
1 échec, uniquement ce test). Le test « modules vides : simulation identique tick à tick » **passe** avec
`municipal` enregistré (contrat inutilisé = aucun effet, aucune section, aucun `ext`). Ne pouvant modifier ni ce
test ni `src/shared/protocol-ext/index.ts`, j'ai laissé `npm test` vert et je propose le diff complet ici. Toute
l'intégration est néanmoins testée par injection (`new Simulation([...SIM_PLUGINS, createMunicipalPlugin()])`,
`tests/municipal/plugin.test.ts`, `tests/municipal/effets.test.ts`).

```diff
--- a/src/sim/plugins/index.ts
+++ b/src/sim/plugins/index.ts
@@
 import { chantiersPlugin } from './chantiers';
+import { municipalPlugin } from '../municipal/plugin';
 import type { SimPlugin } from './types';
@@
   chantiersPlugin,
+  municipalPlugin,
 ];
--- a/src/sim/save-sections/index.ts
+++ b/src/sim/save-sections/index.ts
@@
 import { pietonsSaveSection } from './pietons';
+import { municipalSaveSection } from './municipal';
 import type { SaveSectionSpec } from './types';
@@
   chantiersSaveSection,
+  municipalSaveSection,
 ];
```

`municipal` doit être placé **avant** les modules qui l'utilisent si ceux-ci appellent `ctx.use('municipal')` dans
`init` (le service est publié dans `init`). Les modules de 2A n'en dépendent pas : la fin de liste convient aujourd'hui ;
électricité / eau / déchets seront ajoutés après lui.

## 2. Test des registres (`tests/plugins/plugins.test.ts`, fichier superviseur)

Les modules de 2B sont des modules de simulation sans rendu ni panneau propres (pas d'entrée dans
`RENDER_PLUGINS` / `UI_PANELS` / `PHASE2_MODULES`). Proposition :

```diff
-  const ids = [...PHASE2_MODULES];
-  assert.deepEqual(SIM_PLUGINS.map((p) => p.id), ids);
+  const ids = [...PHASE2_MODULES];
+  /** Modules de simulation sans rendu ni panneau (phase 2B) : enregistrés seulement côté simulation. */
+  const SIM_ONLY = ['municipal'];
+  assert.deepEqual(SIM_PLUGINS.map((p) => p.id), [...ids, ...SIM_ONLY]);
   assert.deepEqual(RENDER_PLUGINS.map((p) => p.id), ids);
   assert.deepEqual(UI_PANELS.map((p) => p.id), ids);
-  assert.deepEqual(SAVE_SECTIONS.map((p) => p.id), ids);
-  for (const p of SIM_PLUGINS) assert.deepEqual(Object.keys(p), ['id'], `${p.id} : plugin vide attendu`);
+  assert.deepEqual(SAVE_SECTIONS.map((p) => p.id), [...ids, ...SIM_ONLY]);
+  for (const p of SIM_PLUGINS) if (!SIM_ONLY.includes(p.id)) assert.deepEqual(Object.keys(p), ['id'], `${p.id} : plugin vide attendu`);
@@
-  assert.deepEqual(new Simulation().plugins.ids(), ids);
+  assert.deepEqual(new Simulation().plugins.ids(), [...ids, ...SIM_ONLY]);
```

(La règle « plugin vide » tombera de toute façon dès que les branches 2A rempliront leurs modules ; le test
« identique tick à tick » reste la vraie garantie et passe avec `municipal`.)

## 3. Branchement de l'économie (cœur : `src/sim/plugins/types.ts`, `host.ts`, `economy.ts`)

### 3.1 Lecture du bilan mensuel (miroir budgétaire) — sans changer aucun montant

Le module lit déjà, s'il existe, `ctx.economy?.lastMonth()` (voir `EconomyAccess` dans
`src/sim/municipal/plugin.ts`) : dès que le cœur l'expose, les lignes budgétaires recopient chaque mois le bilan
de `Economy.onMonth` (impôts par secteur, entretien bâtiments / routes, salaires, intérêts, capital), montants
identiques (test : `tests/municipal/plugin.test.ts` « budget : miroir… » avec une source branchée à la main ;
trésorerie et historique de l'économie identiques avec ou sans le module).

```diff
--- a/src/sim/plugins/types.ts
+++ b/src/sim/plugins/types.ts
+import type { MonthRecord, TaxSector } from '../economy';
+/** Économie en lecture seule. */
+export interface PluginEconomy {
+  readonly money: number;
+  readonly taxRates: Readonly<Record<TaxSector, number>>;
+  /** Dernier bilan mensuel clos (copie ; undefined avant le premier mois). */
+  lastMonth(): MonthRecord | undefined;
+}
 export interface PluginContext {
@@
   readonly demography: PluginDemography | null;
+  readonly economy: PluginEconomy;
--- a/src/sim/plugins/host.ts
+++ b/src/sim/plugins/host.ts
@@ makeContext
+    const economy: PluginEconomy = {
+      get money() { return sim.economy.money; },
+      get taxRates() { return sim.economy.taxRates; },
+      lastMonth: () => {
+        const h = sim.economy.history[sim.economy.history.length - 1];
+        return h ? { ...h, income: { ...h.income }, expenses: { ...h.expenses } } : undefined;
+      },
+    };
@@ return {
+      economy,
```

Ordre garanti par le cœur actuel : `onMonthStart` des modules est appelé **après** `economy.onMonth` (world.ts,
événement `MonthStart`) ; le bilan lu est donc celui du mois qui vient de se clore.

### 3.2 Application des lignes propres aux modules à la trésorerie (sous-étape 3 « Fiscalité et budget »)

Aujourd'hui les lignes postées par les modules (`budget.post`) sont comptées à part (`moduleBalance`) et **ne
touchent pas** `Economy.money`. Pour la sous-étape 3, API proposée (aucun changement des montants existants :
les postes de base restent calculés comme aujourd'hui, seule une ligne « modules » s'ajoute au bilan) :

```diff
--- a/src/sim/economy.ts
+++ b/src/sim/economy.ts
 export interface ExpenseBreakdown {
@@
   loanPrincipal: number;
+  /** Dépenses nettes des modules de phase 2 (0 sans module). */
+  modules?: number;
 }
+  /** Recettes / dépenses des modules du mois en cours (cumul, appliqué à la clôture). */
+  private monthExternalIncome = 0;
+  private monthExternalExpense = 0;
+  /** Enregistre un montant de module ; appliqué à la trésorerie par `onMonth`. */
+  applyExternal(income: number, expense: number): void { this.monthExternalIncome += income; this.monthExternalExpense += expense; }
@@ onMonth
-    this.money += totalIncome - expenses;
+    this.money += totalIncome - expenses + this.monthExternalIncome - this.monthExternalExpense;
```

et dans `PluginContext` : `budget: { post(side, amount): void }` relayé vers `economy.applyExternal`. Le module
municipal appellera ce relais depuis sa tâche `municipal:budget` avec `pendingModuleBalance()` ventilé. Un test de
non-régression devra montrer que, sans ligne de module, `history` et `money` restent identiques au centime.

## 4. Rien d'autre

Aucune modification de `world.ts`, `economy.ts`, `demography.ts`, ni des dossiers traffic / pedestrians /
construction / districts / buildings / ui.
