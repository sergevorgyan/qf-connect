import { useState } from 'react';
import { api, formatPhone } from '../api';
import { useData } from '../useData';
import { toast } from '../toast';

interface Tenant { id: number; name: string; plan: string; numbers: number; extensions: number; createdAt: string }

export function Admin({ actingTenantId, onSwitch }: { actingTenantId: number | null; onSwitch: () => void }) {
  const { data, reload } = useData<Tenant[]>('/api/admin/tenants');
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState<number | null>(null);
  const actAs = async (id: number | 'none') => { await api(`/api/admin/impersonate/${id}`, { method: 'POST' }); onSwitch(); };
  return (
    <>
      <div className="row"><h1>Customers</h1><button className="primary small" onClick={() => setAdding(!adding)}>{adding ? 'Cancel' : 'Add customer'}</button></div>
      {adding && <NewTenant onCreated={() => { setAdding(false); reload(); }} />}
      <div className="card table">
        <table>
          <thead><tr><th>Business</th><th>Plan</th><th>Numbers</th><th>Extensions</th><th></th><th></th></tr></thead>
          <tbody>
            {data?.map((t) => (
              <tr key={t.id}>
                <td><strong>{t.name}</strong></td><td>{t.plan}</td><td>{t.numbers}</td><td>{t.extensions}</td>
                <td><button className="link" onClick={() => setManaging(managing === t.id ? null : t.id)}>{managing === t.id ? 'Close' : 'Numbers and extensions'}</button></td>
                <td>{t.id === actingTenantId ? <button className="link" onClick={() => actAs('none')}>Stop viewing</button> : <button className="link" onClick={() => actAs(t.id)}>View portal</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {managing !== null && <ManageTenant key={managing} id={managing} onChanged={reload} />}
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
      onCreated(); toast(`${f.name} created.`);
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

interface Detail {
  tenant: { id: number; name: string; voipmsClientId: string | null };
  numbers: { did: string; label: string | null; tendlcStatus: string; smsCallbackUrl: string }[];
  extensions: { account: string; label: string; voicemailBox: string | null }[];
}
interface Inventory {
  numbers: { did: string | null; description: string; smsEnabled: boolean; tenantId: number | null }[];
  extensions: { account: string; description: string; tenantId: number | null }[];
  clients: { id: string; name: string; email: string; tenantId: number | null }[];
}

const TENDLC = ['not_started', 'pending', 'approved', 'rejected'];

// Links numbers and sub-accounts from whichever VoIP.ms account is connected. Moving to a new
// VoIP.ms account later means unlinking the old items here and linking the new ones.
function ManageTenant({ id, onChanged }: { id: number; onChanged: () => void }) {
  const { data, reload } = useData<Detail>(`/api/admin/tenants/${id}`);
  const { data: inv, error: invError, reload: reloadInv } = useData<Inventory>('/api/admin/voipms/inventory');
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setError('');
    try { await fn(); reload(); reloadInv(); onChanged(); toast(done); } catch (e) { setError((e as Error).message); toast(`Not saved: ${(e as Error).message}`, 'error'); }
  };
  if (!data) return null;
  const freeNumbers = inv?.numbers.filter((n) => n.did && n.tenantId === null) ?? [];
  const freeExts = inv?.extensions.filter((e) => e.tenantId === null) ?? [];
  return (
    <section className="card stack">
      <h2>{data.tenant.name}: numbers and extensions</h2>
      <ResellerClientLink tenantId={id} clientId={data.tenant.voipmsClientId} clients={inv?.clients ?? []} run={run} />
      <div className="label">Linked numbers</div>
      <ul className="rows">
        {data.numbers.map((n) => (
          <li key={n.did}>
            <span><strong>{formatPhone(n.did)}</strong> <span className="muted">{n.label ?? ''}</span></span>
            <span className="row">
              <select value={n.tendlcStatus} onChange={(e) => run(() => api(`/api/admin/numbers/${encodeURIComponent(n.did)}`, { method: 'PATCH', body: { tendlcStatus: e.target.value } }), `10DLC status for ${formatPhone(n.did)} set to ${e.target.value.replace('_', ' ')}.`)}>
                {TENDLC.map((s) => <option key={s} value={s}>10DLC: {s.replace('_', ' ')}</option>)}
              </select>
              <button className="link" onClick={() => navigator.clipboard.writeText(n.smsCallbackUrl).then(() => toast('SMS callback URL copied.'), () => toast('Could not copy. Select the URL and copy it by hand.', 'error'))}>Copy SMS callback URL</button>
              <button className="link" onClick={() => run(() => api(`/api/admin/tenants/${id}/numbers/${encodeURIComponent(n.did)}`, { method: 'DELETE' }), `${formatPhone(n.did)} unlinked.`)}>Unlink</button>
            </span>
          </li>
        ))}
        {data.numbers.length === 0 && <li className="muted">None yet.</li>}
      </ul>
      <div className="label">Linked extensions</div>
      <ul className="rows">
        {data.extensions.map((e) => (
          <li key={e.account}>
            <span><strong>{e.label}</strong> <span className="muted">{e.account}{e.voicemailBox ? ` · voicemail ${e.voicemailBox}` : ''}</span></span>
            <button className="link" onClick={() => run(() => api(`/api/admin/tenants/${id}/extensions/${encodeURIComponent(e.account)}`, { method: 'DELETE' }), `Extension ${e.account} unlinked.`)}>Unlink</button>
          </li>
        ))}
        {data.extensions.length === 0 && <li className="muted">None yet.</li>}
      </ul>
      <div className="label">Not linked to any customer in the connected VoIP.ms account</div>
      {invError && <div className="error">Could not read the VoIP.ms account ({invError}). Run npm run voipms:check on the server.</div>}
      <ul className="rows">
        {freeNumbers.map((n) => (
          <li key={n.did}>
            <span>{formatPhone(n.did)} <span className="muted">{n.description} · SMS {n.smsEnabled ? 'on' : 'off'}</span></span>
            <button className="link" onClick={() => run(() => api(`/api/admin/tenants/${id}/numbers`, { method: 'POST', body: { did: n.did, label: n.description || undefined } }), `${formatPhone(n.did)} linked.`)}>Link number</button>
          </li>
        ))}
        {freeExts.map((e) => (
          <li key={e.account}>
            <span>{e.account} <span className="muted">{e.description}</span></span>
            <button className="link" onClick={() => {
              const box = window.prompt(`Voicemail box for ${e.account} (leave empty for none)`) ?? '';
              run(() => api(`/api/admin/tenants/${id}/extensions`, { method: 'POST', body: { account: e.account, label: e.description || e.account, voicemailBox: box || undefined } }), `Extension ${e.account} linked.`);
            }}>Link extension</button>
          </li>
        ))}
        {inv && freeNumbers.length + freeExts.length === 0 && <li className="muted">Everything in the account is linked.</li>}
      </ul>
      {error && <div className="error">{error}</div>}
    </section>
  );
}

// Upgrading a basic customer (VoIP.ms white-label portal) to VIP: pick their reseller client, then pull in its numbers.
function ResellerClientLink({ tenantId, clientId, clients, run }: {
  tenantId: number; clientId: string | null; clients: Inventory['clients'];
  run: (fn: () => Promise<unknown>, done: string) => Promise<void>;
}) {
  const choices = clients.filter((c) => c.tenantId === null || c.tenantId === tenantId);
  const current = clients.find((c) => c.id === clientId);
  if (!clients.length && !clientId) return null;
  const linkItems = () => run(async () => {
    const r = await api<{ numbers: string[]; extensions: string[]; skipped: string[] }>(`/api/admin/tenants/${tenantId}/voipms-client/link-items`, { method: 'POST' });
    if (r.skipped.length) toast(`Skipped (already belong to another customer): ${r.skipped.join(', ')}`, 'error');
    return r;
  }, "Client's numbers and extensions linked.");
  return (
    <div className="stack">
      <div className="label">VoIP.ms reseller client (basic portal account)</div>
      <div className="row wrap">
        <select value={clientId ?? ''} onChange={(e) => run(() => api(`/api/admin/tenants/${tenantId}/voipms-client`, { method: 'PUT', body: { clientId: e.target.value || null } }), e.target.value ? 'Reseller client linked.' : 'Reseller client unlinked.')}>
          <option value="">None (portal-only customer)</option>
          {choices.map((c) => <option key={c.id} value={c.id}>{c.name} · client {c.id}</option>)}
          {clientId && !current && <option value={clientId}>client {clientId}</option>}
        </select>
        {clientId && <button className="secondary" onClick={linkItems}>Link this client's numbers and extensions</button>}
      </div>
      <p className="muted small">The customer keeps their VoIP.ms portal login. Their numbers and extensions also appear here, so they get the VIP features without changing accounts.</p>
    </div>
  );
}
