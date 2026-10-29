# HubSpot app for QF Connect

The HubSpot app customers approve when they click **Connect HubSpot** in the portal. It only asks to read and write contacts and to create calls.

`src/app/app-hsmeta.json` holds the redirect URL and scopes. They must match the portal: the redirect is `<PUBLIC_URL>/api/integrations/hubspot/callback`, and the scopes match `HUBSPOT_SCOPES` in `apps/api/src/integrations/hubspot.ts`. When the portal moves to the Quantum Frame domain, update `redirectUrls` and upload again.

Upload it from the server (no Node install needed on the host):

```
cd /root/qf-connect/hubspot-app
docker run --rm -it -v "$PWD":/work -w /work -v qf-hscli:/root node:22 \
  sh -c "npx -y @hubspot/cli@latest account auth && npx -y @hubspot/cli@latest project upload"
```

Then in HubSpot: Development > Projects > quantum-frame-phone > Quantum Frame Phone > **Auth** tab. Copy the client ID and client secret into `.env` as `HUBSPOT_CLIENT_ID` and `HUBSPOT_CLIENT_SECRET`, and restart with `docker compose up -d`.
