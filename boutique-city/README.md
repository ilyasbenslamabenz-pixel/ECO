# Boutique City

Jeu de gestion de commerces à la troisième personne, en 3D légère (Three.js), indépendant de Meknes City. Vous
incarnez un entrepreneur qui part de rien dans un quartier animé : chaque achat se fait sur place, chaque commerce
s'aménage en 3D, et l'on voit clients et employés vivre dans ses magasins.

## Jouer
- **Se déplacer** : Z Q S D (ou W A S D, ou flèches), Maj pour courir. Souris : glisser pour tourner la caméra,
  molette pour le zoom. Sur écran tactile : joystick à gauche, glisser pour tourner, pincer pour zoomer.
- **E** : entrer dans un bâtiment (anneau lumineux devant la porte), conduire un véhicule, tenir la caisse, dormir.
- **T** : téléphone (pause automatique) : Commerces, Immobilier, Banque, Équipe, Marché, Messages, Objectifs,
  Véhicules, Carte, Entreprise, Réglages. **B** : aménager le commerce. **M** : carte. **P** : pause. **H** : aide.
  **Échap** : fermer. Jeu pensé pour ordinateur (clavier et souris).

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
4. **Marchandise** : au grossiste, à emporter (24 unités à pied, 60 en scooter, 140 en citadine, 90 en sportive, 320 en SUV, 600 en camionnette, 1 600 en camion garé devant) puis
   « Décharger » dans le commerce ; ou livrée le lendemain à 7 h avec des frais ; ou réassort automatique.
5. **Caisse** : tenez-la vous-même (E derrière la caisse) ou embauchez à l'agence pour l'emploi.
6. **Clients** : chaque vente fait entrer un client qui va aux rayons, fait la queue et paie.
7. **Vie du personnage** : énergie et faim baissent ; manger au snack, dormir chez soi. À zéro d'énergie, taxi et
   longue nuit.
8. **Banque** (prêts remboursés chaque jour), **publicité** (plus de clients pendant la campagne), **garage**.
9. **Objectifs** (33 en quatre paliers : Démarrage, Gérant, Entrepreneur, Magnat ; trois actifs à la fois, une
   récompense par palier franchi, écran de victoire « Légende du quartier ») et rang d'entrepreneur ; **récapitulatif** chaque
   soir ; **affluence** par heure (servis / perdus) ; **avis clients** en bulles (trop cher, rupture, attente) ;
   employés qui progressent avec l'expérience ; **cycle jour/nuit** (lampadaires, vitrines éclairées) ; sons.
10. Sept types de commerce : épicerie, café, boutique de vêtements, fleuriste, boulangerie, fast-food, primeur ; 28 meubles (gondoles,
    congélateurs, bar, coin salon, tables bistrot, écran publicitaire…) ; 4 véhicules (scooter, citadine, camionnette,
    camion).

11. **Immobilier** : louez plusieurs locaux ; prenez aussi des appartements ou des locaux à bail pour les
    **sous-louer** (loyer demandé réglable, locataires qui arrivent et partent).
12. **Économie vivante** : loyer des locaux provisionné chaque jour et prélevé tous les 30 jours ; prix du grossiste
    qui varient chaque jour ; concurrents qui baissent leurs prix ; météo (pluie : moins de passants, sauf cafés et
    fast-foods) ; jour de marché ; contrôles d'hygiène ; vols à l'étalage ; livraisons à 7 h et 14 h.
13. **Employés** : compétence qui progresse, satisfaction liée au salaire, demandes d'augmentation, démissions.

Équilibrage : `npx tsx scripts/equilibrage.ts` (7 jours par type, bien ou mal géré) ; parcours d'un bon joueur
jusqu'à la légende du quartier (jour d'atteinte de chaque objectif, paliers, espacement) : `npx tsx scripts/tutoriel.ts`.

Sauvegarde automatique chaque jour de jeu (dans le navigateur) et bouton Sauvegarder.

## Modèles 3D
877 modèles **Kenney, licence CC0** (domaine public), dans `models/` (40 Mo, 8,9 Mo une fois compressés), tirés de
17 packs : City Kit Commercial, Suburban, Industrial et Roads, Retro Urban Kit, Car Kit, Mini Characters, Blocky
Characters, Mini Market, Mini Arcade, Mini Skate, Furniture Kit, Food Kit, Nature Kit, Survival Kit, Holiday Kit,
Cube Pets.
- **Quartier** : tous les immeubles, tours, maisons et entrepôts ; ligne d'horizon (gratte-ciel, zone industrielle,
  pavillons) ; voitures garées ; mobilier urbain ; parc avec statues, massifs, mini-zoo et skate-park ;
- **Vie** : 30 apparences de clients (accessoires, fauteuils roulants), employés en tenue, animaux, skateurs ;
- **Mobilier** : tout le Furniture Kit, le Mini Market, des bornes d'arcade et des décorations de fête ;
- **Marchandise** : les 200 modèles du Food Kit répartis entre les produits.

Sources et licences : `models/CREDITS.txt`. Page publiée : tous les GLB dans `models/pack.json` (bout à bout,
compressés en gzip, décompressés dans le navigateur).
- `src/assets.ts` : section CONFIG puis ASSETS (clé → fichier, échelle, rotation), chargement unique (GLTFLoader +
  LoadingManager, écran de chargement avec barre de progression), clones (SkeletonUtils.clone pour les personnages),
  ajustement automatique par boîte englobante.
- Repli obligatoire : un modèle absent ou en erreur laisse la forme faite en code (`?sansmodeles` pour l'essayer).
- `?galerie` : galerie de contrôle (orientation, échelle) des modèles.
- `node scripts/embed-textures.mjs <texture.png> <modèle.glb>…` (ou `--dir <dossier>`) : intègre les textures d'un
  pack dans ses GLB.
- `?galerie=N` : page N (40 modèles par page).

## Développement
```
npm install
npm run typecheck && npm test      # simulation, collisions, chemins (tsx --test)
npm run build                      # dist/game.js, dist/index.html, dist/artifact.html
node tests/e2e.mjs [dossier]       # parcours navigateur complet (Playwright) et captures
node tests/e2e-boucle.mjs [dossier] # boucle commerce sur 3 jours, récapitulatifs, sauvegarde et rechargement
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
