# Demandes du module « Circulation » (branche `claude/p2a-circulation`)

Besoins qui touchent des fichiers hors de la propriété du module (ROADMAP §1). Chaque demande indique
l'API proposée et ce qui est DÉJÀ implémenté derrière, pour que l'intégration au cœur soit mécanique.

## 1. Accès au trafic depuis `PluginContext` (bloquant pour le module, contourné)

**Besoin.** Le module `circulation` doit publier l'API des feux (`ctx.provide('feux', …)`), envoyer la carte
de congestion et répondre aux commandes du panneau. Tout cela vit dans `TrafficSystem`
(`src/sim/traffic/system.ts`), construit par `src/sim/world.ts`. `PluginContext` (façade commune, lecture
seule) n'expose ni le trafic ni la simulation.

**API proposée** (`src/sim/plugins/types.ts`, ajout rétrocompatible) :

```ts
/** Trafic en lecture seule (null hors partie). */
readonly traffic: PluginTraffic | null;
```

avec `PluginTraffic` = sous-ensemble déjà public de `TrafficSystem` :
`stats`, `signalLayoutVersion`, `signalSnapshot()`, `restoreSignals()`, `signalJunctions()`, `crossings()`,
`feuxApi()`, `announcePedestrians()`, `congestionFrame()`, `congestionLayout()`, `congestedLength()`,
`rerouteEnabled`, `demandScale`. Côté `host.ts` : `get traffic() { return sim.terrain ? sim.traffic : null; }`.

**Contournement en place.** `src/sim/traffic/registry.ts` (propriété du module) : le `TrafficSystem` construit
s'inscrit dans un registre de module, `activeTraffic()` le rend au plugin. Une seule simulation tourne par
worker, donc le comportement est correct en jeu ; en tests, plusieurs `Simulation` partagent le registre
(dernière construite). **À remplacer par `ctx.traffic` à l'intégration** : une seule ligne à changer dans
`src/sim/plugins/circulation.ts` (`function traffic()`).

## 2. Garde-fou d'architecture : `src/sim/**` ne peut pas importer `../save-sections/...`

`tests/unit/architecture.test.ts` interdit `from '../(render|client|ui|input|save)'` : le préfixe `save`
attrape aussi `../save-sections/`, qui est pourtant un dossier de la simulation que les modules DOIVENT lire
(leur section versionnée). Contournement : `src/sim/plugins/circulation.ts` importe
`'../../sim/save-sections/circulation'`. **Correctif proposé** : exiger le `/` final dans la règle,
`/from\s+['"]\.\.\/(render|client|ui|input|save)\//`.

## 3. `tests/plugins/plugins.test.ts` : contrôles « tous les modules sont vides »

Ce fichier (propriété commune) affirmait que CHAQUE module de phase 2 n'a que la clé `id`, que le registre
n'a aucun effet et que `pluginCommand` sur `circulation` répond `NOT_IMPLEMENTED`. Ces trois contrôles
deviennent faux dès qu'une branche de phase 2A livre son module. Modification minimale faite sur la branche
(à reprendre pour les autres modules) : un ensemble `IMPLEMENTED = new Set(['circulation'])`, les contrôles
« module vide » portent sur `EMPTY_PLUGINS`, et le test `NOT_IMPLEMENTED` vise `pietons` (encore vide).
Chaque branche n'a qu'à ajouter son identifiant à `IMPLEMENTED`.

## 4. Script npm du banc de charge (confort)

Le banc ≥ 2 000 véhicules est `tests/circulation/bench.ts`, lancé par `npx tsx tests/circulation/bench.ts`.
`package.json` appartient à l'architecte ; entrée proposée :
`"circulation:bench": "tsx tests/circulation/bench.ts"`.

## 5. Décor : lampadaire collé au mât d'un feu (défaut QA)

Le placement du décor des rues (lampadaires, arbres, mobilier) est calculé par
`src/render/roads/builder.ts` (`decor()`, propriété du module ROUTES) ; les feux, eux, sont posés par la
simulation (`TrafficSystem.signalLayout()`, un mât par bras, au bord droit de la chaussée à la ligne
d'arrêt) et dessinés par `src/render/traffic/signals.ts`.

Le module circulation publie désormais la position des mâts **avant** le rendu du décor :
`signalLayout()` donne pour chaque bras le pied du mât (x, y, z) et le cap. **Demande** : dans
`decor()`, supprimer tout lampadaire dont le pied est à moins de **4 m** du pied d'un mât de feu
(ou décaler le lampadaire d'un demi-intervalle). Entrée proposée pour le module ROUTES :

```ts
// src/render/roads/builder.ts — nouvel élément de BuildContext
signalPoles?: readonly { x: number; z: number }[]; // pieds des mâts de feux (monde)
```

alimenté côté rendu par la trame `signals.layout` déjà reçue (`SIGNAL_HEAD_STRIDE`, 3 premiers flottants).
Le module circulation fournit en attendant la fonction utilitaire
`signalPolePositions(layout)` (`src/render/traffic/poles.ts`) qui extrait ces positions de la trame.
