/**
 * Écran « Compte » (comptes joueurs Supabase, src/save/account.ts) : créer un compte, se connecter,
 * mot de passe oublié / nouveau mot de passe, se déconnecter, état de synchronisation, import des
 * parties invité à la première connexion.
 *
 * Tout est injecté par ce module (fenêtre #account-panel, bouton « Compte » du menu principal et de la
 * barre latérale, styles dans <style id="account-styles">) : markup.html, hud.ts et styles.css restent
 * inchangés. N'est installé que si la configuration Supabase est renseignée.
 * Champs en 16 px (pas de zoom Safari iOS), cibles ≥ 44 px, couleurs des variables du thème.
 */
import type { AccountManager, AccountSnapshot } from '../save/account';
import type { SlotInfo } from '../save/store';
import { el } from './dom';
import { iconEl } from './icons';

export interface AccountUiHooks {
  toast(message: string, kind?: 'ok' | 'error' | 'info'): void;
}

type View = 'signin' | 'signup' | 'forgot' | 'newpass';

const CSS = `
#account-panel { z-index: 46; }
#account-panel .account-card { gap: 12px; max-height: calc(100dvh - 32px); overflow-y: auto; }
#account-panel h2 { display: flex; align-items: center; gap: 10px; }
#account-panel h2 svg.ic { color: var(--accent); width: 24px; height: 24px; }
#account-panel .form input { font-size: 16px; min-height: 44px; }
#account-panel button { min-height: 44px; }
:root[data-theme] #account-panel button.primary:hover:not(:disabled) { background: linear-gradient(180deg, #62f0a2, #2fcf76); }
#account-panel .acc-tabs { display: flex; gap: 6px; }
#account-panel .acc-tabs button { flex: 1; }
#account-panel .acc-note { margin: 0; color: var(--muted); font-size: 14px; line-height: 1.45; }
#account-panel .acc-who { margin: 0; color: var(--text-strong); font-size: 15px; overflow-wrap: anywhere; }
#account-panel .acc-msg { margin: 0; font-size: 14px; line-height: 1.45; padding: 10px 12px; border-radius: 10px; color: var(--text-strong);
  background: rgba(var(--ink), .06); border: 1px solid var(--line); }
#account-panel .acc-msg.err { background: rgba(255, 107, 107, .1); border-color: rgba(255, 107, 107, .45); }
#account-panel .acc-msg.ok { background: var(--accent-soft); border-color: rgba(var(--accent-rgb), .45); }
#account-panel .acc-msg:empty { display: none; }
#account-panel .acc-status { display: flex; align-items: center; gap: 10px; font-size: 15px; color: var(--text-strong); }
#account-panel .acc-status small { display: block; color: var(--muted); font-size: 12.5px; }
#account-panel .acc-dot { width: 11px; height: 11px; border-radius: 50%; flex: 0 0 auto; background: var(--muted); }
#account-panel .acc-dot.on { background: var(--accent); box-shadow: 0 0 10px rgba(var(--accent-rgb), .6); }
#account-panel .acc-dot.busy { background: var(--warn); }
#account-panel .acc-link { background: none; border: 0; color: var(--accent); text-decoration: underline; padding: 8px 2px; justify-content: flex-start; align-self: flex-start; }
#account-panel .acc-box { border: 1px solid var(--line); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 10px; background: rgba(var(--ink), .03); }
#account-panel .acc-actions { display: flex; flex-wrap: wrap; gap: 8px; }
#account-panel .acc-actions button { flex: 1 1 140px; }
#btn-account .acc-sub { margin-left: auto; align-self: center; line-height: 1.2; font-size: 12.5px; color: var(--muted); max-width: 55%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;

const PASS_MIN = 6;

function statusLine(s: AccountSnapshot): { cls: string; text: string; sub: string } {
  if (s.state === 'offline') return { cls: '', text: 'Hors ligne — sauvegarde locale', sub: 'Vos parties seront envoyées au retour du réseau.' };
  const st = s.sync;
  const last = st.lastSyncAt ? `Dernière synchronisation : ${new Date(st.lastSyncAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : '';
  const pending = st.pending > 0 ? `${st.pending} envoi${st.pending > 1 ? 's' : ''} en attente` : '';
  const sub = [last, pending].filter(Boolean).join(' · ');
  if (st.state === 'online') return { cls: 'on', text: 'Sauvegardé en ligne', sub };
  if (st.state === 'syncing' || st.state === 'connecting') return { cls: 'busy', text: st.label || 'Synchronisation…', sub };
  if (st.state === 'offline') return { cls: '', text: 'Hors ligne — sauvegarde locale', sub: st.message ? 'Nouvel essai automatique dans quelques minutes.' : sub };
  return { cls: '', text: 'Sauvegardes en ligne inactives', sub };
}

export function installAccountUi(mgr: AccountManager, h: AccountUiHooks): { open(view?: View): void; close(): void } {
  if (typeof document === 'undefined') return { open: () => undefined, close: () => undefined };
  if (!document.getElementById('account-styles')) {
    const style = el('style', { attrs: { id: 'account-styles' } });
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  let view: View = 'signin';
  let message: { text: string; kind: 'ok' | 'err' | '' } = { text: '', kind: '' };
  let busy = false;
  let candidates: SlotInfo[] = [];
  let snap = mgr.snapshot;
  /** Saisie en cours, conservée d'un rendu à l'autre (effacée à la fermeture ; jamais stockée ailleurs). */
  const draft = new Map<string, string>();

  const card = el('div', { cls: 'menu-card account-card' });
  const panel = el('div', { cls: 'overlay hidden', attrs: { id: 'account-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'account-title' } }, card);
  document.body.appendChild(panel);
  panel.addEventListener('click', (e) => { if (e.target === panel) close(); });

  const isOpen = (): boolean => !panel.classList.contains('hidden');
  const setMsg = (text: string, kind: 'ok' | 'err' | '' = ''): void => { message = { text, kind }; };

  function open(v?: View): void {
    if (v) view = v;
    panel.classList.remove('hidden');
    render();
    void refreshCandidates();
  }
  function close(): void {
    panel.classList.add('hidden');
    setMsg('');
    draft.clear();
    if (snap.redirect) mgr.clearRedirect();
  }

  // Échap ferme la fenêtre avant que le menu ne le traite (écoute en phase de capture).
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && isOpen()) { e.preventDefault(); e.stopImmediatePropagation(); close(); }
  }, true);

  async function refreshCandidates(): Promise<void> {
    candidates = snap.state === 'signed-out' ? [] : await mgr.importCandidates().catch(() => []);
    if (isOpen()) render();
  }

  const field = (label: string, attrs: Record<string, string>): { wrap: HTMLLabelElement; input: HTMLInputElement } => {
    const input = el('input', { attrs });
    const key = `${view}:${attrs['name'] ?? ''}`;
    const shared = attrs['name'] === 'email' ? 'email' : key; // l'e-mail suit d'un onglet à l'autre
    input.value = draft.get(shared) ?? '';
    input.addEventListener('input', () => draft.set(shared, input.value));
    return { wrap: el('label', {}, label, input), input };
  };
  const emailField = (): ReturnType<typeof field> => field('E-mail', {
    type: 'email', name: 'email', autocomplete: 'email', inputmode: 'email', autocapitalize: 'none', spellcheck: 'false', required: '', maxlength: '254',
  });
  const passField = (label: string, auto: 'current-password' | 'new-password', name = 'password'): ReturnType<typeof field> => field(label, {
    type: 'password', name, autocomplete: auto, required: '', minlength: String(PASS_MIN), maxlength: '72',
  });
  const btn = (text: string, fn: () => void, cls = ''): HTMLButtonElement => {
    const b = el('button', { cls, text, attrs: { type: 'button' } });
    b.addEventListener('click', fn);
    return b;
  };

  /** Exécute une action réseau : boutons désactivés, message de résultat. */
  async function run(fn: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true;
    render();
    try { await fn(); } catch { setMsg('Une erreur inattendue est survenue. Réessayez.', 'err'); } finally { busy = false; render(); }
  }

  function guestView(): Node[] {
    const out: Node[] = [];
    out.push(el('p', { cls: 'acc-note', text: 'Avec un compte, vos villes sont sauvegardées en ligne et vous les retrouvez sur tous vos appareils. Sans compte, vos parties restent sur cet appareil (mode invité).' }));
    if (view === 'signin' || view === 'signup') {
      const tabs = el('div', { cls: 'acc-tabs', attrs: { role: 'tablist' } },
        btn('Se connecter', () => { view = 'signin'; setMsg(''); render(); }, view === 'signin' ? 'active' : ''),
        btn('Créer un compte', () => { view = 'signup'; setMsg(''); render(); }, view === 'signup' ? 'active' : ''));
      out.push(tabs);
      const email = emailField();
      const pass = passField('Mot de passe', view === 'signup' ? 'new-password' : 'current-password');
      const form = el('form', { cls: 'form', attrs: { novalidate: '' } }, email.wrap, pass.wrap);
      let confirm: ReturnType<typeof field> | null = null;
      if (view === 'signup') {
        confirm = passField('Confirmer le mot de passe', 'new-password', 'password2');
        form.append(confirm.wrap, el('p', { cls: 'acc-note', text: `Au moins ${PASS_MIN} caractères.` }));
      }
      const submit = el('button', { cls: 'primary', text: view === 'signup' ? 'Créer mon compte' : 'Se connecter', attrs: { type: 'submit' } });
      submit.disabled = busy;
      form.append(submit);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const em = email.input.value.trim();
        const pw = pass.input.value;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { setMsg('Adresse e-mail invalide.', 'err'); render(); return; }
        if (pw.length < PASS_MIN) { setMsg(`Mot de passe trop court : au moins ${PASS_MIN} caractères.`, 'err'); render(); return; }
        if (confirm && confirm.input.value !== pw) { setMsg('Les deux mots de passe ne correspondent pas.', 'err'); render(); return; }
        void run(async () => {
          if (view === 'signup') {
            const r = await mgr.signUp(em, pw);
            if (!r.ok) { setMsg(r.message, 'err'); return; }
            for (const k of [...draft.keys()]) if (k !== 'email') draft.delete(k);
            if (r.value.needsConfirmation) {
              view = 'signin';
              setMsg(`Presque fini ! Un e-mail de confirmation a été envoyé à ${em}. Ouvrez le lien qu'il contient (pensez aux courriers indésirables), puis revenez vous connecter ici.`, 'ok');
            } else { setMsg('Compte créé : vos parties sont maintenant sauvegardées en ligne.', 'ok'); h.toast('Compte créé, connecté', 'ok'); }
          } else {
            const r = await mgr.signIn(em, pw);
            if (!r.ok) { setMsg(r.message, 'err'); return; }
            draft.clear();
            setMsg('');
            h.toast(`Connecté : ${r.value.email}`, 'ok');
          }
          await refreshCandidates();
        });
      });
      if (busy) for (const i of [email.input, pass.input]) i.disabled = true;
      out.push(form);
      if (view === 'signin') out.push(btn('Mot de passe oublié ?', () => { view = 'forgot'; setMsg(''); render(); }, 'acc-link'));
    } else if (view === 'forgot') {
      out.push(el('p', { cls: 'acc-note', text: 'Indiquez l\'adresse de votre compte : vous recevrez un lien pour choisir un nouveau mot de passe.' }));
      const email = emailField();
      const submit = el('button', { cls: 'primary', text: 'Envoyer le lien', attrs: { type: 'submit' } });
      submit.disabled = busy;
      const form = el('form', { cls: 'form', attrs: { novalidate: '' } }, email.wrap, submit);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const em = email.input.value.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { setMsg('Adresse e-mail invalide.', 'err'); render(); return; }
        void run(async () => {
          const r = await mgr.recover(em);
          setMsg(r.ok ? `Si un compte existe pour ${em}, un e-mail vient d'être envoyé. Ouvrez le lien sur cet appareil pour choisir un nouveau mot de passe.` : r.message, r.ok ? 'ok' : 'err');
        });
      });
      out.push(form, btn('← Retour à la connexion', () => { view = 'signin'; setMsg(''); render(); }, 'acc-link'));
    }
    return out;
  }

  function newPassForm(): HTMLFormElement {
    const pass = passField('Nouveau mot de passe', 'new-password');
    const confirm = passField('Confirmer', 'new-password', 'password2');
    const submit = el('button', { cls: 'primary', text: 'Enregistrer le mot de passe', attrs: { type: 'submit' } });
    submit.disabled = busy;
    const form = el('form', { cls: 'form', attrs: { novalidate: '' } }, pass.wrap, confirm.wrap, submit);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (pass.input.value.length < PASS_MIN) { setMsg(`Mot de passe trop court : au moins ${PASS_MIN} caractères.`, 'err'); render(); return; }
      if (confirm.input.value !== pass.input.value) { setMsg('Les deux mots de passe ne correspondent pas.', 'err'); render(); return; }
      void run(async () => {
        const r = await mgr.updatePassword(pass.input.value);
        if (r.ok) { view = 'signin'; draft.clear(); mgr.clearRedirect(); setMsg('Mot de passe modifié.', 'ok'); } else setMsg(r.message, 'err');
      });
    });
    return form;
  }

  function userView(): Node[] {
    const out: Node[] = [];
    out.push(el('p', { cls: 'acc-who', text: `Connecté : ${snap.user?.email || 'compte joueur'}` }));
    const st = statusLine(snap);
    out.push(el('div', { cls: 'acc-status', attrs: { role: 'status' } }, el('span', { cls: `acc-dot ${st.cls}` }), el('div', {}, st.text, st.sub ? el('small', { text: st.sub }) : null)));
    if (view === 'newpass') {
      out.push(el('p', { cls: 'acc-note', text: 'Choisissez un nouveau mot de passe pour votre compte.' }), newPassForm(),
        btn('Annuler', () => { view = 'signin'; mgr.clearRedirect(); setMsg(''); render(); }, 'acc-link'));
      return out;
    }
    if (candidates.length) {
      const names = candidates.slice(0, 4).map((c) => c.cityName).join(', ') + (candidates.length > 4 ? '…' : '');
      const n = candidates.length;
      const box = el('div', { cls: 'acc-box' },
        el('p', { cls: 'acc-note', text: `${n} partie${n > 1 ? 's' : ''} jouée${n > 1 ? 's' : ''} sur cet appareil sans compte (${names}). Les importer dans votre compte ? Les copies invité restent aussi sur l'appareil.` }),
        el('div', { cls: 'acc-actions' },
          btn('Importer', () => { void run(async () => { const done = await mgr.importGuest(candidates.map((c) => c.slot)); candidates = []; setMsg(`${done.length} partie${done.length > 1 ? 's' : ''} importée${done.length > 1 ? 's' : ''} dans votre compte.`, 'ok'); }); }, 'primary'),
          btn('Non merci', () => { mgr.declineImport(); candidates = []; render(); })));
      out.push(box);
    }
    const actions = el('div', { cls: 'acc-actions' },
      btn('Synchroniser maintenant', () => { void run(async () => { await mgr.resync(); const s = mgr.snapshot; setMsg(s.sync.state === 'online' ? 'Parties synchronisées.' : 'Hors ligne : nouvel essai automatique au retour du réseau.', s.sync.state === 'online' ? 'ok' : ''); }); }),
      btn('Changer le mot de passe', () => { view = 'newpass'; setMsg(''); render(); }),
      btn('Se déconnecter', () => { void run(async () => { await mgr.signOut(); view = 'signin'; setMsg('Déconnecté : retour au mode invité (parties de cet appareil).', 'ok'); h.toast('Déconnecté', 'info'); }); }, 'danger'));
    for (const b of Array.from(actions.querySelectorAll('button'))) b.disabled = busy;
    out.push(actions, el('p', { cls: 'acc-note', text: 'Vos parties sont enregistrées sur l\'appareil puis envoyées en ligne automatiquement (sauvegardes automatiques au plus toutes les 2 minutes).' }));
    return out;
  }

  function render(): void {
    const title = el('h2', { attrs: { id: 'account-title' } }, iconEl('people'), 'Compte joueur');
    const body = snap.state === 'signed-out' ? guestView() : userView();
    const msg = el('p', { cls: `acc-msg ${message.kind}`, text: message.text, attrs: { role: message.kind === 'err' ? 'alert' : 'status', 'aria-live': 'polite' } });
    const closeBtn = btn('Fermer', close);
    card.replaceChildren(title, ...body, msg, el('div', { cls: 'form-actions' }, closeBtn));
  }

  // ----- Points d'entrée : menu principal et barre latérale -----

  const homeBtn = el('button', { attrs: { id: 'btn-account', type: 'button' } }, iconEl('people'), 'Compte', el('span', { cls: 'acc-sub' }));
  homeBtn.addEventListener('click', () => open());
  const home = document.querySelector('#main-menu [data-screen="home"]');
  const before = home?.querySelector('#btn-options') ?? home?.querySelector('.menu-foot') ?? null;
  if (home) home.insertBefore(homeBtn, before);

  const sbExtra = document.querySelector('#sidebar .sb-extra');
  if (sbExtra) {
    const sb = el('button', { attrs: { id: 'sb-account', type: 'button', 'data-tip': 'Compte joueur et sauvegardes en ligne' } }, iconEl('people'), el('span', { cls: 'tl', text: 'Compte' }));
    sb.addEventListener('click', () => { document.body.classList.remove('sidebar-open'); open(); });
    sbExtra.insertBefore(sb, sbExtra.querySelector('[data-proxy="btn-menu"]'));
  }

  const syncButtons = (): void => {
    const sub = homeBtn.querySelector('.acc-sub');
    if (sub) sub.textContent = snap.state === 'signed-out' ? 'invité' : (snap.user?.email ?? '');
  };

  const onSnap = (s: AccountSnapshot): void => {
    const was = snap.state;
    snap = s;
    syncButtons();
    if (s.notice) { h.toast(s.notice, 'info'); setMsg(s.notice, 'err'); mgr.clearNotice(); }
    if (was !== s.state) void refreshCandidates();
    if (isOpen() && !busy) render();
  };
  mgr.onChange(onSnap);
  syncButtons();

  // Retour d'un lien e-mail (confirmation d'adresse, mot de passe oublié).
  let redirectHandled = false;
  const handleRedirect = (s: AccountSnapshot): void => {
    const r = s.redirect;
    if (!r || redirectHandled) return;
    redirectHandled = true;
    if (r.error) { setMsg(r.error, 'err'); open('signin'); return; }
    if (r.type === 'recovery') { setMsg('Lien accepté : choisissez votre nouveau mot de passe.', 'ok'); open('newpass'); return; }
    h.toast(r.type === 'signup' ? 'Adresse confirmée : vous êtes connecté.' : 'Connecté.', 'ok');
    mgr.clearRedirect();
  };
  handleRedirect(snap);
  mgr.onChange(handleRedirect);

  return { open, close };
}
