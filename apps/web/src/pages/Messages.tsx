import { useState } from 'react';
import { api, formatPhone, timeAgo } from '../api';
import { useData } from '../useData';

interface Thread { did: string; contact: string; lastAt: string; lastBody: string; unread: number; fromTextback: number }
interface Msg { id: number; direction: 'in' | 'out'; body: string; source: string; createdAt: string }
interface NumberRow { did: string; label: string | null }

export function Messages() {
  const { data: threads, reload } = useData<Thread[]>('/api/sms/threads', 10_000);
  const { data: numbers } = useData<NumberRow[]>('/api/numbers');
  const [open, setOpen] = useState<{ did: string; contact: string } | null>(null);
  const [composing, setComposing] = useState(false);
  return (
    <>
      <h1>Messages</h1>
      <div className="inbox">
        <div className="card threads">
          <button className="primary small" onClick={() => { setOpen(null); setComposing(true); }}>New text</button>
          <ul>
            {threads?.map((t) => (
              <li key={`${t.did}|${t.contact}`} className={open?.contact === t.contact && open.did === t.did ? 'active' : ''} onClick={() => { setOpen(t); setComposing(false); }}>
                <div className="row"><strong>{formatPhone(t.contact)}</strong><span className="muted">{timeAgo(t.lastAt)}</span></div>
                <div className="preview">{t.unread > 0 && <span className="badge">{t.unread}</span>}{t.fromTextback ? <span className="tag">missed call</span> : null}{t.lastBody}</div>
              </li>
            ))}
            {threads?.length === 0 && <li className="muted">No conversations yet.</li>}
          </ul>
        </div>
        <div className="card conversation">
          {open ? <Conversation key={`${open.did}|${open.contact}`} {...open} onSent={reload} />
            : composing && numbers ? <Compose numbers={numbers} onSent={(t) => { setOpen(t); setComposing(false); reload(); }} />
            : <p className="muted">Pick a conversation.</p>}
        </div>
      </div>
    </>
  );
}

function Conversation({ did, contact, onSent }: { did: string; contact: string; onSent: () => void }) {
  const { data, reload } = useData<Msg[]>(`/api/sms/threads/${encodeURIComponent(did)}/${encodeURIComponent(contact)}`, 5_000);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api('/api/sms/send', { method: 'POST', body: { did, to: contact, body: text } });
      setText(''); reload(); onSent();
    } catch (err) {
      setError((err as Error).message === 'opted_out' ? 'This person replied STOP and has opted out.' : 'Message not sent.');
    }
  };
  return (
    <>
      <div className="conv-head"><strong>{formatPhone(contact)}</strong><span className="muted"> via {formatPhone(did)}</span></div>
      <div className="bubbles">
        {data?.map((m) => (
          <div key={m.id} className={`bubble ${m.direction}`}>
            {m.body}
            <div className="meta">{m.source === 'textback' ? 'Auto text-back · ' : ''}{timeAgo(m.createdAt)}</div>
          </div>
        ))}
      </div>
      <form className="composer" onSubmit={send}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a reply" />
        <button className="primary" disabled={!text.trim()}>Send</button>
      </form>
      {error && <div className="error">{error}</div>}
    </>
  );
}

function Compose({ numbers, onSent }: { numbers: NumberRow[]; onSent: (t: { did: string; contact: string }) => void }) {
  const [did, setDid] = useState(numbers[0]?.did ?? '');
  const [to, setTo] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api('/api/sms/send', { method: 'POST', body: { did, to, body: text } });
      const digits = to.replace(/\D/g, '').slice(-10);
      onSent({ did, contact: `+1${digits}` });
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <form className="stack" onSubmit={send}>
      <h2>New text</h2>
      <label>From<select value={did} onChange={(e) => setDid(e.target.value)}>{numbers.map((n) => <option key={n.did} value={n.did}>{formatPhone(n.did)} {n.label ?? ''}</option>)}</select></label>
      <label>To<input value={to} onChange={(e) => setTo(e.target.value)} placeholder="(415) 555-0123" required /></label>
      <label>Message<textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} required /></label>
      {error && <div className="error">{error}</div>}
      <button className="primary">Send</button>
    </form>
  );
}
