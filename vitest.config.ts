// Configuration des tests du moteur. Les tests de long terme (30 ans simulés, parties de joueurs-robots) prennent
// quelques secondes : le délai par défaut de 5 s provoquait des échecs intermittents sur une machine chargée.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 240_000,
  },
});
