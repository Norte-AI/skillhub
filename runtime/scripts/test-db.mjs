import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const runtimeRoot = fileURLToPath(new URL('../', import.meta.url));
import { spawn } from 'node:child_process';
import { configuredDatabaseUrl, developmentDatabaseUrl } from './db-config.mjs';
const env = { ...process.env, SKILLHUB_TEST_DATABASE_URL: process.env.SKILLHUB_TEST_DATABASE_URL || configuredDatabaseUrl() };
// File test fixtures must never inherit a deployment database or admin credential.
delete env.SKILLHUB_DATABASE_URL; delete env.SKILLHUB_TOKEN;
if (env.SKILLHUB_TEST_DATABASE_URL === developmentDatabaseUrl) env.SKILLHUB_TEST_PG_DOCKER_BACKUP = '1';
const files = (await readdir(join(runtimeRoot, 'tests'))).filter(name => name.endsWith('.test.mjs')).map(name => `tests/${name}`);
const child = spawn(process.execPath, ['--test', ...files], { cwd: runtimeRoot, env, stdio: 'inherit' });
child.once('exit', code => { process.exitCode = code ?? 1; });
child.once('error', () => { console.error('Cannot run backend tests'); process.exitCode = 1; });
