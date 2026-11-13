# Reprise — module déchets (branche claude/p2b-dechets)

**Fait** : simulation (production, bacs, tournées sur graphe routier, tri / incinération / décharge, pollution, nuisances -> satisfaction / valeur foncière, budget, registre d'effets), protocole, sauvegarde v1, rendu (camions, tumulus, panache, conteneurs, calque), panneau, 6 GLB LOD0/1/2, docs/DECHETS.md.
**Preuves (2026-11-13)** : typecheck ✓ ; npm test 210/210 (3 tests d'effet) ; build ✓ (+0,97 Mo) ; npm run e2e SUCCÈS ; tests/dechets/e2e.mjs SUCCÈS (captures regardées) ; validate:visual SUCCÈS.
**Reste** (docs/requests/dechets.md) :
- API trafic pour injecter les camions (§2) ; validateur : autoriser `tools/waste/` (§3) ; registre des générateurs (§4) ;
- montage UI des panneaux (provisoire : touche J) (§5) ; trésorerie et démographie (§6) ;
- défaut préexistant ×16 sans affichage (§8).
**Décisions** : municipal enregistré avant dechets ; tests plugins/municipal adaptés (registre filtré, aucune assertion changée).
