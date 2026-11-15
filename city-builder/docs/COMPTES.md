# Comptes joueurs (Supabase)

Comptes e-mail + mot de passe et sauvegardes en ligne liées au compte, pour le site publié sur
GitHub Pages (https://ilyasbenslamabenz-pixel.github.io/ECO/). Sans configuration, **rien ne change** :
aucune option de compte n'est affichée, aucune requête n'est envoyée, les sauvegardes locales, l'export
de fichier `.meknes` et les sauvegardes claude.ai (`src/save/cloud.ts`) fonctionnent comme avant.

## Mise en service, pas à pas

### 1. Créer le projet Supabase

1. Aller sur https://supabase.com, créer un compte puis **New project** (choisir une région proche,
   ex. *Europe West*), noter le mot de passe de la base (il ne sert pas au jeu).
2. Attendre la fin de la création (1 à 2 min).

### 2. Créer la table des sauvegardes

Menu **SQL Editor** > **New query**, coller puis **Run** :

```sql
create table public.saves (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  slot text not null,
  data text not null,          -- sauvegarde gzip en base64
  sha256 text not null,
  saved_at timestamptz not null default now(),
  meta jsonb,                  -- nom, population, date de jeu, trésorerie… pour la liste
  primary key (user_id, slot)
);
alter table public.saves enable row level security;
create policy "own saves" on public.saves for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

La règle RLS « own saves » garantit que chaque joueur ne lit et n'écrit que ses propres lignes, même
avec la clé publique.

### 3. Réglages d'authentification

Menu **Authentication** :

- **Sign In / Providers > Email** : activé. **Confirm email** :
  - activé (recommandé) : après « Créer mon compte », le jeu affiche « Un e-mail de confirmation a été
    envoyé… ouvrez le lien puis revenez vous connecter ». Une connexion avant confirmation affiche
    « Adresse e-mail pas encore confirmée ». Le lien ramène sur le jeu, déjà connecté ;
  - désactivé : le joueur est connecté dès l'inscription.
- **URL Configuration** :
  - **Site URL** : `https://ilyasbenslamabenz-pixel.github.io/ECO/`
  - **Redirect URLs** : ajouter `https://ilyasbenslamabenz-pixel.github.io/ECO/` (retour des liens
    « confirmer l'adresse » et « mot de passe oublié »). Pour tester en local, ajouter aussi
    l'adresse du serveur local (ex. `http://localhost:8080/`).
- (Facultatif) **Emails** : le service d'e-mail intégré est limité à quelques envois par heure ; pour un
  usage réel, configurer un SMTP (Brevo, Resend…) dans *SMTP Settings*.

### 4. Coller l'URL et la clé dans le jeu

Menu **Project Settings > API** (ou *Data API* / *API Keys*) :

- **Project URL** (ex. `https://abcdefghijkl.supabase.co`) ;
- clé **anon** / **publishable** (publique, prévue pour le navigateur).

Les coller dans `src/save/account-config.ts` :

```ts
export const SUPABASE_URL = 'https://abcdefghijkl.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOi…';   // ou sb_publishable_…
```

Puis `npm run build` et publier comme d'habitude. Le bouton **Compte** apparaît dans le menu principal
et dans la barre latérale (bouton « Compte » au-dessus de « Réglages »).

> **Jamais** la clé `service_role` / `secret` dans le client : elle contourne la RLS et donnerait accès
> à toutes les sauvegardes de tous les joueurs.

## Fonctionnement

| Fichier | Rôle |
|---|---|
| `src/save/account-config.ts` | URL + clé anon (vides = désactivé), adresse de retour des e-mails |
| `src/save/supabase-auth.ts` | client GoTrue (`fetch` direct) : inscription, connexion, rafraîchissement, déconnexion, mot de passe oublié, nouveau mot de passe, retour des liens e-mail |
| `src/save/account.ts` | transport PostgREST (`SupabaseSavesRemote`), espace local par compte (`ScopedBackend`), `AccountStore` (SaveStore du joueur courant), `AccountManager`, `attachAccounts` |
| `src/save/sync.ts` | moteur commun « local d'abord » (aussi utilisé par `cloud.ts`) |
| `src/ui/account.ts` | fenêtre « Compte joueur », boutons du menu et de la barre latérale (styles injectés) |

Pas de SDK `@supabase/supabase-js` : quelques appels REST suffisent (≈ 8 Ko minifiés au lieu de ~100 Ko).

### Requêtes

- Auth : `POST /auth/v1/signup?redirect_to=…`, `POST /auth/v1/token?grant_type=password`,
  `POST /auth/v1/token?grant_type=refresh_token`, `POST /auth/v1/logout`,
  `POST /auth/v1/recover?redirect_to=…`, `PUT /auth/v1/user` (nouveau mot de passe).
- Données (en-têtes `apikey: <anon>` + `Authorization: Bearer <jeton d'accès>`) :
  - liste : `GET /rest/v1/saves?select=slot,sha256,saved_at,meta` (sans `data`, donc léger) ;
  - lecture : `GET /rest/v1/saves?select=data,sha256&slot=eq.<slot>` ;
  - écriture : `POST /rest/v1/saves?on_conflict=user_id,slot` avec
    `Prefer: resolution=merge-duplicates,return=minimal` (upsert) ;
  - suppression : `DELETE /rest/v1/saves?slot=eq.<slot>`.
  - Réponse 401 (jeton expiré) : jeton renouvelé puis requête rejouée une fois.

### Ligne enregistrée

`data` = octets gzip de la sauvegarde (identiques au stockage local) en base64 ; `sha256` = empreinte
de ces octets (vérifiée au téléchargement) ; `saved_at` = date de la sauvegarde ; `meta` =
`{ format, name, population, gameMinutes, money, buildings, version, savedAt, bytes, compressed, info }`
(`info` = résumé complet affiché par « Continuer / Charger »).

### Synchronisation (identique aux sauvegardes claude.ai)

- Écriture locale immédiate, envoi en ligne en arrière-plan, une opération à la fois par emplacement.
- Sauvegardes automatiques (`auto-*`) envoyées au plus une fois toutes les 2 min ; envoi forcé quand
  l'onglet passe en arrière-plan (`visibilitychange`) ou se ferme (`pagehide`), et au retour au menu.
- Lecture : la plus récente des deux (locale / en ligne) selon `savedAt` ; une version en ligne plus
  récente n'est jamais écrasée par un appareil en retard (conflit = la plus récente gagne).
- Aucun envoi si l'empreinte n'a pas changé.
- Hors ligne : tout reste local (« Hors ligne — sauvegarde locale »), nouvel essai au créneau suivant
  et au retour du réseau (évènement `online`).
- Indicateur : évènement `meknes:cloudsave` (badge en bas à gauche, « Sauvegardé en ligne »),
  état du compte : évènement `meknes:account`.

### Session

- Seuls le jeton de rafraîchissement et l'identité (id, e-mail) sont gardés (`localStorage`, clé
  `meknes:compte:session`, accès protégés par try/catch) ; le jeton d'accès reste en mémoire.
