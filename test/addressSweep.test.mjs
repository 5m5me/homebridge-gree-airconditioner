import test from 'node:test';
import assert from 'node:assert/strict';
import { isIPv4, isPrivateIPv4, lostAfterSeconds, subnetPrefix, sweepTargets, isLost, sweepDue } from '../dist/addressSweep.js';

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

test('isPrivateIPv4', () => {
  for (const value of ['10.0.0.1', '172.16.0.1', '172.31.255.254', '192.168.55.13']) {
    assert.equal(isPrivateIPv4(value), true, value);
  }
  for (const value of ['172.15.0.1', '172.32.0.1', '192.169.1.1', '224.0.0.1', '8.8.8.8', '127.0.0.1', '169.254.1.1', 'cloud', undefined]) {
    assert.equal(isPrivateIPv4(value), false, String(value));
  }
});

test('lostAfterSeconds', () => {
  assert.equal(lostAfterSeconds(10, 90), 90);
  assert.equal(lostAfterSeconds(60, 90), 180);
  assert.equal(lostAfterSeconds(30, 90), 90);
  for (const value of [undefined, 0, -5, NaN, '60']) {
    assert.equal(lostAfterSeconds(value, 90), 90, String(value));
  }
});
