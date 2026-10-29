# Connect a VoIP.ms account and put the portal online

This takes the portal from mock data to a real VoIP.ms account, on a test address like `https://qf.lowcoster.us`.
It works the same for the test account now and the Quantum Frame account later; only `.env` and the linked numbers change.

## Ground rules

- **Credentials go in `.env` on the server only.** Never paste the API password into chat, email, GitHub or a ticket. `.env` is git-ignored.
- **The portal only touches what you link.** Numbers and sub-accounts that aren't linked to a customer in **Customers** are ignored by the worker, the inbox and text-back.
- **Use a spare test number.** Your other business's live numbers keep working as they are; don't link them, and don't add an SMS callback URL to them.
- **Text-back stays off** for every new customer until you turn it on, and it only ever sends from a number marked 10DLC approved.

## 1. Get a small server with a fixed IP

VoIP.ms only accepts API calls from IP addresses you whitelist, so the portal needs a server whose IP never changes.

1. Create a VPS, for example a DigitalOcean Droplet (Ubuntu 24.04, 1 GB RAM, about $6/month) or Hetzner CX22. Its public IPv4 address is fixed for as long as the server exists.
2. Install Docker: `curl -fsSL https://get.docker.com | sh`.
3. Clone the code: `git clone https://github.com/sergevorgyan/qf-connect && cd qf-connect`.

## 2. Point a test address at the server

Use a **subdomain**, `qf.lowcoster.us`, rather than a folder like `lowcoster.us/test/quantumframe`. The lowcoster.us website stays where it is and is not touched. The portal gets its own HTTPS certificate and login cookies, and moving to the Quantum Frame domain later is a one-line change.

1. Sign in wherever lowcoster.us's DNS is managed (your registrar, or Cloudflare if you use it).
2. Add an **A record**: name `qf`, value = the VPS's IP, TTL automatic. With Cloudflare, set it to **DNS only** (grey cloud).
3. Wait until `ping qf.lowcoster.us` answers from that IP (usually a few minutes).

## 3. Turn on the VoIP.ms API

In the VoIP.ms portal, open **Main Menu > SOAP & REST/JSON API**:

1. **Enable** the API.
2. Set an **API password**. It is separate from your login password; make it long and random.
3. Under **Enabled IP Addresses**, add the VPS's IP and save. Changes can take a few minutes.

## 4. Fill in `.env` on the server

```bash
cp .env.example .env
nano .env
```

| Setting | Value |
| --- | --- |
| `DOMAIN` | `qf.lowcoster.us` |
| `PUBLIC_URL` | `https://qf.lowcoster.us` |
| `SESSION_SECRET` | output of `openssl rand -base64 48` |
| `ENCRYPTION_KEY` | output of `openssl rand -base64 32` |
| `QF_ADMIN_EMAIL`, `QF_ADMIN_PASSWORD` | your admin login (password 12+ characters) |
| `VOIPMS_MOCK` | `0` |
| `VOIPMS_API_USERNAME` | the VoIP.ms account's email |
| `VOIPMS_API_PASSWORD` | the API password from step 3 |

Keep `ENCRYPTION_KEY` safe: losing it disconnects HubSpot for every customer.

## 5. Check the connection

```bash
docker compose run --rm api npm run voipms:check
```

It prints the IP VoIP.ms sees (it must match the whitelist), the balance, and every number and sub-account in the account. It only reads. If it reports an IP error, fix the whitelist and run it again.

## 6. Start it

```bash
docker compose run --rm api npm run seed     # creates your admin login
docker compose up -d --build
```

Open `https://qf.lowcoster.us` and sign in with `QF_ADMIN_EMAIL`.

## 7. Set up a test customer

1. **Customers > Add customer**: a test business with yourself as its admin (use a different email from the QF admin).
2. Open **Numbers and extensions** on that customer. Under "Not linked", link the test number and a test sub-account (add its voicemail box number if it has one).
3. Click **Copy SMS callback URL** and, in VoIP.ms, paste it into that test number's **SMS/MMS URL Callback** (DID Numbers > Manage DIDs > Edit, with SMS enabled).
4. Call the test number from your mobile and let it ring out. Within about a minute it shows in the call log.
5. To try text-back: mark the number's 10DLC status approved **only if** it really is registered for texting, then turn text-back on under **View portal > Integrations**.

## Later: switch to the Quantum Frame account and domain

1. Create the Quantum Frame VoIP.ms account once the LLC exists, enable its API and whitelist the same server IP.
2. Move or order the numbers you want there. VoIP.ms support can move DIDs between accounts.
3. In `.env`, change `VOIPMS_API_USERNAME` and `VOIPMS_API_PASSWORD`; change `DOMAIN` and `PUBLIC_URL` to the new domain and add its A record. Then run `docker compose up -d`.
4. Run `npm run voipms:check`. In **Numbers and extensions**, unlink the old account's items and link the new ones. Sub-account names start with the account number, so they will be new.
5. Paste the new SMS callback URLs into the new account's numbers. Customer logins, settings and history stay as they are.
