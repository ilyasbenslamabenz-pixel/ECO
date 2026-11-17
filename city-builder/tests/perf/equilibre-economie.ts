/**
 * Étude d'équilibrage économique (docs/EQUILIBRE_ECONOMIE.md) — NON branchée sur `npm test`.
 *
 *   npx tsx tests/perf/equilibre-economie.ts --parcours=prudent|typique|ambitieux|depart [--mois=36]
 *        [--reglages=base|A,B,…] [--graine=4242] [--json=chemin] [--sauver=chemin] [--quiet] [--debug] [--centrale]
 *
 * Partie « Nouvelle partie » telle que le jeu la crée (catalogue réel avec prix des logements ÷ 4 et dépôt de tram
 * dérivé, 3 M CHF, déblocages progressifs activés, avril, 9 h), sur une carte plate sans eau (reproductible). Un
 * joueur scripté trace des rues, zone, branche les réseaux et pose des services selon le parcours ; la simulation
 * complète (tous les modules) tourne au pas de 10 minutes. Chaque mois clos : trésorerie, recettes et dépenses par
 * poste (bilan de l'économie + lignes des modules, attribuées par module appelant), population, solde.
 *
 * Réglages (`--reglages`) : surcharges LOCALES appliquées au démarrage (aucun fichier du jeu modifié), voir REGLAGES.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Simulation } from '../../src/sim/world';
import type { AssetCatalog } from '../../src/shared/catalog';
import { TILE_SIZE } from '../../src/shared/constants';
import { withResidentialPricing, withTransitAssets } from '../../src/shared/transit-assets';
import { buildCity } from '../../src/sim/city-builder';
import { SERVICE_WAGE, MUNICIPAL_WAGE_SHARE, TAX_SECTORS, type MonthRecord } from '../../src/sim/economy';
import { BudgetLedger } from '../../src/sim/municipal/budget';
import { WASTE_PARAMS } from '../../src/shared/waste/types';
import { MILESTONES, milestoneForZone } from '../../src/shared/milestones';

/* --------------------------------- Options --------------------------------- */
const args = process.argv.slice(2);
const opt = (name: string, def: string): string => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? def;
const PARCOURS_OPT = opt('parcours', 'prudent') as 'prudent' | 'typique' | 'ambitieux' | 'depart' | 'manuel';
/** « manuel » = parcours typique, mais les logements sont POSÉS À LA MAIN (prix ÷ 4) au lieu d'être zonés. */
const MANUEL = PARCOURS_OPT === 'manuel';
const PARCOURS = (MANUEL ? 'typique' : PARCOURS_OPT) as 'prudent' | 'typique' | 'ambitieux' | 'depart';
const MONTHS = Number(opt('mois', '36'));
const SEED = Number(opt('graine', '4242'));
const REG = opt('reglages', 'base').split(',').filter((x) => x && x !== 'base');
const JSON_OUT = opt('json', '');
/** `--sauver=chemin` : sauvegarde de la ville en fin de partie (à recharger pour l'inspecter). */
const SAVE_OUT = opt('sauver', '');
const QUIET = args.includes('--quiet');
const log = (...m: unknown[]): void => { if (!QUIET) console.log(...m); };

/* --------------------------------- Réglages --------------------------------- */
/**
 * Ajustements étudiés. Chacun est une surcharge locale (catalogue copié, méthode d'instance, table mutable) qui
 * reproduit l'effet de la modification proposée dans le code du jeu. Appliqués avant / après `newGame`.
 */
interface Reglage { label: string; catalog?(c: AssetCatalog): void; before?(): void; after?(s: Simulation): void }
const REGLAGES: Record<string, Reglage> = {
  // R1 — Achat d'électricité au réseau voisin : 4,5 → 2,5 ¢/kWh (src/shared/power/model.ts:127, IMPORT_SPEC.priceCentsPerKwh).
  import_elec: { label: 'Électricité importée 4,5 → 2,5 ¢/kWh', before() { scaleLine('achat:electricite_exterieure', 2.5 / 4.5); } },
  // R1 bis (variante comparée) — Tarif de vente de l'électricité aux habitants : 2 → 3 ¢/kWh (model.ts:118).
  tarif_elec: { label: 'Tarif électricité 2 → 3 ¢/kWh', before() { scaleLine('vente:electricite', 3 / 2); } },
  // R2 — Logements posés à la main : entretien ÷ 4 comme le prix (src/shared/transit-assets.ts:46-52).
  logements_main: {
    label: 'Entretien des logements posés à la main ÷ 4',
    catalog(c) { for (const a of c.assets) if (a.tags?.includes('prix:logement')) a.upkeepPerMonth = Math.round(a.upkeepPerMonth / 4); },
  },
  // R3 — Camions-bennes : 1 800 → 900 CHF par camion et par mois (src/shared/waste/types.ts:53).
  dechets: { label: 'Camion-benne 1 800 → 900 CHF/mois', before() { (WASTE_PARAMS as { truckCostPerMonth: number }).truckCostPerMonth = 900; } },
};
/** Multiplie les montants d'une ligne budgétaire des modules (surcharge du prix sous-jacent, ex. ¢/kWh). */
function scaleLine(category: string, f: number): void {
  const proto = BudgetLedger.prototype as unknown as { post(side: string, cat: string, amount: number, service?: string, district?: string): number };
  const orig = proto.post;
  proto.post = function (side, cat, amount, service, district) { return orig.call(this, side, cat, cat === category ? Math.round(amount * f * 100) / 100 : amount, service, district); };
}

