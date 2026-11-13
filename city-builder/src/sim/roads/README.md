# Module routier (simulation) — `src/sim/roads`

TypeScript pur (ni three ni DOM), exécutable dans le worker, testé en Node (`tests/roads/*.test.ts`).

| Fichier | Rôle |
|---|---|
| `types.ts` | 6 types de routes en DONNÉES : voies par sens, largeurs, terre-plein, trottoirs, vitesse, coût/m, entretien, pente max, rayon min, piétons/véhicules, croisement à niveau, espacement lampadaires/arbres |
| `bezier.ts` | Bézier cubiques XZ : évaluation, dérivées, découpe exacte (De Casteljau), abscisse curviligne, point le plus proche, rayon min, intersections courbe/courbe |
| `spatial.ts` | index spatial par cases (64 m) : snapping et croisements en O(k) |
| `network.ts` | graphe SoA (typed arrays, suppression par permutation), tronçons courbes, découpe, profils en cache, journal des changements (deltas) |
| `profile.ts` | profil en long : terrain lissé, pente max, ponts au-dessus de l'eau/des creux avec rampes, piles |
| `planner.ts` | `planRoad` (snapping nœud/tronçon, croisements → carrefours, validations, coût, sans modifier) / `commitRoadPlan` |
| `junction.ts` | branches triées, reculs (setbacks) des carrefours, types (impasse, continu, carrefour) |
| `grading.ts` | nivellement de la carte de hauteurs : plateforme sous la chaussée, terrain juste SOUS le talus maillé par le rendu (remblai relevé, déblai creusé), hors ponts, tunnels et au-delà des murs |
| `sides.ts` | bords hors ouvrage : talus (remblai 1/2, déblai 1/1,5, 14 m max) ou mur de soutènement (pied du talus dans l'eau, remblai trop haut, déblai > 3,5 m) ; décision sur le terrain naturel |
| `roundabout.ts` | giratoires (Ø 36 m / 56 m) posés sur un carrefour ou une route : branches coupées sur le cercle, anneau à sens unique antihoraire, tronçons marqués `ring` |
| `routing.ts` | graphe de circulation CSR, A* sans allocation par requête, cache LRU, HPA*, graphe de voies |
| `serialize.ts` | JSON versionné (`aube-urbaine-roads` v1) |

Portage Unity/Unreal : transposition directe (structures SoA → `NativeArray`/`TArray`) ; les tests donnent les
valeurs de référence (le terrain et les profils sont déterministes). Le maillage (`src/render/roads/builder.ts`)
n'importe pas three non plus : il produit des tampons position/index par matériau, transposables en `Mesh`/`ProceduralMesh`.

## Relief (module « routes et relief »)

- **Hauteur imposée** (`RoadRequest.elevation`, commande `buildRoad.elevation`, pas de 4 m, ±40 m ; boutons ▲ / ▼ de l'outil
  Routes) : la route suit le terrain lissé + la hauteur (ou la corde entre ses extrémités : viaduc rectiligne au-dessus d'un
  creux, tunnel rectiligne sous une colline) ; extrémités au sol, rampes à la pente maximale du type. Stockée par tronçon
  (`segElev`, champ facultatif `elev` des enregistrements et des sauvegardes).
- **Passages dénivelés** : un croisement dont le dénivelé atteint `GRADE_SEPARATION` (6 m) et dont l'ouvrage existe (pont au-dessus,
  tunnel en dessous) ne crée pas de carrefour ; entre 1,5 et 6 m : refus explicite (« montez / descendez le tracé »).
- **Tunnels** : route abaissée (▼) avec ≥ `TUNNEL_MIN_COVER` (6,5 m) de terrain au-dessus ; jamais pour une route au niveau du
  terrain (stabilité des réseaux existants). Plages `tunnelRuns` transmises au rendu (portails, revêtement sombre).
- **Talus / murs** : `wallL` / `wallR` par échantillon du profil (`walls` dans les messages) ; le rendu maille le talus du bord
  jusqu'au terrain rendu, le nivellement garantit que le terrain reste dessous.
- **Giratoires** : commande étendue `buildRoundabout { x, z, size, dryRun? }` ; anneau prioritaire (rang 4 dans le trafic,
  carrefours d'entrée en cédez-le-passage). Champ facultatif `ring` (centre, rayon) des tronçons.
- Sauvegardes : tous ces champs sont facultatifs ; une sauvegarde antérieure se charge sans changement (routes au niveau du terrain).
