import { useEffect, useState } from 'react';
import { api, formatPhone } from '../api';
import { useData } from '../useData';

interface TextbackSettings { template: string; when: 'always' | 'after_hours' | 'business_hours'; businessHours: { days: number[]; start: string; end: string }; cooldownHours: number; maxAgeMinutes: number }
interface Data {
  textback: { enabled: boolean; settings: TextbackSettings; numbers: { did: string; tendlcStatus: string }[] };
  hubspot: { enabled: boolean; connected: boolean; configured: boolean; settings: { logMissed: boolean; createUnknownContacts: boolean } };
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function Integrations({ canEdit }: { canEdit: boolean }) {
  const { data, reload } = useData<Data>('/api/integrations');
  if (!data) return <h1>Integrations</h1>;
  return (
    <>
      <h1>Integrations</h1>
      <Textback data={data.textback} canEdit={canEdit} onSaved={reload} />
      <Hubspot data={data.hubspot} canEdit={canEdit} onChanged={reload} />
    </>
  );
}

function Textback({ data, canEdit, onSaved }: { data: Data['textback']; canEdit: boolean; onSaved: () => void }) {
  const [enabled, setEnabled] = useState(data.enabled);
  const [s, setS] = useState(data.settings);
  const [saved, setSaved] = useState(false);
  useEffect(() => setSaved(false), [enabled, s]);
  const save = async () => {
    await api('/api/integrations/textback', { method: 'PUT', body: { enabled, settings: s } });
    setSaved(true); onSaved();
  };
  const preview = s.template.replace('{business}', 'your business');
  return (
    <section className="card stack">
      <div className="row"><h2>Missed-call text-back</h2><Toggle on={enabled} onChange={setEnabled} disabled={!canEdit} /></div>
      <p className="muted">When a call to your business number goes unanswered, we text the caller from that number so the conversation continues in Messages.</p>
      <label>Message<textarea rows={3} value={s.template} disabled={!canEdit} onChange={(e) => setS({ ...s, template: e.target.value })} /></label>
      <div className="bubble out preview-bubble">{preview}</div>
      <label>Send
        <select value={s.when} disabled={!canEdit} onChange={(e) => setS({ ...s, when: e.target.value as TextbackSettings['when'] })}>
          <option value="always">Any time a call is missed</option>
          <option value="after_hours">Only outside business hours</option>
          <option value="business_hours">Only during business hours</option>
        </select>
      </label>
      {s.when !== 'always' && (
        <div className="row wrap">
          {DAYS.map((d, i) => (
            <label key={d} className="check"><input type="checkbox" disabled={!canEdit} checked={s.businessHours.days.includes(i)}
              onChange={(e) => setS({ ...s, businessHours: { ...s.businessHours, days: e.target.checked ? [...s.businessHours.days, i] : s.businessHours.days.filter((x) => x !== i) } })} />{d}</label>
          ))}
          <input type="time" value={s.businessHours.start} disabled={!canEdit} onChange={(e) => setS({ ...s, businessHours: { ...s.businessHours, start: e.target.value } })} />
          <span>to</span>
          <input type="time" value={s.businessHours.end} disabled={!canEdit} onChange={(e) => setS({ ...s, businessHours: { ...s.businessHours, end: e.target.value } })} />
        </div>
      )}
      <label>Don't text the same caller again for (hours)<input type="number" min={1} max={168} value={s.cooldownHours} disabled={!canEdit} onChange={(e) => setS({ ...s, cooldownHours: Number(e.target.value) })} /></label>
      <div>
        <div className="label">Texting registration (10DLC) by number</div>
        <ul className="rows">
          {data.numbers.map((n) => <li key={n.did}><span>{formatPhone(n.did)}</span><span className={`pill ${n.tendlcStatus}`}>{n.tendlcStatus.replace('_', ' ')}</span></li>)}
        </ul>
        <p className="muted small">US carriers require each business to be registered before texts are delivered. Quantum Frame handles this for you.</p>
      </div>
      {canEdit && <div className="row"><button className="primary" onClick={save}>Save</button>{saved && <span className="ok">Saved</span>}</div>}
    </section>
  );
}

function Hubspot({ data, canEdit, onChanged }: { data: Data['hubspot']; canEdit: boolean; onChanged: () => void }) {
  const connect = async () => {
    const { url } = await api<{ url: string }>('/api/integrations/hubspot/connect');
    window.location.href = url;
  };
  const disconnect = async () => { await api('/api/integrations/hubspot', { method: 'DELETE' }); onChanged(); };
  const update = async (patch: Partial<Data['hubspot']['settings']>) => {
    await api('/api/integrations/hubspot', { method: 'PUT', body: { enabled: data.enabled, settings: { ...data.settings, ...patch } } });
    onChanged();
  };
  return (
    <section className="card stack">
      <div className="row"><h2>HubSpot call logging</h2>{data.connected && <span className="pill approved">connected</span>}</div>
      <p className="muted">Every call is logged on the matching HubSpot contact with direction, length and outcome, so your team sees phone history in the CRM.</p>
      {data.connected ? (
        <>
          <label className="check"><input type="checkbox" disabled={!canEdit} checked={data.settings.logMissed} onChange={(e) => update({ logMissed: e.target.checked })} />Log missed calls too</label>
          <label className="check"><input type="checkbox" disabled={!canEdit} checked={data.settings.createUnknownContacts} onChange={(e) => update({ createUnknownContacts: e.target.checked })} />Create a contact for unknown numbers</label>
          {canEdit && <button className="secondary" onClick={disconnect}>Disconnect HubSpot</button>}
        </>
      ) : canEdit ? (
        data.configured ? <button className="primary" onClick={connect}>Connect HubSpot</button>
          : <p className="muted small">HubSpot isn't configured on this server yet (HUBSPOT_CLIENT_ID).</p>
      ) : <p className="muted">Ask your admin to connect HubSpot.</p>}
      <p className="muted small">Zoho CRM and Salesforce are coming next.</p>
    </section>
  );
}

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={on} disabled={disabled} className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)}><span /></button>;
}
