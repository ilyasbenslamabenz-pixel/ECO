# Boutique City

Jeu de gestion de commerces dans un quartier, en 3D légère (Three.js), indépendant de Meknes City. Certaines briques
viennent de Meknes City, copiées et non partagées : la caméra (`src/input/camera.ts`) et des outils de géométrie.

## Jouer
1. Le quartier : immeubles de logements et de bureaux. Les **repères ronds** marquent les locaux commerciaux à louer.
2. Cliquer sur un immeuble à repère : surface, loyer, **passage** devant la vitrine (habitants et employés proches),
   concurrence et clients estimés par type de commerce (épicerie, café, boutique de vêtements). Louer : dépôt de
   garantie d'un mois, loyer prélevé chaque jour.
3. **Aménager** (vue de dessus, grille de 1 m) : caisse obligatoire, meubles de présentation (rayonnage, vitrine
   réfrigérée, comptoir, vitrine à pâtisseries, portant), machine à café, tables, décoration. Chaque meuble doit
   rester accessible depuis l'entrée.
4. **Employés** : chacun tient une caisse (28 clients par heure au plus, selon sa compétence). Salaire payé à chaque
   heure d'ouverture. Nouveaux candidats chaque lundi.
5. **Stock et prix** : commandes livrées le lendemain à 7 h, remise de 10 % dès 100 unités, réassort automatique à
   21 h. Prix au-dessus du quartier : moins de clients ; en dessous : marge réduite.
6. **Résultats** et **Finances** : ventes, marge, salaires, loyers, trésorerie, jour par jour.

Sauvegarde automatique chaque jour de jeu (dans le navigateur) et bouton Sauvegarder.

## Développement
```
npm install
npm run typecheck && npm test      # simulation (tsx --test)
npm run build                      # dist/game.js, dist/index.html, dist/artifact.html
node tests/e2e.mjs [dossier]       # parcours navigateur (Playwright) et captures
```
- `src/sim/` : simulation en TypeScript pur (quartier, aménagement, clients minute par minute, employés, stocks,
  finances, sauvegarde) ; équilibrage vérifié par `tests/sim.test.ts`.
- `src/render/` : quartier instancié (fenêtres calculées dans le shader, aucune texture), passants et clients.
- `src/ui/` : barre du haut, panneau latéral, éditeur d'aménagement.

Paramètres d'adresse : `?seed=N` (quartier), `?nouveau` (ignore la sauvegarde), `?vitesse=0..3`, `?auto` (partie
de test immédiate).
