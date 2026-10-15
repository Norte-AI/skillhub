import { configuredDatabaseUrl } from './db-config.mjs';
process.env.SKILLHUB_DATABASE_URL = configuredDatabaseUrl();
await import('./publish-git-market.mjs');
