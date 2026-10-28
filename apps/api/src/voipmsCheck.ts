import { config } from './config.ts';
import { openDb } from './db.ts';
import { toE164 } from './phone.ts';
import { HttpVoipMs } from './voipms/client.ts';
import { VoipMsError } from './voipms/types.ts';

// `npm run voipms:check` - confirms the VoIP.ms credentials in .env work from this machine and lists
// the account's numbers and sub-accounts, marking which ones the portal already manages.
// It only reads; it never changes anything in VoIP.ms. The password is never printed.
const { username, password } = config.voipms;
if (!username || !password) {
  console.error('Set VOIPMS_API_USERNAME and VOIPMS_API_PASSWORD in .env first.');
  process.exit(1);
}
const api = new HttpVoipMs(username, password);
const db = openDb();
const managedDids = new Map((db.prepare('SELECT n.did, t.name FROM numbers n JOIN tenants t ON t.id = n.tenant_id').all() as { did: string; name: string }[]).map((r) => [r.did, r.name]));
const managedAccounts = new Map((db.prepare('SELECT e.voipms_account AS a, t.name FROM extensions e JOIN tenants t ON t.id = e.tenant_id').all() as { a: string; name: string }[]).map((r) => [r.a, r.name]));

console.log(`VoIP.ms account: ${username}`);
const ip = await api.getIP();
console.log(`This machine reaches VoIP.ms from IP ${ip}. Whitelist exactly this IP in the VoIP.ms API settings.`);

try {
  console.log(`Balance: $${await api.getBalance()}`);
} catch (err) {
  if (err instanceof VoipMsError && /ip/.test(err.status)) {
    console.error(`\nVoIP.ms refused this IP (${err.status}). Add ${ip} under Main Menu > SOAP & REST/JSON API > Enabled IP Addresses, save, wait a few minutes, and run this again.`);
  } else if (err instanceof VoipMsError) {
    console.error(`\nVoIP.ms said "${err.status}". Check the API is enabled and the API password (not your login password) is right.`);
  } else throw err;
  process.exit(1);
}

const dids = await api.getDIDsInfo();
console.log(`\nNumbers (${dids.length}):`);
for (const d of dids) {
  const owner = managedDids.get(toE164(d.did) ?? '');
  console.log(`  ${d.did}  ${d.description || '-'}  sms:${d.sms_enabled === '1' ? 'on' : 'off'}  ${owner ? `-> ${owner}` : '(not in portal)'}`);
}
const subs = await api.getSubAccounts();
console.log(`\nSub-accounts (${subs.length}):`);
for (const s of subs) console.log(`  ${s.account}  ${s.description || '-'}  ${managedAccounts.get(s.account) ? `-> ${managedAccounts.get(s.account)}` : '(not in portal)'}`);
console.log('\nThe portal and worker only touch numbers and sub-accounts linked to a customer. Everything marked "(not in portal)" is ignored.');
