/**
 * Éditeur d'aménagement (vue de dessus) : grille du local en cases de 1 m, porte en bas. Choisir un meuble dans la
 * palette puis cliquer pour le poser (R : tourner) ; cliquer un meuble posé pour le sélectionner, glisser pour le
 * déplacer, Suppr pour le revendre. Toutes les règles et tous les prix viennent de la simulation (Game).
 */
import { ECONOMY, FURNITURE, FURNITURE_BY_ID, productsOf } from '../sim/catalog';
import type { Game, Shop } from '../sim/game';
import { canPlace, doorCells, footprint, occupancy } from '../sim/layout';
import { $, button, chf, el, num } from './dom';

/** Meubles utiles par type de commerce (les autres restent disponibles, en second). */
function relevant(shop: Shop): Set<string> {
  const stores = new Set(productsOf(shop.type).map((p) => p.store));
  const ids = new Set<string>(['caisse', 'plante', 'lampe', 'tapis']);
  for (const f of FURNITURE) if (stores.has(f.kind as never)) ids.add(f.id);
  if (shop.type === 'cafe') { ids.add('machine'); ids.add('table'); }
  return ids;
}

export class InteriorEditor {
  private readonly root = $('editor');
  private canvas!: HTMLCanvasElement;
  private shop: Shop | null = null;
  private tool: string | null = null;
  private rot: 0 | 1 = 0;
  private selected: number | null = null;
  private hover: { x: number; z: number } | null = null;
  private drag: { uid: number; dx: number; dz: number } | null = null;
  private cell = 40;
  private readonly keyHandler = (e: KeyboardEvent): void => this.key(e);

  constructor(private readonly game: Game, private readonly toast: (t: string, k?: 'ok' | 'error' | 'info') => void, private readonly onChange: () => void) {}

  get isOpen(): boolean { return !this.root.classList.contains('hidden'); }

  open(shop: Shop): void {
    this.shop = shop; this.tool = null; this.selected = null; this.rot = 0;
    this.root.classList.remove('hidden');
    window.addEventListener('keydown', this.keyHandler);
    this.build();
  }

  close(): void {
    this.root.classList.add('hidden');
    window.removeEventListener('keydown', this.keyHandler);
    this.shop = null;
    this.onChange();
  }

  private build(): void {
    const s = this.shop!;
    const p = this.game.premise(s.premiseId)!;
    const rel = relevant(s);
    const pal = el('div', { cls: 'ed-palette' }, el('div', { cls: 'sec', text: 'Mobilier' }),
      ...[...FURNITURE].sort((a, b) => Number(rel.has(b.id)) - Number(rel.has(a.id))).map((f) => {
        const b = el('button', { cls: `ed-item${rel.has(f.id) ? '' : ' dim'}${this.tool === f.id ? ' on' : ''}`, attrs: { type: 'button', 'data-def': f.id } },
          el('i', { attrs: { style: `background:${f.color}` } }),
          el('span', { cls: 'n', text: f.nameFr }),
          el('span', { cls: 'p', text: `${chf(f.price)} · ${f.w}×${f.d} m` }));
        b.addEventListener('click', () => { this.tool = this.tool === f.id ? null : f.id; this.selected = null; this.build(); });
        return b;
      }));
    const avail = Math.min(window.innerWidth - 560, window.innerHeight - 220);
    this.cell = Math.max(22, Math.min(56, Math.floor(avail / Math.max(p.gridW, p.gridD))));
    this.canvas = el('canvas', { cls: 'ed-canvas' });
    this.canvas.width = p.gridW * this.cell; this.canvas.height = p.gridD * this.cell + 24;
    this.canvas.addEventListener('pointermove', (e) => this.pointer(e, 'move'));
    this.canvas.addEventListener('pointerdown', (e) => this.pointer(e, 'down'));
    this.canvas.addEventListener('pointerup', (e) => this.pointer(e, 'up'));
    this.canvas.addEventListener('pointerleave', () => { this.hover = null; this.draw(); });
    const st = this.game.stats(s);
    const caps = Object.entries(st.capacity).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${num(v)}`).join(' · ') || 'aucun meuble de présentation';
    const tips: string[] = [];
    if (st.registers === 0) tips.push('Posez au moins une caisse : sans caisse, personne ne peut payer.');
    for (const pr of productsOf(s.type)) if (st.capacity[pr.store] === 0 && !tips.some((t) => t.includes(pr.store))) tips.push(`Aucun meuble « ${pr.store} » : ${productsOf(s.type).filter((q) => q.store === pr.store).map((q) => q.nameFr.toLowerCase()).join(', ')} invendables.`);
    if (s.type === 'cafe' && st.machines === 0) tips.push('Sans machine à café, ni café ni thé.');
    if (st.blocked.length) tips.push(`${st.blocked.length} meuble(s) inaccessible(s) depuis l'entrée : laissez un passage.`);
    const info = el('div', { cls: 'ed-info' },
      el('div', { cls: 'sec', text: `${s.name} — ${p.gridW} × ${p.gridD} m` }),
      el('p', { text: `Caisses : ${st.registers} · places assises : ${st.seats} · décoration : ${Math.round(Math.min(1, st.decor) * 100)} %` }),
      el('p', { text: `Capacité : ${caps}` }),
      el('p', { cls: 'muted', text: `Mobilier : ${chf(st.value)} (revente ${Math.round(ECONOMY.resale * 100)} %) · trésorerie ${chf(this.game.cash)}` }),
      ...tips.map((t) => el('p', { cls: 'warn', text: t })),
      el('p', { cls: 'muted small', text: 'Clic : poser · R : tourner · clic sur un meuble : le sélectionner, glisser pour le déplacer · Suppr : revendre · Échap : fermer' }),
      this.selected !== null ? el('div', { cls: 'row' }, button('Tourner', () => this.rotateSelected()), button('Revendre', () => this.removeSelected(), 'danger')) : null,
    );
    this.root.replaceChildren(el('div', { cls: 'ed-box' },
      el('div', { cls: 'ed-head' }, el('h2', { text: 'Aménagement' }), button('Terminer', () => this.close(), 'primary')),
      el('div', { cls: 'ed-body' }, pal, el('div', { cls: 'ed-stage' }, this.canvas), info)));
    this.draw();
  }

