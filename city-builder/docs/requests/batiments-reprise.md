# Reprise du module « Bâtiments & quartiers » (branche claude/p2a-batiments)

État au 2026-11-13 : **WIP non validé** (commit poussé sans relancer la suite complète, à la demande de reprise).

## Fait
- Générateur procédural `tools/buildings/procedural/` : grammaire de façade (`grammar.ts`), 8 styles (`styles.ts`),
  composants (`parts.ts`, `rail.ts`), 6 familles (`models/*.ts`) → **78 bâtiments** LOD0/1/2 dans
  `assets/buildings/procedural/`, fragment `assets/catalog.buildings.procedural.json`, fusionnés dans `assets/catalog.json`
  (`npx tsx tools/buildings/procedural/build.ts --merge`). `npm run validate:assets` était vert avant les derniers allègements.
- Quartiers : `src/sim/districts/**`, plugin sim/rendu/UI/sauvegarde v2 `batiments`, tests `tests/batiments/` (26 verts),
  demande d'API d'écriture `docs/requests/batiments.md`.
- `npm test` vert (190) au dernier lancement, AVANT les derniers réglages de `parts.ts` / `rail.ts` (outils seulement).

## Reste à faire
- **Budget dist dépassé** : 63,6 Mo mesurés (limite 60) ; allègements en cours (GLB bruts 35 → 32,1 Mo). Rebuild à refaire ;
  si encore > 60 Mo : alléger LOD0 des plus lourds (tours plot, barres, hôtels) ou retirer quelques modèles (≥ 60 requis).
- Planche-contact complète à rendre et REGARDER (seuls 10 modèles vus : dôme et villa contemporaine corrigés/à revoir ;
  entrepôts, gymnases, dépôts encore pauvres en détail).
- `npm run typecheck`, `npm test`, `npm run build`, `npm run e2e`, `npm run validate:visual` à relancer ; vérifier que la
  ville de démo pose les 118 modèles (`demo.missing`, city-builder.ts hors propriété).
- Script de capture des 6 types de quartier en jeu ; mise à jour FEATURES/PROJECT_STATUS ; tests `generateur-*`.

## Décisions
- GLB dans `assets/buildings/procedural/` (cohérent avec l'existant) plutôt que `assets/models/buildings/`.
- Kit Node existant réutilisé (pas de Blender) ; aucune nouvelle texture (jeux partagés).
- `tests/plugins/plugins.test.ts` (fichier commun) modifié d'une assertion « plugin vide » → voir `docs/requests/batiments.md` §2.
- Enregistrement dans `tools/generators/index.ts` (hors propriété) à demander : une ligne `generateProcedural`.
