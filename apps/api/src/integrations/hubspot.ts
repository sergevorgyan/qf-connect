import { config } from '../config.ts';
import { audit, type DB } from '../db.ts';
import { decrypt, encrypt } from '../secrets.ts';
import { getIntegration, hubspotSettings, saveIntegration } from './settings.ts';

const API = 'https://api.hubapi.com';
export const HUBSPOT_SCOPES = ['crm.objects.contacts.read', 'crm.objects.contacts.write', 'crm.objects.calls.write', 'oauth'];
const CALL_TO_CONTACT = 194; // HubSpot-defined association type: call -> contact

interface Tokens { access_token: string; refresh_token: string; expires_at: number }

export interface CallForCrm {
  direction: string;
  disposition: string;
  fromNumber: string | null;
  fromName: string | null;
  toNumber: string | null;
  durationSeconds: number;
  startedAt: string;
}

const STATUS: Record<string, string> = { ANSWERED: 'COMPLETED', 'NO ANSWER': 'NO_ANSWER', VOICEMAIL: 'NO_ANSWER', BUSY: 'BUSY', FAILED: 'FAILED' };

export function buildCallProperties(call: CallForCrm, businessName: string) {
  const inbound = call.direction === 'inbound';
  const other = inbound ? call.fromNumber : call.toNumber;
  const missed = inbound && call.disposition !== 'ANSWERED';
  return {
    hs_timestamp: call.startedAt,
    hs_call_title: `${missed ? 'Missed call' : inbound ? 'Inbound call' : 'Outbound call'} ${inbound ? 'from' : 'to'} ${call.fromName && inbound ? `${call.fromName} ` : ''}${other ?? 'unknown'}`,
    hs_call_direction: inbound ? 'INBOUND' : 'OUTBOUND',
    hs_call_status: STATUS[call.disposition] ?? 'FAILED',
    hs_call_duration: String(call.durationSeconds * 1000),
    hs_call_from_number: call.fromNumber ?? '',
    hs_call_to_number: call.toNumber ?? '',
    hs_call_body: `Logged automatically by ${businessName} phone system.`,
  };
}

export function authorizeUrl(tenantId: number, state: string) {
  const qs = new URLSearchParams({
    client_id: config.hubspot.clientId,
    redirect_uri: `${config.publicUrl}/api/integrations/hubspot/callback`,
    scope: HUBSPOT_SCOPES.join(' '),
    state: `${tenantId}.${state}`,
  });
  return `https://app.hubspot.com/oauth/authorize?${qs}`;
}

