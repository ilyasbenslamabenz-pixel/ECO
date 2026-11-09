// Objectifs et conditions de victoire / défaite (section 30).
import type { Criterion } from '../../../shared/sim/victory';
import { useStore } from '../store';
import { govAction, leaveGame } from '../net';
import { dec1, pct } from '../format';
import { Drawer, Meter, Section } from './common';
import { monthLabel } from './charts';
import { Icon } from './Icon';

function fmtC(c: Criterion, v: number) {
  if (!Number.isFinite(v)) return '—';
  if (c.fmt === 'pct') return pct(v);
  if (c.fmt === 'ratio') return v.toFixed(3).replace('.', ',');
  if (c.fmt === 'mt') return `${dec1(v)} Mt`;
  return dec1(v);
}

export function ObjectifsPanel() {
  const snap = useStore((s) => s.snap);
  const V = snap?.victory;
  if (!snap || !V) return null;
  return (
    <Drawer title="Objectifs & victoire" icon="trophee" wide>
      {V.status === 'defaite' && V.defeat && (
        <div className="notice bad">
          <div className="notice-head"><b><Icon name="interdit" size={15} />Fin de mandat</b><span>{monthLabel(V.defeat.month, snap.startYear)}</span></div>
          <p>{V.defeat.text}</p>
          <div className="btn-row">
            <button className="btn" onClick={() => govAction({ type: 'continuer' })}>Continuer en mode libre</button>
            <button className="btn danger" onClick={leaveGame}>Menu principal</button>
          </div>
        </div>
      )}
      {V.sandbox && <p className="muted small">Mode libre : la partie continue sans nouvelle défaite possible.</p>}
      {V.conditions.map((c) => (
        <Section key={c.id} title={`${c.name}${c.achieved !== null ? ' · obtenue' : ''}`} hint={c.description}>
          <div className="row between small">
            <span>{c.achieved !== null ? `Obtenue en ${monthLabel(c.achieved, snap.startYear)}` : c.id === 'totale' ? 'Obtenez les quatre autres victoires' : `Critères tenus depuis ${c.held} / ${c.required} mois`}</span>
            <b>{pct(c.progress, 0)}</b>
          </div>
          <Meter value={c.progress} max={1} tone={c.achieved !== null ? 'var(--good)' : undefined} />
          <table className="table">
            <tbody>
              {c.criteria.map((k) => (
                <tr key={k.id} className={k.available ? '' : 'muted'}>
                  <td>{k.available ? <Icon name={k.ok ? 'valide' : 'case'} size={14} /> : <span style={{ display: 'inline-block', width: 20 }}>·</span>}{k.label}</td>
                  <td>{k.available ? fmtC(k, k.value) : 'non mesuré'}</td>
                  <td className="muted small">objectif {k.dir === 'max' ? '≥' : '≤'} {fmtC(k, k.target)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ))}
      <Section title="Risques de défaite">
        <div className="bar-row"><span className="bar-label">Défaut de paiement</span><div style={{ flex: 1 }}><Meter value={V.risk.defaut} max={1} tone={V.risk.defaut > 0.5 ? 'var(--bad)' : 'var(--warn)'} /></div><span className="bar-val">{pct(V.risk.defaut, 0)}</span></div>
        <p className="muted small">Défaite si la dette atteint 200 % du PIB ou si le taux d'emprunt dépasse 12 % pendant 6 mois.</p>
        <div className="bar-row"><span className="bar-label">Troubles sociaux</span><div style={{ flex: 1 }}><Meter value={V.risk.troubles} max={1} tone={V.risk.troubles > 0.5 ? 'var(--bad)' : 'var(--warn)'} /></div><span className="bar-val">{pct(V.risk.troubles, 0)}</span></div>
        <p className="muted small">Défaite après 12 mois consécutifs de risque d'émeutes ≥ 50 % ou de satisfaction &lt; 25. Mois critiques : {V.risk.unrestMonths}.</p>
        <p className="muted small">Défaite politique : perte des élections (voir Vie politique) ; une motion de censure adoptée provoque des élections anticipées.</p>
      </Section>
    </Drawer>
  );
}
