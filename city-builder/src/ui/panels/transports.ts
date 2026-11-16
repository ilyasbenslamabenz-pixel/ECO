/**
 * Panneau « Transports » du module `hubs` (port et aéroport, phase 2C) — propriété de la branche p2c-port-aeroport.
 * Valeurs RÉELLES de la simulation (commande `summary`, rafraîchie toutes les 2 s et à chaque changement de
 * structure) : capacités d'export / import et de passagers, trafic (fret, camions/jour, mouvements), revenus et
 * entretien, nuisances mesurées sur les grilles municipales, bâtiments en infraction avec les servitudes.
 * `transportsView` (pure, testée) prépare les lignes ; `mount` les affiche.
 */
import type { HubSummary } from '../../shared/hubs/types';
import type { HubsCommands } from '../../shared/protocol-ext/hubs';
import type { BusState } from '../../shared/protocol-ext/bus';
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

/* ------------------------------------------------------------------------------------------------------------------ */
/* Lignes de bus (module « bus », docs/TRANSPORTS_COMMUN.md) : panneau « Bus » du tableau de bord Transports.         */
/* ------------------------------------------------------------------------------------------------------------------ */

const pctOf = (v: number): string => `${nf(v * 100, 1)} %`;
const chf = (n: number): string => `${nf(Math.round(n))} CHF`;

/** Lignes du panneau des bus (pure, testée) : synthèse, puis une section par ligne avec ses arrêts. */
export function busLinesView(s: BusState): TransportsSection[] {
  const m = s.summary;
  const out: TransportsSection[] = [{
    title: 'Réseau de bus',
    rows: [
      ['Lignes, arrêts', `${nf(m.lines)} lignes, ${nf(m.stops)} arrêts`],
      ['Dépôts (places)', m.depots ? `${nf(m.depots)} (${nf(m.depotCapacity)} bus)` : 'aucun : posez un dépôt (Transports › Gares et dépôts)'],
      ['Bus en service / demandés', `${nf(m.busesActive)} / ${nf(m.busesRequested)}`],
      ...(m.tram && (m.tram.lines > 0 || m.tram.trackM > 0) ? [
        ['Tram : lignes, rames en service / demandées', `${nf(m.tram.lines)} lignes, ${nf(m.tram.vehiclesActive)} / ${nf(m.tram.vehiclesRequested)}`],
        ['Tram : dépôts (places)', m.tram.depots ? `${nf(m.tram.depots)} (${nf(m.tram.depotCapacity)} rames)` : 'aucun : posez un dépôt de tram (Transports › Gares et dépôts)'],
        ['Tram : voies posées (site propre)', `${nf(m.tram.trackM / 1000, 2)} km (${nf(m.tram.dedicatedM / 1000, 2)} km)`],
        ['Tram : voyages par jour', nf(m.tram.ridersDay)],
      ] as [string, string][] : []),
      ['Voyages par jour', nf(m.ridersDay)],
      ['Part modale transports en commun / voiture / marche', `${pctOf(m.modal.bus)} / ${pctOf(m.modal.car)} / ${pctOf(m.modal.walk)}`],
      ['Trafic automobile évité', pctOf(1 - m.carFactor)],
      ['Habitants à moins de 400 m d’un arrêt', m.population ? `${nf(m.coveredResidents)} (${pctOf(m.coveredResidents / Math.max(1, m.population))})` : '—'],
      ['Emplois desservis', nf(m.coveredJobs)],
      ['Embauches grâce au bus (mois)', nf(m.transitHiresMonth)],
      ['Recettes − coût du mois', `${chf(m.revenueMonth)} − ${chf(m.costMonth)}`],
      ['Mois dernier', `${chf(m.revenueLastMonth)} − ${chf(m.costLastMonth)}`],
    ],
  }];
  for (const l of s.lines) {
    const rows: [string, string][] = [
      ['État', l.problem ?? `en service : ${l.mode === 'tram' ? 'une rame' : 'un bus'} toutes les ${nf(l.headwayMin, 1)} min`],
      ['Bus en service / demandés, tarif', `${nf(l.activeBuses)} / ${nf(l.buses)}, ${nf(l.fare, 2)} CHF`],
      ['Boucle, durée d’un tour', `${nf(l.lengthM / 1000, 2)} km, ${nf(l.cycleMin, 1)} min`],
      ['Voyages par jour', `${nf(l.stats.ridersDay)}${l.stats.refusedDay ? ` (+${nf(l.stats.refusedDay)} refusés)` : ''}`],
      ['Charge à la pointe', pctOf(l.stats.load)],
      ['Recettes / coût du mois', `${chf(l.stats.revenueMonth)} / ${chf(l.stats.costMonth)}`],
      ['Mois dernier (recettes / coût)', `${chf(l.stats.revenueLastMonth)} / ${chf(l.stats.costLastMonth)}`],
    ];
    for (const id of l.stopIds) {
      const st = s.stops.find((q) => q.id === id);
      if (st) rows.push([`· ${st.name}`, `${nf(st.boardings)} montées, ${nf(st.alightings)} descentes${st.ok ? '' : ' (sans route)'}`]);
    }
    out.push({ title: l.mode === 'tram' ? `Tram · ${l.name}` : `${l.name}`, rows });

  }
  if (!s.lines.length) out.push({ title: 'Aucune ligne', rows: [['Tracer une ligne', 'barre d’outils › Transports › Lignes de bus']] });
  return out;
}

export const busPanel: UiPanel = {
  id: 'bus',
  title: 'Bus',
  phase: '2C',
  mount(root, api) {
    const doc = root.ownerDocument;
    let alive = true;
    const render = (s: BusState): void => {
      root.replaceChildren();
      const head = doc.createElement('div');
      head.className = 'chips';
      const open = doc.createElement('button');
      open.className = 'chip';
      open.type = 'button';
      open.textContent = 'Tracer ou modifier une ligne';
      open.dataset['busOpen'] = '1';
      open.addEventListener('click', () => window.dispatchEvent(new CustomEvent('ui:open-bus-editor')));
      head.append(open);
      root.append(head);
      busLinesView(s).forEach((sec, k) => {
        const box = doc.createElement('section');
        box.className = 'panel-section';
        const h = doc.createElement('h3');
        h.textContent = sec.title;
        const line = s.lines[k - 1];
        if (line) {
          const dot = doc.createElement('span');
          dot.textContent = '● ';
          dot.style.color = line.color;
          h.prepend(dot);
        }
        const dl = doc.createElement('dl');
        for (const [kk, v] of sec.rows) {
          const dt = doc.createElement('dt'); dt.textContent = kk;
          const dd = doc.createElement('dd'); dd.textContent = v;
          dl.append(dt, dd);
        }
        box.append(h, dl);
        root.append(box);
      });
    };
    const refresh = (): void => {
      api.command('state').then((r) => { if (alive) render(r as BusState); }).catch((e: unknown) => api.toast(`Bus : ${String(e)}`, 'error'));
    };
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => { alive = false; clearInterval(timer); };
  },
};
