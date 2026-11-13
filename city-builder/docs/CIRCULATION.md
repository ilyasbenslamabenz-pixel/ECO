# Circulation — simulation du trafic, feux et congestion

Module de phase 2A (branche `claude/p2a-circulation`). Code : `src/sim/traffic/**`,
`src/render/vehicles/**`, `src/render/traffic/**`, `tools/vehicles/**`, et les fichiers de module
`src/sim/plugins/circulation.ts`, `src/shared/protocol-ext/circulation.ts`,
`src/sim/save-sections/circulation.ts`, `src/render/plugins/circulation.ts`, `src/ui/panels/circulation.ts`.
Tests : `tests/circulation/**`, `tests/vehicles/**`.

## 1. Chaîne de simulation

| Étage | Fichier | Rôle |
|---|---|---|
| Entrée | `traffic/adapters.ts` | réseau routier courbe → description neutre (polylignes, voies, **lignes d'arrêt et passages piétons aux cotes du marquage peint**) |
| Graphe | `traffic/network.ts` | voies, connecteurs de carrefour (Bézier), conflits géométriques, branches (`leg`) et passages, régimes et phases |
| Itinéraires | `traffic/router.ts` | A\* sur les ARCS (tronçon, sens), coût = temps libre + retard observé **par sens** + pénalité de carrefour |
| Poursuite | `traffic/idm.ts` | IDM (Treiber) ; profils par type de véhicule |
| Changement de voie | `traffic/mobil.ts` | MOBIL asymétrique (règle européenne) : sécurité, politesse, biais vers la droite, seuil |
| Boucle | `traffic/system.ts` | SoA sans allocation : feux, demandes d'accès aux carrefours, MOBIL, déplacement, demande, statistiques, réacheminement |

Un pas dure 0,1 s de temps physique (`step(dt, hour)`), appelé une fois par tick de simulation.

### Carrefours

Régime déduit du réseau : impasse, aucun, **priorité à droite**, **cédez-le-passage** (rangs des voies),
**feux à phases** (bras opposés groupés, vert proportionnel au nombre de voies, orange 3 s, rouge intégral 2 s).
Chaque véhicule qui approche demande l'accès ; les demandes d'un carrefour sont triées (engagé, forçage
anti-famine, priorité, tourne-à-gauche, temps d'arrivée) puis arbitrées :

1. faisabilité (feu, sortie dégagée, connecteur libre, **piétons annoncés**) ;
2. priorités (droite, rang, tourne-à-gauche permissif) ;
3. **réservation des trajectoires en conflit** : deux manœuvres sécantes ne sont jamais accordées au même pas ;
4. déblocage : si personne ne passe depuis 3 s, le véhicule qui attend le plus est autorisé.

### Anti-blocage et réacheminement

- Interdiction de s'engager si la sortie est bouchée ; engagement irrévocable si l'arrêt est impossible.
- Voie qui ne mène plus à l'itinéraire (changement de voie raté) : itinéraire de secours par la meilleure
  manœuvre disponible après 12 s d'attente (`stats.unblocked`).
- Réacheminement : quelques véhicules par pas réexaminent leur trajet avec les retards observés et changent
  pour un gain net ≥ max(6 s, 8 %) (`stats.rerouted`). Réglable (panneau, commande `reglages`).
- Dernier recours : véhicule immobile depuis 150 s retiré (`stats.removedStuck`).

## 2. API des feux pour les piétons (service `feux`)

Publiée par le module de simulation : `ctx.provide('feux', api)`. Côté consommateur :

```ts
import { FEUX_SERVICE, FEU_VERT, type FeuxApi } from '../../shared/protocol-ext/circulation';

const feux = ctx.use<FeuxApi>(FEUX_SERVICE);
if (!feux) { /* module circulation absent : traversée prudente */ }
else {
  const passages = feux.crossingsNear(x, z, 25);          // passages autour d'un piéton
  const p = passages[0];
  if (p && (!p.controlled || p.walk === FEU_VERT) && p.remaining > 6) {
    feux.announcePedestrians(p.id, 8);                     // les véhicules cèdent pendant 8 s
    // … engager la traversée de (p.ax, p.az) vers (p.bx, p.bz)
  }
}
```

| Membre | Contenu |
|---|---|
| `version` | change à chaque reconstruction du réseau (invalider les caches) |
| `crossings()` / `crossing(id)` / `crossingsNear(x, z, r)` | `CrossingState` : `walk` (vert/orange/rouge **piéton**), `remaining` (s), `vehicle` (feu du bras, −1 si non régulé), `controlled`, centre `x/y/z`, extrémités `ax/az` → `bx/bz`, `widthM` |
| `junctions()` / `junction(id)` | `FeuJunctionState` : phases, phase et étape courantes, temps restant, et par bras : état, temps restant, cap d'arrivée, identifiant de passage |
| `announcePedestrians(id, s)` | annonce des piétons sur un passage (≤ 30 s) : les véhicules qui le franchissent, à l'entrée comme à la sortie du carrefour, s'arrêtent avant |

Règle des feux piétons : le passage d'un bras est **rouge** tant que ce bras (et les mouvements directs
qui l'empruntent) ont le vert ; il passe au **vert** dès que la phase conflictuelle est terminée, puis à
l'**orange** (dégagement) `largeur / 1,2 m·s⁻¹ + 2 s` avant le retour du vert véhicules. Carrefour sans
feux : `controlled = false`, `walk = vert` (au piéton d'être prudent), les véhicules cèdent quand même
aux piétons annoncés s'ils peuvent encore s'arrêter.

Identifiants stables : `crossingId = idTronçon × 2 + (0 extrémité a | 1 extrémité b)`.

## 3. Carte de congestion

`delta.ext.circulation` / `snapshot.ext.circulation` (types dans `protocol-ext/circulation.ts`) :

- `layout` : polylignes des tronçons et demi-largeurs — envoyé **une fois par version de réseau** (transféré) ;
- `congestion` : `edgeIds`, `density` (véh/km/voie), `speed` (m/s), `ratio` (observé / libre), `level` 0-3 —
  envoyé ≈ 1 fois par seconde réelle (transféré) ;
- `stats` : indicateurs du panneau ; `overlay` : affichage demandé.

Rendu : `src/render/traffic/congestion.ts` construit **un seul maillage** (rubans translucides au-dessus de
la chaussée) et ne met à jour que les couleurs de sommets. Palette commune à la légende du panneau
(`CONGESTION_COLORS`). Masqué par défaut, affiché par la commande `afficherCongestion`.

## 4. Commandes du module (`pluginCommand { plugin: 'circulation', … }`)

| Nom | Charge utile | Résultat |
|---|---|---|
| `stats` | — | `CirculationStats` |
| `congestion` | — | `CongestionFrame` |
| `feux` | — | `FeuJunctionState[]` |
| `passages` | `{ x?, z?, radius? }` | `CrossingState[]` |
| `afficherCongestion` | `{ on }` | `{ on }` |
| `reglages` | `{ reroute?, demandScale? }` | `{ reroute, demandScale }` |

## 5. Sauvegarde

Section versionnée `save.plugins.circulation` (v1) : état de chaque carrefour à feux (nœud, phase, étape,
chronomètre) et réglages. Les véhicules ne sont pas sauvegardés (déplacements en cours, régénérés par la
demande). Une sauvegarde **sans** la section se charge normalement (feux repartis du réseau), et une section
illisible est signalée sans empêcher le chargement. L'état des feux survit aussi à une modification du réseau
en cours de partie (un chantier ailleurs ne remet pas tous les carrefours à zéro).

## 6. Plaques d'immatriculation

`tools/vehicles/textures.ts` génère une **planche** de `PLATE_ROWS` (24) plaques différentes
(`vehicules_plaques_*.webp`, format européen `XX-123-YY`, bande d'identification, caractères embossés).
Chaque GLB porte un sous-maillage de rôle `plaque` dont les UV couvrent la première bande ; le rendu
(`src/render/vehicles/renderer.ts`) ajoute un attribut d'instance `aPlaque` et décale `vMapUv.y` d'une bande
par véhicule : toute la flotte partage un matériau et un draw call par lot. 24 numéros tirés par identifiant
de véhicule : deux véhicules peuvent porter le même numéro (constaté en capture), mais deux voisins
rarement (sonde e2e : 24 bandes distinctes utilisées sur ≈ 230 instances).

Régénération : `npx tsx tools/vehicles/build.ts` (écrit `assets/vehicles/**` et
`assets/catalog.vehicles.json`), puis fusion dans `assets/catalog.json` par `npm run assets`.

## 7. Banc de charge

```
npx tsx tests/circulation/bench.ts --vehicles=2000 --ticks=600 --grid=14
```

Écrit `tests/e2e/out/perf/circulation-bench.json` (véhicules, réseau, temps par tick moyen / médian / p95 /
max, vitesse moyenne, réseau saturé, distance minimale entre véhicules, matériel exact). Mesure **processeur
seul** (aucun rendu) : contrairement aux images par seconde sous SwiftShader, ces chiffres sont représentatifs.

Mesures du 2026-11-13 (Xeon 2,1 GHz, 4 cœurs, Node 22) : grille 14 (364 tronçons, 88 carrefours à feux) —
tick moyen **1,27 ms**, p95 **1,87 ms**, max 4,5 ms ; grille 22 (924 tronçons, 228 à feux) — moyen **1,58 ms**,
p95 **3,26 ms**, max 6,9 ms. Budget du pas de simulation : 100 ms.

## 8. Feux stop et clignotants

La simulation pose les bits d'état `flags` de chaque véhicule (`TrafficSystem.move`) : `1` freinage
(décélération < −1 m/s²), `2` / `4` clignotant gauche / droit pendant un changement de voie (tant que le
décalage latéral résiduel dépasse 0,1 m, soit ≈ 2,3 s) et à moins de 35 m d'un virage (sens du connecteur
suivant, demi-tour = gauche). Le rendu les reçoit dans la trame véhicules et les passe en attribut d'instance
`aFeux` au matériau des détails : texels émissifs rouges à l'arrière renforcés au freinage, optiques du côté
indiqué (gauche = +X du modèle) virées à l'orange au rythme de ≈ 1,5 Hz. La phase n'avance que dans la boucle
d'affichage (les images forcées par `renderNow` la figent). Sonde e2e : `globalThis.__aubeVehicules.probe()`.

## 9. Captures de contrôle

`node tests/circulation/captures.mjs [--v=2000] [--demand=x] [--tag=-suffixe]` (après `npm run build`) :
ville de charge, carrefour le plus chargé, véhicule en plein changement de voie (vue rue + aérienne), carte de
congestion. Images commentées : `docs/captures-circulation/` (voir docs/requests/circulation-reprise.md).
