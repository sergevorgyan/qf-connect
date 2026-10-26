import { openDb } from '../src/db.ts';
import { createTenant } from '../src/routes/admin.ts';
import { hashPassword } from '../src/secrets.ts';

export function seededDb() {
  const db = openDb(':memory:');
  db.prepare(`INSERT INTO users (tenant_id, email, name, role, password_hash) VALUES (NULL, 'admin@qf.test', 'Admin', 'qf_admin', ?)`).run(hashPassword('admin-password'));
  const bay = createTenant(db, {
    name: 'Bay Dental',
    admin: { name: 'Dana', email: 'dana@bay.test', password: 'dana-password' },
    numbers: [{ did: '4155550100' }, { did: '4155550101' }],
    extensions: [{ account: '100001_frontdesk', label: 'Front desk', voicemailBox: '1001' }],
  });
  const acme = createTenant(db, {
    name: 'Acme Plumbing',
    admin: { name: 'Ari', email: 'ari@acme.test', password: 'ari-password1' },
    numbers: [{ did: '5105550200' }],
    extensions: [{ account: '100001_acme', label: 'Office', voicemailBox: '2001' }],
  });
  db.prepare(`UPDATE numbers SET tendlc_status = 'approved'`).run();
  return { db, bay, acme };
}
