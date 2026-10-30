import { openDb } from './db.ts';
import { HubSpotClient } from './integrations/hubspot.ts';
import { toE164 } from './phone.ts';

// `npm run hubspot:check -- 2672622465` - for each customer connected to HubSpot, shows how HubSpot
// stores contact phones, whether the given number matches a contact, and where the last calls went.
// Read-only. Prints no tokens.
const number = toE164(process.argv[2] ?? '');
const db = openDb();
const tenants = db.prepare(`SELECT t.id, t.name FROM integrations i JOIN tenants t ON t.id = i.tenant_id
  WHERE i.type = 'hubspot' AND i.secret IS NOT NULL`).all() as { id: number; name: string }[];
if (!tenants.length) console.log('No customer is connected to HubSpot.');

type Page = { results: { id: string; properties: Record<string, string | null> }[] };
for (const t of tenants) {
  console.log(`\n== ${t.name} ==`);
  const hs = new HubSpotClient(db, t.id);
  const props = ['firstname', 'lastname', 'phone', 'mobilephone', 'hs_searchable_calculated_phone_number', 'hs_searchable_calculated_mobile_number'];
  const contacts = await hs.request<Page>(`/crm/v3/objects/contacts?limit=5&properties=${props.join(',')}`);
  console.log('Contacts (first 5):');
  for (const c of contacts.results) console.log(`  ${c.id}  ${props.map((p) => `${p}=${c.properties[p] ?? ''}`).join('  ')}`);
  if (number) console.log(`Match for ${number}: ${(await hs.findContactByPhone(number)) ?? 'none'}`);
  const calls = await hs.request<Page>('/crm/v3/objects/calls?limit=5&properties=hs_call_title,hs_timestamp&associations=contacts');
  console.log('Calls (first 5):');
  for (const c of calls.results as (Page['results'][number] & { associations?: { contacts?: { results: { id: string }[] } } })[]) {
    console.log(`  ${c.id}  ${c.properties.hs_timestamp}  ${c.properties.hs_call_title}  contacts: ${c.associations?.contacts?.results.map((a) => a.id).join(',') || 'none'}`);
  }
}
