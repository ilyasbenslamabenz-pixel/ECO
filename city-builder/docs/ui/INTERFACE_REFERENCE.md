# Référence d'interface (validée par le propriétaire)

Image : `reference-interface.png` (maquette fournie par le propriétaire). **Seule l'interface sert de
référence** ; la ville rendue en arrière-plan n'est pas une cible de rendu.

## Éléments à reproduire

1. **Barre supérieure** : logo/nom de la ville, contrôle de vitesse (pause, ×1, ×2, ×4), date + heure,
   météo (icône + température), population + variation, satisfaction (icône d'humeur + %),
   trésorerie + solde mensuel, statistiques, notifications (badge), réglages.
2. **Barre latérale gauche = tableaux de bord** (consulter/régler) : Vue ville, Finances, Population,
   Services, Énergie, Eau & égouts, Déchets, Transports, Environnement, Politiques, Recherche.
3. **Barre inférieure = outils de construction** (poser) : Zones, Routes, Bâtiments, Services, Énergie,
   Eau, Déchets, Transports, Nature, Terrain ; sous-barre contextuelle à icônes colorées (ex. zones :
   Résidentiel, Commercial, Industriel, Bureaux, Agricole, Spécial).
4. **Panneaux à onglets** à droite (ex. Finances municipales : Aperçu, Impôts, Budget, Dette) avec
   recettes/dépenses ventilées, solde mensuel, graphique d'évolution sur 12 mois.
5. **Panneau Objectifs** (en bas à droite) avec progression.
6. **Mini-carte** (en bas à gauche) avec boutons de vue, zoom et orientation.
7. Identité visuelle : thème sombre translucide, accent vert, icônes dédiées colorées.

## Corrections décidées

- Pas de doublon d'intention : la barre latérale ouvre les **tableaux de bord**, la barre du bas les
  **outils de construction** (un même système peut apparaître dans les deux, mais avec ces rôles distincts).
- Variante **iPhone portrait** : barre latérale en tiroir, panneaux en plein écran / feuille glissante,
  barre d'outils défilante, zones sûres respectées.
- Graphiques avec axes corrects ; onglets jamais tronqués.
- Toutes les valeurs affichées proviennent de la simulation réelle ; aucun bouton sans action
  (les fonctions pas encore développées restent grisées avec leur phase).
- Nom du jeu : **Meknes City** (choisi par le propriétaire ; aucun jeu vidéo existant de ce nom trouvé le 2026-11-13). Remplace « Aube Urbaine » dans l'interface lors de la refonte (titre, menu, logo, <title>), sans renommer le code ni casser les sauvegardes.

## Planification

Refonte de l'interface entre la phase 2A et la phase 2B (la 2B a besoin des tableaux de bord),
en conservant toutes les fonctions existantes. Validation : captures desktop + iPhone comparées à
la référence, tests e2e de chaque bouton.
