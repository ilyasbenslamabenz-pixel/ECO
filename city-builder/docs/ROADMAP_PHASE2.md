# Feuille de route — Phase 2 (organisation validée par le propriétaire)

Statut : **préparée, non démarrée.** Aucune modification de phase 2 avant la validation complète
de la phase 1 (intégration terminée, `npm run check`, `npm run validate:visual` et QA verts).

Principes imposés :
- Priorité absolue à la qualité et à la stabilité, pas à la vitesse.
- Aucune fonctionnalité existante supprimée. Aucune exigence réduite sans accord écrit du propriétaire.
- Architecture générale gelée : ajouts rétrocompatibles uniquement. Tout besoin de changement → `docs/requests/`.
- Après **chaque** étape (2A, 2B, 2C et chaque sous-étape de 2B/2C) : version jouable publiée, tests
  automatisés verts, captures multi-angles, rapport « fonctionne réellement / reste à faire ».
- Aucun objectif de performance déclaré atteint sans mesure réelle (voir §5).

## 0. Préparation commune (après validation phase 1, avant 2A)

> **Points d'extension et banc de captures : FAITS** (branche locale `prep-phase2`, à fusionner après validation
> de la phase 1 ; détail : `docs/ARCHITECTURE.md` §9). Fichiers : `src/sim/plugins/{types,host,index}.ts` +
> `src/sim/plugins/<module>.ts` ; `src/shared/protocol-ext/{index,<module>}.ts` ; `src/sim/save-sections/{types,index,<module>}.ts` ;
> `src/render/plugins/{types,index,<module>}.ts` ; `src/ui/panels/{types,index,<module>}.ts` ; `tests/plugins/plugins.test.ts`,
> `tests/<module>/<module>.test.ts` (dans `npm test`) ; `tests/e2e/captures.mjs` (`npm run captures`). Branchements :
> `src/sim/world.ts`, `src/sim/handler.ts` (commande `pluginCommand`), `src/shared/protocol.ts`, `src/render/index.ts`.
> Reste à faire par le superviseur : l'audit d'intégration de la phase 1 (point 1, première moitié).

Fait par le superviseur sur la branche principale, en un commit :
1. **Audit d'intégration** de la phase 1 + banc de captures `npm run captures` (≥ 12 vues, échec sur
   image uniforme, erreur console ou modèle manquant).
2. **Points d'extension** pour que les branches parallèles ne touchent jamais les mêmes fichiers :
   - `src/sim/plugins/<module>.ts` (un fichier par module, enregistré une fois dans `src/sim/plugins/index.ts`) ;
   - `src/shared/protocol-ext/<module>.ts` (commandes et deltas propres au module, rétrocompatibles) ;
   - `src/sim/save-sections/<module>.ts` (section de sauvegarde versionnée par module, migration testée) ;
   - `src/render/plugins/<module>.ts` et `src/ui/panels/<module>.ts` (enregistrement dans le rendu et le HUD) ;
   - `tests/<module>/` et une entrée par module dans le script `npm test`.
   Chaque fichier d'enregistrement existe déjà (vide) avant le départ des branches : chaque agent
   ne remplit que les siens.

## 1. Phase 2A — en parallèle sur machines cloud séparées

Modules réellement indépendants, une session cloud et une branche Git chacun, base = commit de
préparation §0.

| Session | Branche | Propriété exclusive de fichiers |
|---|---|---|
| Bâtiments & quartiers | `claude/p2a-batiments` | `tools/buildings/**`, `assets/models/buildings/**`, entrées catalogue bâtiments, `src/sim/districts/**`, plugins `batiments` |
| Circulation | `claude/p2a-circulation` | `src/sim/traffic/**`, `src/render/vehicles/**`, `src/render/traffic-lights/**`, `tools/vehicles/**`, plugins `circulation` |
| Piétons | `claude/p2a-pietons` | `src/sim/pedestrians/**`, `src/render/pedestrians/**`, `tools/pedestrians/**`, `assets/models/pedestrians/**`, plugins `pietons` |
| Chantiers | `claude/p2a-chantiers` | `src/sim/construction/**`, `src/render/construction/**`, `tools/construction/**`, `assets/models/construction/**`, plugins `chantiers` |

