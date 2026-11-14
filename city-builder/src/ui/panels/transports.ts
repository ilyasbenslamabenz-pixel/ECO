/**
 * Panneau « Transports » du module `hubs` (port et aéroport, phase 2C) — propriété de la branche p2c-port-aeroport.
 * Valeurs RÉELLES de la simulation (commande `summary`, rafraîchie toutes les 2 s et à chaque changement de
 * structure) : capacités d'export / import et de passagers, trafic (fret, camions/jour, mouvements), revenus et
 * entretien, nuisances mesurées sur les grilles municipales, bâtiments en infraction avec les servitudes.
 * `transportsView` (pure, testée) prépare les lignes ; `mount` les affiche.
 */
import type { HubSummary } from '../../shared/hubs/types';
import type { HubsCommands } from '../../shared/protocol-ext/hubs';
import type { UiPanel } from './types';

export type TransportsSummary = HubsCommands['summary']['result'];

export interface TransportsSection { title: string; rows: [string, string][] }

const nf = (n: number, d = 0): string => n.toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const t = (n: number): string => `${nf(n)} t`;
const credits = (n: number): string => `${nf(Math.round(n))} ¢`;

function hubSection(h: HubSummary): TransportsSection {
  const m = h.month, c = h.capacity, n = h.nuisance;
  const rows: [string, string][] = [];
  if (c.exportT > 0) {
    rows.push(['Capacité export / import (mois)', `${t(c.exportT)} / ${t(c.importT)}`]);
    rows.push(['Fret ce mois (export / import)', `${t(m.exportT)} / ${t(m.importT)}`]);
    rows.push(['dont contrats d\'exportation', t(m.bookedExportT)]);
    rows.push(['Coût de transit, délai', `${nf(c.costPerT)} ¢/t, ${nf(c.delayDays)} j`]);
  }
  if (c.paxPerMonth > 0) rows.push(['Passagers ce mois / capacité', `${nf(m.pax)} / ${nf(c.paxPerMonth)}`]);
  rows.push(['Camions par jour', nf(m.trucksPerDay, 1)]);
  rows.push([h.hub.type === 'aeroport' ? 'Mouvements d\'avions (mois)' : 'Escales (mois)', nf(m.movements)]);
  rows.push(['Emplois', nf(m.jobs)]);
  rows.push(['Recettes du mois', credits(m.revenue)]);
  if (h.lastMonth) rows.push(['Mois dernier : recettes − entretien', credits(h.lastMonth.revenue - h.lastMonth.upkeep)]);
  rows.push(['Bruit moyen (cellules exposées)', `${nf(n.noiseMean, 1)} / 100 sur ${nf(n.noisyCells)} cellules`]);
  rows.push(['Habitants exposés au bruit', nf(n.exposedResidents)]);
  rows.push(['Satisfaction, valeur foncière (zone exposée)', `${nf(n.satisfactionDelta, 1)} pt, ${nf(n.landValueDelta, 1)} ¢/m²`]);
  if (h.hub.type !== 'aeroport') rows.push(['Pollution de l\'eau (bassin)', `${nf(n.waterPollution, 1)} / 100`]);
  rows.push(['Pollution de l\'air', `${nf(n.airPollution, 1)} / 100`]);
  return { title: `${h.nameFr} n° ${h.hub.id}`, rows };
}

/** Lignes du panneau (pure). */
export function transportsView(s: TransportsSummary): TransportsSection[] {
  const out: TransportsSection[] = [];
  out.push({
    title: 'Capacités de la ville',
    rows: [
      ['Port : export disponible ce mois', s.port.exportT > 0 ? `${t(Math.max(0, s.port.exportT - s.port.usedExportT))} sur ${t(s.port.exportT)}` : 'aucun port'],
      ['Aéroport : fret disponible ce mois', s.aeroport.exportT > 0 ? `${t(Math.max(0, s.aeroport.exportT - s.aeroport.usedExportT))} sur ${t(s.aeroport.exportT)}` : 'aucun aéroport'],
      ['Passagers (capacité mensuelle)', nf(s.port.paxPerMonth + s.aeroport.paxPerMonth)],
    ],
  });
  for (const h of s.hubs) out.push(hubSection(h));
  if (s.violations.length) {
    out.push({ title: 'Servitudes aéronautiques : bâtiments en infraction', rows: s.violations.map((v) => [v.name, `${nf(v.height, 1)} m > ${nf(v.limit, 1)} m`]) });
  }
  if (!s.sharedMunicipal) out.push({ title: 'Note', rows: [['Grilles municipales', 'instance locale (module municipal non enregistré)']] });
  return out;
}

export const transportsPanel: UiPanel = {
  id: 'hubs',
  title: 'Transports',
  phase: '2C',
  mount(root, api) {
    const doc = root.ownerDocument;
    let alive = true;
    const render = (s: TransportsSummary): void => {
      root.replaceChildren();
      for (const sec of transportsView(s)) {
        const box = doc.createElement('section');
        box.className = 'panel-section';
        const h = doc.createElement('h3');
        h.textContent = sec.title;
        const dl = doc.createElement('dl');
        for (const [k, v] of sec.rows) {
          const dt = doc.createElement('dt'); dt.textContent = k;
          const dd = doc.createElement('dd'); dd.textContent = v;
          dl.append(dt, dd);
        }
        box.append(h, dl);
        root.append(box);
      }
    };
    const refresh = (): void => {
      api.command('summary').then((r) => { if (alive) render(r as TransportsSummary); }).catch((e: unknown) => api.toast(`Transports : ${String(e)}`, 'error'));
    };
    refresh();
    const timer = setInterval(refresh, 2000);
    const off = api.onDeltaExt((p) => { if ((p as { hubs?: unknown }).hubs) refresh(); });
    return () => { alive = false; clearInterval(timer); off(); };
  },
};
