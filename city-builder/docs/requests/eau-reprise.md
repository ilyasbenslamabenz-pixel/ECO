# Reprise — eau et assainissement (branche claude/p2b-eau)

**Fait** (commits b255df5 → 91329f9) : simulation `src/sim/water-network/**` (captage surface/forage, potabilisation, châteaux, réseaux `eau`/`egouts` sur la voirie, pression, qualité, épuration, pollution routée vers l'aval), module/section/protocole `eau`, calque souterrain + panneau « Eau & égouts », 5 GLB LOD0/1/2 (`tools/water-network`), 19 tests dont 4 tests d'effet, `docs/EAU.md`.
**Preuves** : typecheck vert ; npm test 218/219 (seul échec : assertion superviseur « plugin vide », diff dans docs/requests/eau.md §1) ; build 45,45 Mo ; e2e SUCCÈS ; validate:visual SUCCÈS ; `npm run eau:captures` SUCCÈS (images regardées).
**Reste** (hors périmètre, diffs proposés dans docs/requests/eau.md) :
- croissance bloquée consommée par la démographie (§2) ; satisfaction/santé lues par le cœur (§3) ;
- budget du service appliqué à la trésorerie (municipal §3.2) ;
- enregistrement de `municipal` avant `eau` ; montage officiel du panneau (§5) ; générateur dans tools/generators (§6) ;
- tracé réel des rivières exposé aux modules (§7).
