# ECO NATION — Équilibrage par parties simulées

Ce document rend compte d'une passe d'équilibrage. Elle s'appuie sur un harnais de joueurs-robots déterministes. On cherche un jeu **addictif et juste** :

- chaque décision a un effet visible en quelques mois ;
- les missions sont atteignables avec un effort raisonnable ;
- le facteur 4 est difficile mais faisable ;
- l'inaction est sanctionnée sans rendre le jeu injouable ;
- aucune stratégie unique ne règle tout.

## 1. Méthode

`npm run playtest` lance `tests/playtest.ts`, qui s'appuie sur la bibliothèque `tests/playtestLib.ts`. Le harnais joue des parties complètes avec les mêmes leviers que le joueur : diagnostic des besoins, recrutements, programmes, centrales, cartes du plan climat, budget et fiscalité votés au parlement.

| Robot | Comportement |
|---|---|
| **Passif** | Ne fait rien. |
| **Besoins** | Chaque mois, applique la première action payante du besoin le plus urgent (`assessNeeds`, niveau ≥ 1), si le budget le permet. Le budget le permet tant que le déficit reste sous 4 %, la dette sous 110 % et le coût sous 0,4 % du PIB. Un besoin traité n'est pas retraité avant 12 mois. |
| **Climat** | Chaque mois, joue la carte disponible qui évite le plus de CO₂ par point de soutien dépensé. |
| **Austérité** | −4 % sur toutes les lignes budgétaires chaque janvier pendant 5 ans (environ −18 %). |
| **Dépensier** | +5 % sur toutes les lignes chaque janvier. Applique jusqu'à 3 actions de besoins par mois sans regarder le budget et jusqu'à 2 cartes climat par mois. |
| **Équilibré** | Lance la recherche orientée climat dès le départ. Lit ses missions : à l'apparition d'une mission, il actionne une fois le levier rapide évident, par exemple un recrutement, +1 point de TVA, une aide à l'embauche, une centrale solaire ou une carte. Il traite aussi les besoins sous contrainte budgétaire, joue une carte climat tous les deux mois si le déficit reste sous 4 %, et pilote la TVA chaque année selon le déficit. |

Mesures relevées :

- missions réussies et échouées, délai moyen ;
- jalons 2035 et 2050, avec leur écart en points de la référence ;
- émissions nettes, dette, chômage, satisfaction, popularité du camp gouvernemental ;
- élections : G = gagnée (majorité ou coalition élargie), C = cohabitation, P = perdue ;
- défaites, crises (événements hors opportunités), premier trophée, XP et titre à 10 et 30 ans.

Après une défaite, la partie continue en mode libre pour mesurer la suite. Les élections qui suivent une défaite ne comptent donc plus.

Protocole des tableaux : 3 graines de pays (2030, 7 et 99), 30 ans par partie. Quand une cellule contient trois valeurs, ce sont les trois graines. Les autres cellules donnent la moyenne. La colonne « avant » correspond au moteur d'origine joué par **les mêmes robots**.

```bash
npm run playtest                     # 6 stratégies × 3 graines × 30 ans (≈ 40 s)
npm run playtest -- 50 2030          # 50 ans, une graine
npm run playtest -- 30 2030,7,99 --md --detail
```

## 2. Constats avant réglage

1. **Missions quasi inatteignables.** Le joueur passif réussissait 0,5 % de ses missions et le joueur équilibré 18 %. Trois causes :
   - **Cibles trop raides par rapport aux leviers réels.** Les mesures sur 12 mois le montrent : un levier fort fait gagner environ 0,2 point de satisfaction, alors que la mission demandait +2,5 points en 12 mois. Pour le chômage, +1 500 € d'aide à l'embauche donnent −0,25 point, et la mission demandait −0,8 point. Pour les soins, 2 000 médecins donnent +1,9 point de capacité, et la mission demandait +3 points.
   - **Échéances plus courtes que les chantiers.** La mission « écoles » durait 12 à 15 mois, alors qu'un lycée se construit en 30 mois. La mission « universités » durait 15 mois, pour un chantier de 48 mois.
   - **Arrondis vers le haut.** Avec `Math.ceil(sat + 2.5)`, la cible pouvait demander jusqu'à +3,5 points. L'arrondi pouvait doubler l'effort réellement demandé.
