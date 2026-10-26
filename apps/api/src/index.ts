import { config } from './config.ts';
import { openDb } from './db.ts';
import { buildServer } from './server.ts';

const app = await buildServer(openDb(), { logger: true });
await app.listen({ port: config.port, host: '0.0.0.0' });
