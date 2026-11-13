# Demandes du module « Chantiers » (branche `claude/p2a-chantiers`)

Destinataires : propriétaire (arbitrage) et architecte (`src/shared/**`, `src/sim/{world,ecs,demography,economy}.ts`).
Rédigé le 2026-11-13. Le module est écrit pour fonctionner **avec ou sans** ces ajouts : sans eux, les chantiers
sont simulés, sauvegardés et affichés, mais un bâtiment en chantier produit et loge déjà (limite documentée
dans FEATURES.md). Avec eux, l'exigence « aucune production, aucun habitant avant achèvement » est tenue.

---

## 1. Demande principale : portail d'activité des bâtiments (BLOQUANT pour la mission)

### Besoin
Un bâtiment en chantier ne doit **ni loger, ni employer, ni produire de recette fiscale, ni coûter d'entretien,
ni émettre de trafic** tant qu'il n'est pas achevé. Aujourd'hui, `PluginContext` est en lecture seule : un module
ne peut pas rendre un bâtiment inactif. C'est le seul point où la mission « Chantiers » a besoin du cœur.

### Pourquoi cette forme
La démographie teste DÉJÀ `buildings.roadAccess[i]` à chaque endroit qui compte (logement : `demography.ts:363`,
`:386` ; emploi : `:546`, `:597`, `:637` ; attractivité et rapports : `:1011`, `:1013`, `:1082` ; bonheur : `:692`)
et le monde fait de même pour les emplois affichés (`world.ts:740`). Un bâtiment « sans accès route » est donc
déjà, partout, un bâtiment inerte. Il suffit qu'un bâtiment en chantier soit inerte **de la même manière**,
sans ajouter une seule condition dans les boucles de démographie : on ajoute une colonne `active` et on la
combine à l'accès route à l'endroit **unique** où celui-ci est calculé. Diff ci-dessous : 4 fichiers,
≈ 30 lignes ajoutées, aucune ligne supprimée, aucun comportement changé quand aucun module n'appelle le portail
(`active` vaut 1 partout).

### API demandée
```ts
// src/sim/plugins/types.ts — dans PluginBuildings
/**
 * Active ou désactive un bâtiment (phase 2, chantiers). Un bâtiment inactif ne loge personne,
 * n'emploie personne, ne produit aucune assiette fiscale, ne coûte pas d'entretien et n'émet pas
 * de trafic ; il reste visible et occupe le terrain. Renvoie faux si le bâtiment n'existe pas.
 * Facultatif : un module doit prévoir son absence (`ctx.buildings.setActive?.(id, false)`).
 */
setActive?(buildingId: number, active: boolean): boolean;
/** Vrai si le bâtiment est actif (défaut : vrai). */
isActive?(buildingId: number): boolean;
```
Et, pour éviter que le module ne découvre les poses par comparaison de listes à chaque tick (voir §2) :
```ts
// src/sim/plugins/types.ts — dans SimPlugin
/** Après l'insertion d'un bâtiment. `origin` : 'commande' (placeBuilding du joueur), 'lot' (buildCity), 'chargement'. */
onBuildingAdded?(ctx: PluginContext, buildingId: number, origin: 'commande' | 'lot' | 'chargement'): void;
/** Avant le retrait d'un bâtiment (démolition du joueur ou chargement). */
onBuildingRemoved?(ctx: PluginContext, buildingId: number): void;
```

### Patch proposé (à appliquer tel quel ; `active` vaut 1 par défaut : aucune partie existante ne change)

```diff
--- a/src/sim/ecs.ts
+++ b/src/sim/ecs.ts
@@ class BuildingStore
   /** 1 si une route passe devant la façade (accès véhicules/piétons), recalculé par le monde. */
   roadAccess: Uint8Array;
+  /**
+   * 1 si le bâtiment est en service. 0 pendant un chantier (phase 2) : le bâtiment n'a pas d'accès
+   * route effectif (`roadAccess` vaut alors 0), donc il ne loge, n'emploie et ne produit rien.
+   */
+  active: Uint8Array;
@@ constructor
     this.roadAccess = new Uint8Array(capacity);
+    this.active = new Uint8Array(capacity);
@@ private grow()
     this.roadAccess = growU8(this.roadAccess, n);
+    this.active = growU8(this.active, n);
@@ add(...)  // juste après this.roadAccess[i] = 0;
     this.roadAccess[i] = 0;
+    this.active[i] = 1;
@@ remove(...)  // avec les autres permutations
     this.roadAccess[i] = this.roadAccess[last]!;
+    this.active[i] = this.active[last]!;
```

