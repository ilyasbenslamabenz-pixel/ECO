/**
 * Réseau de démonstration du module routier, construit par les VRAIES règles de la simulation
 * (planRoad / commitRoadPlan : snapping, découpes, carrefours, ponts, pentes). Pur TS (aucun three) :
 * utilisé par la page de démo et vérifiable en Node.
 */
import { RoadNetwork, commitRoadPlan, planRoad, type ProfileEnv, type RoadRequest } from '../../../sim/roads';

export interface DemoLayoutResult { net: RoadNetwork; failures: string[]; built: number }

export const DEMO_SEED = 7;
export const DEMO_MAP_CHUNKS = 8;

const R = (kind: RoadRequest['kind'], x0: number, z0: number, x1: number, z1: number, cx?: number, cz?: number): RoadRequest =>
  (cx === undefined ? { kind, start: { x: x0, z: z0 }, end: { x: x1, z: z1 } } : { kind, start: { x: x0, z: z0 }, end: { x: x1, z: z1 }, control: { x: cx, z: cz! } });

/** Liste ordonnée des tracés de la démo (un quartier en damier, axes, courbes, ponts, autoroute). */
export const DEMO_ROADS: { label: string; req: RoadRequest }[] = [
  { label: 'boulevard est-ouest', req: R('boulevard', -360, -200, 380, -200) },
  { label: 'avenue nord-sud', req: R('avenue', 0, -380, 0, 360) },
  { label: 'rue x=-200', req: R('street', -200, -360, -200, 120) },
  { label: 'rue x=-100', req: R('street', -100, -330, -100, 120) },
  { label: 'rue x=110', req: R('street', 110, -330, 110, 120) },
  { label: 'rue x=220', req: R('street', 220, -330, 220, 40) },
  { label: 'rue z=-320', req: R('street', -260, -320, 260, -320) },
  { label: 'sens unique z=-100', req: R('oneway', -300, -100, 300, -100) },
  { label: 'rue z=20', req: R('street', -260, 20, 110, 20) },
  { label: 'rue piétonne z=-40', req: R('pedestrian', -200, -40, -100, -40) },
  { label: 'rue piétonne x=-150', req: R('pedestrian', -150, -100, -150, 20) },
  { label: 'rue courbe', req: R('street', 110, 120, 330, 160, 260, 100) },
  { label: 'avenue courbe', req: R('avenue', 220, 40, 380, -200, 380, 20) },
  { label: 'impasse', req: R('street', 110, 70, 50, 70) },
  { label: 'pont (avenue)', req: R('avenue', 0, 360, 0, 820) },
  { label: 'rue sur la rive nord', req: R('street', -200, 820, 260, 820) },
  { label: 'autoroute avec pont', req: R('highway', -560, -420, -560, 900) },
];

export function buildDemoNetwork(env: ProfileEnv, bounds: { minX: number; minZ: number; maxX: number; maxZ: number }): DemoLayoutResult {
  const net = new RoadNetwork(env, 256);
  const failures: string[] = [];
  let built = 0;
  for (const { label, req } of DEMO_ROADS) {
    const r = planRoad(net, req, { bounds });
    if (!r.ok) { failures.push(`${label} : ${r.error.code} ${r.error.message}`); continue; }
    commitRoadPlan(net, r.plan);
    built++;
  }
  net.takeChanges();
  return { net, failures, built };
}
