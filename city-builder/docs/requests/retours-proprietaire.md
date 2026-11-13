# Retours du propriétaire (à traiter en priorité)

## 2026-11-13 — test sur iPhone (version publiée)

Le jeu se lance et fonctionne sur iPhone ; le propriétaire « aime bien ». À corriger :

1. **Arbres trop clairsemés** : le feuillage paraît maigre et peu réaliste (peupliers et feuillus
   de près). Piste : densité des cartes de feuillage, seuil alphaTest trop haut, LOD trop agressif
   de près, alpha-to-coverage, teinte/ombrage des feuilles. Objectif : couronnes denses et crédibles,
   sans dégrader les performances (vérifier sur iPhone et sur le Mac M1).
2. **L'interface déborde sur iPhone (portrait)** : barre du haut coupée à droite (budget tronqué,
   bouton menu coupé), barre d'outils coupée. Tout doit tenir dans la largeur avec les zones sûres
   (`env(safe-area-inset-*)`), ou défiler explicitement (barre d'outils), sans débordement de page.
   Vérifier par capture iPhone 13/15 en portrait.
