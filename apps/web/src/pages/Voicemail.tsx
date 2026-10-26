import { formatPhone } from '../api';
import { useData } from '../useData';

interface Message { mailbox: string; folder: string; message_num: string; date: string; duration: string; listened: 'yes' | 'no'; caller: { name: string | null; number: string | null } }

export function Voicemail() {
  const { data, error } = useData<Message[]>('/api/voicemails', 60_000);
  return (
    <>
      <h1>Voicemail</h1>
      {error && <div className="error">Could not load voicemail ({error}).</div>}
      <div className="card">
        <ul className="rows">
          {data?.map((m) => (
            <li key={`${m.mailbox}-${m.message_num}`} className={m.listened === 'no' ? 'unread' : ''}>
              <span><strong>{m.caller.name ?? formatPhone(m.caller.number)}</strong><span className="muted"> {m.date} · {m.duration} · box {m.mailbox}</span></span>
              <audio controls preload="none" src={`/api/voicemails/${m.mailbox}/${m.folder}/${m.message_num}/audio`} />
            </li>
          ))}
        </ul>
        {data?.length === 0 && <p className="muted">No voicemail.</p>}
      </div>
    </>
  );
}
