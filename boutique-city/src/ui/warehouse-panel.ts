/**
 * Panneau de la logistique : entrepôt (bail, étagères, stock, déchargement, arrivages, transport des tournées,
 * stocks minimums des commerces) et vue d'ensemble (appli Logistique du téléphone : entrepôts loués et libres).
 */
import { ECONOMY, LOGISTICS, PRODUCT_BY_ID, TRANSPORT_FR, VEHICLE_BY_ID, productsOf, type TransportMode } from '../sim/catalog';
import type { Premise } from '../sim/district';
import {
  atWarehouse, autoMins, buyRacks, capacityOf, incomingOf, maxRacks, minOf, releaseQuote, releaseWarehouse, rentWarehouse, runTours,
  sellRack, setMin, setTransport, stockValue, stow, takeOut, tourPreview, usedOf, vehicleLabel, warehouseAt, warehouseName, warehousePremises,
  warehouseRent, type Warehouse,
} from '../sim/logistics';
import { importerView, kpi, type UiCtx } from './dialogs';
import { askConfirm, button, chf, el, num } from './dom';
import type { View } from './panel';

const sec = (t: string): HTMLElement => el('div', { cls: 'sec', text: t });
const note = (t: string): HTMLElement => el('p', { cls: 'muted small', text: t });
const lower = (id: string): string => PRODUCT_BY_ID.get(id)?.nameFr.toLowerCase() ?? id;
/** Valeurs des menus et champs gardées entre deux rafraîchissements. */
const memo = new Map<string, string>();
function remember<T extends HTMLSelectElement | HTMLInputElement>(key: string, e: T): T {
  const v = memo.get(key);
  if (v !== undefined && (e.tagName !== 'SELECT' || [...(e as HTMLSelectElement).options].some((o) => o.value === v))) e.value = v;
  e.addEventListener('change', () => memo.set(key, e.value));
  return e;
}

/** Vue d'un entrepôt (local réservé) : à louer, ou loué. */
export function warehouseView(ctx: UiCtx, premiseId: number): View {
  const g = ctx.game, p = g.premise(premiseId)!;
  const self = (): View => warehouseView(ctx, premiseId);
  return {
    kicker: 'Logistique · Entrepôt', title: warehouseName(g, premiseId), wide: true,
    // Ouvrir l'importateur depuis l'entrepôt ne fait pas sortir le personnage.
    onClose: () => { if (!ctx.panel.current?.kicker.startsWith('Logistique')) ctx.leave(); },
    render: () => {
      const w = warehouseAt(g, premiseId);
      return w ? rented(ctx, w, self) : offer(ctx, p);
    },
  };
}

function offer(ctx: UiCtx, p: Premise): (Node | null)[] {
  const g = ctx.game, rent = warehouseRent(p), racks = maxRacks(p);
  return [
    note('Local en périphérie réservé à la logistique : stockez les palettes de l’importateur (bien moins cher que le grossiste), puis laissez les tournées de nuit remplir les rayons de vos commerces.'),
    el('div', { cls: 'kpis' }, kpi('Surface', `${p.area} m²`), kpi('Loyer', `${chf(rent)} / mois`), kpi('Capacité max.', `${num(racks * LOGISTICS.rackCapacity)} u.`)),
    note(`Jusqu’à ${racks} étagères à palettes (${chf(LOGISTICS.rackPrice)} pièce, ${LOGISTICS.rackCapacity} unités chacune).`),
    button(`Louer l’entrepôt (dépôt ${chf(rent * ECONOMY.depositMonths)})`, () => ctx.act(rentWarehouse(g, p.id)), 'primary wide'),
  ];
}

