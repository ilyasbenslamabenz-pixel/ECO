# Interface (vague 5)

Cartes d'information, fiches « Pourquoi », graphiques d'évolution, notifications hiérarchisées. Mécaniques inspirées
des city-builders modernes ; textes, couleurs et valeurs propres au jeu.

| Couche | Fichiers |
|---|---|
| Partagé | `src/shared/protocol-ext/cartes.ts` (types, échelles 0..100), `src/shared/protocol-ext/historique.ts` (format compact, fonctions pures) |
| Simulation | `src/sim/plugins/cartes.ts`, `src/sim/plugins/historique.ts`, section `src/sim/save-sections/historique.ts` ; `demography.ts` (`scoreCitizen`, `residentAggregates`, `inspectBuilding().diagnosis`) ; `plugins/dechets.ts` (`binLevel`) ; façade `economy.history()` (`plugins/types.ts`, `host.ts`) ; rattachement dans `world.ts` |
| Rendu | `src/render/plugins/cartes.ts` (nouveau ; une ligne dans le registre) — aucun fichier cœur du rendu modifié |
| Interface | `src/ui/layers-menu.ts` (menu Cartes), `src/ui/why.ts` + `panels.ts` (fiche Pourquoi), `src/ui/history-view.ts` + `charts.ts` (`drawTimeChart`) + `dashboards.ts` (Statistiques, Journal), `src/ui/notify-log.ts` + `notify.ts` (journal), `markup.html`, `styles.css` |
| Tests | `tests/jeu/interface.test.ts` (11 tests), `tests/e2e/interface-pc.mjs` (dans `npm run e2e`), `tests/e2e/interface-iphone.mjs` (facultatif : `npm run e2e:interface:iphone`) |

## 1. Menu Cartes

Bouton « Cartes » (icône calques) de la barre caméra. Une seule carte à la fois, classée par thème ; en tête : nom,
dégradé et libellés des extrémités, résumé (bâtiments pris en compte, nombre « en rouge »), « ce que ça montre » et
**Quoi faire**. Sur bureau, le menu s'ouvre à droite de la barre latérale (il passait dessous).

| Thème | Cartes |
|---|---|
| Habitants | Satisfaction (par logement), Chômage (par quartier : secteurs, sinon îlots de 500 m), Éducation (niveau moyen des adultes), Valeur foncière (fixe les loyers) |
| Services | Écoles (couverture), Santé, Criminalité, Risque d'incendie, Collecte des déchets (remplissage des bacs) |
| Réseaux | Électricité, Eau : desserte / pression / pollution |
| Environnement | Pollution de l'air (industrie + grille `pollution_air`), Bruit (grilles `bruit` et nuisances des déchets), Nuisances des déchets |
| Déplacements, territoire | Trafic (saturation), Transports en commun, Quartiers |

Les cartes nouvelles sont calculées par le module `cartes` **seulement quand elles sont affichées** : grille de 32 m,
une valeur 0..100 par cellule (pire bâtiment ; moyenne pour la valeur foncière), renvoyée par `calque { kind }` puis au
plus une fois par jour de jeu dans `delta.ext.cartes`. Le rendu reconstruit un maillage drapé (couleurs de sommets)
à chaque grille reçue, rien à chaque image. Lecture seule : la simulation est identique avec ou sans carte (testé).

## 2. Fiche « Pourquoi »

Encadré en tête de la fiche d'un bâtiment (`#info-why`), raisons **classées par importance**, une action pour chacune :

- **logement vide** : ruine / dégâts d'incendie, puis la raison de `vacancyReasons` (accès, eau, courant, loyer, demande) ;
- **personne n'y travaille** : accès, entreprise fermée, courant coupé, aucun chômeur, diplôme exigé ou distance ;
- **habitants mécontents** : facteurs de satisfaction négatifs des habitants du bâtiment (même calcul que le jour :
  `scoreCitizen`, partagé avec la passe quotidienne), chiffrés (« Loyer trop cher (45 % des revenus, soutenable :
  40 %) »), plus réseaux coupés et poubelles pleines ;
- **entreprise qui perd de l'argent** : raison principale (`CLOSURE_REASONS`), postes vacants, clientèle, part du loyer
  dans le chiffre d'affaires, sous-qualification, courant.

Données : `inspectBuilding().diagnosis` (facultatif, lecture tolérante). Mise en mots : `explainBuilding` (pure).

## 3. Graphiques d'évolution

Tableau de bord Statistiques : onglets Habitants, Trésorerie (courbe + barres du solde de chaque mois clos, rouges si
négatives), Emploi (emplois offerts, occupés, chômage en %), Satisfaction ; périodes **3 mois / 1 an / toute la partie**.

Module `historique` : un relevé par jour (7 entiers : jour, habitants, trésorerie, emplois, emplois occupés, chômage ‰,
satisfaction ×10) à partir du rapport que le module `paliers` calcule déjà ; 92 jours quotidiens, série longue de 256
points au plus (pas de 4 jours, doublé à chaque compaction), 480 soldes mensuels. Section `historique` v1 ;
**ancienne sauvegarde** : série longue et soldes repris de l'historique mensuel de l'économie (240 mois).

## 4. Notifications

- **Gravité** : urgent (faillite, incendies, ruines, coupures d'électricité ou d'eau), important (pannes, événements,
  paliers, criminalité, trafic, alertes inconnues), info (constructions, routes, démolitions, refus, sauvegardes,
  objectifs, chantiers…).
- **Regroupement** des doublons dans une seule entrée qui compte ses occurrences : « 12 constructions (dernière :
  Maison) », « Coupures d'électricité : 4 alertes (dernière : 13 bâtiments sans courant) » ; les messages qui ne
  diffèrent que par leurs nombres se regroupent aussi. Les toasts d'un même groupe se mettent à jour au lieu d'empiler.
- **Badge** : seulement les urgentes et importantes non lues. Journal classé Urgent > Important > Info, filtres,
  **Tout marquer comme lu**, Tout effacer ; ouvrir le journal marque les infos comme lues ; cliquer une entrée la marque.
- Aucun type de notification n'est supprimé.

## 5. Étiquette du curseur (correctif vérifié)

`tests/e2e/interface-pc.mjs` (1280×800, densité 1,5) : outil Bâtiments, choix d'un bâtiment, curseur à 12 positions
juste au-dessus de `#tool-options` : l'étiquette ne chevauche jamais `#tool-options` ni `#toolbar`, « Terminer » est au
premier plan et le clic ramène à l'outil Sélection. Le correctif de `hud.ts` tient ; aucune modification nécessaire.

## 6. Coût

Ville de charge (`buildCity stress`, 500 bâtiments, ≈ 22 000 habitants, Node 22, conteneur partagé très chargé) :
`historique.onDayStart` 0,03 ms en moyenne (0,16 ms au plus), section sauvegardée 1,5 ko après 30 jours (≤ ≈ 25 ko
quelle que soit la durée) ; grille d'une carte 0,3 à 3 ms (chômage le plus cher), une fois par jour de jeu et seulement
affichée ; fiche d'un bâtiment 6,5 ms (une passe sur les citoyens, à l'ouverture). Aucune boucle par image.

## 7. Limites

- Les cartes nouvelles se mettent à jour une fois par jour de jeu.
- Juste après un chargement, la valeur foncière est recalculée par la même formule à partir des services connus.
- Le regroupement des notifications repose sur les textes (règles dans `notify-log.ts`).
