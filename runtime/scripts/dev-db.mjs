import { spawn } from 'node:child_process';
import { configuredDatabaseUrl } from './db-config.mjs';
const child = spawn(process.execPath, ['apps/server/src/index.mjs'], {
  stdio: 'inherit', env: { ...process.env, SKILLHUB_DATABASE_URL: configuredDatabaseUrl() },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
child.once('exit', code => { process.exitCode = code ?? 1; });
child.once('error', () => { console.error('Cannot start database-backed server'); process.exitCode = 1; });
