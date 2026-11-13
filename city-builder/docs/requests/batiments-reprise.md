# Reprise du module « Bâtiments & quartiers » (branche claude/p2a-batiments)

État au 2026-11-13 (2ᵉ session) : budget de distribution tenu, planche-contact regardée et corrigée.

## Fait
- Générateur procédural `tools/buildings/procedural/` : grammaire de façade (`grammar.ts`), 8 styles (`styles.ts`),
  composants (`parts.ts`, `rail.ts`), fusion de matériaux par LOD (`merge.ts`), 6 familles (`models/*.ts`).
  **63 bâtiments exportés** (78 définis ; 15 mis hors budget, liste `HORS_BUDGET` dans `index.ts`, réactivables)
  → `assets/buildings/procedural/`, fragment `assets/catalog.buildings.procedural.json`, fusionnés dans
  `assets/catalog.json` par `npx tsx tools/buildings/procedural/build.ts --merge` (qui retire aussi les entrées disparues).
- **Budget dist** : `npm run build` → 53,73 Mo (budget 60, cible module ≤ 54). Procédural compressé : 17,9 → 9,2 Mio.
  Leviers : drapeau `Ctx.eco` du kit (procédural seulement ; le rendu des 40 bâtiments existants est inchangé) —
  fenêtres en aplats sur mur plein au LOD1, sans appuis aux LOD1/2, cadres sans retours, faces jointives omises,
  barreaux en quadrilatères simple face côté rue, JSON glTF arrondi ; fusion des matériaux de teinte voisine
  (le JSON glTF coûtait ~2,3 Ko par primitive et dépassait la géométrie aux LOD1/2) ; retrait de 15 modèles lourds
  ayant un proche parent. Essais sans effet : meshopt « high » (−1 %), arrondi sur grille avant quantification
  (re-quantifié par gltf-transform).
- **Planche-contact** (`npx tsx tools/buildings/showcase/run.ts --frags=catalog.buildings.procedural.json --tag=procedural --cols=7`,
  sortie `tests/buildings/out/planche_procedural.png`, ignorée par git) regardée en entier. Corrigé :
  `ringFrames` construisait des repères en miroir → façades retournées (invisibles) sur ~25 modèles (angles, bureaux,
  halles, entrepôts, ateliers, équipements) ; croupes à 72° (pyramides démesurées) plafonnées à 42°.
- Quartiers : `src/sim/districts/**`, plugin sim/rendu/UI/sauvegarde v2 `batiments`, tests `tests/batiments/`,
  demande d'API d'écriture `docs/requests/batiments.md`.
- Vérifié : `npm run typecheck` OK, `npm test` 188/188, `npm run test:assets` 102/102, `npm run validate:assets` OK,
  `npm run build` OK (53,73 Mo), `npm run e2e` OK (17 contrôles, sortie 0), `npm run validate:visual` SUCCÈS
  (152 assets, 103 bâtiments ; démo : 122 bâtiments posés, 103 modèles distincts — tous les modèles sont posés).

## Reste à faire
- Planche aux LOD1/2 (`--lods`) à regarder. Vues de face, de dos et aérienne LOD0 regardées pour les 63 modèles
  (`--views=back,aerial` → `planche_procedural_dos_aerien.png`) : volumes fermés, aucune face retournée ; façades
  arrière volontairement sobres. Liserés rouges des arêtiers de croupe un peu voyants (rôle `rive`).
- Entrepôts, dépôts, gymnase : corrects mais pauvres en détail.
- Script de capture des 6 types de quartier en jeu ; mise à jour FEATURES/PROJECT_STATUS ; tests `generateur-*`.

## Décisions
- GLB dans `assets/buildings/procedural/` (cohérent avec l'existant) plutôt que `assets/models/buildings/`.
- Kit Node existant réutilisé (pas de Blender) ; aucune nouvelle texture (jeux partagés).
- `tests/plugins/plugins.test.ts` (fichier commun) modifié d'une assertion « plugin vide » → voir `docs/requests/batiments.md` §2.
- Enregistrement dans `tools/generators/index.ts` (hors propriété) à demander : une ligne `generateProcedural`.
- `scripts/optimize-glb.mjs` (hors propriété) : piste d'économie non exploitée — partager les accesseurs de sommets
  entre primitives réduirait encore le JSON, mais suppose de vérifier la déquantification côté `src/render/assets.ts`.
