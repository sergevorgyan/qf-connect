import { config } from './config.ts';
import { openDb } from './db.ts';
import { createTenant } from './routes/admin.ts';
import { saveIntegration } from './integrations/settings.ts';
import { hashPassword } from './secrets.ts';

// Mock mode: demo data that lines up with the mock VoIP.ms account (DIDs 415-555-0100/0101, sub-accounts 100001_*).
// Live mode: only the Quantum Frame admin login, from QF_ADMIN_EMAIL / QF_ADMIN_PASSWORD. Customers are added in the portal.
const db = openDb();
const env = process.env;
if (db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  console.log('database already seeded');
} else if (!config.voipms.mock) {
  if (!env.QF_ADMIN_EMAIL || !env.QF_ADMIN_PASSWORD || env.QF_ADMIN_PASSWORD.length < 12) {
    console.error('Live VoIP.ms mode: set QF_ADMIN_EMAIL and QF_ADMIN_PASSWORD (12+ characters) in .env, then run again.');
    process.exit(1);
  }
  db.prepare(`INSERT INTO users (tenant_id, email, name, role, password_hash) VALUES (NULL, ?, 'Quantum Frame Admin', 'qf_admin', ?)`).run(env.QF_ADMIN_EMAIL.toLowerCase(), hashPassword(env.QF_ADMIN_PASSWORD));
  console.log(`seeded admin login ${env.QF_ADMIN_EMAIL}; add customers under Customers`);
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
