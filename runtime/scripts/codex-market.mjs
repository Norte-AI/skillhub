import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const usage = 'node scripts/codex-market.mjs --codex-home <absolute-directory> --action add|install|update|list|remove [--source <Git URL or local market>] [--ref <Git ref>] [--marketplace skill-hub] [--plugin personal]';
export function parseOptions(args) {
  const options = {};
  const accepted = new Set(['codex-home', 'action', 'source', 'ref', 'marketplace', 'plugin']);
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.slice(2);
    if (!args[i]?.startsWith('--') || !accepted.has(key) || Object.hasOwn(options, key) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(usage);
    options[key] = args[i + 1];
  }
  if (!options['codex-home'] || !isAbsolute(options['codex-home'])) throw new Error('--codex-home must explicitly name an absolute directory');
  if (!['add', 'install', 'update', 'list', 'remove'].includes(options.action)) throw new Error(usage);
  for (const key of ['marketplace', 'plugin']) if (options[key] && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(options[key])) throw new Error(`Invalid --${key}`);
  if (options.ref && (options.ref.startsWith('-') || /[\s\x00-\x1f]/.test(options.ref))) throw new Error('Invalid --ref');
  if (options.ref && options.action !== 'add') throw new Error('--ref is supported by add; add the desired Git ref then install to restore a version');
  const source = options.source ?? 'http://127.0.0.1:4317/git/codex.git';
  if (isAbsolute(source) && options.ref) throw new Error('--ref is only supported for Git marketplace sources');
  if (source.startsWith('-') || /[\x00-\x1f]/.test(source)) throw new Error('Invalid --source');
  try { const url = new URL(source); if (url.username || url.password) throw new Error('Credential-bearing Git URLs are not supported'); } catch (error) { if (error.message === 'Credential-bearing Git URLs are not supported') throw error; }
  return { ...options, source, marketplace: options.marketplace ?? 'skill-hub', plugin: options.plugin ?? 'personal' };
}
export function commandsFor(options) {
  const selector = `${options.plugin}@${options.marketplace}`;
  switch (options.action) {
    case 'add': return [['plugin', 'marketplace', 'add', options.source, ...(isAbsolute(options.source) ? [] : ['--ref', options.ref ?? 'main']), '--json']];
    case 'install': return [['plugin', 'add', selector, '--json']];
    case 'update': return [['plugin', 'marketplace', 'upgrade', options.marketplace, '--json'], ['plugin', 'add', selector, '--json']];
    case 'list': return [['plugin', 'list', '--marketplace', options.marketplace, '--available', '--json']];
    case 'remove': return [['plugin', 'remove', selector, '--json']];
    default: throw new Error('Unsupported action');
  }
}
export function subprocessEnvironment(options, inherited = process.env) {
  const env = { ...inherited, CODEX_HOME: resolve(options['codex-home']) };
  let url;
  try { url = new URL(options.source); } catch { return env; }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)) return env;
  const count = Number(env.GIT_CONFIG_COUNT ?? '0');
  if (!Number.isSafeInteger(count) || count < 0 || count > 1024) throw new Error('Invalid inherited GIT_CONFIG_COUNT');
  // Override only the loopback origin in this subprocess; do not edit global Git config.
  env.GIT_CONFIG_COUNT = String(count + 1);
  env[`GIT_CONFIG_KEY_${count}`] = `http.${url.origin}/.proxy`;
  env[`GIT_CONFIG_VALUE_${count}`] = '';
  return env;
}
export async function runCodexMarket(options, { run } = {}) {
  await mkdir(options['codex-home'], { recursive: true, mode: 0o700 });
  const env = subprocessEnvironment(options);
  const execute = run ?? ((args, env) => new Promise((resolve, reject) => {
    const child = spawn('codex', args, { env, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(`Codex command failed (${code}): ${stderr.trim()}`)));
  }));
  const results = [];
  for (const args of commandsFor(options)) {
    const result = await execute(args, env);
    let value;
    try { value = JSON.parse(result); } catch { /* CLI may print non-JSON diagnostics. */ }
    if (Array.isArray(value?.errors) && value.errors.length) throw new Error('Codex marketplace refresh reported errors; installation stopped');
    results.push({ command: args, result });
  }
  return { codexHome: resolve(options['codex-home']), action: options.action, results };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await runCodexMarket(parseOptions(process.argv.slice(2))), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
