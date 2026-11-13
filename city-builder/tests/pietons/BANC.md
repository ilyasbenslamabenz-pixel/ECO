# Banc du module piétons (simulation seule)

Généré par `npx tsx tests/pietons/banc.ts` le 2026-11-13. Mesures RÉELLES sur la machine d'exécution :
Intel(R) Xeon(R) Processor @ 2.10GHz, 4 cœurs, 16 Go, Linux 6.18.44-fc-v445, Node v22.23.4 ; aucun rendu (le coût du rendu se mesure sur GPU réel).

Un tick = 0,1 s de marche (10 ticks/s à x1). Budget de l'architecture : tick de simulation ≤ 4 ms.

| Piétons (min–max mesurés) | Module : moyenne | Module : p95 | Module : max | Tick complet avec module (moy. / p95) | Tick complet sans module (moy. / p95) | Trame / delta | Itinéraires / s |
|---|---|---|---|---|---|---|---|
| 2000 (1995–2006) | 0.73 ms | 0.907 ms | 3.72 ms | 0.924 / 1.295 ms | 0.113 / 0.179 ms | 44.9 Ko | 5.108 |
| 5000 (4994–5003) | 2.101 ms | 2.503 ms | 7.218 ms | 2.399 / 3.381 ms | 0.119 / 0.184 ms | 112.2 Ko | 13.1 |

Ville de mesure : 288 bâtiments, graphe {"noeuds":1152,"aretes":1440,"trottoirsM":23347,"passages":288,"passagesMarques":288,"passagesRegules":0}.
Le coût « module » est mesuré par le module lui-même (`performance.now()` autour de son tick, fenêtre des 600 derniers ticks) ;
le tick complet inclut démographie et trafic. Détail : `tests/e2e/out/perf/pietons-<N>.json`.
