import { useState } from 'react';
import { api } from '../api';
import { useData } from '../useData';

interface Tenant { id: number; name: string; plan: string; numbers: number; extensions: number; createdAt: string }

export function Admin({ actingTenantId, onSwitch }: { actingTenantId: number | null; onSwitch: () => void }) {
  const { data, reload } = useData<Tenant[]>('/api/admin/tenants');
  const [adding, setAdding] = useState(false);
  const actAs = async (id: number | 'none') => { await api(`/api/admin/impersonate/${id}`, { method: 'POST' }); onSwitch(); };
  return (
    <>
      <div className="row"><h1>Customers</h1><button className="primary small" onClick={() => setAdding(!adding)}>{adding ? 'Cancel' : 'Add customer'}</button></div>
      {adding && <NewTenant onCreated={() => { setAdding(false); reload(); }} />}
      <div className="card table">
        <table>
          <thead><tr><th>Business</th><th>Plan</th><th>Numbers</th><th>Extensions</th><th></th></tr></thead>
          <tbody>
            {data?.map((t) => (
              <tr key={t.id}>
                <td><strong>{t.name}</strong></td><td>{t.plan}</td><td>{t.numbers}</td><td>{t.extensions}</td>
                <td>{t.id === actingTenantId ? <button className="link" onClick={() => actAs('none')}>Stop viewing</button> : <button className="link" onClick={() => actAs(t.id)}>View portal</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">Viewing a customer's portal is recorded in the audit log.</p>
    </>
  );
}

function NewTenant({ onCreated }: { onCreated: () => void }) {
  const [f, setF] = useState({ name: '', adminName: '', adminEmail: '', adminPassword: '', dids: '', extensions: '' });
  const [error, setError] = useState('');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api('/api/admin/tenants', { method: 'POST', body: {
        name: f.name,
        admin: { name: f.adminName, email: f.adminEmail, password: f.adminPassword },
        numbers: f.dids.split(',').map((d) => d.trim()).filter(Boolean).map((did) => ({ did })),
        // "100001_front:Front desk:1001, 100001_bob:Bob"
        extensions: f.extensions.split(',').map((x) => x.trim()).filter(Boolean).map((x) => { const [account, label, voicemailBox] = x.split(':'); return { account, label: label ?? account, voicemailBox }; }),
      } });
      onCreated();
    } catch (err) { setError((err as Error).message); }
  };
  return (
    <form className="card stack" onSubmit={submit}>
      <h2>New customer</h2>
      <label>Business name<input value={f.name} onChange={set('name')} required /></label>
      <div className="row wrap">
        <label>Admin name<input value={f.adminName} onChange={set('adminName')} required /></label>
        <label>Admin email<input type="email" value={f.adminEmail} onChange={set('adminEmail')} required /></label>
        <label>Temporary password<input value={f.adminPassword} onChange={set('adminPassword')} minLength={10} required /></label>
      </div>
      <label>VoIP.ms DIDs (comma separated)<input value={f.dids} onChange={set('dids')} placeholder="4155550100, 4155550101" /></label>
      <label>Sub-accounts (account:label:voicemail box, comma separated)<input value={f.extensions} onChange={set('extensions')} placeholder="100001_front:Front desk:1001" /></label>
      {error && <div className="error">{error}</div>}
      <button className="primary">Create customer</button>
    </form>
  );
}
