// Persistance des parties : PostgreSQL si DATABASE_URL est défini, sinon SQLite (node:sqlite).
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config';

export interface GameMeta { id: string; name: string; month: number; updatedAt: number; createdAt: number }

interface Backend {
  name: string;
  list(owner: string): Promise<GameMeta[]>;
  load(id: string, owner: string): Promise<string | null>;
  save(id: string, owner: string, name: string, month: number, data: string): Promise<void>;
  remove(id: string, owner: string): Promise<boolean>;
}

async function postgres(url: string): Promise<Backend> {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, max: 10, ssl: process.env.PGSSL === '1' ? { rejectUnauthorized: false } : undefined });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS eco_games (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL, month INTEGER NOT NULL,
      data TEXT NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_eco_games_owner ON eco_games(owner, updated_at DESC);
  `);
  return {
    name: 'PostgreSQL',
    async list(owner) {
      const r = await pool.query('SELECT id, name, month, created_at, updated_at FROM eco_games WHERE owner = $1 ORDER BY updated_at DESC', [owner]);
      return r.rows.map((x) => ({ id: x.id, name: x.name, month: x.month, createdAt: Number(x.created_at), updatedAt: Number(x.updated_at) }));
    },
    async load(id, owner) {
      const r = await pool.query('SELECT data FROM eco_games WHERE id = $1 AND owner = $2', [id, owner]);
      return r.rows[0]?.data ?? null;
    },
    async save(id, owner, name, month, data) {
      const now = Date.now();
      await pool.query(
        `INSERT INTO eco_games (id, owner, name, month, data, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$6)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, month = EXCLUDED.month, data = EXCLUDED.data, updated_at = EXCLUDED.updated_at
         WHERE eco_games.owner = EXCLUDED.owner`,
        [id, owner, name, month, data, now],
      );
    },
    async remove(id, owner) {
      const r = await pool.query('DELETE FROM eco_games WHERE id = $1 AND owner = $2', [id, owner]);
      return (r.rowCount ?? 0) > 0;
    },
  };
}

async function sqlite(): Promise<Backend> {
  const { DatabaseSync } = await import('node:sqlite');
  const dir = DATA_DIR;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
  } catch (e) {
    throw new Error(`le dossier de données « ${dir} » n'existe pas ou n'est pas accessible en écriture. Créez-le ou corrigez la variable DATA_DIR (chemin absolu d'un dossier persistant).`, { cause: e });
  }
  const file = path.join(dir, 'eco-nation.db');
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS eco_games (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL, month INTEGER NOT NULL,
      data TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_eco_games_owner ON eco_games(owner, updated_at DESC);
  `);
  const list = db.prepare('SELECT id, name, month, created_at, updated_at FROM eco_games WHERE owner = ? ORDER BY updated_at DESC');
  const load = db.prepare('SELECT data FROM eco_games WHERE id = ? AND owner = ?');
  const ups = db.prepare(`INSERT INTO eco_games (id, owner, name, month, data, created_at, updated_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, month = excluded.month, data = excluded.data, updated_at = excluded.updated_at
    WHERE eco_games.owner = excluded.owner`);
  const del = db.prepare('DELETE FROM eco_games WHERE id = ? AND owner = ?');
  return {
    name: `SQLite (${file})`,
    async list(owner) {
      return (list.all(owner) as { id: string; name: string; month: number; created_at: number; updated_at: number }[]).map((x) => ({ id: x.id, name: x.name, month: x.month, createdAt: x.created_at, updatedAt: x.updated_at }));
    },
    async load(id, owner) {
      return (load.get(id, owner) as { data: string } | undefined)?.data ?? null;
    },
    async save(id, owner, name, month, data) {
      const now = Date.now();
      ups.run(id, owner, name, month, data, now, now);
    },
    async remove(id, owner) {
      return Number(del.run(id, owner).changes) > 0;
    },
  };
}

let backend: Promise<Backend> | null = null;
/** Ouvre la base (une seule fois). Rejette avec un message explicite si elle est inaccessible. */
function open(): Promise<Backend> {
  backend ??= (process.env.DATABASE_URL ? postgres(process.env.DATABASE_URL) : sqlite()).catch((e: unknown) => {
    const what = process.env.DATABASE_URL ? 'PostgreSQL (DATABASE_URL)' : 'SQLite';
    throw new Error(`impossible d'ouvrir la base ${what} : ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  });
  return backend;
}

export const db = {
  /** À attendre avant d'accepter des connexions : renvoie le nom de la base ouverte. */
  ready: async () => (await open()).name,
  list: async (owner: string) => (await open()).list(owner),
  load: async (id: string, owner: string) => (await open()).load(id, owner),
  save: async (id: string, owner: string, name: string, month: number, data: string) => (await open()).save(id, owner, name, month, data),
  remove: async (id: string, owner: string) => (await open()).remove(id, owner),
};
