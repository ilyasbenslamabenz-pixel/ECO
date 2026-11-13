/**
 * Points d'extension de l'INTERFACE (phase 2) : panneaux des modules.
 * Registre typé seulement : aucun montage visible pour l'instant ; la refonte d'interface (§1bis de
 * docs/ROADMAP_PHASE2.md) montera chaque panneau du registre dans la barre latérale / les onglets.
 */

/** Services offerts à un panneau (fournis par l'interface au montage). */
export interface UiPanelApi {
  /** Commande `pluginCommand` au module de simulation de même identifiant (rejet : erreur lisible). */
  command(name: string, payload?: unknown): Promise<unknown>;
  /** Abonnement aux charges utiles `delta.ext[id]` du module ; renvoie la fonction de désabonnement. */
  onDeltaExt(listener: (payload: unknown) => void): () => void;
  /** Dernière charge utile `snapshot.ext[id]` reçue (undefined si aucune). */
  snapshotExt(): unknown;
  /** Message bref à l'écran. */
  toast(message: string, kind?: 'info' | 'ok' | 'error'): void;
}

export interface UiPanel {
  /** Même identifiant que le module de simulation. */
  readonly id: string;
  /** Titre affiché (français). */
  readonly title: string;
  /** Étape de la feuille de route qui livre le panneau. */
  readonly phase: '2A' | '1bis' | '2B' | '2C';
  /** Monte le panneau dans `root` (vidé par l'interface) ; renvoie éventuellement une fonction de démontage. */
  mount?(root: HTMLElement, api: UiPanelApi): void | (() => void);
}