```diff
--- a/src/sim/world.ts
+++ b/src/sim/world.ts
@@ private insertBuilding(r: BuildingRecord, silent = false): void
-    this.buildings.roadAccess[bi] = this.computeRoadAccess(bi) ? 1 : 0;
-    this.economy.addUpkeep(asset.upkeepPerMonth, 'buildings');
+    this.buildings.roadAccess[bi] = this.computeRoadAccess(bi) ? 1 : 0;
+    if (this.buildings.active[bi]) this.economy.addUpkeep(asset.upkeepPerMonth, 'buildings');
     this.demography?.onBuildingAdded(r.id, this.clock.totalMinutes);
     this.trafficBuildingsDirty = true;
     this.jobsDirty = true;
     if (!silent) this.pendingBuildingsAdded.push({ ...r });
+    this.plugins.onBuildingAdded(r.id, silent ? 'chargement' : this.inBatch ? 'lot' : 'commande');
   }
+
+  /**
+   * Portail d'activité des bâtiments (modules de phase 2, chantiers). Un bâtiment inactif perd son accès
+   * route effectif : la démographie et l'économie l'ignorent partout, sans condition supplémentaire.
+   */
+  setBuildingActive(id: number, active: boolean): boolean {
+    const bi = this.buildings.indexOf(id);
+    if (bi < 0) return false;
+    const v = active ? 1 : 0;
+    if (this.buildings.active[bi] === v) return true;
+    this.buildings.active[bi] = v;
+    const asset = this.catalog!.assets[this.buildings.assetIndex[bi]!]!;
+    if (active) this.economy.addUpkeep(asset.upkeepPerMonth, 'buildings');
+    else {
+      this.economy.removeUpkeep(asset.upkeepPerMonth, 'buildings');
+      // Occupants évacués comme à la démolition (relogement si possible), le bâtiment restant en place.
+      this.demography?.onBuildingRemoved(id, this.clock.totalMinutes);
+    }
+    this.buildings.roadAccess[bi] = active && this.computeRoadAccess(bi) ? 1 : 0;
+    this.demography?.markCoverageDirty();
+    this.trafficBuildingsDirty = true;
+    this.jobsDirty = true;
+    return true;
+  }
@@ private computeRoadAccess(bi: number): boolean
   private computeRoadAccess(bi: number): boolean {
+    if (!this.buildings.active[bi]) return false;
     const o = this.obbs.get(this.buildings.id[bi]!);
@@ demolish(a: CommandArgs<'demolish'>)
     const asset = this.catalog!.assets[this.buildings.assetIndex[i]!]!;
+    const wasActive = this.buildings.active[i] === 1;
     this.obbs.delete(a.buildingId);
     const displaced = this.buildings.residents[i]!;
+    this.plugins.onBuildingRemoved(a.buildingId);
     this.demography?.onBuildingRemoved(a.buildingId, this.clock.totalMinutes);
     this.buildings.remove(a.buildingId);
     this.buildingIndex.remove(a.buildingId);
-    this.economy.removeUpkeep(asset.upkeepPerMonth, 'buildings');
+    if (wasActive) this.economy.removeUpkeep(asset.upkeepPerMonth, 'buildings');
```
`applySave` : rien à faire, les bâtiments sont réinsérés actifs puis le module remet en chantier ceux de sa
section (`setActive(id, false)` au `load`).

`inBatch` : drapeau privé de `Simulation` mis à vrai pendant `runExt('buildCity')` (une ligne au début et à
la fin du `case 'buildCity'`), pour que la ville de démonstration n'ouvre pas 400 chantiers.

```diff
--- a/src/sim/plugins/host.ts
+++ b/src/sim/plugins/host.ts
@@ const buildings: PluginBuildings = {
       query: (x0, z0, x1, z1, out) => sim.buildingIndex.query(x0, z0, x1, z1, out),
+      setActive: (id, active) => sim.setBuildingActive(id, active),
+      isActive: (id) => { const i = sim.buildings.indexOf(id); return i >= 0 && sim.buildings.active[i] === 1; },
     };
@@ (nouveaux relais, sur le modèle de onDayStart)
+  onBuildingAdded(id: number, origin: 'commande' | 'lot' | 'chargement'): void {
+    for (const p of this.plugins) if (p.onBuildingAdded) this.guard(p, 'onBuildingAdded', () => p.onBuildingAdded!(this.ctx(p), id, origin), undefined);
+  }
+  onBuildingRemoved(id: number): void {
+    for (const p of this.plugins) if (p.onBuildingRemoved) this.guard(p, 'onBuildingRemoved', () => p.onBuildingRemoved!(this.ctx(p), id), undefined);
+  }
```

