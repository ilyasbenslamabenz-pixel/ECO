/**
 * Générateur de noms français (prénoms + noms de famille courants en France).
 * Les citoyens ne stockent que des INDEX (Uint16) dans ces tables : mémoire compacte,
 * sauvegarde légère. Ne jamais réordonner ces tables (les sauvegardes y font référence) :
 * ajouter uniquement en fin de liste.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { Rng } from './rng';

export const FIRST_NAMES_F: readonly string[] = [
  'Marie', 'Camille', 'Léa', 'Manon', 'Chloé', 'Emma', 'Inès', 'Sarah', 'Julie', 'Laura',
  'Anaïs', 'Clara', 'Lucie', 'Pauline', 'Mathilde', 'Élise', 'Juliette', 'Louise', 'Alice', 'Jeanne',
  'Charlotte', 'Margaux', 'Océane', 'Lola', 'Zoé', 'Ambre', 'Rose', 'Agathe', 'Anna', 'Lina',
  'Nathalie', 'Isabelle', 'Sylvie', 'Catherine', 'Christine', 'Sophie', 'Valérie', 'Sandrine', 'Céline', 'Aurélie',
  'Hélène', 'Martine', 'Monique', 'Françoise', 'Brigitte', 'Josiane', 'Odile', 'Colette', 'Simone', 'Yvette',
  'Nadia', 'Fatima', 'Yasmine', 'Samia', 'Amina', 'Leïla', 'Mélissa', 'Justine', 'Elsa', 'Victoire',
];

export const FIRST_NAMES_M: readonly string[] = [
  'Jean', 'Pierre', 'Louis', 'Lucas', 'Hugo', 'Gabriel', 'Arthur', 'Jules', 'Adam', 'Raphaël',
  'Léo', 'Paul', 'Nathan', 'Thomas', 'Théo', 'Maxime', 'Antoine', 'Alexandre', 'Baptiste', 'Clément',
  'Julien', 'Nicolas', 'Romain', 'Quentin', 'Mathis', 'Noé', 'Victor', 'Tom', 'Sacha', 'Martin',
  'Philippe', 'Michel', 'Alain', 'Patrick', 'Christophe', 'Laurent', 'Stéphane', 'Frédéric', 'Olivier', 'Éric',
  'Bernard', 'Jacques', 'Daniel', 'Gérard', 'René', 'André', 'Marcel', 'Roger', 'Henri', 'Lucien',
  'Karim', 'Mehdi', 'Yanis', 'Rayan', 'Samir', 'Ibrahim', 'Mamadou', 'Kevin', 'Florian', 'Damien',
];

export const SURNAMES: readonly string[] = [
  'Martin', 'Bernard', 'Thomas', 'Petit', 'Robert', 'Richard', 'Durand', 'Dubois', 'Moreau', 'Laurent',
  'Simon', 'Michel', 'Lefebvre', 'Leroy', 'Roux', 'David', 'Bertrand', 'Morel', 'Fournier', 'Girard',
  'Bonnet', 'Dupont', 'Lambert', 'Fontaine', 'Rousseau', 'Vincent', 'Muller', 'Lefèvre', 'Faure', 'André',
  'Mercier', 'Blanc', 'Guérin', 'Boyer', 'Garnier', 'Chevalier', 'François', 'Legrand', 'Gauthier', 'Garcia',
  'Perrin', 'Robin', 'Clément', 'Morin', 'Nicolas', 'Henry', 'Roussel', 'Mathieu', 'Gautier', 'Masson',
  'Marchand', 'Duval', 'Denis', 'Dumont', 'Marie', 'Lemaire', 'Noël', 'Meyer', 'Dufour', 'Meunier',
  'Brun', 'Blanchard', 'Giraud', 'Joly', 'Rivière', 'Lucas', 'Brunet', 'Gaillard', 'Barbier', 'Arnaud',
  'Martinez', 'Gérard', 'Roche', 'Renard', 'Schmitt', 'Roy', 'Leroux', 'Colin', 'Vidal', 'Caron',
  'Picard', 'Roger', 'Fabre', 'Aubert', 'Lemoine', 'Renaud', 'Dumas', 'Lacroix', 'Olivier', 'Philippe',
  'Bourgeois', 'Pierre', 'Benoît', 'Rey', 'Leclerc', 'Payet', 'Rolland', 'Leclercq', 'Guillaume', 'Lecomte',
  'Lopez', 'Jean', 'Dupuy', 'Guillot', 'Hubert', 'Berger', 'Carpentier', 'Sanchez', 'Dupuis', 'Moulin',
  'Louis', 'Deschamps', 'Huet', 'Vasseur', 'Perez', 'Boucher', 'Fleury', 'Royer', 'Klein', 'Jacquet',
  'Adam', 'Paris', 'Poirier', 'Marty', 'Aubry', 'Guyot', 'Carré', 'Charles', 'Renault', 'Charpentier',
  'Ménard', 'Maillard', 'Baron', 'Bertin', 'Bailly', 'Hervé', 'Schneider', 'Fernandez', 'Le Gall', 'Collet',
  'Léger', 'Bouvier', 'Julien', 'Prévost', 'Millet', 'Perrot', 'Daniel', 'Le Roux', 'Cousin', 'Germain',
];

/** Sexe : 0 = femme, 1 = homme (sert uniquement au choix du prénom). */
export function randomFirstName(rng: Rng, sex: number): number {
  return rng.int(0, (sex === 0 ? FIRST_NAMES_F : FIRST_NAMES_M).length - 1);
}

export function randomSurname(rng: Rng): number {
  return rng.int(0, SURNAMES.length - 1);
}

export function fullName(sex: number, firstIndex: number, surnameIndex: number): string {
  const first = (sex === 0 ? FIRST_NAMES_F : FIRST_NAMES_M)[firstIndex] ?? '?';
  return `${first} ${SURNAMES[surnameIndex] ?? '?'}`;
}
