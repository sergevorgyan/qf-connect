import type { FastifyReply, FastifyRequest } from 'fastify';
import type { DB } from './db.ts';
import { randomToken } from './secrets.ts';

export type Role = 'qf_admin' | 'tenant_admin' | 'staff';
export interface SessionUser { id: number; email: string; name: string; role: Role; tenantId: number | null }

export const SESSION_COOKIE = 'qf_session';
const SESSION_DAYS = 14;

declare module 'fastify' {
  interface FastifyRequest { user?: SessionUser }
}

export function createSession(db: DB, userId: number, actingTenantId: number | null) {
  const token = randomToken(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, acting_tenant_id, expires_at) VALUES (?, ?, ?, ?)').run(token, userId, actingTenantId, expires);
  return { token, expires };
}

export function loadSession(db: DB, token: string | undefined): SessionUser | undefined {
  if (!token) return undefined;
  const row = db.prepare(`SELECT u.id, u.email, u.name, u.role, s.acting_tenant_id AS tenantId FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > ?`).get(token, new Date().toISOString()) as SessionUser | undefined;
  return row ? { ...row } : undefined;
}

// Every tenant-scoped route goes through this: it returns the tenant the caller is acting for,
// or answers 401/403 itself. QF admins act for a tenant only after choosing one (audited).
export function requireTenant(req: FastifyRequest, reply: FastifyReply, roles: Role[] = ['qf_admin', 'tenant_admin', 'staff']): number | null {
  if (!req.user) { reply.code(401).send({ error: 'unauthorized' }); return null; }
  if (!roles.includes(req.user.role)) { reply.code(403).send({ error: 'forbidden' }); return null; }
  if (req.user.tenantId == null) { reply.code(400).send({ error: 'choose_tenant' }); return null; }
  return req.user.tenantId;
}

export function requireQfAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
  if (req.user?.role === 'qf_admin') return true;
  reply.code(req.user ? 403 : 401).send({ error: req.user ? 'forbidden' : 'unauthorized' });
  return false;
}
