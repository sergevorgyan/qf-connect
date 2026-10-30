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

// The last few calls and what happened to each in HubSpot, so customers can see logging is working.
// Calls older than the worker's 2-day window that were never sent are left out.
function recentCrmCalls(db: DB, tenantId: number, logMissed: boolean) {
  const rows = db.prepare(`SELECT direction, disposition, from_number AS fromNumber, to_number AS toNumber, started_at AS startedAt,
      crm_logged_at AS loggedAt, crm_error AS error FROM calls
    WHERE tenant_id = ? AND (crm_logged_at IS NOT NULL OR crm_error IS NOT NULL OR started_at > ?) ORDER BY started_at DESC LIMIT 5`)
    .all(tenantId, new Date(Date.now() - 2 * 86_400_000).toISOString()) as { direction: string; disposition: string; fromNumber: string | null; toNumber: string | null; startedAt: string; loggedAt: string | null; error: string | null }[];
  return rows.map(({ loggedAt, error, ...c }) => {
    const missed = c.direction === 'inbound' && c.disposition !== 'ANSWERED';
    const status = error ? 'error' : !loggedAt ? 'pending' : missed && !logMissed ? 'skipped' : 'sent';
    return { ...c, missed, status, at: loggedAt };
  });
}

export function integrationRoutes(app: FastifyInstance, db: DB) {
  app.get('/api/integrations', async (req, reply) => {
    const t = requireTenant(req, reply); if (t == null) return;
    const tb = getIntegration(db, t, 'textback', textbackSettings);
    const hs = getIntegration(db, t, 'hubspot', hubspotSettings);
    const numbers = db.prepare('SELECT did, tendlc_status AS tendlcStatus FROM numbers WHERE tenant_id = ?').all(t);
    return {
      textback: { enabled: tb.enabled, settings: tb.settings, numbers },
      hubspot: { enabled: hs.enabled, connected: !!hs.secret, configured: !!config.hubspot.clientId, settings: hs.settings, recent: hs.secret ? recentCrmCalls(db, t, hs.settings.logMissed) : [] },
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