function rented(ctx: UiCtx, w: Warehouse, self: () => View): (Node | null)[] {
  const g = ctx.game, p = g.premise(w.premiseId)!;
  const cap = capacityOf(w), used = usedOf(w), here = atWarehouse(g, w);
  const out: (Node | null)[] = [
    el('div', { cls: 'kpis' }, kpi('Stock', `${num(used)} / ${num(cap)} u.`), kpi('Valeur', chf(stockValue(w))), kpi('Loyer', `${chf(warehouseRent(p))} / mois`), kpi('Arrivages', `${num(incomingOf(g, w))} u.`)),
    el('div', { cls: 'logi-bar' }, el('i', { attrs: { style: `width:${cap ? Math.min(100, Math.round((used / cap) * 100)) : 0}%` } })),
  ];
  if (!cap) out.push(el('p', { cls: 'small warn', text: 'Aucune étagère : installez-en pour stocker des marchandises.' }));
  else if (used === 0) out.push(el('p', { cls: 'small warn', text: 'Entrepôt vide : commandez à l’importateur.' }));

  // Étagères.
  out.push(sec(`Étagères à palettes (${w.racks} / ${maxRacks(p)})`),
    el('div', { cls: 'row' },
      button(`+1 (${chf(LOGISTICS.rackPrice)})`, () => ctx.act(buyRacks(g, w.id, 1), 'Étagère installée.'), 'small primary'),
      button(`+5 (${chf(LOGISTICS.rackPrice * 5)})`, () => ctx.act(buyRacks(g, w.id, 5), (n) => `${n} étagère(s) installée(s).`), 'small'),
      button('Revendre 1', () => ctx.act(sellRack(g, w.id), (v) => `Étagère revendue ${chf(v)}.`), 'small')));

  // Importateur.
  out.push(sec('Importateur'),
    button('Commander à l’importateur', () => ctx.panel.open(importerView(ctx, self)), 'primary wide'));
  for (const o of g.logi.imports.filter((x) => x.warehouseId === w.id)) {
    out.push(el('p', { cls: 'small', text: `En route : ${Object.entries(o.lines).map(([id, n]) => `${n} ${lower(id)}`).join(', ')} · livraison ${g.deliveryLabel(o.arriveAt)} (${chf(o.cost)})` }));
  }

  // Stock.
  out.push(sec('Stock'));
  const ids = Object.keys(w.stock).sort((a, b) => (w.stock[b] ?? 0) - (w.stock[a] ?? 0));
  if (!ids.length) out.push(note('Rien en stock.'));
  else {
    const near = g.vehiclesNear(p.doorX, p.doorZ);
    const carrier = here ? remember('wh-carrier', el('select', { attrs: { 'aria-label': 'Transport' } },
      el('option', { text: `À pied (${g.freeLoad('pied')} places)`, attrs: { value: 'pied' } }),
      ...near.map((v) => el('option', { text: `${VEHICLE_BY_ID.get(v.type)!.nameFr} (${g.freeLoad(v.id)} places)`, attrs: { value: String(v.id) } })))) : null;
    if (carrier) out.push(el('label', { cls: 'field' }, el('span', { text: 'Charger dans' }), carrier));
    const tbl = el('table', { cls: 'tbl' }, el('tr', {}, el('th', { text: 'Produit' }), el('th', { text: 'Unités' }), here ? el('th', { text: '' }) : null));
    for (const id of ids) {
      const qty = here ? el('input', { cls: 'qty', attrs: { type: 'number', min: '1', step: '1', value: '50', 'aria-label': 'Quantité' } }) : null;
      tbl.append(el('tr', {}, el('td', { text: PRODUCT_BY_ID.get(id)?.nameFr ?? id }), el('td', { text: num(w.stock[id] ?? 0) }),
        here && qty && carrier ? el('td', { cls: 'nowrap' }, qty, button('Charger', () => ctx.act(takeOut(g, w.id, id, Number(qty.value), carrier.value === 'pied' ? 'pied' : Number(carrier.value)), (n) => `${n} ${lower(id)} chargés.`), 'small')) : null));
    }
    out.push(tbl);
  }
  if (here) out.push(button('Décharger ici (porté + véhicules garés devant)', () => ctx.act(stow(g, w.id)), 'wide'));
  else out.push(note('Sur place, vous pouvez aussi décharger votre véhicule ici ou y charger de la marchandise.'));

  // Tournées.
  out.push(sec(`Tournées automatiques (chaque nuit à ${LOGISTICS.tourHour} h)`));
  const mode = el('select', { attrs: { 'aria-label': 'Transport des tournées' } }, ...(Object.keys(TRANSPORT_FR) as TransportMode[]).map((m) => el('option', { text: TRANSPORT_FR[m], attrs: { value: m } })));
  mode.value = w.mode;
  const veh = el('select', { attrs: { 'aria-label': 'Véhicule des tournées' } }, ...g.vehicles.map((v) => el('option', { text: `${VEHICLE_BY_ID.get(v.type)!.nameFr} (${VEHICLE_BY_ID.get(v.type)!.cargo} u.)`, attrs: { value: String(v.id) } })));
  if (w.vehicleId !== null) veh.value = String(w.vehicleId);
  const apply = (): void => { ctx.act(setTransport(g, w.id, mode.value as TransportMode, mode.value === 'vehicule' && veh.value ? Number(veh.value) : null)); };
  mode.addEventListener('change', apply);
  veh.addEventListener('change', apply);
  out.push(el('div', { cls: 'row' }, mode, w.mode === 'vehicule' || g.vehicles.length ? veh : null));
  out.push(note(`Transporteur : ${chf(LOGISTICS.service.base)} par tournée + ${chf(LOGISTICS.service.perStop)} par commerce livré + ${LOGISTICS.service.perUnit.toFixed(2)} CHF par unité, ${LOGISTICS.service.cargo} unités au plus. Votre véhicule : chauffeur à la tournée ${chf(LOGISTICS.own.base)} + ${chf(LOGISTICS.own.perStop)} par commerce, capacité de la soute (assurance du véhicule en plus).`));
  const pv = tourPreview(g, w);
  out.push(el('div', { cls: 'kpis' },
    kpi('Véhicule', w.mode === 'vehicule' ? vehicleLabel(g, w) : w.mode === 'service' ? `camionnette (${LOGISTICS.service.cargo} u.)` : 'aucun'),
    kpi('Prochaine tournée', w.mode === 'aucun' ? '—' : `${num(pv.units)} u. · ${pv.stops} arrêt(s)`),
    kpi('Coût estimé', w.mode === 'aucun' ? '—' : chf(pv.cost))));
  if (pv.missing.length) out.push(el('p', { cls: 'small warn', text: `Sous le minimum et absent de l’entrepôt : ${pv.missing.map(lower).join(', ')}.` }));
  if (w.mode !== 'aucun') out.push(button('Lancer une tournée maintenant', () => {
    const r = runTours(g, true).find((t) => t.warehouseId === w.id);
    ctx.toast(r && r.units > 0 ? `Tournée : ${r.units} unités livrées (${chf(r.cost)}).` : 'Rien à livrer : aucun commerce sous son minimum avec du stock ici.', r && r.units > 0 ? 'ok' : 'info');
    ctx.panel.paint(true);
  }, 'wide'));
  const tours = g.logi.tours.filter((t) => t.warehouseId === w.id).slice(-3).reverse();
  for (const t of tours) out.push(el('p', { cls: 'small', text: `Jour ${t.day + 1}${t.manual ? ' (immédiate)' : ''} : ${num(t.units)} u. dans ${t.stops} commerce(s), ${chf(t.cost)}${t.missing.length ? ` · manquait : ${t.missing.map(lower).join(', ')}` : ''}` }));

  // Stocks minimums.
  out.push(sec('Stocks minimums des commerces'));
  out.push(note('Sous ce seuil (stock en rayon + commandes en cours), la tournée remplit le rayon. 0 : pas de réassort depuis l’entrepôt.'));
  if (!g.shops.length) out.push(note('Aucun commerce pour l’instant.'));
  for (const s of g.shops) {
    const tbl = el('table', { cls: 'tbl' }, el('tr', {}, el('th', { text: 'Produit' }), el('th', { text: 'En rayon' }), el('th', { text: 'Minimum' })));
    for (const pr of productsOf(s.type)) {
      const st = s.products[pr.id]!.stock, room = g.storageFor(s, pr), m = minOf(g, s.id, pr.id);
      const inp = el('input', { cls: 'qty', attrs: { type: 'number', min: '0', step: '5', value: String(m), 'aria-label': `Minimum de ${pr.nameFr}` } });
      inp.addEventListener('change', () => ctx.act(setMin(g, s.id, pr.id, Number(inp.value))));
      tbl.append(el('tr', {}, el('td', { text: pr.nameFr }), el('td', { cls: m > 0 && st < m ? 'warn' : '', text: `${num(st)} / ${num(room)}` }), el('td', {}, inp)));
    }
    out.push(el('div', { cls: 'logi-shop' }, el('div', { cls: 'row' }, el('b', { cls: 'grow', text: s.name }),
      button('Proposer (moitié du rayon)', () => ctx.act(autoMins(g, s.id), (n) => `${n} minimum(s) fixé(s) pour ${s.name}.`), 'small'),
      button('Effacer', () => ctx.act(autoMins(g, s.id, 0), 'Minimums effacés.'), 'small')), tbl));
  }

  // Bail.
  const q = releaseQuote(g, w.id);
  out.push(sec('Bail'), button('Résilier le bail de l’entrepôt', () => {
    void askConfirm(`Résilier le bail ? Vous récupérez ${chf(q?.total ?? 0)} (dépôt, étagères revendues, arrivages remboursés, loyer dû retenu).${q && q.stockUnits ? ` ${num(q.stockUnits)} unités en stock seront perdues.` : ''}`, 'Résilier', true)
      .then((y) => { if (y) ctx.act(releaseWarehouse(g, w.id)); });
  }, 'danger wide'));
  return out;
}

