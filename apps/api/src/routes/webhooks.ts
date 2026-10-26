import type { FastifyInstance } from 'fastify';
import { audit, type DB } from '../db.ts';
import { toE164 } from '../phone.ts';

const STOP = /^\s*(stop|stopall|unsubscribe|cancel|end|quit)\s*$/i;
const START = /^\s*(start|unstop|yes)\s*$/i;

export function handleInboundSms(db: DB, token: string, p: { id?: string; from?: string; to?: string; message?: string }) {
  const number = db.prepare('SELECT tenant_id, did FROM numbers WHERE sms_callback_token = ?').get(token) as { tenant_id: number; did: string } | undefined;
  if (!number) return { status: 404 as const };
  const from = toE164(p.from ?? '');
  const to = toE164(p.to ?? '');
  if (!from || to !== number.did) return { status: 400 as const };
  // VoIP.ms retries callbacks; the message id keeps them from duplicating.
  if (p.id && db.prepare('SELECT 1 FROM sms_messages WHERE voipms_id = ? AND direction = ?').get(p.id, 'in')) return { status: 200 as const };

  const body = p.message ?? '';
  db.prepare(`INSERT INTO sms_messages (tenant_id, did, contact, direction, body, source, voipms_id) VALUES (?, ?, ?, 'in', ?, 'inbound', ?)`).run(number.tenant_id, number.did, from, body, p.id ?? null);
  if (STOP.test(body)) {
    db.prepare('INSERT INTO opt_outs (tenant_id, contact) VALUES (?, ?) ON CONFLICT DO NOTHING').run(number.tenant_id, from);
    audit(db, { tenantId: number.tenant_id, action: 'sms.opt_out', detail: { contact: from } });
  } else if (START.test(body)) {
    db.prepare('DELETE FROM opt_outs WHERE tenant_id = ? AND contact = ?').run(number.tenant_id, from);
  }
  db.prepare(`UPDATE textback_events SET replied_at = ? WHERE tenant_id = ? AND contact = ? AND outcome = 'sent' AND replied_at IS NULL AND sent_at > ?`)
    .run(new Date().toISOString(), number.tenant_id, from, new Date(Date.now() - 7 * 86_400_000).toISOString());
  return { status: 200 as const };
}

export function webhookRoutes(app: FastifyInstance, db: DB) {
  // VoIP.ms calls the per-DID "SMS/MMS URL Callback" with GET and placeholders filled in.
  // It expects the body "ok"; anything else is treated as a failure and retried.
  const handler = async (req: { params: unknown; query: unknown; body?: unknown }, reply: { code: (n: number) => { send: (b: string) => unknown } }) => {
    const { token } = req.params as { token: string };
    const p = { ...(req.query as object), ...((req.body as object) ?? {}) } as Record<string, string>;
    const r = handleInboundSms(db, token, p);
    return reply.code(r.status).send(r.status === 200 ? 'ok' : 'error');
  };
  app.get('/webhooks/voipms/sms/:token', handler);
  app.post('/webhooks/voipms/sms/:token', handler);
}
