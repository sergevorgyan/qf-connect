import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildServer } from '../src/server.ts';
import { saveIntegration } from '../src/integrations/settings.ts';
import { encrypt } from '../src/secrets.ts';
import { setVoipMs } from '../src/voipms/client.ts';
import { MockVoipMs } from '../src/voipms/mock.ts';
import { runOnce } from '../src/worker.ts';
import { seededDb } from './helpers.ts';

async function login(app: Awaited<ReturnType<typeof buildServer>>, email: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  assert.equal(res.statusCode, 200);
  const cookie = res.cookies.find((c) => c.name === 'qf_session')!;
  return { cookie: `qf_session=${cookie.value}` };
}

test('login and tenant isolation', async () => {
  const { db } = seededDb();
  const api = new MockVoipMs();
  setVoipMs(api);
  await runOnce(db, api);
  const app = await buildServer(db);

  assert.equal((await app.inject({ url: '/api/calls' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'dana@bay.test', password: 'wrong' } })).statusCode, 401);

  const dana = await login(app, 'dana@bay.test', 'dana-password');
  const calls = (await app.inject({ url: '/api/calls', headers: dana })).json() as { did: string }[];
  assert.ok(calls.length > 0);
  assert.ok(calls.every((c) => ['+14155550100', '+14155550101'].includes(c.did)));

  // Dana can't send from or read another tenant's number or mailbox.
  const send = await app.inject({ method: 'POST', url: '/api/sms/send', headers: dana, payload: { did: '+15105550200', to: '4155551111', body: 'hi' } });
  assert.equal(send.statusCode, 404);
  assert.equal((await app.inject({ url: '/api/voicemails/2001/INBOX/1/audio', headers: dana })).statusCode, 404);
  assert.equal((await app.inject({ url: '/api/admin/tenants', headers: dana })).statusCode, 403);

  const ok = await app.inject({ method: 'POST', url: '/api/sms/send', headers: dana, payload: { did: '+14155550100', to: '(415) 555-1111', body: 'hi' } });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(api.sent.at(-1), { did: '4155550100', dst: '4155551111', message: 'hi' });
});

test('missed call gets one text back, and a reply is tracked', async () => {
  const { db, bay } = seededDb();
  saveIntegration(db, bay, 'textback', { enabled: true, settings: {} });
  const api = new MockVoipMs(new Date(Date.now() - 86_400_000)); // history is old: no texts for it
  setVoipMs(api);
  const app = await buildServer(db);

  // Advance the mock until the newest call is a missed one.
  let texted = 0;
  for (let i = 0; i < 5 && texted === 0; i++) texted = (await runOnce(db, api)).texted;
  assert.equal(texted, 1);
  const text = api.sent.at(-1)!;
  assert.match(text.message, /Bay Dental/);

  const token = (db.prepare('SELECT sms_callback_token AS t FROM numbers WHERE did = ?').get(`+1${text.did}`) as { t: string }).t;
  const hook = await app.inject({ url: `/webhooks/voipms/sms/${token}?id=777&from=${text.dst}&to=${text.did}&message=Can%20I%20book%20Friday%3F` });
  assert.equal(hook.body, 'ok');
  const ev = db.prepare('SELECT replied_at FROM textback_events WHERE outcome = ?').get('sent') as { replied_at: string | null };
  assert.ok(ev.replied_at);

  // STOP opts the caller out of future sends.
  await app.inject({ url: `/webhooks/voipms/sms/${token}?id=778&from=${text.dst}&to=${text.did}&message=STOP` });
  const dana = await login(app, 'dana@bay.test', 'dana-password');
  const res = await app.inject({ method: 'POST', url: '/api/sms/send', headers: dana, payload: { did: `+1${text.did}`, to: text.dst, body: 'hello?' } });
  assert.equal(res.statusCode, 409);

  assert.equal((await app.inject({ url: '/webhooks/voipms/sms/not-a-token?from=1&to=2' })).statusCode, 404);
});

