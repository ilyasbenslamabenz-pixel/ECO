/**
 * Plan du quartier : mini-carte (coin de l'écran, centrée sur le personnage, nord en haut) et grande carte (M) avec
 * légende. Cliquer un lieu sur la grande carte, ou dans la légende, place une destination (balise dans la rue).
 *
 * Code couleur commun aux deux cartes : vert = mes commerces, jaune = locaux libres, couleur propre à chaque
 * service, bleu clair = logements à louer, blanc = chez moi, mauve éteint = concurrents ; flèche jaune = joueur.
 */
import { SERVICES, SERVICE_BY_ID, SHOP_TYPE_BY_ID } from '../sim/catalog';
import { BLOCK, SIDEWALK_W, blockCenter, type Building } from '../sim/district';
import type { Game } from '../sim/game';
import { $, button, el, icon, num } from './dom';

export interface Poi { b: Building; color: string; label: string; kind: 'service' | 'shop' | 'free' | 'rival' | 'home' | 'myhome' }

/** Couleurs de la carte (légende comprise). */
const COL = { shop: '#5cc77a', free: '#ffd166', rival: '#7d6a8c', home: '#9ec9ff', myhome: '#ffffff', player: '#ffcc4d', dest: '#5fc3ff' };

export function pois(g: Game): Poi[] {
  const out: Poi[] = [];
  for (const b of g.district.buildings) {
    if (b.service) { const s = SERVICE_BY_ID.get(b.service)!; out.push({ b, color: s.color, label: s.nameFr, kind: 'service' }); continue; }
    if (b.home) {
      const mine = b.home.id === g.player.home;
      out.push({ b, color: mine ? COL.myhome : COL.home, label: mine ? 'Chez moi' : 'Logement à louer', kind: mine ? 'myhome' : 'home' });
      continue;
    }
    if (b.premise) {
      const sh = g.shopAt(b.premise.id);
      if (sh) out.push({ b, color: COL.shop, label: sh.name, kind: 'shop' });
      else if (!b.premise.competitor) out.push({ b, color: COL.free, label: `Local à louer · ${b.premise.area} m²`, kind: 'free' });
      else out.push({ b, color: COL.rival, label: `${b.premise.competitorName ?? 'Concurrent'} (${SHOP_TYPE_BY_ID.get(b.premise.competitor)!.nameFr.toLowerCase()})`, kind: 'rival' });
    }
  }
  return out;
}

function drawCity(ctx: CanvasRenderingContext2D, g: Game, tx: (x: number) => number, tz: (z: number) => number, s: number, list: Poi[]): void {
  const d = g.district;
  // Chaussée, puis îlots (trottoirs), parc, bâtiments neutres, puis lieux colorés.
  ctx.fillStyle = '#2a3342';
  ctx.fillRect(tx(-d.size.w / 2 - 10), tz(-d.size.d / 2 - 10), (d.size.w + 20) * s, (d.size.d + 20) * s);
  for (let i = 0; i < d.nx; i++) for (let j = 0; j < d.nz; j++) {
    const c = blockCenter(d, i, j), h = BLOCK / 2 + SIDEWALK_W;
    ctx.fillStyle = i === d.parkBlock.i && j === d.parkBlock.j ? '#3d6e45' : '#3b4658';
    ctx.fillRect(tx(c.x - h), tz(c.z - h), 2 * h * s, 2 * h * s);
  }
  for (const b of d.buildings) { ctx.fillStyle = '#56627a'; ctx.fillRect(tx(b.x - b.w / 2), tz(b.z - b.d / 2), b.w * s, b.d * s); }
  for (const p of list) {
    ctx.fillStyle = p.color;
    ctx.globalAlpha = p.kind === 'rival' || p.kind === 'home' ? 0.75 : 1;
    ctx.fillRect(tx(p.b.x - p.b.w / 2), tz(p.b.z - p.b.d / 2), p.b.w * s, p.b.d * s);
  }
  ctx.globalAlpha = 1;
}

function arrow(ctx: CanvasRenderingContext2D, x: number, y: number, heading: number, size: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  // Halo pour retrouver le joueur d'un coup d'œil.
  ctx.fillStyle = 'rgba(255, 204, 77, 0.22)';
  ctx.beginPath(); ctx.arc(0, 0, size * 1.9, 0, Math.PI * 2); ctx.fill();
  ctx.rotate(-heading);
  ctx.fillStyle = color; ctx.strokeStyle = '#0b1119'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(0, -size); ctx.lineTo(size * 0.72, size * 0.8); ctx.lineTo(0, size * 0.35); ctx.lineTo(-size * 0.72, size * 0.8); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.restore();
}

