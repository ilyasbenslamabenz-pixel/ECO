// Actions directes sur un équipement sélectionné sur la carte : améliorer, rénover, démolir (équipements publics),
// fermer (centrales et parcs énergétiques), annuler un chantier. Le serveur valide et applique au mois suivant.
import type { Infra } from '../../../shared/sim/types';
import { BUILDINGS, MAX_LEVEL } from '../../../shared/sim/construction';
import { INFRA_TECH } from '../../../shared/sim/energySites';
import { useStore } from '../store';
import { gameAction, serviceAction } from '../net';
import { int, money } from '../format';
import { Icon } from './Icon';

export function InfraActions({ infra: i }: { infra: Infra }) {
  const snap = useStore((s) => s.snap);
  if (!snap) return null;
  const pr = snap.macro.priceLevel || 1;
  const site = snap.construction?.sites.find((s) => s.infraId === i.id);
  const tech = INFRA_TECH[i.type];
  const def = BUILDINGS[i.type];
  if (site) {
    return (
      <div className="btn-row wrap infra-actions">
        <button className="btn danger" onClick={() => { if (confirm(`Annuler le chantier « ${site.name} » ? Les sommes déjà payées sont perdues.`)) void serviceAction({ type: 'annulerChantier', siteId: site.id }); }}>Annuler le chantier</button>
      </div>
    );
  }
  if (tech) {
    if (i.status === 'closed' || i.status === 'construction') return <p className="muted small">{i.status === 'closed' ? 'Site fermé.' : 'Site en construction (ministère de l\'Énergie).'}</p>;
    return (
      <div className="btn-row wrap infra-actions">
        <button className="btn danger" onClick={() => { if (confirm(`Fermer « ${i.name} » (${int(i.capacity)} MW) ? Vérifiez que la marge électrique reste suffisante.`)) void gameAction({ type: 'energyClose', tech, mw: Math.max(1, i.capacity), infraId: i.id }); }}><Icon name="arret" size={14} />Fermer ce site</button>
        <button className="btn ghost" onClick={() => useStore.getState().set({ panel: 'energie' })}>Ministère de l'Énergie<Icon name="fleche" size={14} /></button>
      </div>
    );
  }
  if (!def || def.hidden) return <p className="muted small">Équipement géré par son ministère (Transports, Industrie…).</p>;
  return (
    <div className="btn-row wrap infra-actions">
      <button className="btn primary" disabled={i.level >= MAX_LEVEL} title="+30 % de capacité" onClick={() => serviceAction({ type: 'ameliorer', infraId: i.id })}><Icon name="agrandir" size={14} />Agrandir · {money(def.cost * 0.45 * i.level * pr)}</button>
      <button className="btn" onClick={() => serviceAction({ type: 'renover', infraId: i.id })}><Icon name="renover" size={14} />Rénover · {money(def.cost * 0.25 * pr)}</button>
      <button className="btn danger" onClick={() => { if (confirm(`Démolir « ${i.name} » ? Sa capacité (${int(i.capacity)} ${i.capacityUnit}) sera perdue.`)) void serviceAction({ type: 'demolir', infraId: i.id }); }}><Icon name="demolir" size={14} />Démolir · {money(def.cost * 0.08 * pr)}</button>
    </div>
  );
}
