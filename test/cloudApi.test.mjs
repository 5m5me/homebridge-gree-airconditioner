import { test } from 'node:test';
import assert from 'node:assert/strict';
import { URL } from 'node:url';

import {
  GREE_CLOUD_SERVERS,
  DEFAULT_CLOUD_REGION,
  GreeCloudApi,
  hashPassword,
  buildBody,
  encryptBody,
  decryptBody,
  formatTimestamp,
} from '../dist/cloud/cloudApi.js';
import { formatDeviceLine } from '../dist/cloud/cloudProbe.js';

const DATE = new Date(Date.UTC(2026, 0, 2, 3, 4, 5));
const T = '2026-01-02 03:04:05';
const USER = 'user@example.com';
const PASSWORD = 'secret-pass';
const HEADERS = {
  'Content-Type': 'application/x-www-form-urlencoded',
  'Gaen1': '5ac2bdf935bcca70',
  'Charset': 'utf-8',
};

// Builds a fake fetch that decrypts each request, records it and answers from the replies map (keyed by URL path).
function fakeFetch(replies, calls = [], status = 200) {
  return async (url, init) => {
    const parsed = new URL(url);
    const body = JSON.parse(decryptBody(init.body));
    calls.push({ url, path: parsed.pathname, host: parsed.origin, init, body });
    const reply = typeof replies[parsed.pathname] === 'function' ? replies[parsed.pathname](body) : replies[parsed.pathname];
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Internal Server Error',
      json: async () => ({ enRes: encryptBody(JSON.stringify(reply)) }),
    };
  };
}

function makeApi(replies, calls = [], status = 200) {
  return new GreeCloudApi('Australia', USER, PASSWORD, fakeFetch(replies, calls, status), () => DATE);
}

test('default region and server table', () => {
  assert.equal(DEFAULT_CLOUD_REGION, 'Australia');
  assert.equal(GREE_CLOUD_SERVERS.Australia, 'https://augrih.gree.com');
  assert.equal(Object.keys(GREE_CLOUD_SERVERS).length, 9);
});

test('formatTimestamp is UTC', () => {
  assert.equal(formatTimestamp(DATE), T);
});

test('hashPassword matches the reference vector', () => {
  assert.equal(hashPassword(PASSWORD, T), 'f2e09c36f3a1861a063c58c4b0f3f057');
});

test('buildBody signs the login payload', () => {
  const body = buildBody({ psw: 'f2e09c36f3a1861a063c58c4b0f3f057', t: T, user: USER }, DATE, ['user', 'psw', 't']);
  assert.equal(body.api.vc, '2321631fdbe1838e7d906125cbfbdd97');
  assert.equal(body.api.r, 1767323045);
  assert.equal(body.api.t, T);
  assert.equal(body.api.appId, '4920681951525131286');
  assert.equal(body.datVc, '9c930a6cf76347e089fd31248c28a5a1');
  assert.equal(body.user, USER);
});

test('buildBody datVc vectors', () => {
  assert.equal(buildBody({ token: 'tok123', uid: 42 }, DATE, ['token', 'uid']).datVc, 'a1e644274c2b73c7294dae26afbabfec');
  assert.equal(buildBody({ token: 'tok123', homeId: 7, uid: 42 }, DATE, ['token', 'uid', 'homeId']).datVc, 'fc70fb53d8c64a6d23d4ef613dbb814a');
  assert.equal(
    buildBody({ token: 'tok123', uid: 42, macs: ['aabbccddeeff', '112233445566'] }, DATE, ['token', 'uid', 'macs']).datVc,
    '4df29a353d463753409a40f8e3e12ae7',
  );
});

test('encryptBody and decryptBody match the reference vector', () => {
  assert.equal(encryptBody('{"hello":"world"}'), 'OhpPjPyY0oB3hOJaRn9n19dhqUvvkSt8RShXElvsmGI=');
  assert.equal(decryptBody('OhpPjPyY0oB3hOJaRn9n19dhqUvvkSt8RShXElvsmGI='), '{"hello":"world"}');
});

test('unknown region throws', () => {
  assert.throws(() => new GreeCloudApi('Mars', USER, PASSWORD), { message: 'Unknown cloud region: Mars' });
});

test('getHomes and getDevices require sign in', async () => {
  const api = makeApi({});
  await assert.rejects(api.getHomes(), { message: 'Not signed in' });
  await assert.rejects(api.getDevices(1), { message: 'Not signed in' });
});

test('login with top-level uid and token sends a correct request', async () => {
  const calls = [];
  const api = makeApi({ '/App/UserLoginV2': { uid: 42, token: 'tok123' } }, calls);
  const creds = await api.login();
  assert.deepEqual(creds, { userId: 42, token: 'tok123' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].host, 'https://augrih.gree.com');
  assert.equal(calls[0].path, '/App/UserLoginV2');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(calls[0].init.headers, HEADERS);
  assert.equal(calls[0].body.user, USER);
  assert.equal(calls[0].body.t, T);
  assert.equal(calls[0].body.psw, 'f2e09c36f3a1861a063c58c4b0f3f057');
  assert.equal(calls[0].body.datVc, '9c930a6cf76347e089fd31248c28a5a1');
  assert.equal(calls[0].body.api.vc, '2321631fdbe1838e7d906125cbfbdd97');
});