### Vérification attendue côté cœur
- `tests/plugins/plugins.test.ts` : la simulation reste identique tick à tick sans module (aucun appel au portail) ;
- nouveau test : bâtiment résidentiel désactivé → `demography.report().housingCapacity` diminue d'autant,
  `economy.buildingUpkeep` perd son entretien, les habitants sont relogés ou partent ; réactivé → tout revient.
- Le module chantiers apporte déjà ses propres tests (`tests/chantiers/`), dont un qui passe dans les deux
  configurations (avec et sans portail).

---

## 1bis. Rendu : API de visibilité des bâtiments de base (non bloquante, fortement souhaitée)

### Besoin
Le bâtiment est envoyé au rendu dès sa pose : le rendu de base (`src/render/buildings/renderer.ts`,
`InstancedBuildingRenderer`) l'affiche donc achevé pendant tout le chantier. Le module doit le cacher jusqu'aux
façades, puis le laisser apparaître.

### Repli actuel (sans modification du rendu de base)
`src/render/construction/mask.ts` retrouve le groupe « batiments » de la scène et met à zéro la partie linéaire des
matrices d'instance des bâtiments en chantier, à chaque image, après `buildings.update()`. C'est fragile par
nature (dépend des noms de lots et de la disposition interne) mais sans risque : si la structure change, le
masque ne fait plus rien et le bâtiment redevient simplement visible.

### API demandée
```ts
// src/render/plugins/types.ts — dans le contexte passé à RenderPlugin.init
buildings?: {
  /** Cache (ou réaffiche) les instances de ces bâtiments, ombres comprises. Ids inconnus ignorés. */
  setBuildingsVisible(ids: readonly number[], visible: boolean): void;
};
```
Implémentation suggérée dans `InstancedBuildingRenderer` : un `Set<number>` de bâtiments cachés consulté à
l'écriture des matrices (matrice nulle, comme pour une instance libérée) et un drapeau « matrices sales ». Le
module détecte l'API (`typeof ctx.buildings?.setBuildingsVisible === 'function'`) et désactive alors son repli
(`BuildingMask.usingApi`, visible dans `window.__aube.chantiers().masqueApi`).

---

## 2. Demandes secondaires (confort, non bloquantes)

1. **`onBuildingAdded` / `onBuildingRemoved`** (diff ci-dessus). Sans eux, le module compare à chaque tick une
   signature des identifiants de bâtiments (O(n) sans allocation, mesuré < 0,05 ms pour 2 000 bâtiments) et ne
   peut pas distinguer une pose du joueur d'une arrivée en lot autrement que par l'instantané qui suit. Cela
   fonctionne, mais le crochet est plus sûr et moins coûteux.
2. **Démolition différée.** Aujourd'hui `demolish` retire le bâtiment immédiatement et rembourse 25 %. Le module
   affiche donc une démolition animée *après* la disparition du bâtiment (gravats, engins, palissade, puis
   terrain nu). C'est volontaire et cohérent, mais si le propriétaire veut voir le bâtiment s'effondrer
   progressivement, il faut que le cœur accepte un retrait en deux temps (`demolish` → bâtiment inactif marqué
   « en démolition », retrait effectif à la fin). À arbitrer en phase 2B avec le module bâtiments.
3. **Coût étalé.** Le coût de construction est débité en une fois à la pose. Un étalement par phase (acomptes)
   demanderait un accès en écriture à l'économie : hors mission, à décider en 2B (fiscalité/budget).
4. **Garde-fou d'architecture** (`tests/unit/architecture.test.ts:20`). La regex `from '../(render|client|ui|input|save)'`
   vise le dossier `src/save/` (côté navigateur) mais attrape aussi `src/sim/save-sections/` importé depuis
   `src/sim/plugins/` (`'../save-sections/chantiers'`), qui est bien côté simulation. Le module contourne avec
   `'../../sim/save-sections/…'`. Correctif proposé : `/from\s+['"]\.\.\/(render|client|ui|input|save)(['"\/])/`
   (ne vise que le dossier exact `save`).

---

## 3. Ce que le module ne demande pas
Aucune modification de `src/shared/protocol.ts`, `src/shared/contracts.ts`, du format de sauvegarde de base
(`SAVE_FORMAT_VERSION` inchangé), de `src/input/**` (l'outil de pose reste celui de la phase 1) ni du rendu de
base. Tout passe par `delta.ext.chantiers`, `snapshot.ext.chantiers`, `save.plugins.chantiers` et `pluginCommand`.