/** Vue d'ensemble (appli Logistique) : entrepôts loués, entrepôts libres, importateur. */
export function logisticsView(ctx: UiCtx): View {
  const g = ctx.game;
  const self = (): View => logisticsView(ctx);
  return {
    kicker: 'Logistique', title: 'Entrepôts et tournées', wide: true,
    render: () => {
      const out: (Node | null)[] = [note('Achetez en gros chez l’importateur, stockez à l’entrepôt, et les tournées de nuit remplissent vos commerces passés sous leur stock minimum.')];
      for (const p of warehousePremises(g)) {
        const w = warehouseAt(g, p.id), b = g.building(p.buildingId)!;
        const go = button('Y aller (GPS)', () => { ctx.waypoint(b.doorX, b.doorZ, warehouseName(g, p.id)); ctx.panel.close(); }, 'small');
        if (w) {
          const pv = tourPreview(g, w);
          out.push(el('div', { cls: 'item' }, el('div', {}, el('b', { text: `${warehouseName(g, p.id)} (loué)` }),
            el('div', { cls: 'muted small', text: `${num(usedOf(w))} / ${num(capacityOf(w))} u. · ${TRANSPORT_FR[w.mode]}${w.mode !== 'aucun' ? ` · prochaine tournée ${num(pv.units)} u., ${chf(pv.cost)}` : ''}${usedOf(w) === 0 ? ' · vide' : ''}` })),
            el('div', { cls: 'nowrap' }, button('Gérer', () => ctx.panel.open(warehouseView(ctx, p.id)), 'small primary'), go)));
        } else {
          out.push(el('div', { cls: 'item' }, el('div', {}, el('b', { text: `${warehouseName(g, p.id)} (à louer)` }),
            el('div', { cls: 'muted small', text: `${p.area} m² · ${chf(warehouseRent(p))} / mois · jusqu’à ${num(maxRacks(p) * LOGISTICS.rackCapacity)} unités` })), go));
        }
      }
      if (g.logi.warehouses.length) out.push(button('Commander à l’importateur', () => ctx.panel.open(importerView(ctx, self)), 'primary wide'));
      else out.push(note('Rendez-vous à un entrepôt pour le louer (porte du local, touche E).'));
      return out;
    },
  };
}
