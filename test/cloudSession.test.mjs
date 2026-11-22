import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers';

import {
  GREE_MQTT_SERVERS,
  GREE_MQTT_PORT,
  CloudSession,
  encryptPack,
  decryptPackTolerant,
  buildEnvelope,
  topicsFor,
  requestTopic,
  macFromTopic,
  randomCid,
  randomClientId,
} from '../dist/cloud/cloudSession.js';
import { parseProbeArgs } from '../dist/cloud/cloudProbe.js';

const KEY = 'abcdefghijklmnop';
const MAC = '580d0d872e16';
const TOKEN = 'token-secret-value';
const MESSAGE = { t: 'dat', cols: ['Pow', 'Mod'], dat: [1, 2] };
const PACK = 'YXKxFYFeM+k+056D/PV2gQ1oZ7caeZLlNSDKZRrSeyBtKtQf0XlBCj90bC0OBDG8';
const PACK_ZERO_PADDED = 'YXKxFYFeM+k+056D/PV2gQ1oZ7caeZLlNSDKZRrSeyDFKY7EWD9ccy3VBGkvKeFa';

class FakeClient extends EventEmitter {
  constructor(url, options) {
    super();
    this.url = url;
    this.options = options;
    this.subscribes = [];
    this.publishes = [];
    this.ended = false;
  }
  subscribe(topics, options, callback) {
    this.subscribes.push({ topics, options });
    callback?.(null);
  }
  publish(topic, payload, options, callback) {
    this.publishes.push({ topic, payload, options });
    callback?.(null);
  }
  end(force) {
    this.ended = true;
    this.endForce = force;
  }
}

function makeSession(extra = {}) {
  const clients = [];
  const logs = [];
  const log = {
    info: (m) => logs.push(m),
    warn: (m) => logs.push(m),
    debug: (m) => logs.push(m),
  };
  const session = new CloudSession({
    region: 'Australia',
    userId: 42,
    token: TOKEN,
    log,
    connect: (url, options) => {
      const client = new FakeClient(url, options);
      clients.push(client);
      return client;
    },
    ...extra,
  });
  return { session, clients, logs };
}

function envelopeFor(message, key = KEY) {
  return Buffer.from(JSON.stringify({ cid: '1', i: 0, pack: encryptPack(message, key), t: 'pack', tcid: MAC, uid: 42 }));
}

test('encryptPack matches the reference vector', () => {
  assert.equal(encryptPack(MESSAGE, KEY), PACK);
});

test('decryptPackTolerant reads PKCS7 and zero padded packs', () => {
  assert.deepEqual(decryptPackTolerant(PACK, KEY), MESSAGE);
  assert.deepEqual(decryptPackTolerant(PACK_ZERO_PADDED, KEY), MESSAGE);
});

test('buildEnvelope with and without a tag', () => {
  assert.deepEqual(buildEnvelope(MAC, 'pk', 42, '1234567890'), { cid: '1234567890', i: 0, pack: 'pk', t: 'pack', tcid: MAC, uid: 42 });
  assert.deepEqual(buildEnvelope(MAC, 'pk', 42, '1234567890', 'x'), { cid: '1234567890', i: 0, pack: 'pk', t: 'pack', tcid: MAC, uid: 42, tag: 'x' });
});

test('topic helpers', () => {
  assert.deepEqual(topicsFor(MAC), [`response/${MAC}/#`, `status/${MAC}/#`, `connect/${MAC}`]);
  assert.equal(requestTopic(MAC), `request/${MAC}`);
  assert.equal(macFromTopic(`response/${MAC}/a/b`), MAC);
  assert.equal(macFromTopic(`status/${MAC}`), MAC);
  assert.equal(macFromTopic(`connect/${MAC}`), MAC);
  assert.equal(macFromTopic(`request/${MAC}`), undefined);
  assert.equal(macFromTopic('other'), undefined);
});

test('random identifiers have the expected format', () => {
  for (let i = 0; i < 50; i++) {
    assert.match(randomCid(), /^[1-9][0-9]{9}$/);
    assert.match(randomClientId(), /^app_[0-9a-f]{16}$/);
  }
});

test('the broker table and port', () => {
  assert.equal(GREE_MQTT_PORT, 1984);
  assert.equal(GREE_MQTT_SERVERS.Australia, 'mqtt-au.gree.com');
  assert.equal(Object.keys(GREE_MQTT_SERVERS).length, 9);
});

test('an unknown region throws', () => {
  assert.throws(() => new CloudSession({ region: 'Nowhere', userId: 1, token: 't' }), /Unknown cloud region: Nowhere/);
});

