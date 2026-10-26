import { randomBytes } from 'node:crypto';

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 3000),
  publicUrl: env.PUBLIC_URL ?? 'http://localhost:3000',
  sessionSecret: env.SESSION_SECRET ?? 'dev-only-secret',
  // Dev falls back to a random key per process, so tokens written in dev do not survive a restart.
  encryptionKey: env.ENCRYPTION_KEY ? Buffer.from(env.ENCRYPTION_KEY, 'base64') : randomBytes(32),
  databasePath: env.DATABASE_PATH ?? './qf-connect.db',
  voipms: {
    mock: env.VOIPMS_MOCK !== '0',
    username: env.VOIPMS_API_USERNAME ?? '',
    password: env.VOIPMS_API_PASSWORD ?? '',
  },
  cdrPollSeconds: Number(env.CDR_POLL_SECONDS ?? 60),
  hubspot: {
    clientId: env.HUBSPOT_CLIENT_ID ?? '',
    clientSecret: env.HUBSPOT_CLIENT_SECRET ?? '',
  },
};
