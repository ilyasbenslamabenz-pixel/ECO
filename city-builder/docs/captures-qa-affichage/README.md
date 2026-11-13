# Captures QA affichage (iPhone 390×844 mode allégé, ordinateur 1440×900)

Banc : `node tests/e2e/qa-affichage.mjs [iphone|paysage|desktop|all] <préfixe>` (rendu logiciel SwiftShader).
`avant-*` : état de départ de la branche ; `apres-*` : après corrections. Plage : `*-plage-*`.

| Défaut | Avant | Après |
|---|---|---|
| Vignettes noires (mode allégé) | `avant-iphone-06-services.jpg` (Temple en brique noir) | `apres-iphone-06-services.jpg` |
| Bouton « ⚡ Énergie » sur les cartes du tiroir | `avant-iphone-04-batiments.jpg` | `apres-iphone-04-batiments.jpg` |
| Route sur la plage en dalle | `avant-plage-proche.jpg` | `apres-plage-proche.jpg` |
| Barre du haut hors écran (démo, ordinateur) | `avant-desktop-20-demo.jpg` | `apres-desktop-20-demo.jpg` |
| Arbres granuleux en vue haute (imposteurs) | `avant-iphone-18-vue-haute.jpg` | `apres-iphone-18-vue-haute.jpg` |
| Fiche d'information plein écran, vignette floue | `avant-iphone-12-info-route.jpg` | `apres-iphone-11-info-batiment.jpg`, `apres-iphone-12-info-route.jpg` |
| Note du tiroir Routes coupée | `avant-iphone-05-routes.jpg` | `apres-iphone-05-routes.jpg` |
| Consigne d'outil coupée (ordinateur) | `avant-desktop-10-placement.jpg` | `apres-desktop-10-placement.jpg` |
| Paysage (iPhone 17 Pro 874×402) | — | `apres-paysage-*.jpg` |

Arbres sur les routes : `node tests/e2e/qa-arbres-routes.mjs` (avant : 4 arbres sur la chaussée après 4 routes, et
encore 4 après chargement de la sauvegarde ; après : 0, démo comprise).
