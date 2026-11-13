# Demandes de l'agent BÂTIMENTS & QUARTIERS (branche `claude/p2a-batiments`)

Modules livrés : `src/sim/districts/**` (générateur de quartiers, pur), `src/sim/plugins/batiments.ts`,
`src/shared/protocol-ext/batiments.ts`, `src/sim/save-sections/batiments.ts`, `src/render/plugins/batiments.ts`,
`src/ui/panels/batiments.ts`, `tests/batiments/**`, plus les outils d'assets (`tools/buildings/**`).
Le jeu compile, tourne et se charge sans aucune de ces demandes : elles ne font que **brancher** ce qui est déjà
écrit et testé derrière l'API proposée.

## 1. API d'écriture pour les modules (bloquant pour `applyDistrict` / `applyProposal`)

`PluginContext` est en lecture seule : un module peut PLANIFIER un quartier mais pas le construire. Tout est
implémenté derrière l'interface suivante (`src/sim/districts/apply.ts`), déjà utilisée par le plugin et les tests :

```ts
export type ActionOutcome<T> = { ok: true; data: T } | { ok: false; error: CommandError };

export interface DistrictActions {
  buildRoad(a: CommandArgs<'buildRoad'>): ActionOutcome<CommandResult<'buildRoad'>>;
  placeBuilding(a: CommandArgs<'placeBuilding'>): ActionOutcome<CommandResult<'placeBuilding'>>;
  demolish(a: CommandArgs<'demolish'>): ActionOutcome<CommandResult<'demolish'>>;
}
```

Ce sont **exactement** les signatures de `Simulation.buildRoad / placeBuilding / demolish` : un module ne
construit donc rien que le joueur ne puisse construire (mêmes validations : pente, eau, collisions, fonds, accès
route ; mêmes coûts ; mêmes deltas vers le rendu). `dryRun` est déjà dans `CommandArgs` et reste disponible.

**Demande (au choix du superviseur, la première est la moins intrusive) :**

1. **Service publié par le cœur** — dans `PluginHost` (ou `Simulation.setCatalog`), publier une fois :
   ```ts
   host.provideCore('sim.actions', {
     buildRoad: (a) => sim.buildRoad(a),
     placeBuilding: (a) => sim.placeBuilding(a),
     demolish: (a) => sim.demolish(a),
   } satisfies DistrictActions);
   ```
   Le module le consomme déjà : `ctx.use<DistrictActions>('sim.actions')` (constante `ACTIONS_SERVICE` dans
   `src/sim/plugins/batiments.ts`). Tant que le service est absent, `applyDistrict` et `applyProposal` renvoient
   `NOT_IMPLEMENTED` avec la marche à suivre — aucun autre comportement n'est affecté.
   Remarque : `provide` étant aujourd'hui ouvert à tous les modules, un module tiers pourrait usurper le nom
   `sim.actions` ; un `provideCore` réservé à l'hôte (noms préfixés `sim.`) évite ce risque.
2. **Ou** champ facultatif `PluginContext.actions?: DistrictActions`, alimenté par `host.makeContext`.

**Point à arbitrer (propriétaire)** : les constructions faites par un module doivent-elles être payées par la
ville (comportement actuel de l'implémentation : oui, coût normal, refus si fonds insuffisants) ou gratuites
(outil d'édition / scénario) ? Si une variante gratuite est voulue, proposer `placeBuilding({ …, free?: true })`
réservé aux appels internes (jamais accepté depuis le protocole, cf. `validateCommandMessage`).

## 2. Test commun `tests/plugins/plugins.test.ts` (bloquant pour `npm test`)

Le test « registres » affirme `assert.deepEqual(Object.keys(p), ['id'])` pour **chaque** module de `SIM_PLUGINS`
(« plugin vide attendu »). Cette assertion est par construction incompatible avec tout module de phase 2A dès
qu'il est rempli (bâtiments, circulation, piétons, chantiers). Demande : la remplacer par une vérification de
forme, par exemple
```ts
for (const p of SIM_PLUGINS) assert.equal(typeof p.id, 'string');
```
et conserver, comme garde-fou réel, le test « modules vides : simulation identique tick à tick » (il passe avec le
module bâtiments : sans quartier enregistré, celui-ci n'écrit aucun delta, aucun instantané, aucune section de
sauvegarde et ne tire rien sur le PRNG de base).

## 3. Interface (refonte §1bis)

`src/ui/panels/batiments.ts` fournit `mount(root, api)` complet (liste des quartiers, propositions, bascules,
formulaire de planification). Il attend seulement d'être monté par la future barre latérale, avec les trois
services de `UiPanelApi` (`command`, `onDeltaExt`, `snapshotExt`, `toast`) — aucun changement d'API demandé.
Styles : le panneau n'utilise que des classes (`panel-batiments`, `quartiers-*`) ; la feuille de style commune
pourra les habiller lors de la refonte.

## 4. Catalogue (information, pas de demande)

Les bâtiments procéduraux livrés par cette branche portent les tags `procedural`, `style:<id>`,
`densite:<faible|moyenne|forte|tres_forte>`, `quartier:<type>` (un ou plusieurs parmi `centre_historique`,
`faubourg`, `pavillonnaire`, `affaires`, `activites`, `grands_ensembles`) et `mitoyen` (murs latéraux aveugles).
Les 40 bâtiments de la phase 1 n'ayant pas ces tags, `src/sim/districts/profiles.ts` contient une table de repli
par identifiant puis par catégorie : le générateur de quartiers fonctionne avec l'ancien comme avec le nouveau
catalogue, sans aucune modification des entrées existantes.