2. **Missions gagnées sans agir la première année.** Le transitoire conjoncturel de départ fait déjà baisser le chômage d'environ 0,5 point, la dette d'environ 3 points et le déficit d'environ 0,6 point. La moyenne glissante des émissions suit la saison tant qu'elle ne couvre pas 12 mois.
3. **Personne ne perdait les élections, même sans rien faire** (GGGGGGG pour le passif). La satisfaction, donc la popularité, restait plate. De plus, l'élargissement de coalition faisait boule de neige : une coalition à 4 partis gagnait toutes les élections suivantes.
4. **Diagnostic des besoins peu efficace.** Les actions proposées étaient des constructions : construire un commissariat n'améliore que l'état des locaux (effet nul en 24 mois), et un hôpital sans budget de fonctionnement n'ouvre pas de lits. Les leviers rapides (recrutements) n'étaient pas proposés.
5. **XP gonflée par les cartes climat** (10 XP par carte et 20 XP par bilan). Le robot « climat » devenait Chef d'État en 10 ans en enchaînant les cartes.
6. **Anomalie comptable latente.** La dotation des missions réussies était versée directement en trésorerie, hors comptes. L'identité « Δ trésorerie = solde + emprunts » cassait dès qu'une mission réussissait. Le test l'ignorait seulement parce qu'aucune mission n'était réussie pendant les 36 premiers mois.
7. **Facteur 4.** Le jalon 2050 n'était atteint par aucun robot. Le robot « climat » épuise tout le catalogue de cartes vers 18 ans. Ensuite, le frein est la jauge de soutien de l'État, qui dépend du déficit et de la dette.

## 3. Réglages modifiés

| Domaine | Réglage | Avant | Après | Pourquoi |
|---|---|---|---|---|
| Missions (`missions.ts`) | Satisfaction (amélioration) | +2,5 pts (arrondi ↑) en 12 mois | +0,5 pt (arrondi au ½ point) en 18 mois | La satisfaction bouge d'environ 0,2 pt par levier : la cible demandait 10 leviers. |
| | Chômage | −0,8 pt en 15 à 18 mois | −0,2 pt (arrondi au plus proche) | Un levier d'emploi fait −0,25 pt en 12 mois. |
| | Dette | −4 pts en 24 mois | −2 pts (arrondi au ½ point) | Pente spontanée ≈ −1,2 pt par an ; −2 pts demandent un vrai effort. |
| | Déficit | −0,8 pt | −0,5 pt (−1 pt au-delà de 3,5 %) | +1 point de TVA ou −1,5 % de budget ≈ −0,5 pt. |
| | Pauvreté | −0,8 pt | −0,2 pt | Indicateur très inerte. |
| | Sécurité (besoin / amélioration) | +4 / +3 (arrondi ↑) | +1 (½ point) | 8 % de policiers en plus font environ +1,5 en 15 mois. |
| | Capacité de soins / attente | +3 pts ; −15 % ou −3 jours | +2 pts ; −10 % ou −2 jours | Calées sur un recrutement de médecins. |
| | Air | +3 à +4 pts en 18 mois | +0,6 à +0,8 pt en 18 à 24 mois, affichage au dixième | L'air progresse de 0,3 pt par an ; une fermeture de centrale à charbon apporte +0,9 pt. |
| | Écoles, universités | −5 à −6 pts en 12 à 15 mois | −3 pts en 24 mois | Échéance plus longue que le chantier. |
| | Logement (attente, tension) | −25 % ; −0,03 | −15 % ; −0,02 | Même principe. |
| | Échauffement macro (`MACRO_WARMUP`) | — | 12 mois sans mission chômage, dette, déficit ni émissions | Évite les missions gagnées sans agir (constat 2). |
| | Dotation de mission | `cash +=` hors comptes | Recette « divers » du mois (`addRevenue`) | Rétablit l'identité de trésorerie. |
| | Titres (XP) | 0 / 250 / 600 / 1 100 / 1 800 / 2 800 / 4 200 / 6 000 | 0 / 300 / 900 / 1 700 / 2 800 / 4 400 / 6 800 / 12 000 | Actif : Ministre vers 10 ans, Chef d'État vers 30 ans ; « visionnaire » reste exceptionnel. |
| Politique (`politics.ts`) | Usure du pouvoir | — | −0,04 par an sur le log du poids électoral du camp du chef du gouvernement, plafond 0,5, diminuée du **bilan** | Sanctionne l'inaction (élection perdue vers 8 à 12 ans) ; un bilan solide la compense. |
| | Bilan (`record`) | — | Mission réussie : +0,012 × difficulté (échec : −35 %) ; jalon climat atteint : +0,06 à +0,14 (manqué : −0,02 × k) | Relie la progression (missions, jalons) au destin électoral. |
| | Coalitions | Élargissement sans condition, définitif | Accords valables pour une législature : on se représente avec son camp d'origine (`core`), qui doit garder ≥ 44 % des sièges pour s'élargir | Supprime la boule de neige à 4 ou 5 partis. |
| Besoins (`needs.ts`, `Besoins.tsx`) | Santé, sécurité | Construction seulement | **Recrutement** de médecins ou de policiers proposé en premier (nouvelle action `recruit`, coût annuel affiché) | Effet mesurable en 6 à 9 mois ; un test le vérifie. |
| | Énergie verte | 300 MW solaire | Libellés avec les délais (éolien en mer 4 ans, solaire 600 MW en 1 an) | Information du joueur. L'éolien reste en tête : il produit plus. |
| Plan climat (`climate.ts`) | XP d'une carte / d'un bilan | 10 / 20 | 4 / 8 (`CARD_XP`, `CARD_REPORT_XP`) | Enchaîner les cartes ne suffit plus à monter en grade. |
| | Capital gagné par une mission réussie | État +1, Citoyens +3 | État +2, Citoyens +3 | Synergie missions ↔ climat : le jeu équilibré est récompensé. |
| | Jalon atteint | État +12, Entreprises +8, Citoyens +12 | État +20, Entreprises +10, Citoyens +15 | Le succès relance la capacité d'action (le soutien de l'État est le frein tardif). |
| | Cartes rejouables | — | Deux fois : complément renouvelable, prime pompe à chaleur, fonds rénovation, aide isolation, bonus VE, aide industrie propre. Plus de fois : solaire 5→8, éolien en mer 3→5, rénovation 5→8, tram 4→6, électrification 4→6 | Leviers tardifs pour le facteur 4, rendus chers par la lassitude (×1,3 par utilisation, inchangée). |
| Tests | `vitest.config.ts` | Délai 5 s | 30 s par test | Les tests de 30 ans dépassaient 5 s sur une machine chargée (échecs intermittents). |

