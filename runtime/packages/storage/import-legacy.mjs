import { resolve } from 'node:path';
import { PostgresStore } from './index.mjs';

let store;
try {
  const options = {};
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (!['--data', '--database-url', '--schema'].includes(flag) || options[flag] || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Usage: --data <legacy-directory> --database-url <postgres-url> [--schema <schema>]');
    options[flag] = args[index + 1];
  }
  if (!options['--data'] || !options['--database-url']) throw new Error('--data and --database-url are required');
  store = new PostgresStore({ connectionString: options['--database-url'], schema: options['--schema'] });
  await store.init();
  console.log(JSON.stringify(await store.importLegacy({ dataDir: resolve(options['--data']) }), null, 2));
} catch (error) {
  // Do not print database URLs or server connection details containing credentials.
  console.error(error.code === 'STORAGE_VALIDATION_ERROR' ? error.message : 'Legacy import failed; verify source data and database connectivity.');
  process.exitCode = 1;
} finally { if (store) await store.close(); }
