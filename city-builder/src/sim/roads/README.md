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
| `grading.ts` | nivellement de la carte de hauteurs sous les chaussées (plateforme + talus, hors ponts) |
| `routing.ts` | graphe de circulation CSR, A* sans allocation par requête, cache LRU, HPA*, graphe de voies |
| `serialize.ts` | JSON versionné (`aube-urbaine-roads` v1) |

Portage Unity/Unreal : transposition directe (structures SoA → `NativeArray`/`TArray`) ; les tests donnent les
valeurs de référence (le terrain et les profils sont déterministes). Le maillage (`src/render/roads/builder.ts`)
n'importe pas three non plus : il produit des tampons position/index par matériau, transposables en `Mesh`/`ProceduralMesh`.