**Aucun test existant n'a été modifié.** Les identités comptables sont préservées, et la dotation de mission les respecte désormais. `npm run calibrate` est inchangé au dixième près à 1, 10, 20 et 50 ans sur le PIB, le chômage, l'inflation, la dette, les émissions et la satisfaction. L'équilibre macroéconomique sans intervention n'a donc pas été touché. Seuls deux chiffres bougent : la confiance gagne 1 à 3 points, parce que le passif échoue à moins de missions, et le mois où tombe une dotation de mission voit ses recettes augmenter de 0,1 à 0,2 point.

## 4. Résultats (3 graines × 30 ans)

### Avant (moteur d'origine, mêmes robots)

| Indicateur | Passif | Besoins | Climat | Austérité | Dépensier | Équilibré |
|---|---|---|---|---|---|---|
| missions ✓/✗ | 0.3/60.7 | 7.7/59.7 | 7.3/59.7 | 2.0/59.7 | 11.0/52.7 | 11.3/52.0 |
| taux ✓ | 0.5% | 11.4% | 10.9% | 3.3% | 17.2% | 17.9% |
| délai ✓ (mois) | 2.7 | 16.3 | 15.2 | 16.8 | 10.4 | 14.3 |
| jalon 2035 | raté raté raté | raté raté raté | proche proche proche | raté raté raté | OK OK OK | OK OK OK |
| écart 2035 (pts) | 13.7 12.8 14.2 | 11.8 11.4 12.3 | 2.3 1.9 2.4 | 12.1 11.3 13.1 | -0.7 -1.1 -1.3 | -2.2 -1.2 -1.0 |
| jalon 2050 | raté raté raté | raté raté raté | raté proche raté | raté raté raté | raté raté raté | proche proche proche |
| CO₂ −% 10/30 ans | 10.3%/22.4% | 13.2%/28.2% | 28.3%/51.5% | 13.6%/32.0% | 31.1%/31.5% | 31.4%/56.1% |
| dette 10/30 ans | 66.5%/35.4% | 70.4%/41.3% | 70.1%/37.0% | 54.4%/28.6% | 141.3%/564.4% | 75.3%/44.9% |
| chômage 10 ans | 8.0% | 7.9% | 9.4% | 10.3% | 7.2% | 9.7% |
| satisf. 10/30 | 66.0/66.6 | 66.1/66.6 | 64.6/64.4 | 58.6/62.2 | 73.1/68.4 | 64.8/66.3 |
| élections | GGGGGGG ×3 | GGGGGGG ×3 | GGGGGGG ×3 | GGGGGGG GGPP GGGGPGG | GP GP GP | GGGGGGG ×3 |
| défaite | aucune | aucune | aucune | aucune, élections 12 a, élections 20 a | défaut 7,5 a ×3 | aucune |
| crises (30 ans) | 14.7 | 14.7 | 15.0 | 21.3 | 15.7 | 13.7 |
| 1er trophée (mois) | 48 48 48 | 31 31 31 | 14 27 14 | 30 37 25 | 14 23 14 | 12 12 12 |
| XP 10/30 ans | 787/2013 | 1693/4200 | 3827/7163 | 1463/2477 | 4237/6200 | 4047/8337 |
| titre 10/30 | Préfet / Ministre | Min. délégué / Premier ministre | Chef d'État / visionnaire | Min. délégué / Ministre | Chef d'État / Chef d'État | Chef d'État / visionnaire |

