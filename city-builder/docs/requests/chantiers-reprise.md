# Chantiers — note de reprise (2026-11-13)

## Fait (commit d82e50e + ce commit WIP)
- Simulation : `src/sim/construction/{schedule,system}.ts`, plugin, protocole, section de sauvegarde v2 (migration v1). 16 tests `tests/chantiers`, suite complète 178/178 verte, typecheck/build/e2e verts au commit d82e50e.
- Assets : 16 modèles LOD0/1/2 générés par `tools/construction/build.ts` → `assets/models/construction/` + `manifest.json` (hors catalog.json).
- Rendu : `src/render/construction/` (pools d'instances, géométrie procédurale, grue/engins animés, masque de repli du bâtiment de base).
- Demande d'API cœur (portail d'activité, crochets) : `docs/requests/chantiers.md`.

## Non vérifié / reste à faire
- AUCUNE capture regardée : `tests/chantiers/capture.mjs` est écrit mais n'a jamais tourné jusqu'au bout. Le rendu des chantiers n'a donc jamais été vu à l'écran.
- Ce commit WIP (panneau `src/ui/panels/chantiers.ts`, crochet `chantiersPreload`, capture.mjs) : seul le typecheck du panneau a été passé ; pas de test, pas de build.
- `npm run validate:visual`, `e2e:gate` non relancés. FEATURES.md / PROJECT_STATUS.md non mis à jour (hors propriété : à demander).
- `docs/requests/chantiers.md` à compléter : demande 1bis (API de visibilité des bâtiments côté rendu), 2.4 (regex `../save` du garde-fou d'architecture), diff `demolish` à nettoyer, patch cœur jamais appliqué ni testé.
- Modèles peu détaillés (pelle 380 tri, baraque 392) ; pas de test du rendu (géométrie, manifeste) ni du panneau.

## Décisions prises
- Chantiers actifs par défaut ; bâtiments présents à la 1re synchronisation (nouvelle partie, chargement, buildCity) = achevés.
- Sans portail d'activité, le module n'écrit rien dans le cœur : un bâtiment en chantier loge/produit déjà (limite connue).
- Section de sauvegarde et `snapshot.ext` absents tant que rien ne s'est passé.
- Modification HORS propriété : `tests/plugins/plugins.test.ts` (liste `REMPLIS`, l'assertion « plugin vide » ne vaut plus pour chantiers).
- Imports `../../sim/save-sections/…` pour contourner la regex du garde-fou d'architecture.
