# Contrat municipal (phase 2B, sous-étape 1)

Socle commun des systèmes de gestion (économie, fiscalité, électricité, eau, déchets, services) : grilles
d'indicateurs par cellule, graphe de réseau générique, lignes budgétaires, registre d'effets traçable,
ordonnanceur multi-fréquence. TypeScript pur (aucun import de three ni du DOM), exécuté dans le worker de
simulation, déterministe, sérialisable.

| Fichier | Rôle |
|---|---|
| `src/shared/municipal/types.ts` | types partagés (indicateurs, réseaux, budget, effets, delta / commandes) |
| `src/shared/municipal/indicators.ts` | spécifications des 11 indicateurs standard |
| `src/sim/municipal/grid.ts` | `IndicatorGrid` : une grille Float32Array, lecture / écriture bornées, émission, diffusion |
| `src/sim/municipal/grids.ts` | `IndicatorGrids` : registre des grilles d'une partie, résolution, propagation, couplages |
| `src/sim/municipal/network.ts` | `ResourceNetwork` / `Networks` : graphe, répartition offre / demande, délestage |
| `src/sim/municipal/budget.ts` | `BudgetLedger` : lignes par poste / service / quartier, miroir de l'économie |
| `src/sim/municipal/effects.ts` | `EffectRegistry` : causes, effets, requêtes, synthèses |
| `src/sim/municipal/scheduler.ts` | `MultiRateScheduler` : tâches par tick / heure / jour / mois |
| `src/sim/municipal/municipal.ts` | `Municipal` : façade d'une partie (service `municipal`) |
| `src/sim/municipal/plugin.ts` | `createMunicipalPlugin()` / `municipalPlugin` : le `SimPlugin` `municipal` |
| `src/sim/municipal/save.ts`, `src/sim/save-sections/municipal.ts` | section de sauvegarde versionnée (v1) |
| `tests/municipal/*.test.ts` | 36 tests (unitaires, intégration Simulation, tests d'effet ROADMAP §4) |

Enregistrement dans `SIM_PLUGINS` / `SAVE_SECTIONS` : diff prêt dans `docs/requests/municipal.md` (non appliqué :
le test superviseur des registres fige la liste à 4 modules vides).

## 1. Accès depuis un module

Le module `municipal` publie dans `init` un objet `Municipal` **stable pendant toute la session** (son contenu est
remplacé en place à chaque nouvelle partie / chargement) :

```ts
import { MUNICIPAL_SERVICE, type Municipal } from '../municipal';

init(ctx) {
  const m = ctx.use<Municipal>(MUNICIPAL_SERVICE);   // undefined si `municipal` n'est pas enregistré
  if (!m) return;                                     // prévoir un repli
  m.scheduler.add({ id: 'monmodule:calcul', every: 'hour', run: (info) => { /* … */ } });
},
onNewGame(ctx) {
  // Grilles, réseaux, couplages : à (re)définir à chaque partie (la sauvegarde les restaure ensuite).
  ctx.use<Municipal>(MUNICIPAL_SERVICE)?.grids.ensure('pollution_air');
},
```

Les tâches sont enregistrées une fois (`init`) et conservées d'une partie à l'autre ; `add` lève si l'identifiant
existe déjà. Préfixer les identifiants (tâches, indicateurs de module, couplages) par l'id du module.

Contrat inutilisé (aucune grille, aucun réseau, aucune ligne, aucune cause) : aucun `delta.ext.municipal`, aucune
section de sauvegarde, aucune écriture dans l'état de base — simulation identique tick à tick (test
`plugin.test.ts` « contrat inutilisé »).

## 2. Grilles d'indicateurs

Géométrie : `originX/originZ` (coin, m), `cellSize` (m), `cols × rows`. Par défaut la carte entière en cellules
de 32 m (`DEFAULT_CELL_SIZE`, carte 2 048 m → 64 × 64 = 4 096 cellules = 16 Kio par indicateur) ; réglable par
`createMunicipalPlugin({ cellSize })` ou `grids.setDefaultGeometry(g, resample = true)` (rééchantillonnage
bilinéaire). Index de cellule `j·cols + i`.

Indicateurs standard (`STANDARD_INDICATORS`) : `pollution_air`, `pollution_sol`, `pollution_eau`, `bruit`,
`valeur_fonciere` (¢/m², fond 100), `couverture_sante|education|police|incendie` (0..1), `criminalite`,
`satisfaction` (fond 50). Indicateur propre à un module : `module:nom` avec une spécification complète.

```ts
const air = m.grids.ensure('pollution_air');                 // créée à la demande, spec standard
m.grids.ensure('elec:tension', { nameFr: 'Tension', unit: 'V', base: 230, min: 0, max: 400 });
air.stamp(x, z, 60, 6, 'linear');   // émission locale, renvoie la somme ajoutée
air.addAt(x, z, 2); air.setAt(x, z, 10);   // écritures bornées à [min, max], NaN -> fond
air.at(x, z); air.sample(x, z); air.meanIn(x, z, 200); air.stats();   // lectures
m.grids.read('valeur_fonciere', x, z);    // fond standard si la grille n'existe pas
```

