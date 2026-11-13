/**
 * Panneau d'interface du module « Chantiers » — propriété de la branche p2a-chantiers.
 *
 * Liste les chantiers en cours (bâtiment, phase, avancement, temps restant) et permet d'activer ou de
 * désactiver les chantiers pour la partie. Le panneau est enregistré dans `UI_PANELS` ; il sera monté par
 * la refonte d'interface (§1bis de docs/ROADMAP_PHASE2.md) : `mount(root, api)` fonctionne dès maintenant
 * (utilisé par les tests), sans dépendre du reste du HUD.
 */
import type { UiPanel, UiPanelApi } from './types';
import type { ChantiersDelta, ChantiersEtat, ChantierInfo } from '../../shared/protocol-ext/chantiers';

/** « 2 j 04 h » / « 3 h 20 » / « 45 min » à partir de minutes de jeu. */
export function formatDureeFr(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), mm = m % 60;
  if (h < 24) return `${h} h ${String(mm).padStart(2, '0')}`;
  return `${Math.floor(h / 24)} j ${String(h % 24).padStart(2, '0')} h`;
}

/** Ligne de texte d'un chantier (reprise par les tests). */
export function ligneChantier(c: ChantierInfo): string {
  const pct = Math.round(c.avancement * 100);
  const quoi = c.kind === 'demolition' ? `Démolition — ${c.nomFr}` : c.nomFr;
  return `${quoi} · ${c.phaseFr} · ${pct} % · reste ${formatDureeFr(c.resteCalendaire)}`;
}

export const chantiersPanel: UiPanel = {
  id: 'chantiers',
  title: 'Chantiers (grues, échafaudages, démolition)',
  phase: '2A',

  mount(root: HTMLElement, api: UiPanelApi): () => void {
    const doc = root.ownerDocument;
    const el = (tag: string, cls?: string, text?: string): HTMLElement => {
      const n = doc.createElement(tag);
      if (cls) n.className = cls;
      if (text !== undefined) n.textContent = text;
      return n;
    };
    const entete = el('div', 'panel-row');
    const resume = el('span', 'panel-value', 'Chantiers : —');
    const bouton = doc.createElement('button');
    bouton.type = 'button';
    bouton.className = 'btn';
    bouton.textContent = 'Désactiver';
    entete.append(resume, bouton);
    const liste = el('ul', 'chantier-list');
    const vide = el('p', 'panel-hint', 'Aucun chantier en cours. Posez un bâtiment pour en ouvrir un.');
    root.append(entete, liste, vide);

    let actif = true;
    const rendre = (e: ChantiersEtat): void => {
      actif = e.actif;
      bouton.textContent = e.actif ? 'Désactiver' : 'Activer';
      const n = e.chantiers.length;
      resume.textContent = e.actif
        ? `Chantiers : ${n}${n > 0 ? (e.enTravail ? ' · en travaux' : ' · hors horaires') : ''}`
        : 'Chantiers désactivés (construction immédiate)';
      vide.hidden = n > 0 || !e.actif;
      liste.replaceChildren(...e.chantiers.map((c) => {
        const li = el('li', 'chantier-item');
        li.append(el('span', 'chantier-nom', ligneChantier(c)));
        const jauge = el('span', 'chantier-jauge');
        const barre = el('span', 'chantier-barre');
        barre.style.width = `${Math.round(c.avancement * 100)}%`;
        jauge.append(barre);
        li.append(jauge);
        li.dataset['chantier'] = String(c.id);
        return li;
      }));
    };

    const rafraichir = (): void => {
      void api.command('etat').then((d) => { if (d) rendre(d as ChantiersEtat); }).catch(() => undefined);
    };
    bouton.addEventListener('click', () => {
      void api.command('configurer', { actif: !actif })
        .then(() => { api.toast(actif ? 'Chantiers désactivés' : 'Chantiers activés', 'ok'); rafraichir(); })
        .catch((e: unknown) => api.toast(e instanceof Error ? e.message : String(e), 'error'));
    });

    // Un delta du module signale un changement de liste : on ne redemande l'état que dans ce cas.
    const off = api.onDeltaExt((payload) => {
      const d = payload as ChantiersDelta | undefined;
      if (d && (d.ajoutes?.length || d.termines?.length)) rafraichir();
    });
    const timer = setInterval(rafraichir, 2000);
    rafraichir();
    return () => { off(); clearInterval(timer); root.replaceChildren(); };
  },
};