async function tokenRequest(params: Record<string, string>, fetchImpl: typeof fetch): Promise<Tokens> {
  const res = await fetchImpl(`${API}/oauth/v3/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.hubspot.clientId, client_secret: config.hubspot.clientSecret, redirect_uri: `${config.publicUrl}/api/integrations/hubspot/callback`, ...params }),
  });
  if (!res.ok) throw new Error(`hubspot_token_${res.status}`);
  const t = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  return { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + (t.expires_in - 60) * 1000 };
}

export async function connectHubspot(db: DB, tenantId: number, code: string, fetchImpl: typeof fetch = fetch) {
  const tokens = await tokenRequest({ grant_type: 'authorization_code', code }, fetchImpl);
  saveIntegration(db, tenantId, 'hubspot', { enabled: true, secret: encrypt(JSON.stringify(tokens)) });
  audit(db, { tenantId, action: 'hubspot.connected' });
}

export class HubSpotClient {
  constructor(private db: DB, private tenantId: number, private fetchImpl: typeof fetch = fetch) {}

  private async token(): Promise<string> {
    const { secret } = getIntegration(this.db, this.tenantId, 'hubspot', hubspotSettings);
    if (!secret) throw new Error('hubspot_not_connected');
    let tokens = JSON.parse(decrypt(secret)) as Tokens;
    if (Date.now() >= tokens.expires_at) {
      tokens = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }, this.fetchImpl);
      saveIntegration(this.db, this.tenantId, 'hubspot', { secret: encrypt(JSON.stringify(tokens)) });
    }
    return tokens.access_token;
  }

  private async request<T>(path: string, body: unknown): Promise<T> {
    const res = await this.fetchImpl(`${API}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await this.token()}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`hubspot_${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json() as Promise<T>;
  }

  async findContactByPhone(e164: string): Promise<string | null> {
    const ten = e164.slice(-10);
    // HubSpot stores phones as typed, so search a few common spellings.
    const values = [e164, ten, `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`, `${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}`];
    const filterGroups = ['phone', 'mobilephone'].flatMap((p) => values.map((v) => ({ filters: [{ propertyName: p, operator: 'EQ', value: v }] })));
    const r = await this.request<{ results: { id: string }[] }>('/crm/v3/objects/contacts/search', { filterGroups: filterGroups.slice(0, 5), limit: 1 });
    if (r.results[0]) return r.results[0].id;
    if (filterGroups.length > 5) {
      const r2 = await this.request<{ results: { id: string }[] }>('/crm/v3/objects/contacts/search', { filterGroups: filterGroups.slice(5), limit: 1 });
      return r2.results[0]?.id ?? null;
    }
    return null;
  }

  async createContact(e164: string, name: string | null): Promise<string> {
    const [firstname, ...rest] = (name ?? '').split(' ');
    const r = await this.request<{ id: string }>('/crm/v3/objects/contacts', { properties: { phone: e164, firstname: firstname || undefined, lastname: rest.join(' ') || undefined } });
    return r.id;
  }

  async logCall(properties: Record<string, string>, contactId: string | null): Promise<string> {
    const associations = contactId ? [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: CALL_TO_CONTACT }] }] : [];
    const r = await this.request<{ id: string }>('/crm/v3/objects/calls', { properties, associations });
    return r.id;
  }
}

interface CallRecord { id: number; tenant_id: number; direction: string; disposition: string; from_number: string | null; from_name: string | null; to_number: string | null; duration_seconds: number; started_at: string }

export async function logPendingCalls(db: DB, fetchImpl: typeof fetch = fetch, limit = 50) {
  const pending = db.prepare(`SELECT c.* FROM calls c JOIN integrations i ON i.tenant_id = c.tenant_id AND i.type = 'hubspot' AND i.enabled = 1
    WHERE c.crm_logged_at IS NULL AND c.crm_error IS NULL AND c.started_at > ? ORDER BY c.started_at LIMIT ?`)
    .all(new Date(Date.now() - 2 * 86_400_000).toISOString(), limit) as unknown as CallRecord[];
  let logged = 0;
  for (const c of pending) {
    const { settings } = getIntegration(db, c.tenant_id, 'hubspot', hubspotSettings);
    const markDone = () => db.prepare('UPDATE calls SET crm_logged_at = ? WHERE id = ?').run(new Date().toISOString(), c.id);
    if (!settings.logMissed && c.direction === 'inbound' && c.disposition !== 'ANSWERED') { markDone(); continue; }
    try {
      const client = new HubSpotClient(db, c.tenant_id, fetchImpl);
      const other = c.direction === 'inbound' ? c.from_number : c.to_number;
      let contactId = other ? await client.findContactByPhone(other) : null;
      if (!contactId && other && settings.createUnknownContacts) contactId = await client.createContact(other, c.from_name);
      const tenant = db.prepare('SELECT name FROM tenants WHERE id = ?').get(c.tenant_id) as { name: string };
      await client.logCall(buildCallProperties({
        direction: c.direction, disposition: c.disposition, fromNumber: c.from_number, fromName: c.from_name,
        toNumber: c.to_number, durationSeconds: c.duration_seconds, startedAt: c.started_at,
      }, tenant.name), contactId);
      markDone();
      logged++;
    } catch (err) {
      db.prepare('UPDATE calls SET crm_error = ? WHERE id = ?').run((err as Error).message.slice(0, 300), c.id);
    }
  }
  return logged;
}
