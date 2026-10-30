# QF Connect

Quantum Frame's branded customer portal on the VoIP.ms API, with missed-call text-back and HubSpot call logging.
Product spec and architecture: https://claude.ai/artifact/6cLo9ozd7YtZyKPXBqUnjR

## What works today

- **Portal (PWA):** sign-in, dashboard, call log with filters and search, visual voicemail, team SMS inbox, extensions with online status, integrations settings.
- **Quantum Frame admin:** add a customer (business, admin user, DIDs, sub-accounts), view a customer's portal (audited), set 10DLC status per number, get each DID's SMS callback URL.
- **Worker:** polls VoIP.ms CDRs every minute, routes each call to its customer by DID or sub-account, texts back missed callers, logs calls to HubSpot.
- **Text-back rules:** missed or busy inbound calls only, 10DLC-approved numbers only, STOP/START opt-out, per-caller cooldown, business-hours modes in the customer's timezone, and no texting a stale backlog after an outage.
- **Security:** the VoIP.ms API password never leaves the server, every route checks the caller's tenant owns the number or mailbox, SMS callback URLs carry a secret per-number token, CRM tokens are AES-256-GCM encrypted, and sensitive actions go to `audit_log`.

Everything runs against a mock VoIP.ms account until `VOIPMS_MOCK=0`.

## Run it

Requires Node 22.13+.

```bash
npm install
cp .env.example .env    # optional for local dev
npm run dev             # seeds demo data, starts API :3000, worker, and web :5173
```

Open http://localhost:5173 and sign in as `dana@baydental.example` / `demo-password` (customer admin) or `admin@quantumframe.com` / `change-me-now` (Quantum Frame admin).

```bash
npm test                # API tests: text-back rules, CDR routing, tenant isolation, webhooks, HubSpot logging
npm run build           # type-check API, build the portal into apps/web/dist (served by the API in production)
```

## Going live with VoIP.ms

Full walkthrough, including a server, a test subdomain and switching accounts later: [docs/connect-voipms.md](docs/connect-voipms.md).

1. In the VoIP.ms portal: enable the API, set an API password, and whitelist the server's static IP.
2. Set `VOIPMS_MOCK=0`, `VOIPMS_API_USERNAME`, `VOIPMS_API_PASSWORD` in `.env`.
3. Add each customer in **Customers**, with their DIDs and sub-accounts.
4. For each DID, enable SMS and paste the URL from `GET /api/admin/tenants/:id/sms-callbacks` into **SMS/MMS URL Callback**.
5. Register each customer's 10DLC brand and campaign (customer care use case, mention missed-call text-back), then mark the number approved.
6. Check method parameter names in `apps/api/src/voipms/client.ts` against the API reference in the logged-in portal. They follow the public docs and open-source clients.

## HubSpot

Create a public app at developers.hubspot.com with scopes `crm.objects.contacts.read`, `crm.objects.contacts.write`, `crm.objects.calls.write` and redirect URL `$PUBLIC_URL/api/integrations/hubspot/callback`. Put the client ID and secret in `.env`. Customers then click **Connect HubSpot** on the Integrations page.

## Deploy

`docker compose up -d --build` on a small VPS (static IP). Caddy is included and handles HTTPS for `DOMAIN` (the portal) and `SITE_DOMAIN` (the static marketing site in `website/`, default `quantumframe.lowcoster.us`). SQLite on a volume is fine for pilots; move to Postgres before about 50 customers.

## Layout

```
apps/api/src
  voipms/        VoIP.ms client (HTTP + mock)
  calls.ts       CDR sync and routing calls to tenants
  integrations/  text-back, HubSpot, per-tenant settings
  routes/        auth, portal, integrations, admin, webhooks
  worker.ts      polling loop
apps/web/src     React portal (Vite, installable PWA)
```

## Next up (from the spec)

Business-hours routing editor (VoIP.ms forwarding and time conditions), add users and reset SIP passwords, voicemail-email trigger for faster text-back, Postgres and pg-boss, number purchase and E911, Stripe billing.
