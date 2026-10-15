import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveContentGraph } from '../packages/compiler/index.mjs';
const revision = (id, dependencies) => ({ id, kind: 'skill', revision: 1, body: id, resources: [{ path: 'example.md', body: id }], ...(dependencies === undefined ? {} : { dependencies }) });
const stateOf = (...items) => ({ content: Object.fromEntries(items.map(item => [item.id, [item]])) });
test('dependency compiler resolves nested shared dependencies once before parents and preserves root ordering', () => {
  const state = stateOf(revision('base'), revision('left', ['base']), revision('right', ['base']), revision('root', ['right', 'left']), revision('independent'));
  assert.deepEqual(resolveContentGraph(state, ['root', 'independent']).map(item => item.id), ['base', 'right', 'left', 'root', 'independent']);
  assert.deepEqual(resolveContentGraph(state, ['independent', 'root']).map(item => item.id), ['independent', 'base', 'right', 'left', 'root']);
  assert.deepEqual(resolveContentGraph(stateOf(revision('a'), revision('b')), ['b', 'a']).map(item => item.id), ['b', 'a']);
});
test('dependency compiler explains cycles and missing references with their paths', () => {
  assert.throws(() => resolveContentGraph(stateOf(revision('a', ['b']), revision('b', ['c']), revision('c', ['a'])), ['a']), error => error.code === 'VALIDATION_ERROR' && /a -> b -> c -> a/.test(error.message));
  assert.throws(() => resolveContentGraph(stateOf(revision('a', ['a'])), ['a']), /a -> a/);
  assert.throws(() => resolveContentGraph(stateOf(revision('a', ['missing'])), ['a']), error => error.code === 'NOT_FOUND' && /a -> missing/.test(error.message));
});
test('dependency compiler locks latest revisions into detached snapshots', () => {
  const state = stateOf(revision('base'), revision('root', ['base']));
  state.content.base.push({ ...revision('base'), revision: 2 });
  const snapshot = resolveContentGraph(state, ['root']);
  assert.equal(snapshot[0].revision, 2);
  state.content.base[1].body = 'new mutation';
  snapshot[1].resources[0].body = 'caller mutation';
  assert.equal(snapshot[0].body, 'base');
  assert.equal(state.content.root[0].resources[0].body, 'root');
});
test('dependency compiler rejects unsafe and duplicate roots and dependencies', () => {
  for (const id of ['__proto__', 'constructor', '../outside', '', null]) assert.throws(() => resolveContentGraph({ content: {} }, [id]), { code: 'VALIDATION_ERROR' });
  assert.throws(() => resolveContentGraph(stateOf(revision('a')), ['a', 'a']), /unique/);
  assert.throws(() => resolveContentGraph(stateOf(revision('a', ['b', 'b']), revision('b')), ['a']), /unique/);
  assert.throws(() => resolveContentGraph(stateOf(revision('a', 'b')), ['a']), /array/);
});
