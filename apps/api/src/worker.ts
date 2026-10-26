import { config } from './config.ts';
import { openDb, type DB } from './db.ts';
import { syncCalls } from './calls.ts';
import { logPendingCalls } from './integrations/hubspot.ts';
import { processTextback } from './integrations/textback.ts';
import { voipms } from './voipms/client.ts';
import type { VoipMs } from './voipms/types.ts';

// One pass: pull new CDRs, text back missed callers, then push calls to CRMs.
// Postgres + pg-boss replaces this loop in production; the steps stay the same.
export async function runOnce(db: DB, api: VoipMs, fetchImpl: typeof fetch = fetch) {
  const fresh = await syncCalls(db, api);
  let texted = 0;
  for (const id of fresh) {
    try {
      const d = await processTextback(db, api, id);
      if (d?.send) texted++;
    } catch (err) {
      console.error(`textback failed for call ${id}:`, (err as Error).message);
    }
  }
  const logged = await logPendingCalls(db, fetchImpl);
  return { newCalls: fresh.length, texted, logged };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const db = openDb();
  const tick = async () => {
    try {
      const r = await runOnce(db, voipms());
      console.log(new Date().toISOString(), r);
    } catch (err) {
      console.error('worker pass failed:', (err as Error).message);
    }
  };
  console.log(`worker polling every ${config.cdrPollSeconds}s (${config.voipms.mock ? 'mock VoIP.ms' : 'live VoIP.ms'})`);
  await tick();
  setInterval(tick, config.cdrPollSeconds * 1000);
}
