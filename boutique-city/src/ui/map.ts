/**
 * Plan du quartier : mini-carte (coin de l'écran, centrée sur le personnage, nord en haut) et grande carte (M) avec
 * légende. Cliquer un lieu sur la grande carte, ou dans la légende, place une destination (balise dans la rue).
 */
import { SERVICES, SERVICE_BY_ID, SHOP_TYPE_BY_ID } from '../sim/catalog';
import { BLOCK, SIDEWALK_W, blockCenter, type Building } from '../sim/district';
import type { Game } from '../sim/game';
import { $, button, el } from './dom';

export interface Poi { b: Building; color: string; label: string }

export function pois(g: Game): Poi[] {
  const out: Poi[] = [];
  for (const b of g.district.buildings) {
    if (b.service) { const s = SERVICE_BY_ID.get(b.service)!; out.push({ b, color: s.color, label: s.nameFr }); continue; }
    if (b.home) { out.push({ b, color: b.home.id === g.player.home ? '#ffffff' : '#9ec9ff', label: b.home.id === g.player.home ? 'Chez moi' : 'Logement à louer' }); continue; }
    if (b.premise) {
      const sh = g.shopAt(b.premise.id);
      if (sh) out.push({ b, color: '#5cc77a', label: sh.name });
      else if (!b.premise.competitor) out.push({ b, color: '#ffd166', label: 'Local à louer' });
      else out.push({ b, color: '#8a6f9e', label: `${b.premise.competitorName ?? 'Concurrent'} (${SHOP_TYPE_BY_ID.get(b.premise.competitor)!.nameFr.toLowerCase()})` });
    }
  }
  return out;
}

function drawCity(ctx: CanvasRenderingContext2D, g: Game, tx: (x: number) => number, tz: (z: number) => number, s: number, list: Poi[]): void {
  const d = g.district;
  ctx.fillStyle = '#39414b';
  ctx.fillRect(tx(-d.size.w / 2 - 10), tz(-d.size.d / 2 - 10), (d.size.w + 20) * s, (d.size.d + 20) * s);
  for (let i = 0; i < d.nx; i++) for (let j = 0; j < d.nz; j++) {
    const c = blockCenter(d, i, j), h = BLOCK / 2 + SIDEWALK_W;
    ctx.fillStyle = i === d.parkBlock.i && j === d.parkBlock.j ? '#5f8f4e' : '#6f747b';
    ctx.fillRect(tx(c.x - h), tz(c.z - h), 2 * h * s, 2 * h * s);
  }
  for (const b of d.buildings) { ctx.fillStyle = '#8d939b'; ctx.fillRect(tx(b.x - b.w / 2), tz(b.z - b.d / 2), b.w * s, b.d * s); }
  for (const p of list) { ctx.fillStyle = p.color; ctx.fillRect(tx(p.b.x - p.b.w / 2), tz(p.b.z - p.b.d / 2), p.b.w * s, p.b.d * s); }
}

function arrow(ctx: CanvasRenderingContext2D, x: number, y: number, heading: number, size: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-heading);
  ctx.fillStyle = color; ctx.strokeStyle = '#0b1119'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, -size); ctx.lineTo(size * 0.7, size * 0.8); ctx.lineTo(0, size * 0.35); ctx.lineTo(-size * 0.7, size * 0.8); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.restore();
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
    c.fillStyle = '#20262e'; c.fillRect(0, 0, W, W);
    drawCity(c, g, tx, tz, s, this.list);
    for (const v of g.vehicles) { c.fillStyle = '#ffffff'; c.beginPath(); c.arc(tx(v.x), tz(v.z), 5, 0, Math.PI * 2); c.fill(); }
    if (dest) {
      const dx = tx(dest.x), dz = tz(dest.z);
      const inside = dx > 8 && dz > 8 && dx < W - 8 && dz < W - 8;
      c.strokeStyle = '#5fc3ff'; c.lineWidth = 3; c.setLineDash([8, 6]);
      c.beginPath(); c.moveTo(W / 2, W / 2); c.lineTo(Math.max(8, Math.min(W - 8, dx)), Math.max(8, Math.min(W - 8, dz))); c.stroke(); c.setLineDash([]);
      if (inside) { c.fillStyle = '#5fc3ff'; c.beginPath(); c.arc(dx, dz, 8, 0, Math.PI * 2); c.fill(); }
    }
    arrow(c, W / 2, W / 2, heading, 13, '#ffcf4a');
  }
}

