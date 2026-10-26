import { audit, type DB } from '../db.ts';
import { toTenDigit } from '../phone.ts';
import type { VoipMs } from '../voipms/types.ts';
import { getIntegration, textbackSettings, type TextbackSettings } from './settings.ts';

const MISSED = new Set(['NO ANSWER', 'BUSY']);

export interface TextbackContext {
  call: { direction: string; disposition: string; fromNumber: string | null; did: string | null; startedAt: string };
  settings: TextbackSettings;
  timezone: string;
  now: Date;
  didApproved: boolean; // 10DLC campaign approved for this DID
  optedOut: boolean;
  lastTextedAt: Date | null; // last text-back to this caller from this tenant
}

export type Decision = { send: true } | { send: false; reason: string };

function localClock(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { day, hhmm: `${get('hour')}:${get('minute')}` };
}

export function isBusinessHours(now: Date, timezone: string, hours: TextbackSettings['businessHours']) {
  const { day, hhmm } = localClock(now, timezone);
  return hours.days.includes(day) && hhmm >= hours.start && hhmm < hours.end;
}

// Pure decision so every skip reason is testable and shows up in the event log.
export function decideTextback(ctx: TextbackContext): Decision {
  const { call, settings, now } = ctx;
  if (call.direction !== 'inbound') return { send: false, reason: 'not_inbound' };
  if (!MISSED.has(call.disposition)) return { send: false, reason: 'answered' };
  if (!call.fromNumber || !call.did) return { send: false, reason: 'no_caller_id' };
  if (!ctx.didApproved) return { send: false, reason: '10dlc_not_approved' };
  if (ctx.optedOut) return { send: false, reason: 'opted_out' };
  if (now.getTime() - Date.parse(call.startedAt) > settings.maxAgeMinutes * 60_000) return { send: false, reason: 'too_old' };
  if (ctx.lastTextedAt && now.getTime() - ctx.lastTextedAt.getTime() < settings.cooldownHours * 3_600_000) return { send: false, reason: 'cooldown' };
  if (settings.when !== 'always') {
    const open = isBusinessHours(now, ctx.timezone, settings.businessHours);
    if (settings.when === 'after_hours' && open) return { send: false, reason: 'business_hours' };
    if (settings.when === 'business_hours' && !open) return { send: false, reason: 'after_hours' };
  }
  return { send: true };
}

export function renderTemplate(template: string, vars: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
}

interface CallRecord { id: number; tenant_id: number; direction: string; disposition: string; from_number: string | null; did: string | null; started_at: string }

export async function processTextback(db: DB, api: VoipMs, callId: number, now = new Date()) {
  const call = db.prepare('SELECT id, tenant_id, direction, disposition, from_number, did, started_at FROM calls WHERE id = ?').get(callId) as CallRecord | undefined;
  if (!call || call.direction !== 'inbound' || !MISSED.has(call.disposition)) return null;
  const integ = getIntegration(db, call.tenant_id, 'textback', textbackSettings);
  if (!integ.enabled) return null;

  const tenant = db.prepare('SELECT name, timezone FROM tenants WHERE id = ?').get(call.tenant_id) as { name: string; timezone: string };
  const number = db.prepare('SELECT tendlc_status FROM numbers WHERE did = ?').get(call.did) as { tendlc_status: string } | undefined;
  const optedOut = !!db.prepare('SELECT 1 FROM opt_outs WHERE tenant_id = ? AND contact = ?').get(call.tenant_id, call.from_number);
  const last = db.prepare(`SELECT MAX(sent_at) AS at FROM textback_events WHERE tenant_id = ? AND contact = ? AND outcome = 'sent'`).get(call.tenant_id, call.from_number) as { at: string | null };

  const decision = decideTextback({
    call: { direction: call.direction, disposition: call.disposition, fromNumber: call.from_number, did: call.did, startedAt: call.started_at },
    settings: integ.settings,
    timezone: tenant.timezone,
    now,
    didApproved: number?.tendlc_status === 'approved',
    optedOut,
    lastTextedAt: last.at ? new Date(last.at) : null,
  });

  const record = db.prepare('INSERT INTO textback_events (tenant_id, call_id, contact, did, outcome, sent_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (call_id) DO NOTHING');
  if (!decision.send) {
    record.run(call.tenant_id, call.id, call.from_number ?? '', call.did ?? '', `skipped:${decision.reason}`, null);
    return decision;
  }

  const body = renderTemplate(integ.settings.template, { business: tenant.name });
  // Claim the event before sending so a crashed or parallel worker can't double-text.
  const claimed = record.run(call.tenant_id, call.id, call.from_number!, call.did!, 'sending', null);
  if (!claimed.changes) return null;
  try {
    const res = await api.sendSMS({ did: toTenDigit(call.did!), dst: toTenDigit(call.from_number!), message: body });
    db.prepare(`UPDATE textback_events SET outcome = 'sent', sent_at = ? WHERE call_id = ?`).run(now.toISOString(), call.id);
    db.prepare(`INSERT INTO sms_messages (tenant_id, did, contact, direction, body, source, voipms_id, read_at) VALUES (?, ?, ?, 'out', ?, 'textback', ?, ?)`)
      .run(call.tenant_id, call.did, call.from_number, body, res.sms, now.toISOString());
    audit(db, { tenantId: call.tenant_id, action: 'textback.sent', detail: { callId: call.id } });
    return decision;
  } catch (err) {
    db.prepare(`UPDATE textback_events SET outcome = ? WHERE call_id = ?`).run(`error:${(err as Error).message}`.slice(0, 200), call.id);
    throw err;
  }
}
