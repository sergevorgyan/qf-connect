import { z } from 'zod';
import type { DB } from '../db.ts';

export const textbackSettings = z.object({
  template: z.string().min(10).max(320).default("Sorry we missed your call! This is {business}. Reply here and we'll get right back to you."),
  when: z.enum(['always', 'after_hours', 'business_hours']).default('always'),
  businessHours: z.object({
    days: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
    start: z.string().regex(/^\d{2}:\d{2}$/).default('08:00'),
    end: z.string().regex(/^\d{2}:\d{2}$/).default('17:00'),
  }).default({}),
  cooldownHours: z.number().min(1).max(168).default(12),
  // Skip calls older than this, so a worker outage doesn't text a backlog of stale callers.
  maxAgeMinutes: z.number().min(1).max(120).default(15),
});
export type TextbackSettings = z.infer<typeof textbackSettings>;

export const hubspotSettings = z.object({
  logMissed: z.boolean().default(true),
  createUnknownContacts: z.boolean().default(false),
});
export type HubspotSettings = z.infer<typeof hubspotSettings>;

interface IntegrationRow { enabled: number; settings: string; secret: string | null }

export function getIntegration<T extends z.ZodTypeAny>(db: DB, tenantId: number, type: 'textback' | 'hubspot', schema: T) {
  const row = db.prepare('SELECT enabled, settings, secret FROM integrations WHERE tenant_id = ? AND type = ?').get(tenantId, type) as IntegrationRow | undefined;
  return {
    enabled: !!row?.enabled,
    settings: schema.parse(row ? JSON.parse(row.settings) : {}) as z.infer<T>,
    secret: row?.secret ?? null,
  };
}

export function saveIntegration(db: DB, tenantId: number, type: 'textback' | 'hubspot', patch: { enabled?: boolean; settings?: unknown; secret?: string | null }) {
  db.prepare(`INSERT INTO integrations (tenant_id, type) VALUES (?, ?) ON CONFLICT (tenant_id, type) DO NOTHING`).run(tenantId, type);
  if (patch.enabled !== undefined) db.prepare('UPDATE integrations SET enabled = ? WHERE tenant_id = ? AND type = ?').run(patch.enabled ? 1 : 0, tenantId, type);
  if (patch.settings !== undefined) db.prepare('UPDATE integrations SET settings = ? WHERE tenant_id = ? AND type = ?').run(JSON.stringify(patch.settings), tenantId, type);
  if (patch.secret !== undefined) db.prepare('UPDATE integrations SET secret = ? WHERE tenant_id = ? AND type = ?').run(patch.secret, tenantId, type);
}
