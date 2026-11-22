import { test } from 'node:test';
import assert from 'node:assert/strict';

import { contextSnapshot, contextChanged } from '../dist/contextSave.js';

test('key order does not change the snapshot, also in nested objects', () => {
  const a = { x: 1, y: { b: 2, a: [{ q: 1, p: 2 }] }, z: 'text' };
  const b = { z: 'text', y: { a: [{ p: 2, q: 1 }], b: 2 }, x: 1 };
  assert.equal(contextSnapshot(a), contextSnapshot(b));
});

test('a changed value, an added key and a removed key change the snapshot', () => {
  const base = { a: 1, b: 2 };
  assert.notEqual(contextSnapshot(base), contextSnapshot({ a: 1, b: 3 }));
  assert.notEqual(contextSnapshot(base), contextSnapshot({ a: 1, b: 2, c: 3 }));
  assert.notEqual(contextSnapshot(base), contextSnapshot({ a: 1 }));
});

test('array order is kept, so a different order is a change', () => {
  assert.notEqual(contextSnapshot({ list: [1, 2, 3] }), contextSnapshot({ list: [3, 2, 1] }));
  assert.equal(contextSnapshot({ list: [1, 2, 3] }), contextSnapshot({ list: [1, 2, 3] }));
});

test('contextChanged is true without a last snapshot and when snapshots differ', () => {
  assert.equal(contextChanged(undefined, '{}'), true);
  assert.equal(contextChanged(undefined, ''), true);
  assert.equal(contextChanged('{"a":1}', '{"a":1}'), false);
  assert.equal(contextChanged('{"a":1}', '{"a":2}'), true);
});

test('a circular context gives an empty string without throwing', () => {
  const ctx = { a: 1 };
  ctx.self = ctx;
  assert.equal(contextSnapshot(ctx), '');
});

test('an empty current snapshot always counts as changed', () => {
  assert.equal(contextChanged('', ''), true);
  assert.equal(contextChanged('{"a":1}', ''), true);
});
