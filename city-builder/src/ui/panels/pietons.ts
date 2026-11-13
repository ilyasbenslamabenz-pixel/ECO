/**
 * Panneau d'interface du module « Piétons » — propriété de la branche p2a-pietons.
 * Seule cette branche modifie ce fichier. Gabarit : voir ./types.ts. Pas de montage visible pour l'instant
 * (la refonte d'interface §1bis montera les panneaux du registre).
 */
import type { UiPanel } from './types';

export const pietonsPanel: UiPanel = { id: 'pietons', title: 'Piétons', phase: '2A' };