  private cellAt(e: PointerEvent): { x: number; z: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: Math.floor(((e.clientX - r.left) / r.width) * this.canvas.width / this.cell), z: Math.floor(((e.clientY - r.top) / r.height) * this.canvas.height / this.cell) };
  }

  private pointer(e: PointerEvent, kind: 'move' | 'down' | 'up'): void {
    const s = this.shop!;
    const p = this.game.premise(s.premiseId)!;
    const c = this.cellAt(e);
    this.hover = c;
    if (kind === 'down') {
      if (this.tool) {
        const def = FURNITURE_BY_ID.get(this.tool)!;
        const f = footprint(def, this.rot);
        const r = this.game.place(s.id, this.tool, c.x - Math.floor((f.w - 1) / 2), c.z - Math.floor((f.d - 1) / 2), this.rot);
        if (!r.ok) this.toast(r.message, 'error');
        this.build();
        return;
      }
      const occ = occupancy(s.items, p.gridW, p.gridD);
      const uid = c.x >= 0 && c.z >= 0 && c.x < p.gridW && c.z < p.gridD ? occ[c.z * p.gridW + c.x]! - 1 : -1;
      if (uid >= 0) {
        const it = s.items.find((i) => i.uid === uid)!;
        this.selected = uid;
        this.drag = { uid, dx: c.x - it.x, dz: c.z - it.z };
        this.canvas.setPointerCapture(e.pointerId);
      } else this.selected = null;
      this.build();
      return;
    }
    if (kind === 'up' && this.drag) {
      const it = s.items.find((i) => i.uid === this.drag!.uid);
      if (it) {
        const nx = c.x - this.drag.dx, nz = c.z - this.drag.dz;
        if (nx !== it.x || nz !== it.z) { const r = this.game.moveItem(s.id, it.uid, nx, nz, it.rot); if (!r.ok) this.toast(r.message, 'error'); }
      }
      this.drag = null;
      this.build();
      return;
    }
    this.draw();
  }

  private key(e: KeyboardEvent): void {
    if (!this.isOpen) return;
    if (e.key === 'Escape') { if (this.tool) { this.tool = null; this.build(); } else this.close(); }
    else if (e.key === 'r' || e.key === 'R') { if (this.selected !== null) this.rotateSelected(); else { this.rot = this.rot ? 0 : 1; this.draw(); } }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected !== null) this.removeSelected();
  }

  private rotateSelected(): void {
    const s = this.shop!, it = s.items.find((i) => i.uid === this.selected);
    if (!it) return;
    const r = this.game.moveItem(s.id, it.uid, it.x, it.z, it.rot ? 0 : 1);
    if (!r.ok) this.toast(r.message, 'error');
    this.build();
  }

  private removeSelected(): void {
    const r = this.game.removeItem(this.shop!.id, this.selected!);
    if (r.ok) this.toast(`Meuble revendu ${chf(r.data)}`, 'info');
    this.selected = null;
    this.build();
  }

  private draw(): void {
    const s = this.shop;
    if (!s) return;
    const p = this.game.premise(s.premiseId)!;
    const g = this.canvas.getContext('2d')!;
    const C = this.cell;
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    // Sol (parquet clair) et quadrillage.
    g.fillStyle = '#e9dfcf'; g.fillRect(0, 0, p.gridW * C, p.gridD * C);
    g.strokeStyle = 'rgba(0,0,0,0.08)'; g.lineWidth = 1;
    for (let x = 0; x <= p.gridW; x++) { g.beginPath(); g.moveTo(x * C + 0.5, 0); g.lineTo(x * C + 0.5, p.gridD * C); g.stroke(); }
    for (let z = 0; z <= p.gridD; z++) { g.beginPath(); g.moveTo(0, z * C + 0.5); g.lineTo(p.gridW * C, z * C + 0.5); g.stroke(); }
    // Porte et trottoir.
    for (const [x, z] of doorCells(p.gridW, p.gridD)) { g.fillStyle = 'rgba(80,170,90,0.35)'; g.fillRect(x * C, z * C, C, C); }
    g.fillStyle = '#b9b4aa'; g.fillRect(0, p.gridD * C, p.gridW * C, 24);
    g.fillStyle = '#3d4450'; g.font = '600 12px system-ui'; g.textAlign = 'center';
    g.fillText('ENTRÉE — trottoir', (p.gridW * C) / 2, p.gridD * C + 16);
    const blocked = new Set(this.game.stats(s).blocked);
    for (const it of s.items) {
      if (this.drag && this.drag.uid === it.uid) continue;
      const def = FURNITURE_BY_ID.get(it.def)!;
      const f = footprint(def, it.rot);
      this.rect(g, it.x, it.z, f.w, f.d, def.color, def.nameFr, it.uid === this.selected, blocked.has(it.uid));
    }
    // Aperçu : meuble à poser ou meuble déplacé.
    const h = this.hover;
    if (h) {
      let def = this.tool ? FURNITURE_BY_ID.get(this.tool)! : null, rot = this.rot, x = h.x, z = h.z, ignore = -1;
      if (def) { const f = footprint(def, rot); x -= Math.floor((f.w - 1) / 2); z -= Math.floor((f.d - 1) / 2); }
      if (this.drag) { const it = s.items.find((i) => i.uid === this.drag!.uid)!; def = FURNITURE_BY_ID.get(it.def)!; rot = it.rot; x = h.x - this.drag.dx; z = h.z - this.drag.dz; ignore = it.uid; }
      if (def) {
        const f = footprint(def, rot);
        const why = canPlace(s.items, p.gridW, p.gridD, def, x, z, rot, ignore);
        g.globalAlpha = 0.75;
        this.rect(g, x, z, f.w, f.d, why ? '#e05555' : '#5cc77a', why ?? def.nameFr, false, false);
        g.globalAlpha = 1;
      }
    }
  }

  private rect(g: CanvasRenderingContext2D, x: number, z: number, w: number, d: number, color: string, label: string, sel: boolean, blocked: boolean): void {
    const C = this.cell;
    g.fillStyle = color;
    g.beginPath(); g.roundRect(x * C + 2, z * C + 2, w * C - 4, d * C - 4, 6); g.fill();
    g.lineWidth = sel ? 3 : 1.5;
    g.strokeStyle = sel ? '#1e88e5' : blocked ? '#e53935' : 'rgba(0,0,0,0.35)';
    g.stroke();
    g.fillStyle = '#1d232c';
    g.font = `600 ${Math.max(9, Math.min(13, C / 3.2))}px system-ui`;
    g.textAlign = 'center';
    g.fillText(label.length > 18 ? `${label.slice(0, 17)}…` : label, (x + w / 2) * C, (z + d / 2) * C + 4, w * C - 6);
  }
}
