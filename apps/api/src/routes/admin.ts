import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireQfAdmin, SESSION_COOKIE } from '../auth.ts';
import { audit, type DB } from '../db.ts';
import { toE164 } from '../phone.ts';
import { hashPassword, randomToken } from '../secrets.ts';
import { voipms } from '../voipms/client.ts';

const newTenant = z.object({
  name: z.string().min(2),
  timezone: z.string().default('America/Los_Angeles'),
  voipmsClientId: z.string().optional(),
  admin: z.object({ name: z.string(), email: z.string().email(), password: z.string().min(10) }),
  numbers: z.array(z.object({ did: z.string(), label: z.string().optional() })).default([]),
  extensions: z.array(z.object({ account: z.string(), label: z.string(), voicemailBox: z.string().optional() })).default([]),
});

export function createTenant(db: DB, input: z.input<typeof newTenant>) {
  const t = newTenant.parse(input);
  const tenantId = Number(db.prepare('INSERT INTO tenants (name, timezone, voipms_client_id) VALUES (?, ?, ?)').run(t.name, t.timezone, t.voipmsClientId ?? null).lastInsertRowid);
  db.prepare(`INSERT INTO users (tenant_id, email, name, role, password_hash) VALUES (?, ?, ?, 'tenant_admin', ?)`).run(tenantId, t.admin.email.toLowerCase(), t.admin.name, hashPassword(t.admin.password));
  for (const n of t.numbers) {
    const did = toE164(n.did);
    if (!did) throw new Error(`invalid DID ${n.did}`);
    db.prepare('INSERT INTO numbers (tenant_id, did, label, sms_callback_token) VALUES (?, ?, ?, ?)').run(tenantId, did, n.label ?? null, randomToken(24));
  }
  for (const e of t.extensions) db.prepare('INSERT INTO extensions (tenant_id, voipms_account, label, voicemail_box) VALUES (?, ?, ?, ?)').run(tenantId, e.account, e.label, e.voicemailBox ?? null);
  return tenantId;
}

