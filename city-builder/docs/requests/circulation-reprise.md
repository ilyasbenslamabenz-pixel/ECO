# Circulation — note de reprise (mise à jour du 2026-11-13, seconde session)

## Couverture de la mission (vérifiée dans le code et à l'écran)
| Exigence | État | Preuve |
|---|---|---|
| Voies multiples | fait | avenues 2×3 voies, `docs/captures-circulation/avenue-voies-aerien.jpg` |
| Changements de voie (MOBIL) | fait | test MOBIL ; capture d'un véhicule à cheval sur deux voies `rue-changement-de-voie.jpg` ; 1 000 à 1 400 changements par banc |
| Intersections avec réservation de conflits | fait | tests `circulation.test.ts` ; `carrefour-charge.jpg` (cœur du carrefour dégagé malgré 4 files) |
| Feux à phases, priorités, cédez-le-passage | fait | `e2e:signals` (véhicule arrêté au rouge, lentilles allumées jour / nuit) |
| Anti-blocage | fait | test + `unblocked` / `removedStuck` dans les statistiques |
| Embouteillages émergents | fait | ville de charge : de 38 % (faible demande) à 69 % du réseau saturé (2 000 véhicules) |
| Carte de congestion | fait | `congestion-charge-moyenne.jpg` (vert → rouge), `congestion-saturation.jpg` ; comptages concordants sim / rendu (diagnostic Node) |
| Réacheminement | fait | test + `rerouted` |
| Plaques variées | fait | 24 bandes distinctes (sonde), numéros différents lisibles en capture |
| Banc ≥ 2 000 véhicules | fait | chiffres ci-dessous |
| API de feux publique (`ctx.provide('feux', …)`) | fait | `docs/CIRCULATION.md` §2, tests `feux.test.ts` |
| **Ajouté cette session** : feux stop / clignotants | fait | bits `flags` émis par la simulation (test MOBIL vérifie gauche puis droit), attribut `aFeux` + shader ; `clignotant-droit.jpg` |

## Résultats réels (cette session)
- Passage final (build avec clignotants) : `npm run typecheck` OK, `npm test` 190/190, `npm run build` OK (44,5 Mo).
- `npm run e2e` : SUCCÈS. `npm run e2e:signals` : SUCCÈS en entier (35 bras, 9 carrefours, véhicule 22 arrêté au rouge,
  58 px rouges de jour, 690 de nuit) ; relancé après correction de la caméra rue : SUCCÈS (68 / 771 px), `feux-rue.jpg`, `feux-rue-nuit.jpg`. `npm run validate:visual` : SUCCÈS.
- Banc (Xeon 2,1 GHz 4 cœurs, processeur seul) : grille 14 — tick moyen 1,27 ms, p95 1,87 ms ;
  grille 22 — moyen 1,58 ms, p95 3,26 ms (2 000 véhicules, 600 pas).
- Captures regardées : carrefour chargé, avenue multivoie, changement de voie, carte de congestion (deux charges),
  clignotant. Corrigé à la suite : caméra rue de `e2e:signals` (lampadaire devant l'objectif), seuil des clignotants
  (retombaient avant d'être visibles), affirmation fausse de la doc sur l'unicité des plaques.

## Reste à faire / limites connues
- Demande de la ville de charge très forte : même à `demandScale` 0,25, ≈ 730 véhicules à 9 km/h de moyenne
  (attente aux nombreux carrefours rapprochés). Calibrage de la demande à revoir avec la démographie (hors module).
- Clignotants : la phase est figée dans les images `renderNow` (tests) ; optiques petites, visibles surtout de près.
- Feux piétons (têtes de feu piétons) non dessinés ; seul l'état est publié par l'API.
- Panneau `src/ui/panels/circulation.ts` non monté (registre commun, refonte d'interface) : carte de congestion
  accessible seulement par `pluginCommand afficherCongestion` — demande dans `circulation.md`.

## Décisions (inchangées)
- Accès au trafic par `src/sim/traffic/registry.ts` ; import `../../sim/save-sections/…` ; `tests/plugins/plugins.test.ts`
  adapté (`IMPLEMENTED`) — voir circulation.md. Lampadaire / mât : demande + utilitaire seulement.