test('start connects with the expected url and options', () => {
  const { session, clients } = makeSession();
  session.start();
  session.stop();
  assert.equal(clients.length, 1);
  assert.equal(clients[0].url, 'mqtts://mqtt-au.gree.com:1984');
  const o = clients[0].options;
  assert.match(o.clientId, /^app_[0-9a-f]{16}$/);
  assert.equal(o.username, '42');
  assert.equal(o.password, TOKEN);
  assert.equal(o.protocolVersion, 4);
  assert.equal(o.clean, true);
  assert.equal(o.keepalive, 60);
  assert.equal(o.rejectUnauthorized, false);
  assert.equal(o.reconnectPeriod, 5000);
  assert.equal(o.connectTimeout, 30000);
});

test('subscribes on connect and when a device registers late', () => {
  const { session, clients } = makeSession();
  session.registerDevice(MAC, KEY, () => {});
  session.start();
  assert.equal(session.connected, false);
  clients[0].emit('connect');
  assert.equal(session.connected, true);
  assert.deepEqual(clients[0].subscribes, [{ topics: topicsFor(MAC), options: { qos: 1 } }]);
  const other = '111122223333';
  session.registerDevice(other, KEY, () => {});
  assert.deepEqual(clients[0].subscribes[1], { topics: topicsFor(other), options: { qos: 1 } });
  session.stop();
});

test('send publishes an encrypted envelope to the request topic', () => {
  const { session, clients } = makeSession();
  session.registerDevice(MAC, KEY, () => {});
  session.start();
  clients[0].emit('connect');
  assert.equal(session.send(MAC, { t: 'status', cols: ['Pow'] }), true);
  const sent = clients[0].publishes[0];
  assert.equal(sent.topic, `request/${MAC}`);
  assert.deepEqual(sent.options, { qos: 1 });
  const envelope = JSON.parse(sent.payload);
  assert.equal(envelope.t, 'pack');
  assert.equal(envelope.tcid, MAC);
  assert.equal(envelope.uid, 42);
  assert.equal(envelope.i, 0);
  assert.match(envelope.cid, /^[1-9][0-9]{9}$/);
  assert.equal('tag' in envelope, false);
  assert.deepEqual(decryptPackTolerant(envelope.pack, KEY), { t: 'status', cols: ['Pow'] });
  session.stop();
});

test('publish returns false before connect and for an unregistered device', () => {
  const { session, clients } = makeSession();
  session.registerDevice(MAC, KEY, () => {});
  session.start();
  assert.equal(session.publish(MAC, 'pk'), false);
  assert.equal(session.send(MAC, {}), false);
  clients[0].emit('connect');
  assert.equal(session.publish('999999999999', 'pk'), false);
  assert.equal(session.send('999999999999', {}), false);
  assert.equal(session.publish(MAC, 'pk', 'tg'), true);
  assert.equal(JSON.parse(clients[0].publishes[0].payload).tag, 'tg');
  session.stop();
});

test('incoming messages reach the handler with the right kind', () => {
  const { session, clients } = makeSession();
  const received = [];
  session.registerDevice(MAC, KEY, (pack, kind) => received.push({ pack, kind }));
  session.start();
  clients[0].emit('connect');
  clients[0].emit('message', `response/${MAC}/x`, envelopeFor(MESSAGE));
  clients[0].emit('message', `status/${MAC}`, envelopeFor({ t: 'res', opt: ['Pow'], p: [1] }));
  clients[0].emit('message', `connect/${MAC}`, Buffer.from('{"online":1}'));
  assert.deepEqual(received, [
    { pack: MESSAGE, kind: 'response' },
    { pack: { t: 'res', opt: ['Pow'], p: [1] }, kind: 'status' },
  ]);
  session.stop();
});

test('bad payloads do not throw and do not call the handler', () => {
  const { session, clients, logs } = makeSession();
  let calls = 0;
  session.registerDevice(MAC, KEY, () => calls++);
  session.start();
  clients[0].emit('connect');
  clients[0].emit('message', `response/${MAC}/x`, Buffer.from('not json'));
  clients[0].emit('message', `response/${MAC}/x`, Buffer.from(JSON.stringify({ pack: 'AAAA' })));
  clients[0].emit('message', `response/${MAC}/x`, envelopeFor(MESSAGE, 'zzzzzzzzzzzzzzzz'));
  clients[0].emit('message', `response/${MAC}/x`, Buffer.from(JSON.stringify({ pack: '' })));
  clients[0].emit('message', 'response/unknownmac/x', envelopeFor(MESSAGE));
  assert.equal(calls, 0);
  assert.ok(logs.every((l) => !l.includes('not json')));
  session.stop();
});