/* --------------------------------- Partie --------------------------------- */
const root = join(import.meta.dirname, '..', '..');
const catalog = withResidentialPricing(withTransitAssets(JSON.parse(readFileSync(join(root, 'assets/catalog.json'), 'utf8')) as AssetCatalog));
for (const r of REG) { if (!REGLAGES[r]) throw new Error(`réglage inconnu : ${r}`); REGLAGES[r]!.catalog?.(catalog); REGLAGES[r]!.before?.(); }

const s = new Simulation();
s.setCatalog(catalog);
const START_MONEY = PARCOURS === 'depart' ? 150_000_000 : 3_000_000;
s.newGame({ seed: PARCOURS === 'depart' ? 7 : SEED, mapChunks: 8, startMoney: START_MONEY, cityName: `Étude ${PARCOURS}`, startHour: 9, startMonth: 4, terrain: { hydrology: 'aucune', rivers: 0 } });
const cmd = (p: string, n: string, a?: unknown): { ok: boolean; data: any; error?: any } => {
  const r = s.plugins.command(p, n, a) as any;
  return r.ok ? { ok: true, data: r.data?.data ?? r.data } : { ok: false, data: null, error: r.error };
};
if (PARCOURS !== 'depart') cmd('paliers', 'mode', { verrous: true });
for (const r of REG) REGLAGES[r]!.after?.(s);

