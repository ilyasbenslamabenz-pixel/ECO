# Demandes à l'équipe interface (correctifs QA n° 2 : feux, horloge, chargement)

Ces points touchent `src/ui/**`, qui n'a pas été modifié par le correctif (un autre développeur y travaille).

1. **Vitesses plus rapides (×8, ×16)** — l'horloge a été ralentie : une journée de jeu dure maintenant 12 min réelles
   à ×1 (avant : 72 s). L'économie reste mensuelle, donc un mois de jeu dure 6 h réelles à ×1 et 1 h 30 à ×4.
   Proposition : ajouter des boutons ×8 et ×16 (il faudra aussi étendre `SIM_SPEEDS` dans
   `src/shared/constants.ts` ; la boucle de la simulation suit, et le tick coûte ≈ 1 ms pour 500 bâtiments).
2. **Horloge du HUD** — avec des pas de 0,2 min, les minutes avancent maintenant de 2 minutes de jeu par seconde
   réelle. Rien à changer, mais un affichage au quart d'heure serait plus calme si le défilement gêne.
3. **Légende des feux (facultatif)** — un clic sur un carrefour à feux pourrait afficher son régime et sa phase
   (données disponibles : `TrafficSystem.signalStates()` côté simulation, `render.signals.debug()` côté rendu).
