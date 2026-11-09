// Vie du pays : avions, navires (instances animées), météo ; la circulation est dans traffic.ts.
import { Color3, MeshBuilder, StandardMaterial, TransformNode, type Mesh, type Scene } from '@babylonjs/core';
import { mulberry32 } from '../../../shared/noise';
import { coastX } from '../../../shared/sim/country';
import type { CountryDef } from '../../../shared/sim/types';
import { ENV, type Grid } from './terrain';

// La circulation routière, les trains et les bateaux sont dans traffic.ts.
export { createTraffic } from './traffic';

export function createAirSea(scene: Scene, grid: Grid, country: CountryDef) {
  const airports = country.infra.filter((i) => i.type === 'aeroport');
  const ports = country.infra.filter((i) => i.type === 'port');
  const white = new StandardMaterial('planeMat', scene);
  white.diffuseColor = Color3.FromHexString('#f8f9fa');
  const hull = new StandardMaterial('hullMat', scene);
  hull.diffuseColor = Color3.FromHexString('#264653');
  const deck = new StandardMaterial('deckMat', scene);
  deck.diffuseColor = Color3.FromHexString('#e76f51');
  const planes = airports.map(() => {
    const n = new TransformNode('plane', scene);
    const body = MeshBuilder.CreateBox('pb', { width: 0.006, height: 0.006, depth: 0.05 }, scene);
    const wing = MeshBuilder.CreateBox('pw', { width: 0.05, height: 0.002, depth: 0.012 }, scene);
    for (const p of [body, wing]) { p.material = white; p.parent = n; p.isPickable = false; }
    return n;
  });
  const ships = ports.flatMap(() => [0, 1].map(() => {
    const n = new TransformNode('ship', scene);
    const h = MeshBuilder.CreateBox('sh', { width: 0.04, height: 0.015, depth: 0.22 }, scene);
    const d = MeshBuilder.CreateBox('sd', { width: 0.03, height: 0.02, depth: 0.05 }, scene);
    h.material = hull; d.material = deck; d.position.set(0, 0.016, -0.06);
    for (const p of [h, d]) { p.parent = n; p.isPickable = false; }
    return n;
  }));
  let t = 0;
  return {
    update: (dt: number) => {
      t += dt;
      airports.forEach((a, i) => {
        const g = planes[i];
        const cycle = (t * 0.05 + i * 0.37) % 1;
        const dx = Math.cos(a.rot), dz = -Math.sin(a.rot);
        const dist = cycle < 0.15 ? (cycle / 0.15) * 1.6 : 1.6 + (cycle - 0.15) * 50;
        const alt = cycle < 0.08 ? 0.003 : Math.min(2.5, (cycle - 0.08) * 10);
        g.position.set(a.x + dx * (dist - 1.2), grid.y(a.x, a.z) + 0.005 + alt, a.z + dz * (dist - 1.2));
        g.rotation.set(cycle > 0.08 && alt < 2.5 ? -0.15 : 0, a.rot + Math.PI / 2, 0);
        g.setEnabled(cycle < 0.95);
      });
      white.emissiveColor.set(ENV.night * 0.8, ENV.night * 0.8, ENV.night * 0.8);
      ports.forEach((p, i) => {
        for (let k = 0; k < 2; k++) {
          const g = ships[i * 2 + k];
          const ph = (t * 0.01 + k * 0.5 + i * 0.21) % 1;
          const z = p.z + (k - 0.5) * 0.8 + Math.sin(ph * 6) * 0.2;
          const x = Math.min(p.x - 0.3 - Math.sin(ph * Math.PI) * 6, coastX(country.seed, z) - 0.4);
          g.position.set(x, 0.035, z);
          g.rotation.y = Math.PI / 2 + (ph > 0.5 ? Math.PI : 0);
        }
      });
    },
  };
}

// ---------- Météo (déterministe par mois et saison) ----------
export type Weather = 'clair' | 'nuageux' | 'pluie' | 'orage' | 'neige' | 'brouillard';
export function weatherFor(seed: number, month: number): Weather {
  const r = mulberry32(seed * 13 + month * 101)();
  const m = month % 12;
  const winter = m === 11 || m <= 1;
  const summer = m >= 5 && m <= 7;
  if (winter) return r < 0.3 ? 'neige' : r < 0.55 ? 'nuageux' : r < 0.7 ? 'brouillard' : r < 0.8 ? 'pluie' : 'clair';
  if (summer) return r < 0.6 ? 'clair' : r < 0.78 ? 'nuageux' : r < 0.9 ? 'orage' : 'pluie';
  return r < 0.35 ? 'clair' : r < 0.6 ? 'nuageux' : r < 0.85 ? 'pluie' : r < 0.93 ? 'brouillard' : 'orage';
}
export const WEATHER_LABEL: Record<Weather, string> = { clair: '☀️ Ensoleillé', nuageux: '⛅ Nuageux', pluie: '🌧️ Pluie', orage: '⛈️ Orage', neige: '🌨️ Neige', brouillard: '🌫️ Brouillard' };
export type { Mesh };
