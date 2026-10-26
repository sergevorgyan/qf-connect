import { Link } from 'react-router-dom';
import { formatPhone, timeAgo } from '../api';
import { useData } from '../useData';
import type { Call } from './Calls';

interface Stats { last24h: { calls: number; missed: number }; unreadTexts: number; textback7d: { sent: number; replied: number } }

export function Dashboard() {
  const { data } = useData<Stats>('/api/dashboard', 30_000);
  const { data: missed } = useData<Call[]>('/api/calls?filter=missed&limit=5', 30_000);
  const replyRate = data && data.textback7d.sent ? Math.round((100 * data.textback7d.replied) / data.textback7d.sent) : null;
  return (
    <>
      <h1>Today</h1>
      <div className="stats">
        <Stat label="Calls, last 24h" value={data?.last24h.calls} />
        <Stat label="Missed calls" value={data?.last24h.missed} tone={data?.last24h.missed ? 'warn' : undefined} />
        <Stat label="Unread texts" value={data?.unreadTexts} link="/messages" />
        <Stat label="Text-backs sent, 7 days" value={data?.textback7d.sent} sub={replyRate !== null ? `${replyRate}% replied` : undefined} />
      </div>
      <section className="card">
        <h2>Recent missed calls</h2>
        {missed?.length ? (
          <ul className="rows">
            {missed.map((c) => (
              <li key={c.id}>
                <span><strong>{c.fromName ?? formatPhone(c.fromNumber)}</strong>{c.fromName && <span className="muted"> {formatPhone(c.fromNumber)}</span>}</span>
                <span className="muted">{timeAgo(c.startedAt)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="muted">No missed calls. Nice.</p>}
        <Link to="/calls">All calls</Link>
      </section>
    </>
  );
}

function Stat({ label, value, sub, tone, link }: { label: string; value?: number; sub?: string; tone?: 'warn'; link?: string }) {
  const body = (
    <div className={`stat card ${tone ?? ''}`}>
      <div className="value">{value ?? '-'}</div>
      <div className="label">{label}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
  return link ? <Link to={link} className="plain">{body}</Link> : body;
}
