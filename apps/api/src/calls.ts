import type { DB } from './db.ts';
import { parseCallerId, toE164 } from './phone.ts';
import type { CdrRecord, VoipMs } from './voipms/types.ts';

export interface CallRow {
  tenantId: number;
  uniqueid: string;
  direction: 'inbound' | 'outbound';
  disposition: string;
  fromNumber: string | null;
  fromName: string | null;
  toNumber: string | null;
  did: string | null;
  extension: string;
  durationSeconds: number;
  startedAt: string; // ISO, UTC
}

export interface Ownership {
  didToTenant: Map<string, number>; // E.164 -> tenant
  accountToTenant: Map<string, number>; // VoIP.ms sub-account -> tenant
}

export function loadOwnership(db: DB): Ownership {
  const didToTenant = new Map<string, number>();
  const accountToTenant = new Map<string, number>();
  for (const r of db.prepare('SELECT did, tenant_id FROM numbers').all() as { did: string; tenant_id: number }[]) didToTenant.set(r.did, r.tenant_id);
  for (const r of db.prepare('SELECT voipms_account, tenant_id FROM extensions').all() as { voipms_account: string; tenant_id: number }[]) accountToTenant.set(r.voipms_account, r.tenant_id);
  return { didToTenant, accountToTenant };
}

// One master account's CDR covers every tenant, so each record is routed to its tenant by the DID
// it rang (inbound) or the sub-account that placed it (outbound). Records we can't place are dropped.
export function normalizeCdr(rec: CdrRecord, own: Ownership): CallRow | null {
  const caller = parseCallerId(rec.callerid);
  const dest = toE164(rec.destination);
  const base = {
    uniqueid: rec.uniqueid,
    disposition: rec.disposition,
    extension: rec.account,
    durationSeconds: Number(rec.seconds) || 0,
    startedAt: new Date(rec.date.replace(' ', 'T') + 'Z').toISOString(),
  };
  if (dest && own.didToTenant.has(dest)) {
    return { ...base, tenantId: own.didToTenant.get(dest)!, direction: 'inbound', fromNumber: caller.number, fromName: caller.name, toNumber: dest, did: dest };
  }
  const tenantId = own.accountToTenant.get(rec.account);
  if (tenantId !== undefined) {
    return { ...base, tenantId, direction: 'outbound', fromNumber: caller.number, fromName: null, toNumber: dest, did: caller.number };
  }
  return null;
}

function utcDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

// Pulls yesterday and today (UTC) and inserts anything new. Returns ids of newly stored calls.
export async function syncCalls(db: DB, api: VoipMs, now = new Date()): Promise<number[]> {
  const records = await api.getCDR({ dateFrom: utcDate(new Date(now.getTime() - 86_400_000)), dateTo: utcDate(now), timezone: 0 });
  const own = loadOwnership(db);
  const insert = db.prepare(`INSERT INTO calls (tenant_id, voipms_uniqueid, direction, disposition, from_number, from_name, to_number, did, extension, duration_seconds, started_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (voipms_uniqueid) DO NOTHING`);
  const fresh: number[] = [];
  for (const rec of records) {
    const c = normalizeCdr(rec, own);
    if (!c) continue;
    const r = insert.run(c.tenantId, c.uniqueid, c.direction, c.disposition, c.fromNumber, c.fromName, c.toNumber, c.did, c.extension, c.durationSeconds, c.startedAt);
    if (r.changes) fresh.push(Number(r.lastInsertRowid));
  }
  return fresh;
}
