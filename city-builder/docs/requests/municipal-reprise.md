# Reprise — contrat municipal (branche claude/p2b-municipal)

**Fait** (commits 2239c57, 160d088, 66bfb52) : grilles d'indicateurs, réseau générique avec délestage par priorité, lignes budgétaires (miroir de l'économie sans changer ses montants), registre d'effets, ordonnanceur multi-fréquence, plugin `municipal` et section de sauvegarde v1. Code dans src/sim/municipal/** et src/shared/municipal/** ; 36 tests dans tests/municipal/ (dont 3 tests d'effet ROADMAP §4) ; docs/MUNICIPAL.md.
**Preuves (avant la pause)** : typecheck vert, npm test 200/200, build vert, e2e SwiftShader SUCCÈS.
**Reste** :
- appliquer l'enregistrement du plugin et de la section + adapter tests/plugins/plugins.test.ts (diffs dans docs/requests/municipal.md §1–2) ;
- branchement du cœur : `ctx.economy.lastMonth()` (§3.1), application des lignes des modules à la trésorerie (§3.2, sous-étape 3).
**Décisions** :
- module non enregistré pour garder npm test vert : le test des registres fige la liste à 4 modules vides ; le test « identique tick à tick » passe avec `municipal` ;
- répartition gloutonne sans annulation de flux (limite documentée) ;
- format de sauvegarde dans src/sim/municipal/save.ts, car le garde-fou d'architecture interdit les imports `../save*` depuis src/sim.
