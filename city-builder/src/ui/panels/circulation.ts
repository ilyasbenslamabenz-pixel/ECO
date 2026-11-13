/**
 * Panneau d'interface du module « Circulation (véhicules, feux) » — propriété de la branche p2a-circulation.
 * Seule cette branche modifie ce fichier. Gabarit : voir ./types.ts. Pas de montage visible pour l'instant
 * (la refonte d'interface §1bis montera les panneaux du registre).
 */
import type { UiPanel } from './types';

export const circulationPanel: UiPanel = { id: 'circulation', title: 'Circulation (véhicules, feux)', phase: '2A' };
