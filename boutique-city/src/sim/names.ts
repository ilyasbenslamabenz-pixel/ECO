/** Prénoms et noms des candidats à l'embauche (quartier marocain et francophone). TypeScript pur. */
import type { Rng } from './rng';

const FIRST = ['Yasmine', 'Karim', 'Salma', 'Mehdi', 'Inès', 'Youssef', 'Lina', 'Omar', 'Nadia', 'Hamza', 'Sofia', 'Rayan', 'Amina', 'Adam',
  'Léa', 'Lucas', 'Chloé', 'Hugo', 'Sarah', 'Nabil', 'Kenza', 'Ayoub', 'Hiba', 'Ilyas', 'Meryem', 'Théo', 'Zineb', 'Anas', 'Camille', 'Imane'];
const LAST = ['Benali', 'El Amrani', 'Tazi', 'Bennani', 'Alaoui', 'Chraibi', 'Idrissi', 'Berrada', 'Fassi', 'Lahlou', 'Martin', 'Bernard',
  'Dubois', 'Moreau', 'Laurent', 'Haddad', 'Ouazzani', 'Kettani', 'Sebti', 'Naciri'];

export function randomName(rng: Rng): string { return `${rng.pick(FIRST)} ${rng.pick(LAST)}`; }
