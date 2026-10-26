import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireTenant } from '../auth.ts';
import { audit, type DB } from '../db.ts';
import { toE164, toTenDigit, parseCallerId } from '../phone.ts';
import { tenantMailboxes, tenantOwnsDid, tenantOwnsMailbox } from '../tenancy.ts';
import { voipms } from '../voipms/client.ts';

export function portalRoutes(app: FastifyInstance, db: DB) {
  app.get('/api/dashboard', async (req, reply) => {
    const t = requireTenant(req, reply); if (t == null) return;
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const week = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const calls = db.prepare(`SELECT COUNT(*) AS total, SUM(direction = 'inbound' AND disposition <> 'ANSWERED') AS missed FROM calls WHERE tenant_id = ? AND started_at > ?`).get(t, since) as { total: number; missed: number | null };
    const unread = db.prepare(`SELECT COUNT(*) AS n FROM sms_messages WHERE tenant_id = ? AND direction = 'in' AND read_at IS NULL`).get(t) as { n: number };
    const tb = db.prepare(`SELECT SUM(outcome = 'sent') AS sent, SUM(replied_at IS NOT NULL) AS replied FROM textback_events WHERE tenant_id = ? AND sent_at > ?`).get(t, week) as { sent: number | null; replied: number | null };
    return { last24h: { calls: calls.total, missed: calls.missed ?? 0 }, unreadTexts: unread.n, textback7d: { sent: tb.sent ?? 0, replied: tb.replied ?? 0 } };
  });

  app.get('/api/calls', async (req, reply) => {
    const t = requireTenant(req, reply); if (t == null) return;
    const q = z.object({ filter: z.enum(['all', 'missed', 'inbound', 'outbound']).default('all'), search: z.string().optional(), limit: z.coerce.number().max(500).default(100) }).parse(req.query);
    const where = ['tenant_id = ?'];
    const args: (string | number)[] = [t];
    if (q.filter === 'missed') where.push(`direction = 'inbound' AND disposition <> 'ANSWERED'`);
    if (q.filter === 'inbound' || q.filter === 'outbound') { where.push('direction = ?'); args.push(q.filter); }
    if (q.search) { where.push('(from_number LIKE ? OR to_number LIKE ? OR from_name LIKE ?)'); const s = `%${q.search}%`; args.push(s, s, s); }
    args.push(q.limit);
    return db.prepare(`SELECT id, direction, disposition, from_number AS fromNumber, from_name AS fromName, to_number AS toNumber, did, extension,
      duration_seconds AS durationSeconds, started_at AS startedAt, crm_logged_at AS crmLoggedAt FROM calls WHERE ${where.join(' AND ')} ORDER BY started_at DESC LIMIT ?`).all(...args);
  });

  app.get('/api/voicemails', async (req, reply) => {
    const t = requireTenant(req, reply); if (t == null) return;
    const boxes = tenantMailboxes(db, t);
    const lists = await Promise.all(boxes.map((mailbox) => voipms().getVoicemailMessages({ mailbox })));
    return lists.flat().map((m) => ({ ...m, caller: parseCallerId(m.callerid) })).sort((a, b) => b.date.localeCompare(a.date));
  });

  app.get('/api/voicemails/:mailbox/:folder/:num/audio', async (req, reply) => {
    const t = requireTenant(req, reply); if (t == null) return;
    const p = req.params as { mailbox: string; folder: string; num: string };
    if (!tenantOwnsMailbox(db, t, p.mailbox)) return reply.code(404).send({ error: 'not_found' });
    const file = await voipms().getVoicemailMessageFile({ mailbox: p.mailbox, folder: p.folder, messageNum: p.num });
    audit(db, { tenantId: t, userId: req.user!.id, action: 'voicemail.play', detail: p });
    return reply.type('audio/mpeg').send(Buffer.from(file.base64, 'base64'));
  });

  app.get('/api/sms/threads', async (req, reply) => {
    const t = requireTenant(req, reply); if (t == null) return;
    return db.prepare(`SELECT did, contact, MAX(created_at) AS lastAt, SUM(direction = 'in' AND read_at IS NULL) AS unread,
      (SELECT body FROM sms_messages m2 WHERE m2.tenant_id = m.tenant_id AND m2.did = m.did AND m2.contact = m.contact ORDER BY created_at DESC, id DESC LIMIT 1) AS lastBody,
      MAX(source = 'textback') AS fromTextback
      FROM sms_messages m WHERE tenant_id = ? GROUP BY did, contact ORDER BY lastAt DESC`).all(t);
  });

  app.get('/api/sms/threads/:did/:contact', async (req, reply) => {
    const t = requireTenant(req, reply); if (t == null) return;
    const p = req.params as { did: string; contact: string };
    db.prepare(`UPDATE sms_messages SET read_at = ? WHERE tenant_id = ? AND did = ? AND contact = ? AND read_at IS NULL`).run(new Date().toISOString(), t, p.did, p.contact);
    return db.prepare(`SELECT id, direction, body, source, created_at AS createdAt FROM sms_messages WHERE tenant_id = ? AND did = ? AND contact = ? ORDER BY created_at, id`).all(t, p.did, p.contact);
  });

  app.post('/api/sms/send', async (req, reply) => {
    const t = requireTenant(req, reply); if (t == null) return;
    const body = z.object({ did: z.string(), to: z.string(), body: z.string().min(1).max(640) }).parse(req.body);
    const to = toE164(body.to);
    if (!to) return reply.code(400).send({ error: 'invalid_number' });
    if (!tenantOwnsDid(db, t, body.did)) return reply.code(404).send({ error: 'not_found' });
    if (db.prepare('SELECT 1 FROM opt_outs WHERE tenant_id = ? AND contact = ?').get(t, to)) return reply.code(409).send({ error: 'opted_out' });
    const res = await voipms().sendSMS({ did: toTenDigit(body.did), dst: toTenDigit(to), message: body.body });
    db.prepare(`INSERT INTO sms_messages (tenant_id, did, contact, direction, body, voipms_id, sent_by_user_id, read_at) VALUES (?, ?, ?, 'out', ?, ?, ?, ?)`)
      .run(t, body.did, to, body.body, res.sms, req.user!.id, new Date().toISOString());
    return { ok: true };
  });

  app.get('/api/numbers', async (req, reply) => {
    const t = requireTenant(req, reply); if (t == null) return;
    return db.prepare('SELECT did, label, sms_enabled AS smsEnabled, tendlc_status AS tendlcStatus FROM numbers WHERE tenant_id = ? ORDER BY did').all(t);
  });

  app.get('/api/extensions', async (req, reply) => {
    const t = requireTenant(req, reply); if (t == null) return;
    const rows = db.prepare(`SELECT e.id, e.voipms_account AS account, e.label, e.voicemail_box AS voicemailBox, u.name AS userName
      FROM extensions e LEFT JOIN users u ON u.id = e.user_id WHERE e.tenant_id = ? ORDER BY e.label`).all(t) as { account: string }[];
    const online = await Promise.all(rows.map((r) => voipms().getRegistrationStatus(r.account).catch(() => null)));
    return rows.map((r, i) => ({ ...r, online: online[i] }));
  });
}
