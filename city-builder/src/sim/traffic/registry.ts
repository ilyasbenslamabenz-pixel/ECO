/**
 * Registre du système de trafic actif (worker, TypeScript pur).
 *
 * Le module « circulation » (src/sim/plugins/circulation.ts) doit publier l'API des feux et lire les
 * indicateurs du trafic, mais `PluginContext` (façade commune, lecture seule) n'expose pas encore le trafic
 * de la simulation : voir la demande `docs/requests/circulation.md` (API proposée : `ctx.traffic`).
 * En attendant, le TrafficSystem construit par `world.ts` s'inscrit ici et le module le consulte.
 * Une seule simulation tourne par worker ; `setActiveTraffic` est exporté pour les tests.
 */
import type { TrafficSystem } from './system';

let active: TrafficSystem | null = null;

/** Déclare le système de trafic de la simulation en cours (appelé par le constructeur de TrafficSystem). */
export function setActiveTraffic(t: TrafficSystem | null): void { active = t; }

/** Système de trafic de la simulation en cours (null avant toute construction). */
export function activeTraffic(): TrafficSystem | null { return active; }
