/**
 * Section de sauvegarde du module « connexions » (connexions extérieures) : réglages appliqués au trafic et à
 * l'immigration (reprise identique), comptes du dernier jour, du mois et du mois précédent. Les connexions elles-mêmes
 * sont recalculées depuis le réseau routier. Absente d'une partie sans connexion : une ancienne sauvegarde se charge
 * sans connexion jusqu'à ce que le réseau en présente une.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { DEFAULT_CONNEXIONS_TUNING } from '../../shared/protocol-ext/connexions';
import { emptyConnexionsDay, type ConnexionsSave } from '../connexions/system';
import { runMigrations, type SaveSectionSpec } from './types';

export const CONNEXIONS_SAVE_VERSION = 1;

export const emptyConnexionsSave = (): ConnexionsSave => ({
  share: 0, freight: 0, immigration: 1, day: emptyConnexionsDay(), month: { migrants: 0, duties: 0 }, lastMonth: { migrants: 0, duties: 0 },
});

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export function migrateConnexions(data: unknown, from: number): ConnexionsSave {
  const o = runMigrations(data, from, CONNEXIONS_SAVE_VERSION, {}, 'connexions') as Record<string, unknown>;
  const t = DEFAULT_CONNEXIONS_TUNING;
  const day = emptyConnexionsDay();
  const rd = (o.day ?? {}) as Record<string, unknown>;
  for (const k of Object.keys(day) as (keyof typeof day)[]) day[k] = num(rd[k], 0);
  const m = (o.month ?? {}) as Record<string, unknown>, lm = (o.lastMonth ?? {}) as Record<string, unknown>;
  return {
    share: Math.min(t.maxTripShare, Math.max(0, num(o.share, 0))),
    freight: Math.min(0.6, Math.max(0, num(o.freight, 0))),
    immigration: Math.min(1 + t.immigrationBonusMax, Math.max(1, num(o.immigration, 1))),
    day,
    month: { migrants: Math.max(0, num(m.migrants, 0)), duties: num(m.duties, 0) },
    lastMonth: { migrants: Math.max(0, num(lm.migrants, 0)), duties: num(lm.duties, 0) },
  };
}

export const connexionsSaveSection: SaveSectionSpec<ConnexionsSave> = {
  id: 'connexions', version: CONNEXIONS_SAVE_VERSION, empty: emptyConnexionsSave, migrate: migrateConnexions,
};
