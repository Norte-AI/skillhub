import { createStore } from '../packages/storage/index.mjs';
import { publishGitMarketplace } from '../packages/git-market/index.mjs';

let store;
try {
  const options = {};
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (!['--target', '--out', '--data', '--database-url', '--schema'].includes(flag) || Object.hasOwn(options, flag) || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Usage: --target codex|zcode [--out <local-bare-repo>] [--data <directory>] [--database-url <url>] [--schema <schema>]');
    options[flag] = args[index + 1];
  }
  store = createStore({ databaseUrl: options['--database-url'] || process.env.SKILLHUB_DATABASE_URL, dataDir: options['--data'] || process.env.SKILLHUB_DATA_DIR || '.skillhub-data', schema: options['--schema'] });
  await store.init();
  const result = await publishGitMarketplace({ store, target: options['--target'] || 'codex', outDir: options['--out'] });
  console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(error.code === 'ECONNREFUSED' ? 'Database connection unavailable' : error.message); process.exitCode = 1; }
finally { if (store) await store.close(); }
