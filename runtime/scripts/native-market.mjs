/** Explicit client-home operations; never invokes a model or reads credentials. */
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export function nativeOptions(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.slice(2);
    if (!args[i]?.startsWith('--') || !['client', 'home', 'share-dir', 'action', 'source', 'plugin', 'marketplace', 'executable', 'node'].includes(key) || Object.hasOwn(options, key) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Invalid native-market option');
    options[key] = args[i + 1];
  }
  if (!['zcode', 'kimi'].includes(options.client)) throw new Error('--client must be zcode or kimi');
  const scope = options.client === 'zcode' ? 'home' : 'share-dir';
  if (!isAbsolute(options[scope] ?? '')) throw new Error(`An explicit absolute --${scope} is required`);
  const actions = options.client === 'zcode' ? ['probe', 'validate', 'add', 'install', 'update', 'list', 'remove'] : ['probe', 'register', 'install'];
  if (!actions.includes(options.action)) throw new Error(`Supported actions: ${actions.join(', ')}`);
  for (const key of ['plugin', 'marketplace']) if (options[key] && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options[key])) throw new Error(`Invalid --${key}`);
  if (['validate', 'add', 'register'].includes(options.action) || (options.client === 'kimi' && options.action === 'install')) {
    if (!isAbsolute(options.source ?? '')) throw new Error('This adapter requires an absolute local --source; Git sources must be exported first');
  }
  if (options.client === 'zcode' && ['install', 'update', 'remove'].includes(options.action) && (!options.plugin || !options.marketplace)) throw new Error('--plugin and --marketplace are required');
  return options;
}
export function nativeCommands(options) {
  if (options.client === 'kimi') {
    const node = options.node ?? '/Applications/Kimi.app/Contents/Resources/resources/runtime/node';
    const base = ['--node', node, 'kimi-plugin'];
    if (options.action === 'probe') return [[...base, '--help']];
    return [[...base, options.action === 'register' ? 'register-personal' : 'install', options.source, '--share-dir', options['share-dir'], ...(options.action === 'register' && options.marketplace ? ['--market', options.marketplace] : []), '--json']];
  }
  const selector = `${options.plugin}@${options.marketplace}`;
  switch (options.action) {
    case 'probe': return [['version']];
    case 'validate': return [['plugins', 'validate', options.source]];
    case 'add': return [['plugins', 'marketplace', 'add', options.source]];
    case 'install': return [['plugins', 'install', selector]];
    case 'update': return [['plugins', 'marketplace', 'update', options.marketplace], ['plugins', 'install', selector]];
    case 'list': return [['plugins', 'list', '--json']];
    case 'remove': return [['plugins', 'uninstall', selector, '--force']];
    default: throw new Error('Unsupported action');
  }
}
export async function runNativeMarket(options, { execute } = {}) {
  const commands = nativeCommands(options);
  const root = options.client === 'zcode' ? options.home : options['share-dir'];
  await mkdir(root, { recursive: true, mode: 0o700 });
  const command = options.executable ?? (options.client === 'zcode' ? process.execPath : '/Applications/Kimi.app/Contents/Resources/resources/daimon-bundle/bin/kimi-daimon');
  const prefix = options.client === 'zcode' && !options.executable ? ['/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs'] : [];
  const env = { ...process.env, ...(options.client === 'zcode' ? { HOME: root } : { KIMI_SHARE_DIR: root }) };
  const invoke = execute ?? ((command, args, env) => new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; let tooLarge = false;
    const timer = setTimeout(() => child.kill('SIGTERM'), 30000);
    for (const [stream, append] of [[child.stdout, value => stdout += value], [child.stderr, value => stderr += value]]) stream.on('data', value => { append(value); if (stdout.length + stderr.length > 2 * 1024 * 1024) { tooLarge = true; child.kill('SIGTERM'); } });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); if (code !== 0 || tooLarge) reject(new Error(`Native ${options.client} ${options.action} failed (exit ${code}${tooLarge ? ', oversized output' : ''}); verify explicit home and local package`)); else resolve({ stdout, stderr }); });
  }));
  const results = [];
  for (const args of commands) results.push(await invoke(command, [...prefix, ...args], env));
  return { client: options.client, action: options.action, scope: root, loaded: false, desktopRestartMayBeRequired: true, results };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await runNativeMarket(nativeOptions(process.argv.slice(2))), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
