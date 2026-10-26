import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadOwnership, normalizeCdr, syncCalls } from '../src/calls.ts';
import { parseCallerId } from '../src/phone.ts';
import { MockVoipMs } from '../src/voipms/mock.ts';
import { seededDb } from './helpers.ts';

test('parses VoIP.ms caller ID formats', () => {
  assert.deepEqual(parseCallerId('"MARIA LOPEZ" <4155557788>'), { name: 'MARIA LOPEZ', number: '+14155557788' });
  assert.deepEqual(parseCallerId('15105559876'), { name: null, number: '+15105559876' });
  assert.deepEqual(parseCallerId('Anonymous'), { name: null, number: null });
});

test('routes CDRs to the tenant that owns the DID or sub-account', () => {
  const { db, bay, acme } = seededDb();
  const own = loadOwnership(db);
  const rec = { date: '2026-10-26 17:00:00', callerid: '4085554321', destination: '5105550200', description: 'Inbound DID', account: '100001_acme', disposition: 'NO ANSWER', seconds: '0', uniqueid: 'u1' };
  assert.equal(normalizeCdr(rec, own)?.tenantId, acme);
  assert.equal(normalizeCdr(rec, own)?.direction, 'inbound');
  const out = normalizeCdr({ ...rec, destination: '2125550000', account: '100001_frontdesk', callerid: '4155550100' }, own);
  assert.equal(out?.tenantId, bay);
  assert.equal(out?.direction, 'outbound');
  assert.equal(normalizeCdr({ ...rec, destination: '2125550000', account: 'someone_else' }, own), null);
});

test('sync is idempotent', async () => {
  const { db } = seededDb();
  const api = new MockVoipMs();
  const first = await syncCalls(db, api);
  assert.ok(first.length > 20);
  const second = await syncCalls(db, api);
  assert.equal(second.length, 1); // the mock adds one new call per poll
});
