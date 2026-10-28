import assert from 'node:assert/strict';
import { test } from 'node:test';
import { wallClockToIso } from '../src/time.ts';
import { parseCallerId } from '../src/phone.ts';

test('VoIP.ms Eastern wall-clock times convert to UTC across daylight saving', () => {
  // Real call: placed 20:52 UTC on 28 Oct 2026, reported by getCDR timezone=-5 as 16:52:36.
  assert.equal(wallClockToIso('2026-10-28 16:52:36', 'America/New_York'), '2026-10-28T20:52:36.000Z');
  assert.equal(wallClockToIso('2026-12-01 09:00:00', 'America/New_York'), '2026-12-01T14:00:00.000Z');
  assert.equal(wallClockToIso('2026-07-01 09:00:00', 'America/Los_Angeles'), '2026-07-01T16:00:00.000Z');
});

test('voicemail caller ID that repeats the number has no name', () => {
  assert.deepEqual(parseCallerId('2672622465 <2672622465>'), { name: null, number: '+12672622465' });
});
