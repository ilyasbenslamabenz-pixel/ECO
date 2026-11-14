# Outils de voirie — état et suites (branche `claude/outils-routes`)

## Livré
- Tracé continu (enchaînement depuis l'extrémité) + bouton flottant « ✓ Terminer le tracé » (≥ 46 px, iPhone), Entrée au clavier.
- Quadrillage (îlots 48 / 64 / 96 m sur la grille de 8 m), coût chiffré par la simulation avant validation, annulation groupée, bord partagé avec un quadrillage voisin.
- Lignes guides parallèles à distance d'îlot ; longueur · angle · coût pendant le tracé.
- Outil « Améliorer » : Gamme + / Gamme − / Sens unique / Inverser, commande `upgradeRoad` (src/sim/roads/upgrade.ts), refus motivé (bâtiment nommé, route voisine, pente, rayon, autoroute).
- Correction simulation : un tronçon créé puis découpé entre deux deltas n'est plus envoyé (évitait un tronçon fantôme chez le client et le rendu).

## Reste à faire / limites connues
- Quadrillage aligné sur les axes nord / est seulement (pas d'orientation libre ni d'alignement sur une route en biais).
- Quadrillage construit rue par rue : si une rue est refusée en cours de route (cas rare après un dryRun réussi), les rues déjà posées restent (annulables d'un Ctrl+Z).
- Améliorer : un tronçon à la fois (pas de sélection d'une rue entière d'un carrefour à l'autre) ; l'identifiant du tronçon change (le panneau d'information se ferme s'il était ouvert dessus).
- Flèches de sens affichées dans l'aperçu seulement ; le marquage du sens unique dans le rendu des routes relève de `src/render/roads/**` (autre session).
- Lanceur « ⚡ Énergie » (module électricité) masqué sur téléphone pendant l'usage d'un outil (il recouvrait les options) ; à repositionner par son propriétaire.
- Pas de commande `upgradeRoad` dans MockSim (src/input/mocks.ts) : l'outil Améliorer répond « non simulé » en mode maquette.
