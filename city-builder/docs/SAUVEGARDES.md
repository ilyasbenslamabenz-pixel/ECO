# Sauvegardes

## Locales (toujours actives)

`src/save/store.ts` — `SaveStore` : emplacements nommés (`SLOT_RE`), JSON compressé gzip
(`codec.ts`), support IndexedDB → localStorage → mémoire (`backends.ts`). Métadonnées séparées
(`meta:<slot>`) pour lister sans décompresser. `autosave.ts` — `Autosaver` : rotation
`auto-1..3` toutes les 3 min. Sauvegarde rapide : emplacement `rapide`.

## Entièrement automatique (aucune action du joueur)

`src/save/auto-triggers.ts` — `AutoSaveTriggers`, branché dans `src/main.ts` :

| Moment | Effet |
|---|---|
| toutes les 3 min | `Autosaver` (rotation `auto-1..3`) ; envoyé en ligne au plus 1 fois / 2 min |
| construction / démolition (`placeBuilding`, `demolish`, `buildRoad`, `removeRoad` réussies) | sauvegarde au plus 1 fois / min, avec une sauvegarde de rattrapage en fin de minute |
| onglet en arrière-plan (`visibilitychange` caché) ou fermeture (`pagehide`) | sauvegarde locale puis envoi en ligne immédiat (`flush`, seuls les emplacements modifiés partent) |
| retour au menu, « Quitter » | idem |
| lancement | « Continuer » propose la partie **la plus récente**, locale ou en ligne (`latestSlot(store.list())`) ; sur un autre appareil, la liste inclut les sauvegardes en ligne et le chargement les rapatrie |

Rien ne se déclenche hors partie (menu principal, démonstration, test de charge). Les commandes
importantes sont détectées en enveloppant `SimBridge.send` dans `main.ts` (liste `IMPORTANT_COMMANDS`).
En navigation `pagehide`, la sauvegarde (aller-retour avec le worker) est « au mieux » :
`visibilitychange` survient normalement avant et laisse le temps de finir.

## En ligne (artifact claude.ai)

`src/save/cloud.ts` — sauvegardes privées par joueur, synchronisées entre appareils, quand le jeu
tourne dans un artifact publié avec `capabilities: { db: {}, user: {} }` (règles par défaut).

### Branchement (`src/main.ts`, 2 lignes)

```ts
installCloudSaveBadge();                 // indicateur discret (src/ui/save-slots.ts)
store = await attachCloudSaves(store);   // SaveStore local -> SaveStore synchronisé
```

- `window.claude` absent (navigateur, e2e, dev) : `attachCloudSaves` rend **le même objet**
  `SaveStore` ; état `disabled`, aucun indicateur, comportement identique à avant.
- Dans l'artifact, `use("db")` ou `user.id()` null, refusé ou trop lent (20 s) : un
  `CloudSlotProvider` hors ligne qui délègue tout au stockage local (état `offline`).
- Sinon : `CloudSlotProvider` connecté à la collection `data/users/<id>` (privée au joueur).
  La synchronisation initiale démarre en arrière-plan, sans retarder le démarrage.

`CloudSlotProvider` **hérite de `SaveStore`** : `save/load/has/list/remove` gardent leur
signature, donc `Autosaver`, `setSlotProvider` et l'interface n'ont pas changé.

### Comportement

| Opération | Effet |
|---|---|
| `save(slot)` | écriture locale immédiate (résultat rendu tout de suite), puis envoi en ligne en arrière-plan. Emplacements nommés et `rapide` : envoi immédiat. Autosauvegardes `auto-*` : **au plus un envoi / 2 min** (créneau différé). |
| `load(slot)` | relit la méta en ligne ; si elle est **plus récente** (`savedAt`) que la locale, télécharge, vérifie, décode puis l'écrit localement ; sinon (ou en cas d'échec) charge la locale. |
| `list()` | union locale + en ligne ; par emplacement, la version la plus récente. |
| `has(slot)` | locale ou en ligne (bouton « Continuer »). |
| `remove(slot)` | suppression locale + en ligne (méta d'abord, puis morceaux). |
| démarrage | **migration** : toute sauvegarde locale absente en ligne ou plus récente est envoyée (idempotent). |
| sortie | `visibilitychange` (caché) et `pagehide` : envoi forcé de ce qui attend (`flush()`). |
| échec réseau | état `offline`, la locale est conservée ; nouvel essai au créneau suivant (2 min). |

Garanties : une seule opération à la fois par emplacement (file par emplacement, donc jamais
deux écritures simultanées sur un document) ; **aucune écriture si l'empreinte SHA-256 est
identique** à celle en ligne ; un appareil en retard n'écrase jamais une version en ligne plus
récente ; un envoi déjà en file n'est pas dupliqué (il lit les octets les plus récents).

### Format en ligne (collection `data/users/<id>`)

- `save__<slot>__part__<n>` : `{ kind: 'part', slot, n, sha256, data }` — `data` = morceau du
  gzip encodé en base64, **≤ 180 000 caractères** (limite 256 Kio par document) ; au plus 200
  morceaux (~27 Mo de gzip).
- `save__<slot>` (méta, écrite **en dernier**) : `{ kind: 'meta', format: 1, slot, name, savedAt,
  version, bytes, compressed, parts, sha256, uploadedAt, info }` (`info` = `SlotInfo` local).
- Liste : `where('kind', '==', 'meta')`. Morceaux en trop d'une version précédente : supprimés
  après la méta.
- Lecture : tous les morceaux présents, même `sha256` que la méta, taille exacte, empreinte
  recalculée identique, puis `decodeSave` valide — sinon la version en ligne est **ignorée**.
  Pendant un envoi, un autre appareil peut voir une méta ancienne avec des morceaux nouveaux :
  l'empreinte ne correspond pas, il garde sa locale (cohérence à terme).
- Emplacements contenant `__` : non synchronisés (ambiguïté avec les identifiants de morceaux).

### Indicateur / état

`window.__aube.cloudSave` et l'évènement `window` **`meknes:cloudsave`** (`detail`) :
`{ state: 'disabled'|'connecting'|'online'|'syncing'|'offline', label, lastSyncAt, pending, message? }`.
Libellés : « Sauvegardé en ligne », « Envoi en ligne… », « Hors ligne — sauvegarde locale ».
`installCloudSaveBadge()` (src/ui/save-slots.ts) affiche une petite pastille fixe en bas à
gauche (sans interaction), absente en état `disabled`. Une refonte d'interface peut la
remplacer en écoutant le même évènement.

### Tests

- `tests/save/cloud.test.ts` (faux `db` en mémoire, limite 256 Kio, détection d'écritures
  concurrentes) : découpage/réassemblage, empreinte, morceau manquant / altéré, la plus récente
  gagne, hors ligne (db null, utilisateur absent, exception, réseau coupé puis rétabli),
  migration, limitation de fréquence + flush, suppression.
- `tests/save/auto-triggers.test.ts` : actions ≤ 1/min avec rattrapage, arrière-plan/fermeture/menu
  (sauvegarde puis envoi), « Continuer » = la plus récente (retrouvée en ligne sur un 2ᵉ appareil),
  autosauvegarde envoyée en ligne.
- Hors artifact, `npm run e2e` vérifie que rien ne change (pas de `window.claude`).
