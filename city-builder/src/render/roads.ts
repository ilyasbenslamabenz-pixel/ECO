/**
 * Rendu des routes — point d'entrée historique (importé par src/render/index.ts).
 * L'implémentation complète vit dans src/render/roads/ : maillage procédural par chunk
 * (chaussée PBR, trottoirs, bordures, terre-plein, marquages, passages piétons, dalles de carrefour
 * à coins arrondis, ponts avec piles), décor instancié (lampadaires GLB allumés la nuit, arbres
 * d'alignement, mobilier). Signature compatible : `new RoadRenderer(scene, heightAt, deps?)`.
 * Sans `deps.lib`, pas de décor ni de textures (repli de couleurs unies) : l'intégration doit
 * passer la bibliothèque d'assets (voir docs/requests/routes.md).
 */
export { RoadNetworkRenderer as RoadRenderer, DECOR_ASSETS, type RoadRendererDeps } from './roads/renderer';
