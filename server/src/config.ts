// Configuration du serveur : chemins résolus depuis l'emplacement du code (et non depuis le dossier courant, qui varie
// selon l'hébergeur), port et dossier des données, journalisation des erreurs de démarrage.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Racine du projet (dossier qui contient package.json, client/, server/, shared/). */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const PRODUCTION = process.env.NODE_ENV === 'production';
export const PORT = Number(process.env.PORT) || 3002;
export const HOST = process.env.HOST || undefined; // toutes les interfaces par défaut
/**
 * Dossier de la base SQLite. En production, placez-le HORS du dossier de l'application (qui peut être effacé et
 * reconstruit à chaque déploiement) : par exemple DATA_DIR=/srv/customer/eco-data chez Infomaniak.
 */
export const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || 'server/data');
export const DIST = path.join(ROOT, 'client/dist');

/** Arrête le serveur avec un message clair (et la cause technique) : utilisé pour toute erreur de démarrage. */
export function fatal(message: string, err?: unknown): never {
  console.error(`\n[ECO NATION] ÉCHEC DU DÉMARRAGE : ${message}`);
  if (err) console.error('[ECO NATION] Cause :', err instanceof Error ? `${err.message}${(err as NodeJS.ErrnoException).code ? ` (${(err as NodeJS.ErrnoException).code})` : ''}` : err);
  if (err instanceof Error && err.stack && !PRODUCTION) console.error(err.stack);
  process.exit(1);
}

/** Vérifie la version de Node.js (node:sqlite et les API utilisées exigent Node 22.13 ou plus récent). */
export function checkNode() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13)) fatal(`Node.js ${process.versions.node} est trop ancien : il faut Node.js 22.13 ou plus récent (24 recommandé).`);
}
