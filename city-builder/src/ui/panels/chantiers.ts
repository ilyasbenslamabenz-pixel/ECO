/**
 * Panneau d'interface du module « Chantiers (grues, échafaudages, démolition) » — propriété de la branche p2a-chantiers.
 * Seule cette branche modifie ce fichier. Gabarit : voir ./types.ts. Pas de montage visible pour l'instant
 * (la refonte d'interface §1bis montera les panneaux du registre).
 */
import type { UiPanel } from './types';

export const chantiersPanel: UiPanel = { id: 'chantiers', title: 'Chantiers (grues, échafaudages, démolition)', phase: '2A' };
