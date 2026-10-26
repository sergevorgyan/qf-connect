import { openDb } from './db.ts';
import { createTenant } from './routes/admin.ts';
import { saveIntegration } from './integrations/settings.ts';
import { hashPassword } from './secrets.ts';

// Demo data that lines up with the mock VoIP.ms account (DIDs 415-555-0100/0101, sub-accounts 100001_*).
const db = openDb();
if (db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  console.log('database already seeded');
} else {
  db.prepare(`INSERT INTO users (tenant_id, email, name, role, password_hash) VALUES (NULL, 'admin@quantumframe.com', 'Quantum Frame Admin', 'qf_admin', ?)`).run(hashPassword('change-me-now'));
  const tenantId = createTenant(db, {
    name: 'Bay Dental',
    admin: { name: 'Dana Park', email: 'dana@baydental.example', password: 'demo-password' },
    numbers: [{ did: '4155550100', label: 'Main line' }, { did: '4155550101', label: 'Billing' }],
    extensions: [
      { account: '100001_frontdesk', label: 'Front desk', voicemailBox: '1001' },
      { account: '100001_drkim', label: 'Dr. Kim', voicemailBox: '1002' },
    ],
  });
  db.prepare(`UPDATE numbers SET tendlc_status = 'approved' WHERE tenant_id = ?`).run(tenantId);
  saveIntegration(db, tenantId, 'textback', { enabled: true, settings: {} });
  console.log('seeded: admin@quantumframe.com / change-me-now, dana@baydental.example / demo-password');
}