export function adminRoutes(app: FastifyInstance, db: DB, publicUrl: string) {
  app.get('/api/admin/tenants', async (req, reply) => {
    if (!requireQfAdmin(req, reply)) return;
    return db.prepare(`SELECT t.id, t.name, t.plan, t.created_at AS createdAt,
      (SELECT COUNT(*) FROM numbers n WHERE n.tenant_id = t.id) AS numbers,
      (SELECT COUNT(*) FROM extensions e WHERE e.tenant_id = t.id) AS extensions
      FROM tenants t ORDER BY t.name`).all();
  });

  app.post('/api/admin/tenants', async (req, reply) => {
    if (!requireQfAdmin(req, reply)) return;
    const tenantId = createTenant(db, req.body as z.input<typeof newTenant>);
    audit(db, { tenantId, userId: req.user!.id, action: 'tenant.created' });
    return { id: tenantId };
  });

  // The SMS callback URL to paste into each DID's settings in the VoIP.ms portal.
  app.get('/api/admin/tenants/:id/sms-callbacks', async (req, reply) => {
    if (!requireQfAdmin(req, reply)) return;
    const rows = db.prepare('SELECT did, sms_callback_token AS token FROM numbers WHERE tenant_id = ?').all(Number((req.params as { id: string }).id)) as { did: string; token: string }[];
    return rows.map((r) => ({ did: r.did, url: `${publicUrl}/webhooks/voipms/sms/${r.token}?id={ID}&from={FROM}&to={TO}&message={MESSAGE}&date={TIMESTAMP}` }));
  });

  app.get('/api/admin/tenants/:id', async (req, reply) => {
    if (!requireQfAdmin(req, reply)) return;
    const id = Number((req.params as { id: string }).id);
    const tenant = db.prepare('SELECT id, name, timezone FROM tenants WHERE id = ?').get(id);
    if (!tenant) return reply.code(404).send({ error: 'not_found' });
    const numbers = (db.prepare('SELECT did, label, tendlc_status AS tendlcStatus, sms_callback_token AS token FROM numbers WHERE tenant_id = ? ORDER BY did').all(id) as { did: string; label: string | null; tendlcStatus: string; token: string }[])
      .map(({ token, ...n }) => ({ ...n, smsCallbackUrl: `${publicUrl}/webhooks/voipms/sms/${token}?id={ID}&from={FROM}&to={TO}&message={MESSAGE}&date={TIMESTAMP}` }));
    const extensions = db.prepare('SELECT voipms_account AS account, label, voicemail_box AS voicemailBox FROM extensions WHERE tenant_id = ? ORDER BY label').all(id);
    return { tenant, numbers, extensions };
  });

  // What the connected VoIP.ms account holds, and which customer (if any) each item belongs to.
  // Used to link a test or new account's numbers and sub-accounts without retyping them.
  app.get('/api/admin/voipms/inventory', async (req, reply) => {
    if (!requireQfAdmin(req, reply)) return;
    const [dids, subs] = await Promise.all([voipms().getDIDsInfo(), voipms().getSubAccounts()]);
    const didOwner = new Map((db.prepare('SELECT did, tenant_id FROM numbers').all() as { did: string; tenant_id: number }[]).map((r) => [r.did, r.tenant_id]));
    const subOwner = new Map((db.prepare('SELECT voipms_account, tenant_id FROM extensions').all() as { voipms_account: string; tenant_id: number }[]).map((r) => [r.voipms_account, r.tenant_id]));
    return {
      numbers: dids.map((d) => ({ did: toE164(d.did), description: d.description, smsEnabled: d.sms_enabled === '1', tenantId: didOwner.get(toE164(d.did) ?? '') ?? null })),
      extensions: subs.map((s) => ({ account: s.account, description: s.description, tenantId: subOwner.get(s.account) ?? null })),
    };
  });

  app.post('/api/admin/tenants/:id/numbers', async (req, reply) => {
    if (!requireQfAdmin(req, reply)) return;
    const id = Number((req.params as { id: string }).id);
    const body = z.object({ did: z.string(), label: z.string().optional() }).parse(req.body);
    const did = toE164(body.did);
    if (!did) return reply.code(400).send({ error: 'invalid_number' });
    if (db.prepare('SELECT 1 FROM numbers WHERE did = ?').get(did)) return reply.code(409).send({ error: 'number_already_assigned' });
    db.prepare('INSERT INTO numbers (tenant_id, did, label, sms_callback_token) VALUES (?, ?, ?, ?)').run(id, did, body.label ?? null, randomToken(24));
    audit(db, { tenantId: id, userId: req.user!.id, action: 'number.linked', detail: { did } });
    return { ok: true };
  });

  app.delete('/api/admin/tenants/:id/numbers/:did', async (req, reply) => {
    if (!requireQfAdmin(req, reply)) return;
    const p = req.params as { id: string; did: string };
    db.prepare('DELETE FROM numbers WHERE tenant_id = ? AND did = ?').run(Number(p.id), p.did);
    audit(db, { tenantId: Number(p.id), userId: req.user!.id, action: 'number.unlinked', detail: { did: p.did } });
    return { ok: true };
  });

  app.post('/api/admin/tenants/:id/extensions', async (req, reply) => {
    if (!requireQfAdmin(req, reply)) return;
    const id = Number((req.params as { id: string }).id);
    const body = z.object({ account: z.string().min(1), label: z.string().min(1), voicemailBox: z.string().optional() }).parse(req.body);
    if (db.prepare('SELECT 1 FROM extensions WHERE voipms_account = ?').get(body.account)) return reply.code(409).send({ error: 'extension_already_assigned' });
    db.prepare('INSERT INTO extensions (tenant_id, voipms_account, label, voicemail_box) VALUES (?, ?, ?, ?)').run(id, body.account, body.label, body.voicemailBox || null);
    audit(db, { tenantId: id, userId: req.user!.id, action: 'extension.linked', detail: { account: body.account } });
    return { ok: true };
  });

  app.delete('/api/admin/tenants/:id/extensions/:account', async (req, reply) => {
    if (!requireQfAdmin(req, reply)) return;
    const p = req.params as { id: string; account: string };
    db.prepare('DELETE FROM extensions WHERE tenant_id = ? AND voipms_account = ?').run(Number(p.id), p.account);
    audit(db, { tenantId: Number(p.id), userId: req.user!.id, action: 'extension.unlinked', detail: { account: p.account } });
    return { ok: true };
  });

  app.patch('/api/admin/numbers/:did', async (req, reply) => {
    if (!requireQfAdmin(req, reply)) return;
    const body = z.object({ tendlcStatus: z.enum(['not_started', 'pending', 'approved', 'rejected']) }).parse(req.body);
    db.prepare('UPDATE numbers SET tendlc_status = ? WHERE did = ?').run(body.tendlcStatus, (req.params as { did: string }).did);
    return { ok: true };
  });

  app.post('/api/admin/impersonate/:id', async (req, reply) => {
    if (!requireQfAdmin(req, reply)) return;
    const tenantId = (req.params as { id: string }).id === 'none' ? null : Number((req.params as { id: string }).id);
    db.prepare('UPDATE sessions SET acting_tenant_id = ? WHERE token = ?').run(tenantId, req.cookies[SESSION_COOKIE] ?? '');
    audit(db, { tenantId, userId: req.user!.id, action: 'admin.impersonate' });
    return { ok: true };
  });
}
