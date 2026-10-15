import { createStore } from '../packages/storage/index.mjs';
import { configuredDatabaseUrl } from './db-config.mjs';
const store = createStore({ databaseUrl: configuredDatabaseUrl() });
try { await store.init(); console.log(JSON.stringify(await store.health())); }
catch { console.error('Database migration failed; check database availability and configured credentials.'); process.exitCode = 1; }
finally { await store.close(); }
