import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireTenant } from '../auth.ts';
import { config } from '../config.ts';
import { audit, type DB } from '../db.ts';
import { authorizeUrl, connectHubspot } from '../integrations/hubspot.ts';
import { getIntegration, hubspotSettings, saveIntegration, textbackSettings } from '../integrations/settings.ts';
import { randomToken } from '../secrets.ts';

function sign(value: string) {
  return createHmac('sha256', config.sessionSecret).update(value).digest('base64url');
}

// What call logging has been doing, so customers can see it working: the last few calls and their
// status, when a call was last sent, and recent failures. Calls the worker will never send
// (older than its 2-day window) are left out of the list.
function crmActivity(db: DB, tenantId: number) {
  const since = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const rows = db.prepare(`SELECT direction, disposition, from_number AS fromNumber, to_number AS toNumber, started_at AS startedAt,
      crm_logged_at AS loggedAt, crm_error AS error FROM calls
    WHERE tenant_id = ? AND (crm_logged_at IS NOT NULL OR crm_error IS NOT NULL OR started_at > ?) ORDER BY started_at DESC LIMIT 5`)
    .all(tenantId, since) as { direction: string; disposition: string; fromNumber: string | null; toNumber: string | null; startedAt: string; loggedAt: string | null; error: string | null }[];
  const recent = rows.map(({ loggedAt, error, ...c }) => ({
    ...c,
    missed: c.direction === 'inbound' && c.disposition !== 'ANSWERED',
    status: error === 'skipped' ? 'skipped' : error ? 'error' : loggedAt ? 'sent' : 'pending',
  }));
  const { last } = db.prepare('SELECT MAX(crm_logged_at) AS last FROM calls WHERE tenant_id = ?').get(tenantId) as { last: string | null };
  const failed = db.prepare(`SELECT COUNT(*) AS n, MAX(crm_error) AS latest FROM calls WHERE tenant_id = ? AND crm_error IS NOT NULL AND crm_error <> 'skipped' AND started_at > ?`)
    .get(tenantId, since) as { n: number; latest: string | null };
  return { recent, lastSyncedAt: last, failures: { count: failed.n, latest: failed.latest } };
}

export function integrationRoutes(app: FastifyInstance, db: DB) {
  app.get('/api/integrations', async (req, reply) => {
    const t = requireTenant(req, reply); if (t == null) return;
    const tb = getIntegration(db, t, 'textback', textbackSettings);
    const hs = getIntegration(db, t, 'hubspot', hubspotSettings);
    const numbers = db.prepare('SELECT did, tendlc_status AS tendlcStatus FROM numbers WHERE tenant_id = ?').all(t);
    return {
      textback: { enabled: tb.enabled, settings: tb.settings, numbers },
      hubspot: { enabled: hs.enabled, connected: !!hs.secret, configured: !!config.hubspot.clientId, settings: hs.settings, activity: hs.secret ? crmActivity(db, t) : null },
    };
  });

  app.put('/api/integrations/textback', async (req, reply) => {
    const t = requireTenant(req, reply, ['qf_admin', 'tenant_admin']); if (t == null) return;
    const body = z.object({ enabled: z.boolean(), settings: textbackSettings }).parse(req.body);
    saveIntegration(db, t, 'textback', body);
    audit(db, { tenantId: t, userId: req.user!.id, action: 'textback.updated', detail: body });
    return { ok: true };
  });

  app.put('/api/integrations/hubspot', async (req, reply) => {
    const t = requireTenant(req, reply, ['qf_admin', 'tenant_admin']); if (t == null) return;
    const body = z.object({ enabled: z.boolean(), settings: hubspotSettings }).parse(req.body);
    saveIntegration(db, t, 'hubspot', body);
    return { ok: true };
  });

  app.delete('/api/integrations/hubspot', async (req, reply) => {
    const t = requireTenant(req, reply, ['qf_admin', 'tenant_admin']); if (t == null) return;
    saveIntegration(db, t, 'hubspot', { enabled: false, secret: null });
    audit(db, { tenantId: t, userId: req.user!.id, action: 'hubspot.disconnected' });
    return { ok: true };
  });

  app.get('/api/integrations/hubspot/connect', async (req, reply) => {
    const t = requireTenant(req, reply, ['qf_admin', 'tenant_admin']); if (t == null) return;
    if (!config.hubspot.clientId) return reply.code(503).send({ error: 'hubspot_not_configured' });
    const nonce = randomToken(12);
    return { url: authorizeUrl(t, `${nonce}.${sign(`${t}.${nonce}`)}`) };
  });

  app.get('/api/integrations/hubspot/callback', async (req, reply) => {
    // HubSpot sends ?error=... instead of a code when the user cancels or the app config is wrong.
    const parsed = z.object({ code: z.string(), state: z.string() }).safeParse(req.query);
    if (!parsed.success) {
      req.log.warn({ query: req.query }, 'hubspot oauth callback without code');
      return reply.redirect('/integrations?hubspot=error');
    }
    const q = parsed.data;
    const [tenant, nonce, sig] = q.state.split('.');
    const expected = sign(`${tenant}.${nonce}`);
    if (!sig || sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return reply.code(400).send({ error: 'bad_state' });
    // The browser must also be signed in to that tenant, so a leaked link can't connect someone else's CRM.
    if (req.user?.tenantId !== Number(tenant)) return reply.code(403).send({ error: 'forbidden' });
    try {
      await connectHubspot(db, Number(tenant), q.code);
    } catch (err) {
      req.log.error({ err }, 'hubspot token exchange failed');
      return reply.redirect('/integrations?hubspot=error');
    }
    return reply.redirect('/integrations?hubspot=connected');
  });
}
