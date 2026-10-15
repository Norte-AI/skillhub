import test from 'node:test';
import assert from 'node:assert/strict';
import { parseServiceOptions, ownedProcess } from '../scripts/service.mjs';
test('service manager requires one explicit lifecycle action', () => {
  for (const args of [[], ['restart'], ['start', '--kill'], ['stop', '123']]) assert.throws(() => parseServiceOptions(args), /Usage/);
  assert.deepEqual(parseServiceOptions(['status']), { action: 'status' });
});
test('PID ownership requires entry, full command and original start identity', () => {
  const entry = '/project/apps/server/src/index.mjs';
  const record = { pid: 123, entry, executable: '/usr/local/bin/node', identity: 'Wed Oct 14 12:00:00 2026' };
  const info = { command: `/usr/local/bin/node ${entry}`, identity: record.identity };
  assert.equal(ownedProcess(record, info, entry), true);
  assert.equal(ownedProcess(record, { ...info, identity: 'recycled process' }, entry), false);
  assert.equal(ownedProcess(record, { ...info, command: `/usr/local/bin/node ${entry}.evil` }, entry), false);
  assert.equal(ownedProcess(record, { ...info, command: `/usr/local/bin/node other.mjs --note ${entry}` }, entry), false);
  assert.equal(ownedProcess({ ...record, entry: '/different/project/index.mjs' }, info, entry), false);
  assert.equal(ownedProcess({ ...record, pid: 1 }, info, entry), false);
  assert.equal(ownedProcess(record, null, entry), false);
});
