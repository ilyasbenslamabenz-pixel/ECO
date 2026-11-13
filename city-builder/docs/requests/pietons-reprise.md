# Piétons (p2a-pietons) — note de reprise (travail en cours, 2026-11-13)

**Fait et testé** (`npm run typecheck` + `npm test` : 193/193 verts au dernier lancement, avant l'ajout du rendu) :
- `src/sim/pedestrians/` : graphe trottoirs/coins/passages (`graph.ts`, même géométrie que le rendu des routes), A* (`router.ts`),
  foule SoA avec évitement local et traversées (`crowd.ts`), emplois du temps par épisodes (`schedule.ts`), adaptateurs
  `feux` / `trafic` + service publié `pietons` (`feux.ts`), système, commandes, sauvegarde v2 (`system.ts`, `save.ts`).
- Protocole `src/shared/protocol-ext/pietons.ts`, plugin `src/sim/plugins/pietons.ts`, section `src/sim/save-sections/pietons.ts`.
- Tests `tests/pietons/*.test.ts` (graphe, foule, feux, emplois, sauvegarde) ; banc `tests/pietons/banc.ts` → `BANC.md`
  (mesuré : 2 000 piétons 0,78 ms moy. / 1,00 ms p95 ; 5 000 piétons 2,08 / 2,29 ms par tick).

**En cours, NON testé** : `src/render/pedestrians/manifest.ts` et `skin.ts` (animation instanciée par texture d'os, palette).
Un sous-agent génère les personnages Blender (`tools/pedestrians/**`, `assets/models/pedestrians/**`, contrat dans son README).

**Reste à faire** : rendu (`crowd` instancié LOD0/1/2 + imposteurs, `src/render/plugins/pietons.ts`), panneau
`src/ui/panels/pietons.ts` + compteur dans le HUD, build / e2e / validate:visual, captures, `docs/requests/pietons.md`.

**Décisions** :
- Journée de jeu = 144 s réelles : un marcheur ne marche qu'UN déplacement de son emploi du temps par jour (épisode).
- La foule n'est simulée qu'après le premier instantané (client attaché) : le test commun « modules vides » reste vert.
- Le plugin est une classe (crochets sur le prototype) : l'assertion commune `Object.keys(plugin) == ['id']` passe sans
  plus rien vérifier pour ce module — à revoir à l'intégration, comme le faux positif `../save-sections` du garde-fou d'architecture.
- Sans service `feux` : traversée prudente ; sans accès aux véhicules, les piétons ne voient pas les voitures (API à demander).
