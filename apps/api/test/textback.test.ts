import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decideTextback, isBusinessHours, renderTemplate, type TextbackContext } from '../src/integrations/textback.ts';
import { textbackSettings } from '../src/integrations/settings.ts';

const now = new Date('2026-10-27T18:00:00Z'); // Tuesday 11:00 in Los Angeles
const base: TextbackContext = {
  call: { direction: 'inbound', disposition: 'NO ANSWER', fromNumber: '+14155557788', did: '+14155550100', startedAt: new Date(now.getTime() - 60_000).toISOString() },
  settings: textbackSettings.parse({}),
  timezone: 'America/Los_Angeles',
  now,
  didApproved: true,
  optedOut: false,
  lastTextedAt: null,
};
const withCall = (c: Partial<TextbackContext['call']>) => ({ ...base, call: { ...base.call, ...c } });

test('texts back a fresh missed inbound call', () => {
  assert.deepEqual(decideTextback(base), { send: true });
  assert.deepEqual(decideTextback(withCall({ disposition: 'BUSY' })), { send: true });
});

test('skips with a reason for each guard', () => {
  const cases: [Partial<TextbackContext>, string][] = [
    [withCall({ direction: 'outbound' }), 'not_inbound'],
    [withCall({ disposition: 'ANSWERED' }), 'answered'],
    [withCall({ fromNumber: null }), 'no_caller_id'],
    [{ didApproved: false }, '10dlc_not_approved'],
    [{ optedOut: true }, 'opted_out'],
    [withCall({ startedAt: new Date(now.getTime() - 30 * 60_000).toISOString() }), 'too_old'],
    [{ lastTextedAt: new Date(now.getTime() - 3_600_000) }, 'cooldown'],
    [{ settings: textbackSettings.parse({ when: 'after_hours' }) }, 'business_hours'],
  ];
  for (const [patch, reason] of cases) assert.deepEqual(decideTextback({ ...base, ...patch }), { send: false, reason });
});

test('cooldown expires', () => {
  assert.deepEqual(decideTextback({ ...base, lastTextedAt: new Date(now.getTime() - 13 * 3_600_000) }), { send: true });
});

test('business hours use the tenant timezone', () => {
  const hours = { days: [1, 2, 3, 4, 5], start: '08:00', end: '17:00' };
  assert.equal(isBusinessHours(now, 'America/Los_Angeles', hours), true);
  assert.equal(isBusinessHours(new Date('2026-10-28T02:00:00Z'), 'America/Los_Angeles', hours), false); // Tue 19:00 PT
  assert.equal(isBusinessHours(new Date('2026-10-25T18:00:00Z'), 'America/Los_Angeles', hours), false); // Sunday
});

test('renders known variables and leaves unknown ones', () => {
  assert.equal(renderTemplate('Hi from {business} {nope}', { business: 'Bay Dental' }), 'Hi from Bay Dental {nope}');
});