/** Étiquette arrondie (fond sombre, pastille de couleur). */
function tag(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string, strong = false): void {
  ctx.font = `${strong ? 700 : 600} ${strong ? 16 : 14}px Rubik, system-ui, sans-serif`;
  const w = ctx.measureText(text).width + 26, h = strong ? 24 : 21;
  const l = x - w / 2, t = y - h;
  ctx.fillStyle = 'rgba(15, 21, 30, 0.9)'; ctx.strokeStyle = color; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(l, t, w, h, h / 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(l + 10, t + h / 2, 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(text, l + 18, t + h / 2 + 1);
}

/** Rose des vents minimale (N). */
function north(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.fillStyle = 'rgba(15, 21, 30, 0.85)'; ctx.strokeStyle = '#3a4a60'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#ffcc4d'; ctx.font = `800 ${Math.round(r * 0.95)}px Rubik, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('N', x, y + 1);
}

export class MiniMap {
  private readonly cv: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private list: Poi[] = [];
  private listVersion = -1;

  constructor(private readonly game: Game, parent: HTMLElement) {
    this.cv = el('canvas', { cls: 'minimap', attrs: { width: '360', height: '360', 'aria-label': 'Mini-carte' } });
    parent.append(this.cv);
    this.ctx = this.cv.getContext('2d')!;
  }

  set visible(v: boolean) { this.cv.classList.toggle('hidden', !v); }

  draw(px: number, pz: number, heading: number, dest: { x: number; z: number } | null): void {
    const g = this.game;
    if (g.version !== this.listVersion) { this.list = pois(g); this.listVersion = g.version; }
    const W = this.cv.width, s = W / 260;
    const tx = (x: number): number => W / 2 + (x - px) * s, tz = (z: number): number => W / 2 + (z - pz) * s;
    const c = this.ctx;
    c.fillStyle = '#1a2230'; c.fillRect(0, 0, W, W);
    drawCity(c, g, tx, tz, s, this.list);
    for (const v of g.vehicles) { c.fillStyle = '#ffffff'; c.strokeStyle = '#0b1119'; c.lineWidth = 2; c.beginPath(); c.arc(tx(v.x), tz(v.z), 6, 0, Math.PI * 2); c.fill(); c.stroke(); }
    if (dest) {
      const dx = tx(dest.x), dz = tz(dest.z);
      const inside = dx > 10 && dz > 10 && dx < W - 10 && dz < W - 10;
      c.strokeStyle = COL.dest; c.lineWidth = 4; c.setLineDash([10, 7]);
      c.beginPath(); c.moveTo(W / 2, W / 2); c.lineTo(Math.max(10, Math.min(W - 10, dx)), Math.max(10, Math.min(W - 10, dz))); c.stroke(); c.setLineDash([]);
      if (inside) { c.fillStyle = COL.dest; c.strokeStyle = '#0b1119'; c.lineWidth = 3; c.beginPath(); c.arc(dx, dz, 10, 0, Math.PI * 2); c.fill(); c.stroke(); }
    }
    arrow(c, W / 2, W / 2, heading, 15, COL.player);
    north(c, W / 2, 26, 17);
  }
}

/** Grande carte (superposée), fermée par M, Échap ou le bouton. */
export class BigMap {
  private readonly root = $('map');
  isOpen = false;

  constructor(private readonly game: Game, private readonly onPick: (p: Poi) => void) {}

  toggle(px: number, pz: number, heading: number, dest: { x: number; z: number; label?: string } | null = null): void {
    if (this.isOpen) this.close(); else this.open(px, pz, heading, dest);
  }

  close(): void { this.isOpen = false; this.root.classList.add('hidden'); this.root.replaceChildren(); }

  open(px: number, pz: number, heading: number, dest: { x: number; z: number; label?: string } | null = null): void {
    const g = this.game;
    this.isOpen = true;
    const list = pois(g);
    const d = g.district;
    const cv = el('canvas', { cls: 'bigmap', attrs: { width: '1200', height: String(Math.round((1200 * (d.size.d + 40)) / (d.size.w + 40))) } });
    const ctx = cv.getContext('2d')!;
    const s = cv.width / (d.size.w + 40);
    const tx = (x: number): number => (x + d.size.w / 2 + 20) * s, tz = (z: number): number => (z + d.size.d / 2 + 20) * s;
    const dist = (p: Poi): number => Math.hypot(p.b.doorX - px, p.b.doorZ - pz);
    ctx.fillStyle = '#1a2230'; ctx.fillRect(0, 0, cv.width, cv.height);
    drawCity(ctx, g, tx, tz, s, list);
    // Locaux libres : pastille jaune sur la porte (se repèrent même petits).
    for (const p of list.filter((x) => x.kind === 'free')) {
      ctx.fillStyle = COL.free; ctx.strokeStyle = '#0b1119'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(tx(p.b.doorX), tz(p.b.doorZ), 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    for (const v of g.vehicles) { ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#0b1119'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(tx(v.x), tz(v.z), 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    // Étiquettes : services, mes commerces, chez moi.
    for (const p of list) {
      if (p.kind !== 'service' && p.kind !== 'shop' && p.kind !== 'myhome') continue;
      tag(ctx, tx(p.b.doorX), tz(p.b.doorZ) - 8, p.label, p.color, p.kind === 'shop');
    }
    if (dest) {
      const x = tx(dest.x), y = tz(dest.z);
      ctx.strokeStyle = COL.dest; ctx.lineWidth = 4; ctx.setLineDash([10, 7]);
      ctx.beginPath(); ctx.moveTo(tx(px), tz(pz)); ctx.lineTo(x, y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = COL.dest; ctx.strokeStyle = '#0b1119'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    arrow(ctx, tx(px), tz(pz), heading, 18, COL.player);
    tag(ctx, tx(px), tz(pz) - 30, 'Vous', COL.player, true);
    north(ctx, cv.width - 34, 34, 20);

    // Lieu sous le pointeur (infobulle) et clic = destination.
    const pick = (e: MouseEvent): Poi | null => {
      const r = cv.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * cv.width / s - d.size.w / 2 - 20;
      const z = ((e.clientY - r.top) / r.height) * cv.height / s - d.size.d / 2 - 20;
      let best: Poi | null = null, bd = 14;
      for (const p of list) { const dd = Math.hypot(p.b.x - x, p.b.z - z) - Math.max(p.b.w, p.b.d) / 2; if (dd < bd) { bd = dd; best = p; } }
      return best;
    };
    const tip = el('div', { cls: 'map-tip hidden' });
    cv.addEventListener('mousemove', (e) => {
      const p = pick(e);
      tip.classList.toggle('hidden', !p);
      if (p) { tip.textContent = `${p.label} · ${num(dist(p))} m`; const r = (cv.parentElement as HTMLElement).getBoundingClientRect(); tip.style.left = `${e.clientX - r.left + 14}px`; tip.style.top = `${e.clientY - r.top + 12}px`; }
    });
    cv.addEventListener('mouseleave', () => tip.classList.add('hidden'));
    cv.addEventListener('click', (e) => { const p = pick(e); if (p) { this.onPick(p); this.close(); } });

    const go = (p: Poi): void => { this.onPick(p); this.close(); };
    const placeBtn = (p: Poi, label = p.label): HTMLButtonElement => {
      const b = button('', () => go(p), 'legend-btn');
      b.append(el('i', { attrs: { style: `background:${p.color}` } }), el('span', { text: label }), el('small', { text: `${num(dist(p))} m` }));
      return b;
    };
    const nearest = (f: (p: Poi) => boolean): Poi | undefined => list.filter(f).sort((a, b) => dist(a) - dist(b))[0];
    const mine = list.filter((p) => p.kind === 'myhome' || p.kind === 'shop');
    const free = list.filter((p) => p.kind === 'free');
    const freeNear = nearest((p) => p.kind === 'free');
    const count = (k: Poi['kind']): number => list.filter((p) => p.kind === k).length;
    const legend = el('div', { cls: 'map-legend' },
      el('div', { cls: 'sec', text: 'Services' }),
      ...SERVICES.filter((sv, k, a) => a.findIndex((x) => x.id === sv.id) === k).map((sv) => { const p = nearest((x) => x.b.service === sv.id); return p ? placeBtn(p, sv.nameFr) : null; }),
      el('div', { cls: 'sec', text: 'Mes lieux' }),
      ...(mine.length ? mine.map((p) => placeBtn(p)) : [el('p', { cls: 'muted small', text: 'Aucun pour l’instant.' })]),
      el('div', { cls: 'sec', text: `Locaux libres · ${free.length}` }),
      freeNear ? placeBtn(freeNear, 'Le plus proche') : el('p', { cls: 'muted small', text: 'Aucun local libre.' }),
      el('div', { cls: 'sec', text: 'Légende' }),
      el('div', { cls: 'leg-grid' },
        ...([[COL.shop, 'Mes commerces', count('shop')], [COL.free, 'Locaux libres', count('free')], [COL.rival, 'Concurrents', count('rival')], [COL.home, 'Logements à louer', count('home')], [COL.myhome, 'Chez moi, véhicules', null], [COL.player, 'Vous', null], [COL.dest, 'Destination', null]] as [string, string, number | null][])
          .map(([c, t, n]) => el('div', { cls: 'leg' }, el('i', { attrs: { style: `background:${c}` } }), el('span', { text: t }), n !== null ? el('b', { text: String(n) }) : null))));
    const head = el('div', { cls: 'map-head' },
      el('div', {}, el('div', { cls: 'kicker', text: 'Plan du quartier' }), el('h3', { text: dest?.label ? `Destination : ${dest.label}` : 'Où aller ?' })),
      el('span', { cls: 'map-hint' }, icon('pin'), 'Cliquez un bâtiment pour y placer une destination'),
      button('×', () => this.close(), 'icon-x'));
    head.querySelector('.icon-x')?.setAttribute('aria-label', 'Fermer la carte (M)');
    this.root.replaceChildren(el('div', { cls: 'map-box' }, head, el('div', { cls: 'map-main' }, el('div', { cls: 'map-canvas' }, cv, tip), legend)));
    this.root.classList.remove('hidden');
  }
}