### Après

| Indicateur | Passif | Besoins | Climat | Austérité | Dépensier | Équilibré |
|---|---|---|---|---|---|---|
| missions ✓/✗ | 8.7/53.7 | 15.7/44.3 | 16.7/49.3 | 10.7/53.0 | 27.3/38.3 | 32.7/31.7 |
| taux ✓ | 13.8% | 26.1% | 25.3% | 16.7% | 41.3% | **50.5%** |
| délai ✓ (mois) | 12.4 | 13.8 | 14.3 | 11.4 | 10.4 | 12.7 |
| jalon 2035 | raté raté raté | raté raté raté | proche proche proche | raté raté raté | OK OK OK | OK OK OK |
| écart 2035 (pts) | 13.7 12.8 14.2 | 11.8 11.4 12.3 | 2.0 1.8 2.4 | 12.1 11.3 13.1 | -1.3 -1.1 -1.3 | -1.8 -1.3 -0.2 |
| jalon 2050 | raté raté raté | raté raté raté | raté proche raté | raté raté raté | raté raté raté | proche proche proche |
| CO₂ −% 10/30 ans | 10.3%/22.4% | 13.1%/27.9% | 28.3%/52.0% | 13.6%/32.1% | 31.2%/31.6% | 31.3%/55.8% |
| dette 10/30 ans | 66.5%/35.4% | 69.6%/40.9% | 69.4%/36.4% | 54.5%/28.6% | 141.0%/563.6% | 75.8%/50.7% |
| chômage 10 ans | 8.0% | 7.8% | 9.4% | 10.3% | 7.2% | 9.3% |
| satisf. 10/30 | 66.0/66.6 | 66.7/67.0 | 64.6/64.8 | 58.6/62.2 | 73.1/68.5 | 65.4/66.5 |
| élections | GPP GGPP GPP | GGPGGGP GGGGGGG GGGPGGP | GGGGGGP GGGGPP GGGGPGP | PP PP PP | GP GP GP | GGGGPGG GGGGGGG GGGGGGP |
| défaite | **élections 8 / 12 / 8 a** | élections 12 a, aucune, 16 a | élections 28 / 20 / 20 a | élections 4 a ×3 | défaut 7,5 a ×3 | élections 20 a, aucune, 28 a |
| crises (30 ans) | 14.7 | 14.3 | 14.7 | 20.7 | 15.7 | 13.3 |
| 1er trophée (mois) | 33 31 48 | 31 31 31 | 30 44 32 | 30 31 25 | 23 23 23 | **12 12 12** |
| XP 10/30 ans | 1123/3213 | 2163/5447 | 3208/7415 | 1593/3557 | 5443/8119 | 3932/9953 |
| titre 10/30 | Préfet / Min. délégué | Min. délégué / Premier ministre | Ministre / Chef d'État | Min. délégué / Ministre | Premier ministre / Chef d'État | Ministre / Chef d'État |

Sur 50 ans (graine 2030), le taux de réussite des missions du joueur équilibré retombe à 39 % : les cibles tardives sont plus exigeantes. Le passif tombe à 8 %. Aucune dérive macroéconomique n'apparaît.

### Lecture au regard des objectifs

