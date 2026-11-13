# Performance et mémoire sur téléphone

## Problème

Sur iPhone, Safari ferme l'onglet ou perd le contexte WebGL quand la page demande trop de mémoire
graphique. La version en ligne (`3cf443d`) plantait souvent, surtout sur la démo.

## Mesures

Les mesures ont été prises sur un Mac (GPU Metal, Chromium) qui imite un iPhone : écran 390×844, rapport
de pixels 3, agent utilisateur iPhone, qualité par défaut.

On compte la mémoire réellement envoyée au GPU en instrumentant `texImage2D`, `texStorage2D` et
`bufferData`. Le tas JavaScript est mesuré après un passage du ramasse-miettes. Toutes les mesures sont
prises 6 s après le chargement.

| Situation | Textures envoyées au GPU | Tampons de géométrie | Tas JS | Canevas | Appels de rendu / triangles |
|---|---|---|---|---|---|
| Nouvelle partie, avant | 235 Mo | 47 Mo | 12,4 Mo | 585×1266 (1,5×) | 48 / 215 k |
| Nouvelle partie, **après** | **107 Mo** | 47 Mo | 12,9 Mo | 487×1055 (1,25×) | 31 / 52 k |
| Démo (113 bâtiments, 100 véhicules), avant | 791 Mo | 65 Mo | 51,2 Mo | 585×1266 | 1 345 / 1,57 M |
| Démo, **après** | **163 Mo** | 59 Mo | 25,3 Mo | 487×1055 | 1 134 / 1,42 M |

Dans la démo, la mémoire graphique des textures baisse de 79 %. Il faut y ajouter la carte d'ombre :
16 Mo avant (2048²), 4 Mo après (1024²).

Avant la correction, la démo comptait environ 100 textures de 1024² (≈ 520 Mo) et environ 120 textures
de 512² (≈ 160 Mo). Ce sont surtout des textures intégrées aux modèles GLB : bâtiments, arbres et
accessoires.

## Mode allégé automatique

Le module `src/render/device-profile.ts` choisit le profil de rendu. Le réglage « Qualité » propose
désormais **Auto**, qui est la valeur par défaut, en plus de Basse, Moyenne et Haute.

« Auto » active le mode allégé sur :
- un téléphone ou une tablette (reconnu par l'agent utilisateur) ;
- un appareil avec `navigator.deviceMemory` ≤ 4 Go ;
- un appareil tactile dont le petit côté d'écran fait au plus 900 px.

Le paramètre `?lite=1` (ou `?lite=0`) force ce choix.

Ce que change le mode allégé :

| Réglage | Normal | Allégé |
|---|---|---|
| Rapport de pixels | 1,5× au plus (« moyenne ») | 1,25× au plus (1× en « basse ») |
| Textures d'image | taille d'origine | 256 px au plus (512 px si « moyenne » est choisie à la main sur téléphone) |
| Carte d'ombre | 2048 ou 4096 | 1024 |
| Végétation (LOD0 / LOD1 / imposteur / masquée) | 50 / 120 / 240 / 3800 m | 35 / 90 / 200 / 2600 m |
| Distances de LOD des bâtiments | × 1 | × 0,7 (× 0,55 en « basse ») |
| Préchargement de tous les modèles (démo) | oui | non : chargement à la demande |
| Particules météo | qualité haute | qualité basse |

Pour réduire les textures, `renderer.capabilities.maxTextureSize` est abaissé juste après la création du
rendu, avant tout envoi au GPU. Three redimensionne alors lui-même chaque image trop grande avant de
l'envoyer (`resizeImage`). Les cartes d'ombre ne sont pas affectées : elles lisent la vraie limite à la
création du rendu.

Ces réglages s'appliquent au démarrage. Un changement de « Qualité » en cours de partie modifie tout de
suite la résolution et les ombres ; les textures et les LOD changent au prochain chargement de la page.

## Pic au chargement (plantage au chargement sur iPhone)

Le plafond `maxTextureSize` n'agit qu'à l'envoi au GPU : les images étaient d'abord décodées en pleine taille
côté CPU. En mode allégé, chaque image de texture est désormais réduite **dès son chargement**, puis l'original
est libéré (fichier `src/render/image-cap.ts`) :
- textures intégrées aux GLB : chargeur d'assets ;
- jeux de textures des bâtiments.

Les modèles GLB sont aussi chargés **un par un** (file d'attente du chargeur d'assets).

Pic de tas JS pendant le chargement (`Performance.getMetrics` toutes les 250 ms, iPhone 390×844 émulé) :

| Chargement | Profil normal (`?lite=0`) | Mode allégé |
|---|---|---|
| Nouvelle partie : pic de tas JS / textures GPU | 28 Mo / 248 Mo | 32 Mo / 111 Mo |
| Démo : pic de tas JS / textures GPU | 91 Mo / 808 Mo | 74 Mo / 165 Mo |

Détection : iPadOS, et Safari en mode « version ordinateur » sur iPhone, se présentent comme un Mac. Une
plateforme `MacIntel` avec plus d'un point de contact (`maxTouchPoints`) est donc traitée comme un mobile.

**Repli sûr** : un drapeau est posé dans le stockage local au début du chargement, puis retiré quand le jeu
est prêt. S'il est encore présent au démarrage suivant, c'est que Safari a fermé l'onglet pendant le
chargement. Le jeu redémarre alors en mode allégé forcé et en qualité basse, avec un message. Choisir une
qualité dans les réglages désactive ce mode sûr. Ce comportement a été vérifié en simulant le plantage.

## Perte du contexte WebGL

Le code se trouve dans `src/main.ts`.

À la perte du contexte (`webglcontextlost`) :
- la page appelle `preventDefault`, ce qui autorise la restauration ;
- le rendu est suspendu et le message « Reprise de l'affichage… » s'affiche ;
- la partie est sauvegardée tout de suite (sauvegarde locale et envoi en ligne).

À la restauration (`webglcontextrestored`) :
- three renvoie au GPU les textures et les géométries ;
- `render.rebuildGpu()` reconstruit ce qui n'existait que sur le GPU : la carte d'environnement du ciel et
  les atlas d'imposteurs des arbres, refaits à partir des modèles gardés en mémoire ;
- les options graphiques sont réappliquées, l'affichage reprend et le message « Affichage rétabli »
  apparaît.

Ce chemin a été vérifié avec `WEBGL_lose_context` (perte puis restauration forcées) : le message
s'affiche, puis la ville réapparaît à l'identique, arbres compris.

La sauvegarde automatique quand l'onglet passe en arrière-plan ou se ferme existait déjà
(`src/save/auto-triggers.ts` : `visibilitychange` caché et `pagehide`). Elle est installée au démarrage.

## Limites et pistes

- Les nombres maximaux de véhicules et de piétons appartiennent aux modules circulation et piétons
  (branches parallèles). Ils n'ont pas été modifiés.
- La vérification a été faite par émulation sur Mac. Un essai sur un vrai iPhone reste à faire : ouvrir la
  démo, changer de vue, laisser tourner quelques minutes.