Propagation (`DiffusionSpec`, appliquée par la tâche intégrée `municipal:propagation:<fréquence>`) : diffusion
explicite à 4 voisins (`rate` ≤ 0,25), transport amont facultatif (`advectX/Z`, vent ou aval), atténuation vers
le fond (`decay`), `steps` pas par échéance, bords `closed` (masse conservée) ou `open` (fuite vers le fond).
Stabilité vérifiée : `4·rate + |advectX| + |advectZ| ≤ 1`. Aucune allocation par pas (tampon réutilisé).

Couplages : `to += factor · (from − fromRef)` à une fréquence donnée, cellule par cellule.

```ts
m.grids.addCoupling({ id: 'air->foncier', from: 'pollution_air', to: 'valeur_fonciere', factor: -0.05, every: 'day' });
```

## 3. Réseaux (électricité, eau, égouts…)

```ts
const net = m.networks.ensure('electricite');
const centrale = net.addNode({ role: 'producer', capacity: 120, cost: 20, x, z, ref: buildingId });
const poste = net.addNode({ role: 'junction', x, z });
const hopital = net.addNode({ role: 'consumer', demand: 50, priority: 10, x, z, ref: id });
const maison = net.addNode({ role: 'consumer', demand: 3, priority: 0, allOrNothing: true });
net.addEdge(centrale, poste, 500 /* capacité */, 0.02 /* pertes */);
const r = m.networks.allocate('electricite');   // NetworkReport, conservé dans lastReport()
```

Édition : `updateNode` / `setDemand` / `setCapacity` / `setNodeEnabled` (panne), `updateEdge` / `setEdgeEnabled`,
`removeNode` (retire les arêtes), `removeEdge`, `components()`.

