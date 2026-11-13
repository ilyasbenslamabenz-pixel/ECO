# Atmosphère (2C) — note de reprise

- Fait : météo simulée déterministe (src/sim/weather, PRNG du module, pas de 10 min), section de sauvegarde v1,
  ext.weather (icône, °C, nuages, pluie, neige, brouillard, orage, vent, sol mouillé, neige au sol, jour de l'année).
- Fait : rendu (src/render/weather + sky) : nuages procéduraux, voile du soleil, éclairs, lueur de coucher, pluie/neige
  instanciées (≤ 2 appels), neige au sol/toits, sol mouillé, herbe/feuillage saisonniers, halos de lampadaires, qualité off/bas/haut.
- Fait : tests/weather (9 tests), captures tests/weather/captures.mjs regardées (4 saisons, pluie, neige, brouillard, orage, coucher, nuit).
- Reste : barre supérieure (UI), sélecteur de qualité (options), ombres des arbres nus, saison de départ de la démo
  (voir atmosphere.md §2, §3, §4, §7).
- Décisions : branchement par lecture de la scène (pas d'édition de vegetation.ts/roads) ; plugins.test ajusté a minima.
