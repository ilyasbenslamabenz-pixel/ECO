/**
 * Paliers de ville : seuils de population, titre de la ville et prime versée une seule fois à la trésorerie.
 * Aucun bâtiment n'est verrouillé (rien de ce qui est disponible aujourd'hui n'est retiré au joueur).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
export interface MilestoneDef { id: string; nameFr: string; population: number; reward: number }

export const MILESTONES: readonly MilestoneDef[] = [
  { id: 'hameau', nameFr: 'Hameau', population: 100, reward: 20_000 },
  { id: 'village', nameFr: 'Village', population: 500, reward: 50_000 },
  { id: 'bourg', nameFr: 'Bourg', population: 1_500, reward: 100_000 },
  { id: 'petite_ville', nameFr: 'Petite ville', population: 3_000, reward: 200_000 },
  { id: 'ville', nameFr: 'Ville', population: 6_000, reward: 350_000 },
  { id: 'grande_ville', nameFr: 'Grande ville', population: 12_000, reward: 600_000 },
  { id: 'cite', nameFr: 'Cité régionale', population: 25_000, reward: 1_000_000 },
  { id: 'agglomeration', nameFr: 'Agglomération', population: 50_000, reward: 1_800_000 },
  { id: 'metropole', nameFr: 'Métropole', population: 100_000, reward: 3_000_000 },
  { id: 'megapole', nameFr: 'Mégapole', population: 200_000, reward: 5_000_000 },
];

export interface PaliersState {
  population: number;
  reached: string[];
  /** Titre actuel (dernier palier atteint) ; null avant le premier. */
  title: string | null;
  next: MilestoneDef | null;
  milestones: (MilestoneDef & { reached: boolean; at: number | null })[];
}