- Jeton renouvelé ~1 min avant expiration (une seule requête à la fois ; si un autre onglet l'a déjà
  renouvelé, le jeton partagé est repris).
- Lancement : reconnexion silencieuse. Hors ligne au lancement : identité gardée, parties locales du
  compte visibles, synchronisation au retour du réseau.
- Jeton révoqué / expiré : retour au mode invité avec le message « Session expirée : reconnectez-vous ».
- Aucun jeton ni mot de passe n'est journalisé ni placé dans un message d'erreur.

### Séparation par compte et mode invité

- Mode invité = comportement d'avant : clés locales historiques (`data:<slot>`, `meta:<slot>`).
- Compte connecté : clés locales préfixées `compte:<id>:` ; un autre joueur sur le même appareil ne voit
  pas ces parties (ni en local, ni en ligne grâce à la RLS).
- Première connexion d'un compte sur l'appareil : « N parties jouées sur cet appareil sans compte… Les
  importer dans votre compte ? » (Importer / Non merci, réponse mémorisée par compte dans
  `meknes:compte:import:<id>`). L'import copie les parties (les copies invité restent) puis les envoie.
- Déconnexion : envoi de ce qui attend (8 s max), puis retour au mode invité.
- Dans l'artifact claude.ai (`window.claude` présent), les comptes ne sont pas activés : les sauvegardes
  claude.ai de `cloud.ts` restent utilisées.

### Mot de passe oublié

« Mot de passe oublié ? » envoie un e-mail ; le lien ramène sur le jeu (`#access_token=…&type=recovery`),
la session est ouverte, les jetons sont retirés de l'adresse et la fenêtre « Choisissez un nouveau mot
de passe » s'ouvre. Lien expiré : message « Ce lien a expiré ou a déjà servi ».

## Taille des sauvegardes (mesurée)

Ville de départ « Meknes City » (125 bâtiments, carte 2 km), mesurée avec la vraie simulation :

| État | JSON | gzip | base64 envoyé |
|---|---|---|---|
| ville de départ (705 habitants) | 228 Ko | 29 Ko | 38 Ko |
| après 30 jours de jeu (2 887 habitants) | 681 Ko | 140 Ko | 187 Ko |

Une grande ville atteint quelques centaines de Ko en base64 : très en dessous des limites de PostgREST
et de Postgres (`text` jusqu'à 1 Go). La liste ne télécharge jamais `data`. Offre gratuite Supabase :
500 Mo de base, soit plusieurs milliers de sauvegardes.

## Tests

`tests/save/account.test.ts` (faux serveur Supabase, `fetch` simulé, RLS par jeton) : configuration
vide (aucune requête), inscription avec / sans confirmation, connexion refusée avant confirmation,
rafraîchissement (marge, rotation, requêtes simultanées), reconnexion silencieuse, session expirée,
upsert (une ligne par emplacement, en-têtes, empreinte), autre appareil (liste, la plus récente),
conflit sans écrasement, hors ligne puis synchronisation, 401 rejoué, séparation par compte et import
des parties invité, mot de passe oublié et retour du lien. L'e2e (`npm run e2e`) tourne avec la
configuration vide : comportement inchangé.
