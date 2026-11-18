/**
 * Fiche détaillée d'un modèle du menu de construction (ordinateur) : au survol ou au focus d'une carte, une fiche
 * s'ouvre au-dessus du tiroir avec tout ce que la carte tronque — nom complet, coût et entretien, chiffres clés,
 * effets (pollution, attractivité, odeurs), dépendances en entier et la liste des variantes (nom + pastilles de
 * couleur). Un clic sur une variante lance la pose avec cette variante.
 * Données : catalogue et `cardInfo` (rien n'est inventé).
 */
import type { CatalogAsset } from '../shared/catalog';
import { TILE_SIZE } from '../shared/constants';
import { cardInfo } from './card-info';
import { el, fmt, money } from './dom';
import { iconEl } from './icons';

export interface CardDetailDeps {
  /** Vignette déjà rendue (même source que les cartes), ou null. */
  thumb(assetId: string): Promise<string> | null;
  /** Lance la pose du modèle avec la variante `variant` (index). */
  place(asset: CatalogAsset, variant: number): void;
  /** Palier qui débloque le modèle (déblocages progressifs), sinon null. */
  lock(assetId: string): string | null;
  /** Libellé de la catégorie (onglet) de la carte. */
  category: string;
}

const tagNum = (a: CatalogAsset, prefix: string): number => {
  const t = a.tags.find((x) => x.startsWith(prefix));
  const v = t ? Number(t.slice(prefix.length)) : NaN;
  return Number.isFinite(v) ? v : 0;
};

/** Effets sur le voisinage lus dans les étiquettes du catalogue. */
function effects(a: CatalogAsset): { icon: string; text: string; bad?: boolean }[] {
  const out: { icon: string; text: string; bad?: boolean }[] = [];
  const pol = tagNum(a, 'pollution:');
  if (pol) out.push({ icon: 'factory', text: `Pollution ${pol >= 2 ? 'forte' : 'modérée'} autour du bâtiment`, bad: true });
  if (tagNum(a, 'odeurs:')) out.push({ icon: 'waste', text: 'Odeurs dans le voisinage', bad: true });
  if (a.tags.includes('trafic_poids_lourds')) out.push({ icon: 'truck', text: 'Trafic de poids lourds', bad: true });
  const att = tagNum(a, 'attractivite:');
  if (att) out.push({ icon: 'star', text: `Attractivité ${att >= 3 ? 'très forte' : 'forte'} (bonheur et valeur foncière autour)` });
  if (a.tags.includes('bord_de_l_eau')) out.push({ icon: 'water', text: 'Se pose au bord de l’eau' });
  return out;
}

/** Couleurs d'une variante (surcharges de matériaux) pour ses pastilles ; vide = matériaux d'origine. */
function swatches(v: CatalogAsset['variants'][number]): string[] {
  const out: string[] = [];
  for (const o of Object.values(v.materialOverrides ?? {})) if (o.color && !out.includes(o.color)) out.push(o.color);
  return out.slice(0, 4);
}

export class CardDetail {
  readonly root = el('aside', { attrs: { id: 'card-detail', class: 'hidden', role: 'dialog', 'aria-label': 'Détail du bâtiment' } });
  private hideTimer = 0;
  private current: string | null = null;

  constructor(private deps: () => CardDetailDeps | null) {
    document.body.append(this.root);
    // La souris peut passer de la carte à la fiche (pour choisir une variante) sans que la fiche se ferme.
    this.root.addEventListener('mouseenter', () => window.clearTimeout(this.hideTimer));
    this.root.addEventListener('mouseleave', () => this.hideSoon());
  }

  /** Ouvre la fiche de `a` au-dessus de `anchor` (carte du tiroir). */
  show(a: CatalogAsset, anchor: HTMLElement, placeable: boolean): void {
    window.clearTimeout(this.hideTimer);
    const d = this.deps();
    if (!d) return;
    if (this.current !== a.id) { this.render(a, d, placeable); this.current = a.id; }
    this.root.classList.remove('hidden');
    this.position(anchor);
  }