test('calls are logged to HubSpot once, matched to the contact', async () => {
  const { db, bay } = seededDb();
  saveIntegration(db, bay, 'hubspot', { enabled: true, settings: {}, secret: encrypt(JSON.stringify({ access_token: 'tok', refresh_token: 'r', expires_at: Date.now() + 3_600_000 })) });
  const requests: { url: string; body: any }[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    requests.push({ url, body });
    if (url.endsWith('/contacts/search')) return new Response(JSON.stringify({ results: [{ id: 'c42' }] }));
    return new Response(JSON.stringify({ id: 'call1' }));
  }) as typeof fetch;

  const api = new MockVoipMs(new Date(Date.now() - 3_600_000));
  const first = await runOnce(db, api, fakeFetch);
  assert.ok(first.logged > 0);
  const created = requests.filter((r) => r.url.endsWith('/crm/v3/objects/calls'));
  assert.equal(created.length, first.logged);
  assert.equal(created[0].body.associations[0].to.id, 'c42');
  assert.ok(['INBOUND', 'OUTBOUND'].includes(created[0].body.properties.hs_call_direction));

  const second = await runOnce(db, api, fakeFetch);
  assert.equal(second.logged, 1); // only the newly polled call
});

test('QF admin links a VoIP.ms number to a customer and unlinks it', async () => {
  const { db, acme } = seededDb();
  setVoipMs(new MockVoipMs());
  const app = await buildServer(db);
  const admin = await login(app, 'admin@qf.test', 'admin-password');

  const inv = (await app.inject({ url: '/api/admin/voipms/inventory', headers: admin })).json() as { numbers: { did: string; tenantId: number | null }[] };
  assert.ok(inv.numbers.filter((n) => n.did !== '+14155550199').every((n) => n.tenantId !== null)); // seed links both Bay DIDs; the cafe's is a reseller client's

  const linked = await app.inject({ method: 'POST', url: `/api/admin/tenants/${acme}/numbers`, headers: admin, payload: { did: '4155550100' } });
  assert.equal(linked.statusCode, 409); // one number, one customer

  await app.inject({ method: 'DELETE', url: '/api/admin/tenants/1/numbers/%2B14155550100', headers: admin });
  const ok = await app.inject({ method: 'POST', url: `/api/admin/tenants/${acme}/numbers`, headers: admin, payload: { did: '4155550100', label: 'Test line' } });
  assert.equal(ok.statusCode, 200);
  const detail = (await app.inject({ url: `/api/admin/tenants/${acme}`, headers: admin })).json() as { numbers: { did: string; smsCallbackUrl: string }[] };
  assert.ok(detail.numbers.some((n) => n.did === '+14155550100' && n.smsCallbackUrl.includes('/webhooks/voipms/sms/')));

  const dana = await login(app, 'dana@bay.test', 'dana-password');
  assert.equal((await app.inject({ url: '/api/admin/voipms/inventory', headers: dana })).statusCode, 403);
});

test('QF admin upgrades a basic reseller client to the VIP portal', async () => {
  const { db, acme } = seededDb();
  setVoipMs(new MockVoipMs());
  const app = await buildServer(db);
  const admin = await login(app, 'admin@qf.test', 'admin-password');

  const inv = (await app.inject({ url: '/api/admin/voipms/inventory', headers: admin })).json() as { clients: { id: string; name: string; tenantId: number | null }[] };
  assert.deepEqual(inv.clients, [{ id: '50001', name: 'Corner Cafe', email: 'owner@cornercafe.example', tenantId: null }]);

  const noClient = await app.inject({ method: 'POST', url: `/api/admin/tenants/${acme}/voipms-client/link-items`, headers: admin });
  assert.equal(noClient.statusCode, 400);

  assert.equal((await app.inject({ method: 'PUT', url: `/api/admin/tenants/${acme}/voipms-client`, headers: admin, payload: { clientId: '50001' } })).statusCode, 200);
  assert.equal((await app.inject({ method: 'PUT', url: '/api/admin/tenants/1/voipms-client', headers: admin, payload: { clientId: '50001' } })).statusCode, 409); // one client, one customer

  const linked = (await app.inject({ method: 'POST', url: `/api/admin/tenants/${acme}/voipms-client/link-items`, headers: admin })).json();
  assert.deepEqual(linked, { numbers: ['+14155550199'], extensions: ['100001_cafe'], skipped: [] });
  const again = (await app.inject({ method: 'POST', url: `/api/admin/tenants/${acme}/voipms-client/link-items`, headers: admin })).json();
  assert.deepEqual(again, { numbers: [], extensions: [], skipped: [] }); // safe to run twice

  const detail = (await app.inject({ url: `/api/admin/tenants/${acme}`, headers: admin })).json() as { tenant: { voipmsClientId: string }; extensions: { account: string; voicemailBox: string | null }[] };
  assert.equal(detail.tenant.voipmsClientId, '50001');
  assert.equal(detail.extensions.find((e) => e.account === '100001_cafe')?.voicemailBox, '3001'); // from the DID's failover
});