Contenu :
- **Bâtiments & quartiers** : générateur architectural procédural (grammaire de façade, fenêtres,
  balcons, toitures, matériaux PBR, ≥ 6 styles originaux, ≥ 60 nouvelles variantes en plus des
  existantes, LOD) + générateur de quartiers (6 types, diversité mesurée, évolution des quartiers).
- **Circulation** : voies multiples, changements de voie (MOBIL), intersections avec réservation de
  conflits, feux à phases, priorités, anti-blocage, embouteillages émergents, carte de congestion,
  réacheminement, banc ≥ 2000 véhicules mesuré. Expose une API de feux pour les piétons.
- **Piétons** : graphe trottoirs/passages, emplois du temps, évitement local, respect des feux (via
  l'API de la circulation ; à défaut, traversée prudente), niveaux de détail, personnages GLB animés.
- **Chantiers** : état de chantier dans la sim (sauvegardé, pas de production avant achèvement),
  phases visibles, grue animée, échafaudages, démolition animée.

Règles : un agent ne modifie aucun fichier hors de sa propriété ; s'il en a besoin, il écrit une
demande dans `docs/requests/<module>.md`. Chaque branche doit passer `npm run check` seule.

**Intégration 2A** (superviseur, séquentielle) : fusion une branche à la fois dans l'ordre
bâtiments → circulation → piétons → chantiers, `npm run check` + captures après chaque fusion,
puis tests croisés (piétons × feux, quartiers × chantiers), QA indépendante, publication.

## 1bis. Refonte de l'interface (entre 2A et 2B)

Référence validée : `docs/ui/INTERFACE_REFERENCE.md` (+ `docs/ui/reference-interface.png`).
Barre supérieure complète, barre latérale de tableaux de bord, barre d'outils à sous-barres
colorées, panneaux à onglets, objectifs, mini-carte, variante iPhone. Aucune fonction existante
supprimée ; chaque bouton testé en e2e.

## 2. Phase 2B — intégration progressive, une sous-étape à la fois

Systèmes interdépendants : pas de parallélisme risqué. Chaque sous-étape = 1 agent + vérification
+ tests + publication avant la suivante.

1. **Contrat municipal** : grilles d'indicateurs par cellule, graphe de réseau générique, lignes
   budgétaires, registre d'effets traçable, ordre de mise à jour multi-fréquence.
2. **Simulation économique et sociale** : habitants (ménages, âges, revenus, éducation), emplois
   (par secteur et qualification), entreprises (création, croissance, faillite), chômage, salaires,
   loyers par segment, pouvoir d'achat, demande de logements, déménagements selon la qualité de
   vie, cycles économiques, évolution des quartiers (valorisation, déclin, gentrification).
3. **Fiscalité et budget** : 5 secteurs (dont agricole), taux par secteur/quartier, financement par
   service, salaires, entretien, investissements, dette, notation, intérêts, prévisions 12 mois.
4. **Électricité** : centrales (thermique, éolien, solaire, hydro), lignes, production/consommation,
   délestage, pannes, entretien.
5. **Eau et assainissement** : captage, pompage, traitement, canalisations, égouts, épuration,
   pollution des cours d'eau propagée vers l'aval.
6. **Déchets** : collecte par camions dans le trafic, tri, recyclage, incinération, décharges.

## 3. Phase 2C — même méthode progressive

1. **Services publics** : santé, éducation, police, pompiers (incendies), transports (bus), espaces
   verts, infrastructures ; couverture par réseau, capacité liée au financement.
2. **Politique et progression** : satisfaction, popularité, élections, ≥ 12 politiques publiques,
   subventions, niveaux de ville, missions, ≥ 15 événements, récompenses, ≥ 4 scénarios
   victoire/défaite.
3. **Atmosphère** : jour/nuit, éclairages, saisons, météo simulée.
4. **Bibliothèques d'assets externes** : étude des licences, intégration du mobilier urbain.
5. **Performance** : LOD, culling, simulation multi-niveaux, banc `?bench` sur l'appareil du joueur.

## 4. Tests d'effet obligatoires (gestion)

Chaque réglage du joueur a un test qui le modifie et mesure l'effet. Au minimum :
hausse d'impôts → baisse d'attractivité de quartiers ; pénurie électrique → coupures ;
déchets non collectés → pollution ; école sous-financée → moins de places ou qualité en baisse ;
chômage en hausse → départs et baisse du pouvoir d'achat ; loyers en hausse → déménagements.

## 5. Mesures de performance (format obligatoire)

`docs/PERFORMANCE.md`, généré depuis `tests/e2e/out/perf/*.json` : pour chaque scénario,
nombre de bâtiments, de véhicules et de piétons, FPS moyen, minimum et 1 % low, mémoire (heap JS +
estimation GPU), temps de simulation par tick (moyenne, p95), draw calls, triangles, et
configuration matérielle exacte (CPU, cœurs, RAM, OS, Chromium, renderer WebGL). Les FPS
mesurés sous SwiftShader (rendu logiciel, sans GPU) sont marqués **non représentatifs**.
Banc `?bench` pour mesurer sur l'appareil réel du joueur.

## 6. Décisions du propriétaire (2026-11-13)

- Style architectural : **européen** (pas de style médina).
- Monnaie affichée : **franc suisse (CHF)** — à appliquer lors de la refonte de l'interface
  (formatage « 12,5 M CHF »), sans changer les montants internes ni casser les sauvegardes.
- Nom du jeu : **Meknes City** (voir `docs/ui/INTERFACE_REFERENCE.md`).
- Le jeu doit être **accessible par une URL** à chaque étape : publication en artifact claude.ai.
  Les artifacts ne servent ni `.glb` ni `.hdr` : l'étape de publication convertit les GLB en glTF
  JSON (buffer embarqué) et embarque les HDRI dans `catalog.json` (script à intégrer :
  `scripts/pack-artifact.mjs`, après la phase 1).

## 7. Ajouts du propriétaire (2026-11-13) : exportations, port, aéroport

**Exportations de ressources (phase 2B, après l'économie et la fiscalité)**
- Chaînes de production réelles : agriculture (céréales, fruits, élevage), industrie (matériaux,
  biens manufacturés), énergie (surplus électrique, déjà prévu), éventuellement extraction selon le terrain.
- Stocks par entreprise/entrepôt, demande et **prix des marchés extérieurs** fluctuant avec les cycles
  économiques ; contrats d'exportation (volume, durée, prix) proposés au maire.
- Les biens partent **physiquement** : camions dans le trafic jusqu'aux sorties de carte, puis par le
  port et l'aéroport quand ils existent (capacité, coût et délai différents). Recettes : taxes
  d'exportation et impôts des entreprises exportatrices ; effets : emplois, pollution, trafic poids lourds.
- Tableau de bord Commerce : production, stocks, exportations/importations, balance commerciale, prix.

**Port (phase 2C, transports)**
- Constructible uniquement sur le littoral ou un cours d'eau navigable (validation par la simulation).
- Port de commerce (quais, grues portuaires animées, conteneurs, entrepôts) : capacité d'export/import
  par bateau, navires visibles en mer ; option port de passagers (ferries, tourisme).
- Effets : emplois, trafic de camions autour du port, pollution de l'eau et de l'air, bruit.

**Aéroport (phase 2C, transports)**
- Terrain plat et grand, piste orientée, interdiction de hauteur des bâtiments dans l'axe des pistes.
- Aérogare, pistes, tour de contrôle, avions qui décollent/atterrissent ; fret aérien (rapide, cher,
  petits volumes de biens à forte valeur) et passagers (tourisme, attractivité des bureaux).
- Effets : bruit fort sur les quartiers voisins (baisse de valeur foncière et de satisfaction), emplois.

Tous les modèles 3D (grues, navires, avions, terminaux) sont des GLB détaillés générés par nos outils
ou issus de sources à licence vérifiée ; aucun primitif. Tests d'effet obligatoires (ex. : un port
augmente la capacité d'export ; un aéroport fait baisser la satisfaction des quartiers sous les pistes).
