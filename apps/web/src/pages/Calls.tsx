import { useState } from 'react';
import { duration, formatPhone, timeAgo } from '../api';
import { useData } from '../useData';

export interface Call {
  id: number; direction: 'inbound' | 'outbound'; disposition: string; fromNumber: string | null; fromName: string | null;
  toNumber: string | null; did: string | null; extension: string; durationSeconds: number; startedAt: string; crmLoggedAt: string | null; crmError: string | null;
}

const FILTERS = ['all', 'missed', 'inbound', 'outbound'] as const;

export function Calls() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const [search, setSearch] = useState('');
  const { data } = useData<Call[]>(`/api/calls?filter=${filter}&search=${encodeURIComponent(search)}`, 30_000);
  return (
    <>
      <h1>Calls</h1>
      <div className="toolbar">
        <div className="tabs">{FILTERS.map((f) => <button key={f} className={f === filter ? 'active' : ''} onClick={() => setFilter(f)}>{f[0].toUpperCase() + f.slice(1)}</button>)}</div>
        <input placeholder="Search number or name" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="card table">
        <table>
          <thead><tr><th>Caller</th><th>Line</th><th>Result</th><th>Length</th><th>When</th><th></th></tr></thead>
          <tbody>
            {data?.map((c) => {
              const other = c.direction === 'inbound' ? c.fromNumber : c.toNumber;
              const missed = c.direction === 'inbound' && c.disposition !== 'ANSWERED';
              return (
                <tr key={c.id}>
                  <td><span className={`dir ${missed ? 'missed' : c.direction}`}>{missed ? 'Missed' : c.direction === 'inbound' ? 'In' : 'Out'}</span>
                    {c.direction === 'inbound' && c.fromName ? <><strong>{c.fromName}</strong> <span className="muted">{formatPhone(other)}</span></> : <strong>{formatPhone(other)}</strong>}</td>
                  <td className="muted">{formatPhone(c.did)}</td>
                  <td>{c.disposition.toLowerCase()}</td>
                  <td>{duration(c.durationSeconds)}</td>
                  <td className="muted">{timeAgo(c.startedAt)}{c.crmLoggedAt ? <span className="crm ok" title={`Logged to HubSpot ${timeAgo(c.crmLoggedAt)}`}>HubSpot ✓</span>
                    : c.crmError && c.crmError !== 'skipped' ? <span className="crm failed" title={c.crmError}>HubSpot ✗</span> : null}</td>
                  <td>{other && <a href={`tel:${other}`}>Call back</a>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {data?.length === 0 && <p className="muted pad">No calls match.</p>}
      </div>
    </>
  );
}