Répartition (`allocate`, déterministe, n'altère pas le réseau) :
1. consommateurs en service triés par priorité décroissante puis identifiant ;
2. pour chacun, chemins augmentants : Dijkstra depuis le consommateur sur les arêtes en service à capacité
   résiduelle, coût `−ln(1 − pertes)` ; producteur appelé = plus petit `cost` (ordre de mérite) ayant de la
   capacité, puis chemin le moins dissipatif, puis plus petit id ;
3. envoi `x = min(capacité restante, besoin / M, min_k résiduel_k / m_k)` ; le consommateur reçoit `x·M` ;
4. consommateur `allOrNothing` incomplet : annulé, ses flux sont rendus ;
5. le reste est délesté → les priorités basses sont coupées en premier.

Bilan : `supply`, `demand`, `delivered`, `produced`, `losses`, `shortfall`, par consommateur (`delivered`, `ratio`,
`shed`), par producteur (`output`), par arête (`flow` signé a→b, `load`), `shedByPriority`.
Limite connue : glouton sans annulation de flux (pas d'arcs résiduels inverses) — pas toujours le flot maximal sur
un maillage complexe ; capacités, pertes et priorités sont toujours respectées. Coût O(augmentations · E log V) ;
mesure indicative (tests, Node, conteneur cloud) : arbre de 2 000 consommateurs réparti sous la borne de 2 s du test.

## 4. Budget

```ts
m.budget.post('income', 'vente:electricite', 1200, 'electricite', 'centre');   // poste, service, quartier
m.budget.postByDistrict('expense', 'entretien:canalisations', 900, { nord: 2, sud: 1 }, 'eau'); // centimes exacts
m.budget.pendingModuleBalance();   // solde des lignes de modules du mois en cours
m.budget.history; m.budget.lastMonth; m.budget.groupBy('service' | 'category' | 'district', mois);
```

Tâche intégrée `municipal:budget` (mois, après les tâches des modules) : recopie le bilan de l'économie de base si
une source est branchée (`economySource`, alimentée par `ctx.economy.lastMonth()` dès que le cœur l'expose —
`docs/requests/municipal.md` §3.1) puis clôt le mois (`BudgetMonth` : lignes, `mirroredBalance` = part recopiée,
déjà appliquée par le cœur ; `moduleBalance` = part des modules, **pas encore appliquée** à la trésorerie, §3.2).
Le miroir ne modifie aucun montant : trésorerie et historique de l'économie identiques avec ou sans le module (test).

## 5. Registre d'effets

```ts
const cause = m.effects.cause({ kind: 'fermeture_centrale', label: 'Fermeture de la centrale', source: 'joueur', at: t, x, z, ref });
m.effects.record(cause, 'electricite:livre', -45, 'kW', t, { x, z, radius: 0 }, 'priorité 0');
const before = grid.copyValues(); /* … action … */ m.effects.measureGrid(cause, grid, before, t);
m.effects.query({ cause, target, x, z, radius, district, since, limit });   // du plus récent au plus ancien
m.effects.summary(cause); m.effects.topCauses(10);   // cumuls par cible, conservés hors tampon
```

Tampon borné (4 096 effets, 1 024 causes par défaut). Les nouveaux effets partent dans `delta.ext.municipal.effects`.

## 6. Ordonnanceur multi-fréquence

`m.scheduler.add({ id, every: 'tick' | 'hour' | 'day' | 'month', order?, run(info) })` ; `info` = `{ freq,
totalMinutes, minutes, index }`. Le module alimente l'ordonnanceur depuis le planificateur de base : `onMonthStart`
→ `month`, `onDayStart` → `day` (événements `MonthStart` / `DayStart` de `src/sim/scheduler.ts`), `onTick` →
`advance` (une exécution horaire par heure franchie, rattrapage compris, puis les tâches par tick). Ordre dans un
tick : mois → jour → heures → tick ; dans une fréquence : `order` croissant (défaut 0 ; tâches intégrées 1000) puis
ordre d'ajout. Une échéance n'est jamais rejouée (état sauvegardé). Tâche en erreur : isolée, comptée
(`stats()` : exécutions, erreurs, temps mural cumulé / max — diagnostic, sans effet sur la simulation).

## 7. Protocole et sauvegarde

`delta.ext.municipal` (`MunicipalDelta`, seulement quand le contenu a changé) : statistiques des grilles, derniers
bilans de réseau, effets récents, dernier mois budgétaire. `snapshot.ext.municipal` : idem avec les 50 derniers
effets. Commandes `pluginCommand { plugin: 'municipal', name, payload }` : `indicators`, `grid { id }` (copie
Float32Array), `effects { cause?, target?, x?, z?, radius?, since?, limit? }`, `causes { limit? }`,
`budget { months?, groupBy? }`, `network { kind }`.

Sauvegarde `save.plugins.municipal = { v: 1, data }` : grilles (Float32 en base64, exact), couplages, réseaux,
budget, effets, échéances. Évolution : incrémenter `MUNICIPAL_SAVE_VERSION`, ajouter `STEPS[v]` dans
`src/sim/municipal/save.ts` et un test. Section illisible : l'hôte notifie, le module repart à neuf, le reste de la
partie est chargé (test).

## 8. Exemple : brancher le futur module « électricité »

```ts
// src/sim/plugins/electricite.ts (sous-étape 2B-4)
let nodeOf = new Map<number, number>();   // bâtiment -> nœud
export const electricitePlugin: SimPlugin = {
  id: 'electricite',
  init(ctx) {
    const m = ctx.use<Municipal>(MUNICIPAL_SERVICE)!;
    // 1. Demande et répartition chaque heure (courbe de charge selon l'heure).
    m.scheduler.add({ id: 'electricite:repartition', every: 'hour', run: (info) => {
      syncNetwork(ctx, m);                              // nœuds = centrales / bâtiments, arêtes = lignes
      const r = m.networks.allocate('electricite');
      for (const c of r.consumers) if (c.shed) markOutage(c.node);   // coupures visibles
      if (r.shortfall > 0 && !shortageCause) shortageCause = m.effects.cause({ kind: 'penurie', label: 'Pénurie électrique', source: 'electricite', at: info.totalMinutes });
    } });
    // 2. Recettes / coûts au mois (lignes par service et par quartier).
    m.scheduler.add({ id: 'electricite:budget', every: 'month', run: () => {
      m.budget.post('expense', 'entretien:centrales', upkeep(), 'electricite');
      m.budget.postByDistrict('income', 'vente:electricite', sold(), districtWeights(), 'electricite');
    } });
  },
  onNewGame(ctx) {
    nodeOf = new Map();
    ctx.use<Municipal>(MUNICIPAL_SERVICE)!.grids.ensure('elec:couverture', { nameFr: 'Desserte électrique', unit: 'part', base: 0, min: 0, max: 1 });
  },
  // Décision du joueur (commande) : fermer une centrale = cause + panne, l'effet est mesuré à l'heure suivante.
  command(ctx, name, p) { /* m.effects.cause(...); net.setNodeEnabled(id, false); */ return { ok: true }; },
};
```

La topologie (réseau, couplages) est sauvegardée par le contrat ; l'état propre au module (`nodeOf`) dans sa
propre section. Les tests d'effet du module suivront le modèle de `tests/municipal/effets.test.ts` (pénurie →
délestage des moins prioritaires, tracé dans le registre).

## 9. Preuves (2026-11-13)

`npm run typecheck` ✓ ; `npm test` 200/200 (dont 36 dans `tests/municipal`) ; `npm run build` ✓ ;
`npm run e2e` (Chromium SwiftShader) SUCCÈS.
