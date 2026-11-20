# Boutique City

Jeu de gestion de commerces à la troisième personne, en 3D légère (Three.js), indépendant de Meknes City. Vous
incarnez un entrepreneur qui part de rien dans un quartier animé : chaque achat se fait sur place, chaque commerce
s'aménage en 3D, et l'on voit clients et employés vivre dans ses magasins.

## Jouer
- **Se déplacer** : Z Q S D (ou W A S D, ou flèches), Maj pour courir. Souris : glisser pour tourner la caméra,
  molette pour le zoom. Sur écran tactile : joystick à gauche, glisser pour tourner, pincer pour zoomer.
- **E** : entrer dans un bâtiment (anneau lumineux devant la porte), conduire un véhicule, tenir la caisse, dormir.
- **B** : aménager le commerce (dans le magasin). **M** : carte (cliquer un lieu = destination). **P** : pause.
  **Échap** : fermer.

### Le quartier
- Anneaux **jaunes** : locaux à louer (surface, loyer, passage, concurrence et clients estimés par type).
- **Services** (anneaux colorés, enseignes) : grossiste, magasin de meubles, banque, agence pour l'emploi, garage,
  agence de publicité, deux snacks.
- Logements à louer (anneaux bleu clair) ; le vôtre en blanc. Vous démarrez dans un studio.

### La boucle
1. **Louer** un local (dépôt d'un mois, loyer prélevé chaque jour) : vous entrez dans le local vide.
2. **Meubles** : au magasin de meubles, livrés dans la réserve du commerce choisi.
3. **Aménager** (B) : poser les meubles de la réserve en 3D sur la grille (R pour tourner, clic sur un meuble posé
   pour le déplacer). Chaque meuble doit rester accessible depuis l'entrée.
4. **Marchandise** : au grossiste, à emporter (24 unités à pied, 60 en scooter, 600 en camionnette garée devant) puis
   « Décharger » dans le commerce ; ou livrée le lendemain à 7 h avec des frais ; ou réassort automatique.
5. **Caisse** : tenez-la vous-même (E derrière la caisse) ou embauchez à l'agence pour l'emploi.
6. **Clients** : chaque vente fait entrer un client qui va aux rayons, fait la queue et paie.
7. **Vie du personnage** : énergie et faim baissent ; manger au snack, dormir chez soi. À zéro d'énergie, taxi et
   longue nuit.
8. **Banque** (prêts remboursés chaque jour), **publicité** (plus de clients pendant la campagne), **garage**.

Sauvegarde automatique chaque jour de jeu (dans le navigateur) et bouton Sauvegarder.

## Développement
```
npm install
npm run typecheck && npm test      # simulation, collisions, chemins (tsx --test)
npm run build                      # dist/game.js, dist/index.html, dist/artifact.html
node tests/e2e.mjs [dossier]       # parcours navigateur complet (Playwright) et captures
```
- `src/sim/` : simulation en TypeScript pur (quartier et services, aménagement, achats sur place, clients minute par
  minute, employés, véhicules et cargaison, besoins du personnage, prêts, publicité, sauvegarde).
- `src/world/` : collisions (rectangles), conduite, chemins sur grille — TypeScript pur, testés.
- `src/render/` : rue instanciée (fenêtres dans le shader, aucune texture chargée), personnages, meubles et
  véhicules modélisés en code, intérieurs avec murs en coupe, clients et employés animés.
- `src/input/` : clavier, joystick tactile, caméra à la troisième personne (évite les immeubles).
- `src/ui/` : barre du haut, panneaux des lieux, gestion du commerce, entreprise, carte.

Paramètres d'adresse : `?seed=N` (quartier), `?nouveau` (ignore la sauvegarde), `?vitesse=0..3`, `?auto` (partie
de test immédiate).