  hideSoon(delay = 220): void {
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.hide(), delay);
  }

  hide(): void {
    window.clearTimeout(this.hideTimer);
    this.root.classList.add('hidden');
  }

  private position(anchor: HTMLElement): void {
    const r = anchor.getBoundingClientRect();
    const drawer = document.getElementById('build-drawer')?.getBoundingClientRect();
    const top = drawer ? drawer.top : r.top;
    const w = this.root.offsetWidth || 360;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    this.root.style.left = `${Math.round(left)}px`;
    this.root.style.bottom = `${Math.round(window.innerHeight - top + 8)}px`;
    // Hauteur disponible au-dessus du tiroir (sous la barre supérieure) : défilement interne au-delà.
    this.root.style.maxHeight = `${Math.max(180, Math.round(top - 8 - 72))}px`;
  }

  private render(a: CatalogAsset, d: CardDetailDeps, placeable: boolean): void {
    const info = cardInfo(a);
    const img = el('div', { cls: 'cd-thumb' });
    const url = d.thumb(a.id);
    if (url) void url.then((u) => img.replaceChildren(el('img', { attrs: { src: u, alt: a.nameFr, draggable: 'false' } }))).catch(() => undefined);
    const w = a.footprint.tilesX * TILE_SIZE, dz = a.footprint.tilesZ * TILE_SIZE;
    const rows: [string, string, string][] = [];
    if (a.capacity.residents) rows.push(['people', 'Habitants', fmt(a.capacity.residents)]);
    if (a.capacity.jobs) rows.push(['office', 'Emplois', fmt(a.capacity.jobs)]);
    if (a.footprint.tilesX > 0) rows.push(['building', 'Emprise', `${a.footprint.tilesX}×${a.footprint.tilesZ} cases (${w} × ${dz} m) · ${Math.round(a.dimensions.height)} m de haut`]);
    const lock = placeable ? d.lock(a.id) : null;
    const variants = a.variants.length > 1 ? el('div', { cls: 'cd-variants' },
      el('h6', { text: `${a.variants.length} variantes${placeable && !lock ? ' — cliquez pour poser celle-ci' : ''}` }),
      ...a.variants.map((v, i) => {
        const b = el('button', { cls: 'cd-var', attrs: { type: 'button', 'data-variant': String(i) } },
          el('span', { cls: 'cd-sw' }, ...(swatches(v).length ? swatches(v) : ['transparent']).map((c) => el('i', { attrs: { style: `background:${c}` } }))),
          el('span', { text: v.nameFr }));
        if (!placeable || lock) b.disabled = true;
        else b.addEventListener('click', () => { this.hide(); d.place(a, i); });
        return b;
      })) : null;
    const fx = effects(a);
    const parts: (Node | null)[] = [
      el('header', {}, img, el('div', { cls: 'cd-head' }, el('span', { cls: 'cd-kicker', text: d.category }), el('h4', { text: a.nameFr }),
        placeable ? el('span', { cls: 'cd-price' }, el('b', { text: money(a.cost) }), el('span', { text: ` · ${money(a.upkeepPerMonth)} / mois` })) : null)),
      lock ? el('p', { cls: 'cd-lock' }, iconEl('lock'), el('span', { text: `Débloqué au palier « ${lock} » (Progression › Paliers)` })) : null,
      el('dl', { cls: 'cd-rows' }, ...rows.flatMap(([ic, k, v]) => [el('dt', {}, iconEl(ic), el('span', { text: k })), el('dd', { text: v })])),
      info.stats.length ? el('ul', { cls: 'cd-stats' }, ...info.stats.map((s) => el('li', {}, iconEl(s.icon), el('span', { text: s.text })))) : null,
      fx.length ? el('ul', { cls: 'cd-fx' }, ...fx.map((f) => el('li', { cls: f.bad ? 'bad' : '' }, iconEl(f.icon), el('span', { text: f.text })))) : null,
      info.depends ? el('p', { cls: 'cd-dep' }, iconEl('info'), el('span', { text: info.depends })) : null,
      variants,
      placeable && !lock ? el('p', { cls: 'cd-hint', text: 'Clic sur la carte : placer · R : pivoter · X : variante suivante' }) : null,
    ];
    this.root.replaceChildren(...parts.filter((n): n is Node => n !== null));
  }
}
