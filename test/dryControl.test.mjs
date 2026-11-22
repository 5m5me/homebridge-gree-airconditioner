import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isDryActive, buildDryCommand, nextRetryAction } from '../dist/dryControl.js';

const OFF = { power: false, mode: 1, xFanEnabled: false, xFanOn: false };
const COOL = { power: true, mode: 1, xFanEnabled: false, xFanOn: false };
const DRY = { power: true, mode: 2, xFanEnabled: false, xFanOn: false };
const OFF_IN_DRY = { power: false, mode: 2, xFanEnabled: false, xFanOn: false };

test('isDryActive is true only when powered on in dry mode', () => {
  assert.equal(isDryActive(true, 2), true);
  assert.equal(isDryActive(false, 2), false);
  assert.equal(isDryActive(true, 1), false);
});

test('dry on from off sends power on and mode dry', () => {
  assert.deepEqual(buildDryCommand(true, OFF), { Pow: 1, Mod: 2 });
});

test('dry on while cooling sends only mode dry', () => {
  assert.deepEqual(buildDryCommand(true, COOL), { Mod: 2 });
});

test('dry on when powered off but last mode was dry sends only power on', () => {
  assert.deepEqual(buildDryCommand(true, OFF_IN_DRY), { Pow: 1 });
});

test('dry on when already dry sends nothing', () => {
  assert.equal(buildDryCommand(true, DRY), null);
});

test('dry on turns xFan on when enabled and currently off', () => {
  assert.deepEqual(buildDryCommand(true, { ...OFF, xFanEnabled: true }), { Pow: 1, Mod: 2, Blo: 1 });
});

test('dry on leaves xFan alone when it is already on', () => {
  assert.deepEqual(buildDryCommand(true, { ...OFF, xFanEnabled: true, xFanOn: true }), { Pow: 1, Mod: 2 });
});

test('dry off while dry sends power off', () => {
  assert.deepEqual(buildDryCommand(false, DRY), { Pow: 0 });
});

test('dry off while cooling sends nothing', () => {
  assert.equal(buildDryCommand(false, COOL), null);
});

test('dry off while already off sends nothing', () => {
  assert.equal(buildDryCommand(false, OFF), null);
});

test('retry is done when the unit matches the desired state', () => {
  assert.equal(nextRetryAction(true, DRY, 0, 2), 'done');
  assert.equal(nextRetryAction(false, OFF, 0, 2), 'done');
  assert.equal(nextRetryAction(false, COOL, 0, 2), 'done');
});

test('retry resends while resends remain', () => {
  assert.equal(nextRetryAction(true, OFF, 0, 2), 'resend');
  assert.equal(nextRetryAction(true, OFF, 1, 2), 'resend');
  assert.equal(nextRetryAction(false, DRY, 1, 2), 'resend');
});

test('retry gives up after the maximum resends', () => {
  assert.equal(nextRetryAction(true, OFF, 2, 2), 'giveUp');
  assert.equal(nextRetryAction(false, DRY, 2, 2), 'giveUp');
});
