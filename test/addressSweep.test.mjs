import test from 'node:test';
import assert from 'node:assert/strict';
import { isIPv4, subnetPrefix, sweepTargets, isLost, sweepDue } from '../dist/addressSweep.js';

test('isIPv4 accepts valid addresses', () => {
  assert.equal(isIPv4('192.168.55.13'), true);
  assert.equal(isIPv4('0.0.0.0'), true);
  assert.equal(isIPv4('255.255.255.255'), true);
});

test('isIPv4 rejects everything else', () => {
  for (const value of ['cloud', '', undefined, null, 5, '192.168.55', '192.168.55.256', '192.168.55.13 ', ' 192.168.55.13', 'a.b.c.d', '1.2.3.4.5']) {
    assert.equal(isIPv4(value), false, String(value));
  }
});

test('subnetPrefix', () => {
  assert.equal(subnetPrefix('192.168.55.13'), '192.168.55');
  assert.equal(subnetPrefix('cloud'), undefined);
  assert.equal(subnetPrefix(undefined), undefined);
});

test('sweepTargets lists .1 to .254', () => {
  const targets = sweepTargets('192.168.55', []);
  assert.equal(targets.length, 254);
  assert.equal(targets[0], '192.168.55.1');
  assert.equal(targets[253], '192.168.55.254');
  assert.equal(targets.includes('192.168.55.0'), false);
  assert.equal(targets.includes('192.168.55.255'), false);
});

test('sweepTargets omits excluded addresses', () => {
  const targets = sweepTargets('192.168.55', ['192.168.55.10', '192.168.54.97']);
  assert.equal(targets.length, 253);
  assert.equal(targets.includes('192.168.55.10'), false);
  assert.equal(sweepTargets('192.168.55', ['192.168.54.97']).length, 254);
});

test('isLost', () => {
  const now = 1_000_000;
  const limit = 90_000;
  assert.equal(isLost(now - 10_000, 0, now, limit), false);
  assert.equal(isLost(now - 200_000, 0, now, limit), true);
  assert.equal(isLost(0, now - 10_000, now, limit), false);
  assert.equal(isLost(0, now - 200_000, now, limit), true);
  assert.equal(isLost(now - limit, 0, now, limit), false);
  assert.equal(isLost(0, now - limit, now, limit), false);
});

test('sweepDue', () => {
  const now = 1_000_000;
  assert.equal(sweepDue(undefined, now, 300_000), true);
  assert.equal(sweepDue(now - 1000, now, 300_000), false);
  assert.equal(sweepDue(now - 300_000, now, 300_000), true);
});
