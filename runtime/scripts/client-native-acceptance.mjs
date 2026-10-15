/** Offline native-client acceptance. No model calls, credentials, or real user configuration. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, writeFile, readFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { HubStore } from '../packages/core/index.mjs';
import { exportMarketplace } from '../packages/exporter/index.mjs';

export async function nativeAcceptance({ output } = {}) {
  if (process.platform !== 'darwin') throw new Error('This native probe requires macOS sandbox-exec; never fall back to an unsandboxed run');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'skillhub-native-acceptance-')));
  const profile = join(root, 'sandbox.sb');
  await writeFile(profile, `(version 1)(allow default)(deny network*)(deny file-write*)(allow file-write* (subpath ${JSON.stringify(root)}))(allow file-write* (literal "/dev/null"))`);
  const report = { schemaVersion: 1, createdAt: new Date().toISOString(), root, modelCalls: 0, network: 'denied-by-os-sandbox', loaded: false, checks: [], clients: {}, limits: ['Desktop activation and new/old model sessions are not tested.', 'MCP SDK verification is not native desktop MCP invocation.'] };
  async function run(client, command, args, { allowFailure = false } = {}) {
    const home = join(root, client, 'home'); await mkdir(home, { recursive: true });
    const result = spawnSync('/usr/bin/sandbox-exec', ['-f', profile, command, ...args], {
      cwd: root, env: { PATH: process.env.PATH, HOME: home, TMPDIR: root, CODEX_HOME: home, KIMI_SHARE_DIR: join(home, 'share'), LANG: 'en_US.UTF-8' },
      encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024,
    });
    report.checks.push({ client, args, exitCode: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error?.message });
    if (!allowFailure && (result.error || result.status !== 0)) throw new Error(`${client} ${args.join(' ')} failed: ${result.error?.message ?? result.stderr}`);
    return result;
  }
  try {
    const store = await new HubStore({ dataDir: join(root, 'data') }).init();
    await store.saveContent({ id: 'probe.rule', kind: 'rule', title: 'Probe rule', body: 'hub_probe_release = v1' });
    await store.saveContent({ id: 'probe.skill', kind: 'skill', title: 'Probe reference skill', body: 'Read references/probe.md and report its marker.', resources: [{ path: 'references/probe.md', body: 'hub_probe_reference = v1' }] });
    await store.saveBundle({ id: 'hub-probe', name: 'Isolated Hub Probe', items: ['probe.rule', 'probe.skill'] });
    const first = await store.buildRelease('hub-probe', '1.0.0');
    await store.saveContent({ id: 'probe.rule', kind: 'rule', title: 'Probe rule', body: 'hub_probe_release = v2' });
    await store.saveContent({ id: 'probe.skill', kind: 'skill', title: 'Probe reference skill', body: 'Read references/probe.md and report its marker.', resources: [{ path: 'references/probe.md', body: 'hub_probe_reference = v2' }] });
    const second = await store.buildRelease('hub-probe', '1.1.0');
    for (const target of ['codex', 'zcode', 'kimi']) {
      const parent = join(root, target); await mkdir(parent);
      await mkdir(join(parent, 'home'));
      await writeFile(join(parent, 'home/AGENTS.md'), 'User-owned rule: preserve this exact text.\n');
      await writeFile(join(parent, 'home/user-note.txt'), 'User-owned content.\n');
      for (const [version, release] of [['v1', first], ['v2', second]]) await exportMarketplace({ release, target, outDir: join(parent, version) });
      await cp(join(parent, 'v1'), join(parent, 'market'), { recursive: true });
    }
    const codex = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
    const zcode = '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs';
    const daimon = '/Applications/Kimi.app/Contents/Resources/resources/daimon-bundle/bin/kimi-daimon';
    const kimiNode = '/Applications/Kimi.app/Contents/Resources/resources/runtime/node';
    report.clients.codex = { version: (await run('codex', codex, ['--version'])).stdout.trim(), nativeInstalled: false };
    await run('codex', codex, ['plugin', 'marketplace', 'add', join(root, 'codex/market'), '--json']);
    for (const version of ['v1', 'v2', 'v1']) {
      await cp(join(root, 'codex', version), join(root, 'codex/market'), { recursive: true, force: true });
      await run('codex', codex, ['plugin', 'add', 'hub-probe@skill-hub-hub-probe', '--json']);
      const listing = await run('codex', codex, ['plugin', 'list', '--marketplace', 'skill-hub-hub-probe', '--available', '--json']);
      const data = JSON.parse(listing.stdout);
      const installed = data.installed.find(item => item.pluginId === 'hub-probe@skill-hub-hub-probe');
      assert.equal(installed?.version, version === 'v2' ? '1.1.0' : '1.0.0');
      assert.equal(installed?.enabled, true);
    }
    report.clients.codex.nativeInstalled = true;
    await run('codex', codex, ['plugin', 'remove', 'hub-probe@skill-hub-hub-probe', '--json']);
    report.clients.codex.uninstall = true;
    report.clients.zcode = { version: (await run('zcode', process.execPath, [zcode, 'version'])).stdout.trim(), nativeInstalled: false };
    await run('zcode', process.execPath, [zcode, 'plugins', 'validate', join(root, 'zcode/market')]);
    await run('zcode', process.execPath, [zcode, 'plugins', 'marketplace', 'add', join(root, 'zcode/market')]);
    for (const version of ['v1', 'v2', 'v1']) {
      await cp(join(root, 'zcode', version), join(root, 'zcode/market'), { recursive: true, force: true });
      await run('zcode', process.execPath, [zcode, 'plugins', 'marketplace', 'update', 'skill-hub-hub-probe']);
      await run('zcode', process.execPath, [zcode, 'plugins', 'install', 'hub-probe@skill-hub-hub-probe']);
      const listing = JSON.parse((await run('zcode', process.execPath, [zcode, 'plugins', 'list', '--json'])).stdout);
      const installed = listing.find(item => item.id === 'hub-probe@skill-hub-hub-probe');
      assert.equal(installed?.version, version === 'v2' ? '1.1.0' : '1.0.0');
      assert.equal(installed?.enabled, true);
    }
    report.clients.zcode.nativeInstalled = true;
    await run('zcode', process.execPath, [zcode, 'plugins', 'uninstall', 'hub-probe', '--force']);
    report.clients.zcode.uninstall = true;
    const share = join(root, 'kimi/home/share');
    report.clients.kimi = { desktopVersion: '3.2.16', registered: false, nativeInstalled: false, desktopActivated: false };
    for (const version of ['v1', 'v2', 'v1']) {
      const plugin = join(root, 'kimi', version, 'plugins/hub-probe');
      await run('kimi', 'python3', ['-B', '/Applications/Kimi.app/Contents/Resources/resources/daimon-bundle/app/daimon/assets/builtin-skills/plugin-builder/scripts/validate_plugin.py', plugin]);
      const registration = JSON.parse((await run('kimi', daimon, ['--node', kimiNode, 'kimi-plugin', 'register-personal', plugin, '--share-dir', share, '--market', 'hub-acceptance', '--json'])).stdout);
      assert.deepEqual(registration.skillNames, ['probe-skill']);
      report.clients.kimi.registered = true;
      const installation = JSON.parse((await run('kimi', daimon, ['--node', kimiNode, 'kimi-plugin', 'install', plugin, '--share-dir', share, '--json'])).stdout);
      assert.equal(installation.plugin.version, version === 'v2' ? '1.1.0' : '1.0.0');
      assert.equal(installation.plugin.enabled, true);
    }
    report.clients.kimi.nativeInstalled = true;
    for (const client of ['codex', 'kimi', 'zcode']) {
      assert.equal(await readFile(join(root, client, 'home/AGENTS.md'), 'utf8'), 'User-owned rule: preserve this exact text.\n');
      assert.equal(await readFile(join(root, client, 'home/user-note.txt'), 'utf8'), 'User-owned content.\n');
      report.clients[client].userFilesPreserved = true;
    }
    report.status = 'offline-native-passed-desktop-session-pending';
  } catch (error) { report.status = 'failed'; report.error = error.message; }
  if (output) { await mkdir(resolve(output), { recursive: true }); await writeFile(join(resolve(output), 'native-clients.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 }); }
  await writeFile(join(root, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--output')) throw new Error('Usage: node scripts/client-native-acceptance.mjs [--output <evidence-directory>]');
  const report = await nativeAcceptance({ output: args[1] });
  console.log(JSON.stringify({ status: report.status, error: report.error, root: report.root, clients: report.clients, loaded: false }, null, 2));
  if (report.status === 'failed') process.exitCode = 1;
}
