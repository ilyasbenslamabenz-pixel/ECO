# Captures QA affichage (iPhone 390×844 mode allégé, ordinateur 1440×900)

Banc : `node tests/e2e/qa-affichage.mjs [iphone|paysage|desktop|all] <préfixe>` (rendu logiciel SwiftShader).
`avant-*` : état de départ de la branche ; `apres-*` : après corrections. Plage : `*-plage-*`.

| Défaut | Avant | Après |
|---|---|---|
| Vignettes noires (mode allégé) | `avant-iphone-06-services.jpg` (Temple en brique noir) | `apres-iphone-06-services.jpg` |
| Bouton « ⚡ Énergie » sur les cartes du tiroir | `avant-iphone-04-batiments.jpg` | `apres-iphone-04-batiments.jpg` |
| Route sur la plage en dalle | `avant-plage-proche.jpg` | `apres-plage-proche.jpg` |
| Barre du haut hors écran (démo, ordinateur) | `avant-desktop-20-demo.jpg` | `apres-desktop-20-demo.jpg` |
