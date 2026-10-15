import { resolve } from 'node:path';
import { createStore } from '../packages/storage/index.mjs';
import { exportMarketplace } from '../packages/exporter/index.mjs';

const options = {};
let store;
try {
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]?.replace(/^--/, '');
    if (!args[index]?.startsWith('--') || !['data', 'release', 'target', 'out'].includes(key) || Object.hasOwn(options, key) || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Usage: --release <fixed-release-id> --target codex|kimi|zcode --out <new-directory> [--data <data-directory>]');
    options[key] = args[index + 1];
  }
  if (!options.release || !options.target || !options.out) throw new Error('--release, --target and --out are required');
  store = createStore({ databaseUrl: process.env.SKILLHUB_DATABASE_URL, dataDir: resolve(options.data || process.env.SKILLHUB_DATA_DIR || '.skillhub-data') });
  await store.init();
  const release = await store.getRelease(options.release);
  console.log(JSON.stringify(await exportMarketplace({ release, target: options.target, outDir: options.out }), null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }

finally { await store?.close(); }
