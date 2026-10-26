import type { DB } from './db.ts';

export function tenantOwnsDid(db: DB, tenantId: number, did: string) {
  return !!db.prepare('SELECT 1 FROM numbers WHERE tenant_id = ? AND did = ?').get(tenantId, did);
}

export function tenantMailboxes(db: DB, tenantId: number): string[] {
  return (db.prepare('SELECT voicemail_box FROM extensions WHERE tenant_id = ? AND voicemail_box IS NOT NULL').all(tenantId) as { voicemail_box: string }[])
    .map((r) => r.voicemail_box);
}

export function tenantOwnsMailbox(db: DB, tenantId: number, mailbox: string) {
  return tenantMailboxes(db, tenantId).includes(mailbox);
}
