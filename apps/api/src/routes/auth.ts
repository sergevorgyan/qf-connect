import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createSession, SESSION_COOKIE } from '../auth.ts';
import { audit, type DB } from '../db.ts';
import { verifyPassword } from '../secrets.ts';
import { config } from '../config.ts';

export function authRoutes(app: FastifyInstance, db: DB) {
  app.post('/api/auth/login', async (req, reply) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    const user = db.prepare('SELECT id, tenant_id, password_hash FROM users WHERE email = ?').get(body.email.toLowerCase()) as
      { id: number; tenant_id: number | null; password_hash: string } | undefined;
    if (!user || !verifyPassword(body.password, user.password_hash)) return reply.code(401).send({ error: 'invalid_credentials' });
    const { token, expires } = createSession(db, user.id, user.tenant_id);
    audit(db, { tenantId: user.tenant_id, userId: user.id, action: 'auth.login' });
    reply.setCookie(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', secure: config.publicUrl.startsWith('https'), expires: new Date(expires) });
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'unauthorized' });
    const tenant = req.user.tenantId ? db.prepare('SELECT id, name, brand_color AS brandColor, timezone FROM tenants WHERE id = ?').get(req.user.tenantId) : null;
    return { user: req.user, tenant };
  });
}
