# Captures « routes et relief »

Générées par `node tests/e2e/routes-relief.mjs <préfixe> [vues]` (après `npm run build`) : partie neuve, graine 7,
routes construites par la vraie commande `buildRoad` / `buildRoundabout`. `avant-*` : version d'origine (commit b4a6a66),
mêmes sites et mêmes commandes (la hauteur imposée et le giratoire y sont ignorés / refusés). `apres-*` : cette branche.

| Vue | Avant | Après |
|---|---|---|
| Plage (rue le long du rivage) | `avant-plage.jpg` : dalle bordée d'une jupe sombre | `apres-plage.jpg` : talus de sable raccordé à la plage |
| Quai au ras de l'eau | `avant-plage-quai.jpg` | `apres-plage-quai.jpg` |
| Bord de rivière | `avant-riviere.jpg` | `apres-riviere.jpg` |
| Pont (culées, piles) | — | `apres-pont.jpg`, `apres-pont-culee.jpg` |
| Colline (déblai / remblai) | `avant-colline.jpg` | `apres-colline.jpg` : talus enherbé côté aval, murs de soutènement côté amont |
| Viaduc +8 m au-dessus d'une rue | `avant-viaduc.jpg` : carrefour à niveau | `apres-viaduc.jpg` : passage supérieur, piles hors de la rue |
| Tunnel (−16 m sous une colline) | `avant-tunnel.jpg` : tranchée | `apres-tunnel.jpg`, `apres-tunnel-sortie.jpg` : portails |
| Giratoire | `avant-rondpoint.jpg` : carrefour | `apres-rondpoint.jpg` : anneau, îlot planté |
| Interface ▲ / ▼ | — | `apres-apercu-hauteur.jpg` (barre d'outils « +8 m ») |