| Objectif | Résultat |
|---|---|
| Passif : perd ou stagne, élection perdue vers 8 à 12 ans, jalon 2035 manqué | ✔ Élection perdue à 8, 12 et 8 ans ; jalon 2035 manqué de 13 à 14 points ; 14 % de missions réussies (dérive spontanée). Ni défaut ni émeutes : le jeu reste jouable. |
| « Besoins » et « climat » seuls : résultats partiels | ✔ 25 à 26 % de missions. Besoins : 2035 manqué, défaite à 12 ou 16 ans (1 graine sur 3 sans défaite). Climat : 2035 « proche » (écart de 2 points), défaite à 20 à 28 ans. |
| Équilibré : peut atteindre 2035 et gagner des élections, sans garantie | ✔ 2035 atteint dans les 3 graines (marge de 0,2 à 1,8 point) ; élections gagnées pendant 20 ans ou plus, mais perdues à 20 et 28 ans dans 2 graines sur 3. |
| Dépensier : crise de dette | ✔ Défaut de paiement vers 7,5 ans (dette > 140 % du PIB), malgré 41 % de missions réussies et le jalon 2035. |
| Austérité : impopularité | ✔ Satisfaction −7 points à 10 ans, élection perdue dès 4 ans. |
| Environ 1 mission sur 2 pour un joueur actif | ✔ 50,5 % (contre 17,9 %) ; réussite en 12,7 mois en moyenne. |
| Premier trophée en 12 à 24 mois pour un joueur actif | ✔ 12 mois (première mission réussie). Le passif ne l'obtient qu'à 31 à 48 mois. |
| Facteur 4 difficile mais faisable | ≈ Jalons 2035 et 2040 tenus par le jeu équilibré ; 2050 « proche » (écart de 3 à 5 points). Un robot « expert » (équilibré + 600 MW d'éolien en mer par an + fermeture du fossile quand la marge le permet) termine à 0,4 et 3,9 points de 2050 : un joueur qui tient aussi ses finances (la jauge État dépend du déficit et de la dette) peut l'atteindre. |
| Aucune stratégie unique ne règle tout | ✔ Le climat seul échoue aux missions et perd les élections, les besoins seuls manquent 2035, le dépensier fait défaut et l'austérité perd tout de suite. |

## 5. Tests de non-régression (`tests/balance.test.ts`)

Ces tests font jouer les robots sur une graine, pendant 8 à 16 ans selon la stratégie, avec des bornes larges :

- **Passif** : moins de 30 % de missions réussies, jalon 2035 manqué, élection perdue entre 6 et 14 ans, aucune défaite autre qu'électorale.
- **Besoins et climat** : meilleurs que le passif, moins bons que l'équilibré ; les besoins seuls manquent 2035, le climat seul passe à moins de 6 points de 2035.
- **Dépensier** : dette au-dessus de 120 % du PIB et défaut de paiement.
- **Austérité** : satisfaction à 5 ans inférieure d'au moins 3 points à celle du passif, élection perdue avant 8 ans.
- **Équilibré** :
  - 35 à 75 % de missions réussies, en 4 à 20 mois ;
  - premier trophée avant 24 mois ;
  - titre entre Ministre délégué et Premier ministre à 10 ans ;
  - écart au jalon 2035 inférieur à 3 points ;
  - majorité tenue plus longtemps que le passif, sans défaut, dette sous 100 %.
- **Crises** : entre 0,2 et 1,2 par an.
- **Retour rapide d'une décision** : un recrutement de 8 % de médecins améliore la capacité de soins et l'attente en 9 mois.

## 6. Limites et pistes

- **Satisfaction peu sensible.** Un levier isolé la fait varier d'environ 0,2 point. Les cibles ont été adaptées, mais le modèle de satisfaction (13 facteurs moyennés) n'a pas été modifié, pour ne pas toucher au calibrage. Une sensibilité plus forte aux services rendrait les décisions plus perceptibles.
- **Constructions de sécurité.** Un commissariat n'améliore que l'état des locaux. Le recrutement est désormais proposé en premier, mais l'effet propre des constructions reste faible.
- **Austérité.** Elle perd dès la première élection : le robot coupe de 4 % par an, ce qui est brutal. Une austérité modérée n'a pas été mesurée.
- **Missions après 30 ans.** Le taux de réussite baisse à mesure que les indicateurs s'améliorent (cibles relatives). On pourrait plafonner la difficulté quand un indicateur est déjà bon.