test('login with uid and token inside data', async () => {
  const api = makeApi({ '/App/UserLoginV2': { r: 200, data: { uid: 7, token: 'abc' } } });
  assert.deepEqual(await api.login(), { userId: 7, token: 'abc' });
});

test('login failure reports the reason without the password', async () => {
  const api = makeApi({ '/App/UserLoginV2': { r: 401, msg: 'bad password' } });
  await assert.rejects(api.login(), (err) => {
    assert.equal(err.message, 'Cloud sign-in failed: bad password');
    assert.ok(!err.message.includes(PASSWORD));
    return true;
  });
});

test('login failure without a message says unknown error', async () => {
  const api = makeApi({ '/App/UserLoginV2': { r: 500 } });
  await assert.rejects(api.login(), { message: 'Cloud sign-in failed: unknown error' });
});

test('HTTP failure throws status and text', async () => {
  const api = makeApi({ '/App/UserLoginV2': {} }, [], 500);
  await assert.rejects(api.login(), { message: 'HTTP 500 Internal Server Error' });
});

test('getHomes sends a signed request and maps homes', async () => {
  const calls = [];
  const api = makeApi({
    '/App/UserLoginV2': { uid: 42, token: 'tok123' },
    '/App/GetHomes': { home: [{ id: 1, name: 'Main' }, { id: 2, name: 'Gym' }] },
  }, calls);
  await api.login();
  const homes = await api.getHomes();
  assert.deepEqual(homes, [{ id: 1, name: 'Main' }, { id: 2, name: 'Gym' }]);
  assert.equal(calls[1].path, '/App/GetHomes');
  assert.equal(calls[1].body.token, 'tok123');
  assert.equal(calls[1].body.uid, 42);
  assert.equal(calls[1].body.datVc, 'a1e644274c2b73c7294dae26afbabfec');
});

const DEVICES_REPLY = {
  rooms: [
    {
      devs: [
        { name: '  Gym AC ', mac: ' aabbccddeeff ', key: ' KEY1234567890123 ', model: ' gree ', ver: ' V1.2 ', online: 0, pmac: '', mid: 10001 },
        { name: 'Lounge', mac: '112233445566', key: 'KEY2', online: 1, pmac: ' 665544332211 ', mid: '60' },
      ],
    },
    { devs: [{ name: 'Bed', mac: '001122334455', key: 'KEY3', online: false }] },
  ],
};

test('getDevices maps and trims device records', async () => {
  const calls = [];
  const api = makeApi({ '/App/UserLoginV2': { uid: 42, token: 'tok123' }, '/App/GetDevsInRoomsOfHomeV2': DEVICES_REPLY }, calls);
  await api.login();
  const devices = await api.getDevices(7);
  assert.equal(calls[1].path, '/App/GetDevsInRoomsOfHomeV2');
  assert.equal(calls[1].body.homeId, 7);
  assert.equal(calls[1].body.datVc, 'fc70fb53d8c64a6d23d4ef613dbb814a');
  assert.equal(devices.length, 3);
  assert.deepEqual(devices[0], {
    name: 'Gym AC',
    mac: 'aabbccddeeff',
    key: 'KEY1234567890123',
    model: 'gree',
    version: 'V1.2',
    online: false,
    parentMac: undefined,
    mid: '10001',
  });
  assert.equal(devices[1].online, true);
  assert.equal(devices[1].parentMac, '665544332211');
  assert.equal(devices[1].mid, '60');
  assert.equal(devices[1].model, undefined);
  assert.equal(devices[2].online, false);
});

test('getAllDevices concatenates devices across homes', async () => {
  const api = makeApi({
    '/App/UserLoginV2': { uid: 42, token: 'tok123' },
    '/App/GetHomes': { home: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] },
    '/App/GetDevsInRoomsOfHomeV2': (body) => ({
      rooms: [{ devs: [{ name: `Unit in ${body.homeId}`, mac: `mac${body.homeId}`, key: 'k', online: 1 }] }],
    }),
  });
  await api.login();
  const devices = await api.getAllDevices();
  assert.deepEqual(devices.map((d) => d.name), ['Unit in 1', 'Unit in 2']);
});

test('formatDeviceLine for a full record', () => {
  const line = formatDeviceLine({
    name: 'Gym AC', mac: 'aabbccddeeff', key: 'SECRETKEY', model: 'gree', version: 'V1.2', online: true, parentMac: '112233445566', mid: '10001',
  });
  assert.equal(line, 'Gym AC | mac=aabbccddeeff | model=gree | ver=V1.2 | online=yes | parent=112233445566 | mid=10001 | key=present');
  assert.ok(!line.includes('SECRETKEY'));
});

test('formatDeviceLine for a sparse record', () => {
  const line = formatDeviceLine({ name: 'Bed', mac: '001122334455', key: '', online: false });
  assert.equal(line, 'Bed | mac=001122334455 | model=- | ver=- | online=no | parent=- | mid=- | key=missing');
});