/** Grande carte (superposée), fermée par M, Échap ou le bouton. */
export class BigMap {
  private readonly root = $('map');
  isOpen = false;

  constructor(private readonly game: Game, private readonly onPick: (p: Poi) => void) {}

  toggle(px: number, pz: number, heading: number): void { if (this.isOpen) this.close(); else this.open(px, pz, heading); }

  close(): void { this.isOpen = false; this.root.classList.add('hidden'); this.root.replaceChildren(); }

  open(px: number, pz: number, heading: number): void {
    const g = this.game;
    this.isOpen = true;
    const list = pois(g);
    const d = g.district;
    const cv = el('canvas', { cls: 'bigmap', attrs: { width: '1200', height: String(Math.round((1200 * (d.size.d + 40)) / (d.size.w + 40))) } });
    const ctx = cv.getContext('2d')!;
    const s = cv.width / (d.size.w + 40);
    const tx = (x: number): number => (x + d.size.w / 2 + 20) * s, tz = (z: number): number => (z + d.size.d / 2 + 20) * s;
    ctx.fillStyle = '#20262e'; ctx.fillRect(0, 0, cv.width, cv.height);
    drawCity(ctx, g, tx, tz, s, list);
    ctx.font = '600 15px system-ui, sans-serif'; ctx.textAlign = 'center';
    for (const p of list) {
      if (!p.b.service && !(p.label === 'Chez moi') && !g.shops.some((sh) => sh.premiseId === p.b.premise?.id)) continue;
      const x = tx(p.b.doorX), y = tz(p.b.doorZ) - 10;
      const w = ctx.measureText(p.label).width + 12;
      ctx.fillStyle = 'rgba(11,17,25,0.82)'; ctx.fillRect(x - w / 2, y - 12, w, 20);
      ctx.fillStyle = '#ffffff'; ctx.fillText(p.label, x, y + 3);
    }
    for (const v of g.vehicles) { ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(tx(v.x), tz(v.z), 6, 0, Math.PI * 2); ctx.fill(); }
    arrow(ctx, tx(px), tz(pz), heading, 16, '#ffcf4a');
    cv.addEventListener('click', (e) => {
      const r = cv.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * cv.width / s - d.size.w / 2 - 20;
      const z = ((e.clientY - r.top) / r.height) * cv.height / s - d.size.d / 2 - 20;
      let best: Poi | null = null, bd = 14;
      for (const p of list) { const dd = Math.hypot(p.b.x - x, p.b.z - z) - Math.max(p.b.w, p.b.d) / 2; if (dd < bd) { bd = dd; best = p; } }
      if (best) { this.onPick(best); this.close(); }
    });
    const legend = el('div', { cls: 'map-legend' },
      el('div', { cls: 'sec', text: 'Aller à' }),
      ...SERVICES.filter((sv, k, a) => a.findIndex((x) => x.id === sv.id) === k).map((sv) => {
        const p = list.filter((x) => x.b.service === sv.id).sort((a, b) => Math.hypot(a.b.doorX - px, a.b.doorZ - pz) - Math.hypot(b.b.doorX - px, b.b.doorZ - pz))[0];
        return p ? button(sv.nameFr, () => { this.onPick(p); this.close(); }, 'legend-btn') : null;
      }),
      ...list.filter((p) => p.label === 'Chez moi' || g.shops.some((sh) => sh.premiseId === p.b.premise?.id)).map((p) => button(p.label, () => { this.onPick(p); this.close(); }, 'legend-btn')),
      el('div', { cls: 'sec', text: 'Légende' }),
      ...[['#ffd166', 'Local à louer'], ['#5cc77a', 'Mes commerces'], ['#8a6f9e', 'Concurrents'], ['#9ec9ff', 'Logement à louer'], ['#ffffff', 'Chez moi / véhicules']].map(([c, t]) => el('div', { cls: 'leg' }, el('i', { attrs: { style: `background:${c}` } }), el('span', { text: t! }))),
      el('p', { cls: 'muted small', text: 'Cliquez un bâtiment pour y placer une destination.' }),
      button('Fermer (M)', () => this.close(), 'wide'));
    this.root.replaceChildren(el('div', { cls: 'map-box' }, cv, legend));
    this.root.classList.remove('hidden');
  }
}
