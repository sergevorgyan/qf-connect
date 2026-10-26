import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { loadSession, SESSION_COOKIE } from './auth.ts';
import { config } from './config.ts';
import type { DB } from './db.ts';
import { adminRoutes } from './routes/admin.ts';
import { authRoutes } from './routes/auth.ts';
import { integrationRoutes } from './routes/integrations.ts';
import { portalRoutes } from './routes/portal.ts';
import { webhookRoutes } from './routes/webhooks.ts';
import { VoipMsError } from './voipms/types.ts';

export async function buildServer(db: DB, opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: true });
  await app.register(cookie);

  app.addHook('onRequest', async (req) => {
    req.user = loadSession(db, req.cookies[SESSION_COOKIE]);
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: 'invalid_request', issues: err.issues });
    if (err instanceof VoipMsError) {
      req.log.error({ method: err.method, status: err.status }, 'voip.ms error');
      return reply.code(502).send({ error: 'voipms_error', status: err.status });
    }
    req.log.error(err);
    return reply.code(500).send({ error: 'internal_error' });
  });

  app.get('/healthz', async () => ({ ok: true }));
  authRoutes(app, db);
  portalRoutes(app, db);
  integrationRoutes(app, db);
  adminRoutes(app, db, config.publicUrl);
  webhookRoutes(app, db);

  // In production the API also serves the built portal, so one origin carries cookies and API calls.
  const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url));
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api/') ? reply.code(404).send({ error: 'not_found' }) : reply.sendFile('index.html')));
  }
  return app;
}
