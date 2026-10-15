import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nativeOptions, nativeCommands, runNativeMarket } from '../scripts/native-market.mjs';

test('native operations require explicit homes and known scoped actions', () => {
  for (const args of [[], ['--client', 'zcode', '--action', 'list'], ['--client', 'kimi', '--share-dir', 'relative', '--action', 'probe'], ['--client', 'kimi', '--share-dir', '/tmp/x', '--action', 'remove']]) assert.throws(() => nativeOptions(args));
  assert.throws(() => nativeOptions(['--client', 'zcode', '--home', '/tmp/x', '--action', 'install', '--plugin', 'test', '--marketplace', 'market;evil']));
  assert.throws(() => nativeOptions(['--client', 'kimi', '--share-dir', '/tmp/x', '--action', 'install', '--source', 'https://example.com/repo.git']));
});
test('ZCode refresh failure stops before installation; HOME remains subprocess-local', async t => {
  const home = await mkdtemp(join(tmpdir(), 'native-adapter-')); t.after(() => rm(home, { recursive: true, force: true }));
  const options = nativeOptions(['--client', 'zcode', '--home', home, '--action', 'update', '--plugin', 'probe', '--marketplace', 'hub']);
  assert.deepEqual(nativeCommands(options), [['plugins', 'marketplace', 'update', 'hub'], ['plugins', 'install', 'probe@hub']]);
  const original = process.env.HOME; let calls = 0;
  await assert.rejects(runNativeMarket(options, { execute: async (command, args, env) => { calls++; assert.equal(env.HOME, home); throw new Error('refresh failed'); } }), /refresh failed/);
  assert.equal(calls, 1); assert.equal(process.env.HOME, original);
});
test('Kimi register uses explicit share-dir and does not claim desktop loading', async t => {
  const home = await mkdtemp(join(tmpdir(), 'native-adapter-')); t.after(() => rm(home, { recursive: true, force: true }));
  const options = nativeOptions(['--client', 'kimi', '--share-dir', home, '--action', 'register', '--source', '/tmp/plugin', '--marketplace', 'hub-probe']);
  const result = await runNativeMarket(options, { execute: async (command, args, env) => { assert.ok(args.includes('register-personal')); assert.deepEqual(args.slice(-5), ['--share-dir', home, '--market', 'hub-probe', '--json']); assert.equal(env.KIMI_SHARE_DIR, home); return { stdout: '{"ok":true}', stderr: '' }; } });
  assert.equal(result.loaded, false); assert.equal(result.desktopRestartMayBeRequired, true);
});
