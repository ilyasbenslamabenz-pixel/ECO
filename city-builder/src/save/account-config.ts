/**
 * Configuration des COMPTES JOUEURS (Supabase). Mode d'emploi : docs/COMPTES.md.
 *
 * - SUPABASE_URL : « Project URL » (Project Settings > API), ex. https://abcdefgh.supabase.co
 * - SUPABASE_ANON_KEY : clé publique « anon » / « publishable » (prévue pour le navigateur ; les données
 *   sont protégées par la règle RLS « own saves »). NE JAMAIS mettre ici la clé « service_role » / « secret ».
 *
 * Laissés vides : aucune option de compte n'est affichée et aucune requête n'est envoyée ; le jeu
 * fonctionne exactement comme avant (sauvegardes locales, export de fichier, sauvegardes claude.ai).
 */
export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';

/** Adresse du jeu publiée : retour des liens « confirmer l'adresse » et « mot de passe oublié ». */
export const ACCOUNT_SITE_URL = 'https://ilyasbenslamabenz-pixel.github.io/ECO/';

/** Vrai si l'URL et la clé sont renseignées (et plausibles). */
export function accountsConfigured(url: string = SUPABASE_URL, key: string = SUPABASE_ANON_KEY): boolean {
  return /^https:\/\/[^\s/]+/.test(url.trim()) && key.trim().length > 20;
}
