# État du projet — Aube Urbaine

## Phase actuelle : 0 → 1 (fondations posées)

Fondations livrées par l'architecte (2026-11-12) : contrats, worker de simulation, rendu de base,
caméra, interface, build, tests, portes de validation. **Aucun modèle 3D n'existe encore** :
la ville n'affiche que le terrain, l'eau et le ciel. C'est attendu à ce stade et ce n'est pas
présenté comme une ville.

### Résultat des commandes (dernière exécution)
| Commande | Résultat |
|---|---|
| `npm run typecheck` | OK |
| `npm test` | OK (19 tests) |
| `npm run build` | OK (dist ≈ 0,7 Mo) |
| `npm run e2e` | OK (index.html + artifact.html : worker prêt, instantané, deltas, frames, horloge, bascule caméra, 0 erreur de page) |
| `npm run e2e:gate` | OK (la porte rejette cube et modèle non texturé, accepte un modèle détaillé) |
| `npm run assets` | OK (catalogue vide) |
| `npm run validate:assets` | **ÉCHEC attendu** : 0 bâtiment |
| `npm run validate:visual` | **ÉCHEC attendu** : 0 bâtiment, scène de démo absente |

### Revue visuelle
Captures regardées : `tests/e2e/out/smoke-index-aerien.png` (plaine verte vue de haut, éclairage
correct après réglage d'exposition), `smoke-index-rue.png` (horizon, ciel), `gate-selftest.png`
(planche-contact de test). Le terrain est encore une couleur par sommet sans texture :
à remplacer par l'agent environnement.

### Prochaines étapes (phase 1)
Voir `AGENT_TASKS.md` : bibliothèque d'assets (priorité 1), scène de démo, environnement,
routes, rendu bâtiments, outils de construction. Critères de sortie de phase 1 dans `AGENT_TASKS.md`.