/* ---------------- Attribution des montants des modules (recettes / dépenses) ---------------- */
const MODULE_OF: [RegExp, string][] = [
  [/\/power\//, 'electricite'], [/\/water-network\//, 'eau'], [/\/waste\//, 'dechets'], [/\/transit\//, 'transports'],
  [/plugins\/paliers/, 'prime_palier'], [/plugins\/objectifs/, 'prime_objectif'], [/plugins\/evenements/, 'evenement'],
  [/plugins\/politiques/, 'politiques'], [/plugins\/recherche/, 'recherche'], [/plugins\/services/, 'reconstruction'],
  [/plugins\/ameliorations/, 'ameliorations'], [/plugins\/secteurs/, 'secteurs'], [/\/hubs\//, 'hubs'],
  [/\/connexions\//, 'connexions'], [/\/ressources\//, 'ressources'],
];
const svcMonth: Record<string, number> = {};
{
  const eco = s.economy;
  const orig = eco.applyService.bind(eco);
  eco.applyService = (amount: number, oneOff = false, line?: string): void => {
    if (Number.isFinite(amount) && amount !== 0) {
      const st = new Error().stack ?? '';
      let mod = 'autre';
      for (const [re, name] of MODULE_OF) if (re.test(st)) { mod = name; break; }
      const key = `${mod}:${amount > 0 ? 'recette' : 'depense'}${oneOff ? ':ponctuel' : ''}`;
      svcMonth[key] = (svcMonth[key] ?? 0) + amount;
    }
    orig(amount, oneOff, line);
  };
}

/* --------------------------------- Outils de pose --------------------------------- */
const T = TILE_SIZE;
let spentInvest = 0; // investissements du joueur (routes, bâtiments, réseaux, transports)
const money = (): number => s.economy.money;
const asset = (id: string) => { const a = s.getAsset(id); if (!a) throw new Error(`asset ${id}`); return a; };
const roadOk = (type: 'street' | 'avenue', pts: number[]): boolean => {
  const m0 = money();
  const r = s.buildRoad({ type, points: pts });
  spentInvest += m0 - money();
  return r.ok;
};
/** Emplacements de services : côté extérieur des rues N-S x = ±W (curseur en z, alterné de part et d'autre du centre). */
const W = 400;
const cursors: Record<string, number> = {};
function placeAlong(id: string, side: -1 | 1, zHint: number): number | null {
  const a = asset(id);
  const w = a.footprint.tilesX * T, d = a.footprint.tilesZ * T;
  // Le bâtiment est posé tourné vers la rue N-S (rot 1 / 3) : sa largeur s'étend le long de z.
  const key = `${side}`;
  void zHint;
  for (let tries = 0; tries < 12; tries++) {
    const z = cursors[key] ?? (zMin + 6);
    if (z + w > zMax) return null;
    const x = side * (W + 8 + d / 2);
    const m0 = money();
    const r = s.placeBuilding({ assetId: id, x, z: z + w / 2, rot: side > 0 ? 3 : 1 });
    cursors[key] = z + w + 6;
    if (r.ok) { spentInvest += m0 - money(); return r.data.buildingId; }
  }
  return null;
}
/** Zone des installations techniques : rue N-S x = -560 (et -720 pour les éoliennes), reliées par la rue z = 0. */
let utilityZ = -300, windZ = -300;
function placeUtility(id: string): number | null {
  const a = asset(id);
  const w = a.footprint.tilesX * T, d = a.footprint.tilesZ * T;
  for (let tries = 0; tries < 30; tries++) {
    const z = utilityZ;
    utilityZ += Math.max(w, d) + 8;
    const m0 = money();
    const r = s.placeBuilding({ assetId: id, x: -560 + 8 + d / 2, z: z + w / 2, rot: 3 });
    if (r.ok) { spentInvest += m0 - money(); return r.data.buildingId; }
  }
  return null;
}
function placeWind(): boolean {
  for (let tries = 0; tries < 10; tries++) {
    const z = windZ; windZ += 92;
    const m0 = money();
    const r = s.placeBuilding({ assetId: 'elec_eolienne', x: -720 - 8 - T, z, rot: 1 });
    if (r.ok) { spentInvest += m0 - money(); return true; }
  }
  return false;
}

/* --------------------------------- Plan de ville --------------------------------- */
// Rangées E-O (x ∈ [-W, W]) au pas de 80 m, ajoutées du centre vers l'extérieur ; rues N-S x = -W, 0, W prolongées.
type Zone = 'res_faible' | 'res_moyen' | 'commerce' | 'industrie' | 'bureaux';
const ROW_ZS: number[] = [0];
for (let k = 1; k <= 11; k++) ROW_ZS.push(-80 * k, 80 * k);
let rowsBuilt = 0, zMin = 0, zMax = 0;
const rowsOf: Record<string, number> = {};
const lastRowOf: Record<string, number> = {};
/** Parcours « manuel » : rangées résidentielles à remplir de logements posés à la main (curseur x, côté). */
const manualRows: { z: number; x: number; side: -1 | 1 }[] = [];
const MANUAL_HOUSING = ['maison_pavillon_enduit', 'maison_brique_pignon', 'mitoyennes_brique', 'immeuble_petit_enduit', 'maison_ville_etroite', 'immeuble_brique_1930'];
let manualIdx = 0, manualPlaced = 0, manualSpent = 0;
/** Pose jusqu'à 8 logements par jour tant que la demande résidentielle est positive et la trésorerie le permet. */
function manualHousing(): void {
  if (!MANUEL) return;
  const d = cmd('zonage', 'state').data?.demand as { R: number } | undefined;
  if (!d || d.R <= 0.05) return;
  for (let n = 0; n < 8; n++) {
    const row = manualRows.find((r) => r.side === -1 || r.x < W - 20);
    if (!row) return;
    const id = MANUAL_HOUSING[manualIdx % MANUAL_HOUSING.length]!;
    const a = asset(id);
    if (money() < a.cost + reserveOf) return;
    const w = a.footprint.tilesX * T, dd = a.footprint.tilesZ * T;
    if (row.x + w > W - 8) { if (row.side === -1) { row.side = 1; row.x = -W + 8; } else { row.x = W; } continue; }
    const z = row.side === -1 ? row.z - 7 - dd / 2 : row.z + 7 + dd / 2;
    const m0 = money();
    const r = s.placeBuilding({ assetId: id, x: row.x + w / 2, z, rot: row.side === -1 ? 0 : 2 });
    row.x += w + 4;
    if (r.ok) { manualIdx++; manualPlaced++; manualSpent += m0 - money(); spentInvest += m0 - money(); }
  }
}
const manualFree = (): boolean => manualRows.some((r) => r.side === -1 || r.x < W - 20);
function addRow(zone: Zone): boolean {
  if (rowsBuilt >= ROW_ZS.length) return false;
  const z = ROW_ZS[rowsBuilt]!;
  const cost = 60 * (2 * W + 3 * 80);
  if (money() < cost) return false;
  if (!roadOk('street', [-W, z, W, z])) return false;
  // Prolongement des rues N-S.
  if (z < zMin) { for (const x of [-W, 0, W]) roadOk('street', [x, zMin, x, z]); zMin = z; }
  if (z > zMax) { for (const x of [-W, 0, W]) roadOk('street', [x, zMax, x, z]); zMax = z; }
  if (MANUEL && zone.startsWith('res')) { manualRows.push({ z, x: -W + 8, side: -1 }); rowsBuilt++; rowsOf[zone] = (rowsOf[zone] ?? 0) + 1; lastRowOf[zone] = s.clock.dayIndex; return true; }
  const p = cmd('zonage', 'paint', { points: [-W + 4, z, W - 4, z], zone, depth: 3 });
  if (!p.ok) event(`zonage ${zone} refusé : ${JSON.stringify(p.error)}`);
  rowsBuilt++;
  rowsOf[zone] = (rowsOf[zone] ?? 0) + 1;
  lastRowOf[zone] = s.clock.dayIndex;
  return true;
}

/* --------------------------------- Parcours --------------------------------- */
interface Svc { id: string; key: string; pop: number }
const report = () => s.demography!.report(s.clock.totalMinutes, s.economy.taxRates.residential);
const pending: string[] = [];
const built: Record<string, number> = {};
const note: string[] = [];
const event = (txt: string): void => { note.push(`m${s.economy.history.length} j${s.clock.dayIndex} ${txt}`); log(`  [j${s.clock.dayIndex}] ${txt}`); };

function setupCommon(): void {
  // Réseau initial : 3 rangées (commerce au centre, deux rangées résidentielles), rue technique reliée.
  // Premiers pas : R, C et I (deux rangées résidentielles, une de commerces, une d'industrie).
  for (const z of ['res_faible', 'res_faible', 'industrie', 'commerce'] as Zone[]) addRow(z);
  // Quadrillage initial : rues N-S de -240 à 240 (le joueur trace une grille, les rangées se zonent ensuite).
  for (const x of [-W, 0, W]) { roadOk('street', [x, zMin, x, -240]); roadOk('street', [x, zMax, x, 240]); }
  zMin = Math.min(zMin, -240); zMax = Math.max(zMax, 240);
  roadOk('street', [-560, -300, -560, 300]);
  roadOk('street', [-560, 0, -W, 0]);
  roadOk('street', [-720, -300, -720, 300]);
  roadOk('street', [-720, 0, -560, 0]);
}
let lastBuy = -99, lastPower = -99, lastWater = -99, lastExpand = -99;
const reserveOf = { prudent: 250_000, typique: 120_000, ambitieux: 0, depart: 0 }[PARCOURS];
function buy(id: string, where: 'service' | 'utility', tag: string): boolean {
  const a = asset(id);
  if (money() < a.cost + reserveOf) return false;
  const side: -1 | 1 = ((built[tag] ?? 0) % 2 === 0) ? 1 : -1;
  const ok = where === 'utility' ? placeUtility(id) !== null : placeAlong(id, side, 0) !== null;
  if (ok) { built[tag] = (built[tag] ?? 0) + 1; event(`pose ${id} (${a.cost.toLocaleString('fr-FR')} CHF)`); }
  return ok;
}

const peak = { cut: 0, imported: 0, served: 1 };
function samplePeak(): void {
  const sum = cmd('electricite', 'state').data?.summary;
  if (sum) { peak.cut = Math.max(peak.cut, sum.cut ?? 0); peak.imported = Math.max(peak.imported, sum.importedKw ?? 0); }
  const bal = cmd('eau', 'state').data?.balance;
  if (bal && bal.buildings > 0) peak.served = Math.min(peak.served, bal.servedShare);
}
/** Réseaux : raccordements au départ ; centrales / pompage dès que le raccordement sature. */
const GAZ = args.includes('--centrale');
const gasLocked = (): boolean => JSON.stringify(cmd('paliers', 'state').data?.locks?.assets ?? {}).includes('elec_centrale_gaz');
function utilities(day: number): void {
  // Maxima de la veille (relevés toutes les 3 h) : coupures et import proche du plafond du raccordement.
  const { cut, imported, served } = peak;
  peak.cut = 0; peak.imported = 0; peak.served = 1;
  // `--centrale` : joueur qui suit l'indice « courant insuffisant » et pose une centrale au gaz dès qu'elle est
  // débloquée (palier Bourg) et payable, au lieu d'empiler des éoliennes.
  if (GAZ && day - lastPower >= 8 && cut > 0 && !gasLocked()) {
    if (buy('elec_centrale_gaz', 'utility', 'gaz')) { lastPower = day; return; }
  }
  if (day - lastPower >= 8 && (cut > 0 || imported > 0.85 * 3000) && money() > asset('elec_eolienne').cost + reserveOf / 2) {
    if (placeWind()) { built['eolienne'] = (built['eolienne'] ?? 0) + 1; event(`éolienne n° ${built['eolienne']} (coupés ${cut}, import ${Math.round(imported)} kW)`); lastPower = day; }
  }
  const bal = cmd('eau', 'state').data?.balance;
  if (bal && day - lastWater >= 10) {
    const need = served < 0.9 && bal.buildings > 20;
    if (need) {
      const step = (built['pompage'] ?? 0) <= (built['potabilisation'] ?? 0) ? 'eau_station_pompage' : 'eau_usine_potabilisation';
      if (buy(step, 'utility', step === 'eau_station_pompage' ? 'pompage' : 'potabilisation')) lastWater = day;
    }
  }
}

/** Zone débloquée : palier requis atteint (déblocages progressifs). */
const unlocked = (zone: string): boolean => {
  const m = milestoneForZone(zone);
  if (!m) return true;
  const st = cmd('paliers', 'state').data;
  return JSON.stringify(st?.reached ?? []).includes(m.id);
};
function expansion(day: number): void {
  if (day - lastExpand < 6) return;
  // Le joueur lit les barres de demande : il zone une rangée du type le plus demandé (résidentiel seulement quand
  // les lots résidentiels sont presque pleins ; C, I, bureaux au plus une rangée par type tous les 20 jours).
  const lots = (s.demography as any).residentialLots() as { zoned: number; free: number; demand: number } | null;
  const st = cmd('zonage', 'state').data;
  if (!lots || !st) return;
  const d = st.demand as { R: number; C: number; I: number; B: number };
  const ambit = PARCOURS === 'ambitieux';
  const freeShare = lots.zoned > 0 ? lots.free / lots.zoned : 0;
  const now = s.clock.dayIndex;
  const recent = (z: Zone): boolean => now - (lastRowOf[z] ?? -999) < 20;
  const cands: [Zone, number][] = [];
  if (d.R > 0.1 && (MANUEL ? !manualFree() : freeShare < (ambit ? 0.3 : 0.2))) cands.push([(rowsOf['res_faible'] ?? 0) > 2 * (rowsOf['res_moyen'] ?? 0) ? 'res_moyen' : 'res_faible', d.R]);
  if (d.C > 0.25 && !recent('commerce')) cands.push(['commerce', d.C]);
  if (d.I > 0.25 && !recent('industrie')) cands.push(['industrie', d.I]);
  if (d.B > 0.25 && !recent('bureaux') && (rowsOf['industrie'] ?? 0) >= 2 && unlocked('bureaux')) cands.push(['bureaux', d.B]);
  cands.sort((a, b) => b[1] - a[1]);
  if (cands.length && money() > reserveOf + 60_000) {
    const [zone, dem] = cands[0]!;
    if (addRow(zone)) { lastExpand = day; event(`rangée n° ${rowsBuilt} : ${zone} (demande ${dem.toFixed(2)}, lots R libres ${lots.free}/${lots.zoned})`); }
  }
}

/** Services selon le parcours : `pop` = population à partir de laquelle le joueur pose le premier équipement. */
const SERVICES: Record<'prudent' | 'typique' | 'ambitieux', Svc[]> = {
  prudent: [],
  typique: [
    { id: 'proc_ecole_moderne', key: 'education', pop: 400 },
    { id: 'proc_centre_sante', key: 'health', pop: 700 },
    { id: 'public_commissariat', key: 'police', pop: 1000 },
    { id: 'public_caserne_pompiers', key: 'fire', pop: 1200 },
  ],
  ambitieux: [
    { id: 'proc_ecole_moderne', key: 'education', pop: 0 },
    { id: 'proc_centre_sante', key: 'health', pop: 0 },
    { id: 'public_commissariat', key: 'police', pop: 0 },
    { id: 'public_caserne_pompiers', key: 'fire', pop: 0 },
    { id: 'public_parc_kiosque', key: 'leisure', pop: 0 },
  ],
};
let coverageKeys: string[] | null = null;
function services(day: number): void {
  if (PARCOURS === 'depart' || PARCOURS === 'prudent') return;
  if (day - lastBuy < (PARCOURS === 'ambitieux' ? 1 : 10)) return;
  const r = report();
  coverageKeys ??= Object.keys(r.services);
  for (const sv of SERVICES[PARCOURS]) {
    const n = built[sv.key] ?? 0;
    const cov = r.services[sv.key] ?? 0;
    // Premier équipement au seuil de population ; suivants quand la couverture tombe sous 80 % (alerte / objectif).
    const want = n === 0 ? r.population >= sv.pop : (cov < 0.8 && r.population > 300 * n);
    if (want && buy(sv.id, 'service', sv.key)) { lastBuy = day; return; }
  }
  if (PARCOURS === 'ambitieux' && (built['leisure'] ?? 0) < 4 && buy('public_parc_kiosque', 'service', 'leisure')) { lastBuy = day; return; }
}

/** Transports : typique = bus quand ~1 500 habitants ; ambitieux = bus dès le 1er mois, tram au 4e. */
let busDone = false, tramDone = false;
function transit(day: number): void {
  if (PARCOURS === 'prudent' || PARCOURS === 'depart') return;
  const pop = s.demography!.population;
  if (!busDone && ((PARCOURS === 'typique' && pop >= 1500) || (PARCOURS === 'ambitieux' && day >= 30))) {
    if (money() < asset('depot_bus').cost + reserveOf + 20_000) return;
    if (placeAlong('depot_bus', -1, 0) === null) return;
    const zs = [ROW_ZS[1]!, ROW_ZS[2]!];
    const m0 = money();
    const l1 = cmd('bus', 'createLine', { stops: [{ x: -300, z: zs[0]! }, { x: 300, z: zs[0]! }, { x: 300, z: zs[1]! }, { x: -300, z: zs[1]! }], buses: 3, fare: 2 });
    const l2 = PARCOURS === 'ambitieux' ? cmd('bus', 'createLine', { stops: [{ x: -200, z: 0 }, { x: 200, z: 0 }, { x: 0, z: zMax }, { x: 0, z: zMin }], buses: 3, fare: 2 }) : { ok: true };
    spentInvest += m0 - money();
    busDone = true;
    event(`dépôt de bus + ligne(s) : ${l1.ok ? 'ok' : JSON.stringify(l1.error)} ${l2.ok ? '' : JSON.stringify((l2 as any).error)}`);
  }
  if (PARCOURS === 'ambitieux' && !tramDone && day >= 120) {
    const dep = asset('depot_tram');
    if (money() < dep.cost + 300_000) return;
    const m0 = money();
    // Rails sur la rue centrale z = 0 (tronçons de 400 m) et la rue N-S x = 0 entre les rangées ±80.
    let ok = 0;
    for (const p of [{ x: -200, z: 0 }, { x: 200, z: 0 }]) if (cmd('bus', 'track', p).ok) ok++;
    const id = placeAlong('depot_tram', 1, 0);
    const line = cmd('bus', 'createLine', { mode: 'tram', stops: [{ x: -350, z: 0 }, { x: -100, z: 0 }, { x: 100, z: 0 }, { x: 350, z: 0 }], buses: 2, fare: 2 });
    spentInvest += m0 - money();
    tramDone = true;
    event(`tram : ${ok} tronçons de rails, dépôt ${id !== null ? 'ok' : 'refusé'}, ligne ${line.ok ? 'ok' : JSON.stringify(line.error)}`);
  }
}

/** Emprunt de l'ambitieux quand la trésorerie descend sous 150 000 CHF (une fois par trimestre au plus). */
let lastLoan = -999;
function loans(day: number): void {
  if (PARCOURS !== 'ambitieux') return;
  if (money() < 150_000 && day - lastLoan > 90) {
    const res = s.economy.takeLoan(500_000, 120, s.clock.totalMinutes);
    lastLoan = day;
    event(`emprunt 500 000 CHF sur 10 ans : ${res && !('error' in res) ? 'accordé' : JSON.stringify(res)}`);
  }
}

/* --------------------------------- Mise en place --------------------------------- */
if (PARCOURS === 'depart') {
  const m0 = money();
  const r = buildCity(s, { preset: 'demo' });
  event(`ville de départ : ${r.buildings} bâtiments, coût ${Math.round(m0 - money()).toLocaleString('fr-FR')} CHF`);
} else {
  setupCommon();
  // Électricité et eau : raccordement au réseau voisin (premier conseil des Premiers pas), sauf l'ambitieux qui
  // construit d'emblée deux éoliennes, un pompage, une usine de potabilisation et une station d'épuration.
  if (PARCOURS === 'ambitieux') {
    placeWind(); placeWind(); built['eolienne'] = 2;
    { const m0 = money(); cmd('electricite', 'raccordement', { on: true }); spentInvest += m0 - money(); } // secours
    for (const id of ['eau_station_pompage', 'eau_usine_potabilisation', 'eau_station_epuration']) placeUtility(id);
    built['pompage'] = 1; built['potabilisation'] = 1;
  } else {
    const m0 = money();
    cmd('electricite', 'raccordement', { on: true });
    cmd('eau', 'raccordement', { on: true });
    spentInvest += m0 - money();
  }
  // Déchets : dépôt de camions et décharge (minimum de tous les parcours).
  placeUtility('dechets_depot_camions'); placeUtility('dechets_decharge');
  event(`mise en place : ${Math.round(START_MONEY - money()).toLocaleString('fr-FR')} CHF investis`);
}

/* --------------------------------- Boucle --------------------------------- */
interface Row {
  m: number; pop: number; money: number; balance: number; taxes: Record<string, number>; taxTotal: number;
  upkeepBuildings: number; upkeepRoads: number; salaries: number; loans: number; services: Record<string, number>;
  servicesRecurring: number; oneOff: number; construction: number; happiness: number; unemployment: number;
  upkeepBy: Record<string, number>; salaryBy: Record<string, number>; modLines: Record<string, number>; palier: string | null;
}
const rows: Row[] = [];
let bankruptAt: number | null = null, firstPositive: number | null = null, minMoney = START_MONEY, minMoneyAt = 0;
let prevHist = 0;
const familyOf = (a: { id: string; tags: string[]; category: string }): string => {
  const t = a.tags;
  if (t.includes('electricite')) return 'electricite';
  if (t.includes('eau')) return 'eau';
  if (t.includes('dechets')) return 'dechets';
  if (t.includes('transport') || t.includes('depot_bus') || a.id.includes('depot_tram')) return 'transports';
  if (t.includes('education') || t.includes('ecole')) return 'education';
  if (t.includes('sante')) return 'sante';
  if (t.includes('police')) return 'police';
  if (t.includes('pompiers')) return 'pompiers';
  if (t.includes('parc') || t.includes('loisirs')) return 'parcs';
  return a.category === 'public' ? 'autre_public' : 'autre';
};
function closeMonth(rec: MonthRecord): void {
  const upkeepBy: Record<string, number> = {}, salaryBy: Record<string, number> = {};
  const b = s.buildings;
  for (let i = 0; i < b.count; i++) {
    const id = b.id[i]!;
    const a = s.catalog!.assets[b.assetIndex[i]!]!;
    if (!s.isPrivateBuilding(id) && a.upkeepPerMonth > 0) { const f = familyOf(a); upkeepBy[f] = (upkeepBy[f] ?? 0) + a.upkeepPerMonth; }
    if (a.category === 'public') { const f = familyOf(a); salaryBy[f] = (salaryBy[f] ?? 0) + b.workers[i]! * SERVICE_WAGE * MUNICIPAL_WAGE_SHARE; }
  }
  const services = { ...svcMonth };
  for (const k of Object.keys(svcMonth)) delete svcMonth[k];
  let recurring = 0, oneOff = 0;
  for (const [k, v] of Object.entries(services)) if (k.endsWith(':ponctuel')) oneOff += v; else recurring += v;
  const mun = s.plugins.service<any>('municipal');
  const modLines: Record<string, number> = {};
  for (const l of mun?.budget?.lastMonth?.lines ?? []) if (l.service !== 'economie') modLines[l.category] = Math.round((modLines[l.category] ?? 0) + (l.side === 'income' ? l.amount : -l.amount));
  const taxes: Record<string, number> = {};
  let taxTotal = 0;
  for (const k of TAX_SECTORS) { taxes[k] = Math.round(rec.income[k]); taxTotal += rec.income[k]; }
  const reached = cmd('paliers', 'state').data?.title ?? null;
  const row: Row = {
    m: rows.length + 1, pop: rec.population, money: Math.round(s.economy.money),
    balance: Math.round(rec.balance + recurring), taxes, taxTotal: Math.round(taxTotal),
    upkeepBuildings: Math.round(rec.expenses.buildings), upkeepRoads: Math.round(rec.expenses.roads), salaries: Math.round(rec.expenses.salaries),
    loans: Math.round(rec.expenses.loanInterest + rec.expenses.loanPrincipal),
    services: Object.fromEntries(Object.entries(services).map(([k, v]) => [k, Math.round(v)])), servicesRecurring: Math.round(recurring), oneOff: Math.round(oneOff),
    construction: Math.round(rec.construction), happiness: Math.round(rec.happiness * 10) / 10, unemployment: Math.round(rec.unemploymentRate * 1000) / 10,
    upkeepBy: Object.fromEntries(Object.entries(upkeepBy).map(([k, v]) => [k, Math.round(v)])),
    salaryBy: Object.fromEntries(Object.entries(salaryBy).map(([k, v]) => [k, Math.round(v)])), modLines,
    palier: typeof reached === 'string' ? reached : (reached?.nameFr ?? null),
  };
  rows.push(row);
  if (row.money < minMoney) { minMoney = row.money; minMoneyAt = row.m; }
  if (firstPositive === null && row.balance > 0 && row.m >= 2) firstPositive = row.m;
  if (s.economy.bankrupt && bankruptAt === null) bankruptAt = row.m;
  log(`m${String(row.m).padStart(2)} pop ${String(row.pop).padStart(5)} trésor ${String(Math.round(row.money / 1000)).padStart(6)} k  solde ${String(row.balance).padStart(8)}  impôts ${row.taxTotal}  entretien ${row.upkeepBuildings}+${row.upkeepRoads}  salaires ${row.salaries}  services ${row.servicesRecurring}  ponctuel ${row.oneOff}  satisf ${row.happiness}  palier ${row.palier ?? '-'}`);
}

/** Relevé quotidien : population, trésorerie, rythme mensuel courant (solde horaire × 720, services compris). */
const days: { d: number; pop: number; money: number; rythme: number; impots: number; invest: number }[] = [];
const t0 = Date.now();
const STEP = Number(opt('pas', '10'));
const DAY_TICKS = Math.round(1440 / STEP);
let day = 0;
while (rows.length < MONTHS) {
  for (let i = 0; i < DAY_TICKS; i++) {
    s.tick(STEP);
    if (i % Math.round(180 / STEP) === Math.round(180 / STEP) - 1 && PARCOURS !== 'depart') samplePeak();
    if (s.economy.history.length > prevHist) { prevHist = s.economy.history.length; closeMonth(s.economy.history[prevHist - 1]!); }
  }
  day++;
  days.push({ d: day, pop: s.demography!.population, money: Math.round(money()), rythme: Math.round(s.economy.hourlyBalance * 720), impots: Math.round(s.economy.monthlyIncome), invest: Math.round(spentInvest) });
  if (args.includes('--debug') && day % 10 === 0) {
    const r = report();
    const el = cmd('electricite', 'state').data?.summary;
    const w = cmd('eau', 'state').data?.balance;
    console.log(`  dbg j${day} pop ${r.population} cap ${r.housingCapacity} libre ${r.housingFree} sat ${r.happiness.toFixed(1)} chôm ${(r.unemploymentRate * 100).toFixed(1)} lots ${JSON.stringify((s.demography as any).residentialLots())} dem ${JSON.stringify(r.demand)}`);
    console.log(`      facteurs ${r.satisfactionFactors.filter((f) => Math.abs(f.delta) > 0.5).map((f) => `${f.key} ${f.delta.toFixed(1)}`).join(', ')} | vacance ${JSON.stringify(r.vacancyReasons)} | hint ${JSON.stringify(r.growthHint)}`);
    console.log(`      élec demande ${el?.demandKw?.toFixed(0)} import ${el?.importedKw?.toFixed(0)} coupés ${el?.cut} manque ${el?.shortfallKw?.toFixed(0)} | eau desservis ${w?.servedShare?.toFixed(2)} ${w?.served}/${w?.buildings} | services ${JSON.stringify(r.services)}`);
  }
  if (PARCOURS !== 'depart' && !s.economy.bankrupt) {
    utilities(day);
    expansion(day);
    manualHousing();
    services(day);
    transit(day);
    loans(day);
  }
  if (s.economy.bankrupt && bankruptAt === null) bankruptAt = rows.length + 1;
}

/* --------------------------------- Synthèse --------------------------------- */
const firstPositiveAfter = (() => { // premier mois à partir duquel le solde reste positif 3 mois de suite
  for (let i = 1; i + 2 < rows.length; i++) if (rows[i]!.balance > 0 && rows[i + 1]!.balance > 0 && rows[i + 2]!.balance > 0) return rows[i]!.m;
  return null;
})();
const out = {
  parcours: PARCOURS_OPT, manuel: MANUEL ? { poses: manualPlaced, cout: Math.round(manualSpent) } : undefined, reglages: REG, mois: MONTHS, graine: SEED, msSimulation: Date.now() - t0,
  investissementsJoueur: Math.round(spentInvest), bankruptAt, firstPositive, positiveDurable: firstPositiveAfter, minMoney, minMoneyAt,
  popFinale: rows[rows.length - 1]?.pop, tresorFinale: rows[rows.length - 1]?.money, construits: built, rangees: rowsBuilt, coverageKeys,
  evenements: note, rows, days, errors: s.plugins.errors,
};
log(JSON.stringify({ ...out, rows: undefined, evenements: undefined }));
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(out));
if (SAVE_OUT) writeFileSync(SAVE_OUT, JSON.stringify(s.toSave()));
void MILESTONES;
