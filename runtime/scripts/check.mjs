import { readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const runtimeRoot = fileURLToPath(new URL('../', import.meta.url));
import { spawnSync } from 'node:child_process';
async function files(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await files(path));
    else if (entry.name.endsWith('.mjs')) found.push(path);
  }
  return found;
}
const paths = (await Promise.all(['apps', 'packages', 'scripts', 'examples', 'tests'].map(directory => files(join(runtimeRoot, directory))))).flat();
for (const path of paths) {
  const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
  if (result.status !== 0) { process.stderr.write(result.stderr); process.exit(1); }
}
console.log(`Syntax checked ${paths.length} JavaScript modules`);
