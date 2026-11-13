# Chantiers — note de reprise (mise à jour 2026-11-13, 2e session)

## État vérifié
- `npm run typecheck` vert ; `npm test` vert (suite complète, dont `tests/chantiers/chantiers.test.ts` 16 tests
  simulation/sauvegarde et `tests/chantiers/rendu.test.ts` 5 tests rendu/modèles/panneau/masque).
- `npm run build` vert : dist 45,1 Mo (budget 60 Mo) ; modèles de chantier 1,6 Mo (< 3 Mo, vérifié par test).
- `npm run e2e` : SUCCÈS. `npm run validate:visual` : SUCCÈS (démo livrée achevée, aucun chantier parasite).
- `node tests/chantiers/capture.mjs` (après build) : 39/39 vérifications, captures du VRAI jeu dans `tests/chantiers/out/`
  (non versionnées) et `rapport.json`. Images REGARDÉES : terrassement (palissade, pelle, baraque, terre),
  fondations (dalle, ferraillage, grue montée, toupie), structure (ossature étage par étage, filets),
  façades (échafaudage + bâche), finitions (échafaudage démonté par le haut, bâtiment révélé), tour (grue
  haute), nuit (travaux arrêtés), démolition (préparation, abattage : murs résiduels, déblaiement : gravats).

## Corrigé dans cette session
- Rendu : l'horloge de travail lissée ne rattrapait pas un grand écart (onglet en arrière-plan, reprise
  à ×16) → recalage direct au-delà de 60 min de travail (`CLOCK_SNAP`, `src/render/construction/index.ts`).
- Rendu : le masque de repli neutralisait les matrices d'instance du bâtiment mais ne les restituait jamais
  (bâtiment invisible après la révélation jusqu'au prochain changement de LOD) → valeurs conservées et
  restituées (`mask.ts`), test dédié.
- Diagnostic `__aube.chantiers()` : phase donnée par son nom (et non son index).
- Script de captures : pilotage par l'état SIMULATION (`pluginCommand chantiers/etat`), heures de jour,
  rendu à dt 0,5 s, mesure de contraste sur la capture PNG (le tampon WebGL n'est pas conservé).
- `docs/requests/chantiers.md` : diff `demolish` propre, demande 1bis (API de visibilité côté rendu),
  demande 2.4 (regex du garde-fou d'architecture).

## Reste à faire / limites connues
- Le patch cœur (portail d'activité `setActive`, crochets `onBuildingAdded/Removed`) n'est PAS appliqué :
  sans lui, un bâtiment en chantier loge et produit déjà (visible : habitants avant achèvement). À arbitrer
  par le propriétaire du cœur (`docs/requests/chantiers.md` §1).
- Démolition : le cœur retire le bâtiment immédiatement ; l'animation montre vestiges → gravats après coup
  (demande §2.2 pour un retrait en deux temps).
- Façades : l'échafaudage bâché enveloppe tout le volume (lecture « bloc bleu » en vue lointaine) ;
  modèles d'engins peu détaillés (pelle, baraque).
- FEATURES.md / PROJECT_STATUS.md non mis à jour (hors propriété : à demander).
- `e2e:gate` non relancé.

## Décisions prises
- Chantiers actifs par défaut ; bâtiments présents à la 1re synchronisation (nouvelle partie, chargement,
  buildCity) = achevés.
- Sans portail d'activité, le module n'écrit rien dans le cœur.
- Section de sauvegarde et `snapshot.ext` absents tant que rien ne s'est passé.
- Modification HORS propriété : `tests/plugins/plugins.test.ts` (liste `REMPLIS`).
- Imports `../../sim/save-sections/…` pour contourner la regex du garde-fou d'architecture (voir demande 2.4).
