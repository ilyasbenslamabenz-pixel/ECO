# Demandes de la branche p2b-electricite (électricité, 2B.4) au superviseur

Branche : `claude/p2b-electricite` (partie de `claude/p2b-municipal`). Documentation : `docs/ELECTRICITE.md`.
Fichiers hors propriété **déjà modifiés** sur la branche (une ligne par registre, comme demandé, + test des registres) :
`src/sim/plugins/index.ts`, `src/sim/save-sections/index.ts`, `src/render/plugins/index.ts`, `src/ui/panels/index.ts`,
`src/shared/protocol-ext/index.ts` (`export type * from './electricite'`), `tests/plugins/plugins.test.ts` (liste des
registres = `PHASE2_MODULES` + `ELECTRICITE_MODULES`, le module électricité n'est pas « vide »), `package.json`
(`tests/electricite/*.test.ts` dans `npm test`, scripts `power:build`, `e2e:electricite`), `assets/catalog.json`
(5 entrées `elec_*`), `assets/LICENSES.md` (régénéré depuis le catalogue par `writeLicenses`, mêmes règles que le pipeline).

Les demandes ci-dessous ne sont **pas** appliquées (fichiers d'autres propriétaires).

## 1. Ordre des registres avec le module `municipal` (contrat 2B.1)

Le module `electricite` utilise `ctx.use('municipal')` dans `init`. Tant que `municipal` n'est pas enregistré, il
**héberge sa propre instance** du contrat (même code) et la sauvegarde dans sa section (`data.municipal`). Quand
`municipal` sera enregistré (`docs/requests/municipal.md` §1), le placer **avant** `electricite` :

```diff
 export const SIM_PLUGINS: readonly SimPlugin[] = [
   …
   chantiersPlugin,
+  municipalPlugin,
   electricitePlugin,
 ];
```

Le mode s'affiche dans le panneau (`delta.ext.electricite.municipal = 'service' | 'integre'`). Une partie sauvegardée
en mode intégré se recharge en mode service : la section `municipal` intégrée est alors ignorée (le contrat repart de
sa propre section, vide) — à traiter si des sauvegardes de joueurs doivent survivre à ce changement (migration simple :
recopier `save.plugins.electricite.data.municipal` vers `save.plugins.municipal` si cette dernière est absente).

## 2. Effet réel « bâtiment sans courant = pas de production ni d'emplois » dans le cœur

Le module calcule, chaque heure, la part servie de chaque bâtiment et la publie (service `electricite`,
`ElectriciteService.powerFactor(id)` / `isPowered(id)`), compte les emplois et habitants sans courant, baisse la
satisfaction (grille municipale) et trace tout dans le registre d'effets. Mais `PluginContext` est en lecture seule :
**la démographie et l'économie de base ignorent encore les coupures** (embauches, production, impôts des entreprises).
Diff proposé (cœur, `src/sim/world.ts` + `src/sim/demography.ts`) :

```diff
--- a/src/sim/demography.ts
+++ b/src/sim/demography.ts
@@ class Demography
+  /** Facteur d'activité d'un bâtiment (1 = actif) : branché par la simulation sur le service `electricite`. */
+  activity: (buildingId: number) => number = () => 1;
@@ recherche d'emploi (≈ l. 548)
-            if (!m || m.jobCap - b.workers[j]! <= 0) continue;
+            if (!m || m.jobCap - b.workers[j]! <= 0 || this.activity(b.id[j]!) < 1) continue;
@@ summary() (≈ l. 1011) et rapport (≈ l. 1083) : emplois offerts
-      if (b.roadAccess[i]) jobsTotal += m.jobCap;
+      if (b.roadAccess[i] && this.activity(b.id[i]!) >= 1) jobsTotal += m.jobCap;
--- a/src/sim/world.ts
+++ b/src/sim/world.ts
@@ après la création de la démographie / des modules
+    // Coupures électriques : un bâtiment sans courant n'embauche pas et ne produit pas.
+    this.demography.activity = (id) => this.plugins.service<{ powerFactor(id: number): number }>('electricite')?.powerFactor(id) ?? 1;
@@ jobsTotal() (l. 740) : même filtre ; recettes des entreprises : pondérer par activity(id)
```

(`PluginHost.service(name)` = lecture de la table des services déjà tenue par l'hôte.) Test d'effet à ajouter avec :
pénurie -> emplois offerts en baisse dans le rapport de démographie (le registre trace déjà `emplois:sans_courant`).

## 3. Lignes budgétaires du service appliquées à la trésorerie

Le module poste ses lignes dans le budget municipal (`entretien:reseau_electrique` selon le financement,
`vente:electricite`, `investissement:lignes_ht`, `investissement:toitures_solaires`). Elles ne sont pas encore
appliquées à la trésorerie (`docs/requests/municipal.md` §3.2). Le coût de construction, l'entretien et les emplois des
**installations** (centrales, postes) passent, eux, par le catalogue et sont donc déjà réels.

## 4. Validateur d'assets : générateur `tools/power/`

`npm run assets:validate` refuse la source « tools/power/models.ts#… » des 5 bâtiments électriques (seuls
`tools/(generators|buildings|vehicles)/` sont admis). Diff proposé (`tools/assets/validate.ts`, l. 56) :

```diff
-  const gen = /^tools\/(generators|buildings|vehicles)\//.test(lic.source);
+  const gen = /^tools\/(generators|buildings|vehicles|power)\//.test(lic.source);
```

Toutes les autres règles passent (dimensions, triangles, LOD décroissants, origine, textures, licence CC0). Le rotor et
le pylône ne sont pas des entrées de catalogue (éléments instanciés par le rendu : `POWER_ELEMENT_FILES`), car les
règles « décor ≤ 10 m de haut, ≤ 15 m d'emprise » ne s'y appliquent pas.

## 5. Montage des panneaux du registre `UI_PANELS` (refonte §1bis)

`electricitePanel` (registre) est prêt. En attendant le montage par l'interface, le module de rendu ajoute un bouton
« ⚡ Énergie » (`mountElectriciteLauncher`, `#elec-launcher`, `#elec-panel`) qui passe par `window.__aube.send`.
À retirer quand l'interface montera `UI_PANELS` (une ligne dans `src/render/plugins/electricite.ts`).

## 6. Météo (phase 2C, module `weather`)

Le module lit le vent et la nébulosité via `ctx.use('weather')` (`{ wind, cloud }` ou `{ state(): { wind, cloud } }`),
sinon un profil déterministe. Demande au module météo : `ctx.provide('weather', { get wind() {…}, get cloud() {…} })`
dans `init` (il ne publie aujourd'hui que `delta.ext.weather`). Placer `weather` avant `electricite` dans le registre.

## 7. Exportations (2B, après la fiscalité)

Valeur publiée pour l'export d'électricité : `ElectriciteService.exportableKw()` (capacité disponible non appelée à
la dernière heure) et `summary().exportableKw` dans `delta.ext.electricite`.