test('renews after a Not authorized error', async () => {
  let renewCalls = 0;
  const { session, clients } = makeSession({
    renew: async () => {
      renewCalls++;
      return { userId: 43, token: 'new-token' };
    },
  });
  session.registerDevice(MAC, KEY, () => {});
  session.start();
  clients[0].emit('error', new Error('Connection refused: Not authorized'));
  clients[0].emit('error', new Error('Connection refused: Bad username or password'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(renewCalls, 1);
  assert.equal(clients[0].ended, true);
  assert.equal(clients.length, 2);
  assert.equal(clients[1].options.username, '43');
  assert.equal(clients[1].options.password, 'new-token');
  clients[1].emit('connect');
  assert.deepEqual(clients[1].subscribes[0].topics, topicsFor(MAC));
  session.stop();
});

test('renews after 3 closes with no connect in between', async () => {
  let renewCalls = 0;
  const { session, clients } = makeSession({
    renew: async () => {
      renewCalls++;
      return { userId: 43, token: 'new-token' };
    },
  });
  session.start();
  clients[0].emit('close');
  clients[0].emit('close');
  clients[0].emit('connect');
  clients[0].emit('close');
  clients[0].emit('close');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(renewCalls, 0);
  clients[0].emit('close');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(renewCalls, 1);
  assert.equal(clients.length, 2);
  session.stop();
});

test('a failed renewal retries after 60 seconds and stop cancels the timer', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let renewCalls = 0;
    const { session, clients, logs } = makeSession({
      renew: async () => {
        renewCalls++;
        if (renewCalls === 1) {
          throw new Error(`failure containing ${TOKEN}`);
        }
        return { userId: 44, token: 'newer-token' };
      },
    });
    session.start();
    clients[0].emit('error', new Error('Not authorized'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(renewCalls, 1);
    assert.equal(clients.length, 1);
    assert.ok(logs.some((l) => l.includes('60 seconds')));
    mock.timers.tick(59_000);
    assert.equal(renewCalls, 1);
    mock.timers.tick(1_000);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(renewCalls, 2);
    assert.equal(clients.length, 2);
    assert.equal(clients[1].options.username, '44');
    session.stop();

    // a pending retry is cancelled by stop
    const second = makeSession({
      renew: async () => {
        throw new Error('no');
      },
    });
    second.session.start();
    second.clients[0].emit('error', new Error('Not authorized'));
    await new Promise((resolve) => setImmediate(resolve));
    second.session.stop();
    mock.timers.tick(120_000);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(second.clients.length, 1);
  } finally {
    mock.timers.reset();
  }
});

test('stop ends the client and prevents further reconnects', async () => {
  let renewCalls = 0;
  const { session, clients } = makeSession({
    renew: async () => {
      renewCalls++;
      return { userId: 43, token: 'x' };
    },
  });
  session.start();
  clients[0].emit('connect');
  session.stop();
  assert.equal(clients[0].ended, true);
  assert.equal(session.connected, false);
  clients[0].emit('error', new Error('Not authorized'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(renewCalls, 0);
  assert.equal(clients.length, 1);
});

test('no log line contains the token or the key', async () => {
  const { session, clients, logs } = makeSession({
    renew: async () => {
      throw new Error(`renew failed ${TOKEN}`);
    },
  });
  session.registerDevice(MAC, KEY, () => {});
  session.start();
  clients[0].emit('connect');
  clients[0].emit('message', `response/${MAC}/x`, Buffer.from('garbage'));
  clients[0].emit('message', `response/${MAC}/x`, envelopeFor(MESSAGE, 'zzzzzzzzzzzzzzzz'));
  clients[0].emit('message', `connect/${MAC}`, Buffer.from('{}'));
  clients[0].emit('error', new Error('Not authorized'));
  await new Promise((resolve) => setImmediate(resolve));
  session.stop();
  assert.ok(logs.length > 0);
  for (const line of logs) {
    assert.ok(!line.includes(TOKEN), line);
    assert.ok(!line.includes(KEY), line);
  }
});

test('parseProbeArgs', () => {
  const DEFAULT = '/var/lib/homebridge/config.json';
  assert.deepEqual(parseProbeArgs([]), { configPath: DEFAULT, statusMac: undefined });
  assert.deepEqual(parseProbeArgs(['/tmp/c.json']), { configPath: '/tmp/c.json', statusMac: undefined });
  assert.deepEqual(parseProbeArgs(['--status', MAC]), { configPath: DEFAULT, statusMac: MAC });
  assert.deepEqual(parseProbeArgs(['/tmp/c.json', '--status', MAC]), { configPath: '/tmp/c.json', statusMac: MAC });
  assert.deepEqual(parseProbeArgs(['--status', MAC, '/tmp/c.json']), { configPath: '/tmp/c.json', statusMac: MAC });
});
