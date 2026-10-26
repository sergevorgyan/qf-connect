import { useData } from '../useData';

interface Ext { id: number; account: string; label: string; voicemailBox: string | null; userName: string | null; online: boolean | null }

export function Team() {
  const { data } = useData<Ext[]>('/api/extensions', 60_000);
  return (
    <>
      <h1>Team and phones</h1>
      <div className="card table">
        <table>
          <thead><tr><th>Extension</th><th>Person</th><th>Voicemail box</th><th>Phone</th></tr></thead>
          <tbody>
            {data?.map((e) => (
              <tr key={e.id}>
                <td><strong>{e.label}</strong> <span className="muted">{e.account}</span></td>
                <td>{e.userName ?? <span className="muted">Unassigned</span>}</td>
                <td>{e.voicemailBox ?? '-'}</td>
                <td><span className={`dot ${e.online ? 'on' : 'off'}`} />{e.online === null ? 'Unknown' : e.online ? 'Online' : 'Offline'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">Adding users, resetting SIP passwords and business-hours routing are next on the roadmap.</p>
    </>
  );
}
