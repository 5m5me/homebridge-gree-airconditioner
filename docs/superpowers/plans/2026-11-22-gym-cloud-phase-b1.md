# Gym Cloud Phase B1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the cloud messaging session (MQTT over TLS) that carries encrypted status requests and commands to a cloud-only Gree unit, and extend the probe so it can read one unit's live status. The running plugin still does not use any cloud code.

**Architecture:** `src/cloud/cloudSession.ts` owns one MQTT connection per account. It exposes `registerDevice`, `publish` and a per-device pack handler, and hides sign-in renewal and reconnects. Pure helpers (envelope, topics, tolerant decryption) are exported for unit tests. The MQTT client is created through an injectable factory so tests use a fake.

**Tech Stack:** TypeScript 6, ES modules (`nodenext`), Node 22, npm package `mqtt` (version 5), Node test runner.

## Probe result this plan is based on (2026-11-22)

The Homebridge account signs in to the Australia region and sees five units. The Gym unit is `mac=580d0d872e16`, `ver=V3.2.M`, `mid=10001`, online, key present. Version 3.2 and above uses the MQTT route in the reference implementation.

## Global Constraints

- Package name stays `homebridge-gree-ac`. Version becomes `2.3.3-dry.3`.
- The only new runtime dependency allowed is `mqtt` (`^5.16.1`).
- No behaviour change to the running plugin: do not import any `src/cloud/` file from `src/platform.ts`, `src/platformAccessory.ts` or `src/index.ts`.
- Never print or log the password, the session token or a device key, in any code path, including errors and debug output. Decrypted device packs (status values) may be printed by the probe.
- Code style: single quotes, 2-space indent, semicolons, trailing commas on multiline, max line length 160, braces on all blocks. `npm run lint` must pass with zero warnings.
- Imports between source files use the `.js` extension.
- No em dashes in any text written (docs, comments, commit messages, program output).
- Run all commands from the repository root.

---

### Task 1: Cloud session and status probe

**Files:**
- Create: `src/cloud/cloudSession.ts`
- Create: `test/cloudSession.test.mjs`
- Modify: `src/cloud/cloudProbe.ts` (add the `--status <mac>` mode)
- Modify: `package.json`, `package-lock.json` (add `mqtt`, version bump), `src/version.ts` (regenerated), `README.md`, `CHANGELOG.md`

**Reference implementation (read only, do not execute; MIT licence):**
- `/home/claude/ref/gc/greeclimate_davo22-2.7.6/greeclimate_davo22/mqtt_client.py`
- `/home/claude/ref/gc/greeclimate_davo22-2.7.6/greeclimate_davo22/cloud_device.py` (see `_mqtt_request`, `_handle_mqtt_message`, `request_status`, `send_command`)
- `/home/claude/ref/gc/greeclimate_davo22-2.7.6/greeclimate_davo22/cipher.py` (`CipherV1`)

Port only what this task lists. Do not port sub-device (parent and child MAC) handling, the legacy TLS gateway, or CipherV2.

**Protocol facts (from the reference):**

- Brokers by region (TLS, port 1984, MQTT 3.1.1, clean session):
  - `Australia`: `mqtt-au.gree.com`
  - `China Mainland`: `mqtt.gree.com`
  - `East South Asia`: `mqtt-hk.gree.com`
  - `Europe`: `mqtt-eu.gree.com`
  - `India`: `mqtt-in.gree.com`
  - `Middle East`: `mqtt-me.gree.com`
  - `North American`: `mqtt-na.gree.com`
  - `Russia`: `mqtt-ru.gree.com`
  - `South American`: `mqtt-sa.gree.com`
- MQTT username is the user id as a string; MQTT password is the session token. Client id is `app_` followed by 16 random hex digits. Keepalive 60 seconds. The broker presents a custom certificate, so certificate verification is disabled for this connection (`rejectUnauthorized: false`).
- Per device (MAC without colons), subscribe with QoS 1 to `response/<mac>/#`, `status/<mac>/#` and `connect/<mac>`.
- To send, publish with QoS 1 to `request/<mac>` this JSON envelope: `{ "cid": "<random 10-digit decimal string>", "i": 0, "pack": "<base64>", "t": "pack", "tcid": "<mac>", "uid": <userId number> }`. Add `"tag": "<tag>"` only when a tag is supplied.
- The pack is the JSON of the inner message encrypted with the device key: AES-128-ECB, PKCS7 padding, base64. The key is the 16-character device key string from the cloud device list, used as UTF-8 bytes.
- Inner messages: status request `{ "t": "status", "cols": [...] }`; command `{ "t": "cmd", "opt": [...], "p": [...] }`. Replies arrive on a `response/<mac>/...` or `status/<mac>/...` topic as an envelope whose `pack` decrypts to `{ "t": "dat", "cols": [...], "dat": [...] }` or `{ "t": "res", "opt": [...], "p": [...] }`.
- Incoming packs may not use PKCS7 padding. Decrypt without automatic unpadding, decode as UTF-8, cut everything after the last `}`, then parse the JSON.

**Interfaces to produce in `src/cloud/cloudSession.ts` (exact names):**

```ts
export const GREE_MQTT_SERVERS: Record<string, string>;
export const GREE_MQTT_PORT = 1984;

export interface CloudEnvelope { cid: string; i: number; pack: string; t: string; tcid: string; uid: number; tag?: string; }

export function encryptPack(message: unknown, key: string): string;         // AES-128-ECB, PKCS7, base64
export function decryptPackTolerant(base64: string, key: string): Record<string, unknown>;
export function buildEnvelope(mac: string, pack: string, userId: number, cid: string, tag?: string): CloudEnvelope;
export function topicsFor(mac: string): string[];                           // the three subscribe topics, in the order listed above
export function requestTopic(mac: string): string;                          // 'request/<mac>'
export function macFromTopic(topic: string): string | undefined;            // second path segment for response/, status/ and connect/ topics
export function randomCid(): string;                                        // 10-digit decimal string, first digit 1 to 9
export function randomClientId(): string;                                   // 'app_' + 16 lowercase hex digits

// minimal shape of the mqtt client this module uses, so tests can supply a fake
export interface MqttClientLike {
  on(event: 'connect' | 'close' | 'error' | 'message', listener: (...args: never[]) => void): unknown;
  subscribe(topics: string[], options: { qos: 0 | 1 | 2 }, callback?: (err?: Error | null) => void): unknown;
  publish(topic: string, payload: string, options: { qos: 0 | 1 | 2 }, callback?: (err?: Error | null) => void): unknown;
  end(force?: boolean): unknown;
}
export type MqttConnect = (url: string, options: Record<string, unknown>) => MqttClientLike;

export interface CloudSessionLog { info(message: string): void; warn(message: string): void; debug(message: string): void; }
export type PackHandler = (pack: Record<string, unknown>, kind: 'response' | 'status') => void;

export class CloudSession {
  constructor(options: {
    region: string;
    userId: number;
    token: string;
    log?: CloudSessionLog;
    connect?: MqttConnect;                 // defaults to the `connect` function of the `mqtt` package
    renew?: () => Promise<{ userId: number; token: string }>;   // called to sign in again
  });
  start(): void;                           // opens the connection; safe to call once
  stop(): void;                            // closes the connection and stops reconnecting
  readonly connected: boolean;
  registerDevice(mac: string, key: string, handler: PackHandler): void;
  publish(mac: string, pack: string, tag?: string): boolean;   // false when not connected or the device is not registered
  send(mac: string, message: unknown): boolean;                // encrypts with the registered key, then publish
}
```

Behaviour rules:

- The constructor throws `Error('Unknown cloud region: <region>')` for a region not in `GREE_MQTT_SERVERS`.
- `start()` calls `connect('mqtts://<broker>:1984', options)` with options `{ clientId, username: String(userId), password: token, protocolVersion: 4, clean: true, keepalive: 60, rejectUnauthorized: false, reconnectPeriod: 5000, connectTimeout: 30000 }`.
- On every `connect` event the session subscribes to the topics of all registered devices. `registerDevice` while connected subscribes immediately.
- On `message` (arguments `topic: string`, `payload: Buffer`): parse the JSON envelope; find the device by `macFromTopic(topic)`; ignore `connect/` topics apart from a debug line; for `response/` and `status/` topics with a non-empty `pack`, decrypt with that device's key using `decryptPackTolerant` and call the handler with kind `response` or `status`. Any parse or decrypt failure is logged at debug level without the payload text and never throws.
- Sign-in renewal: when an `error` event's message contains `Not authorized` or `Bad username or password`, or after 3 consecutive `close` events with no `connect` in between, and `renew` is provided, the session calls `renew()` once, ends the old client, and connects again with the new user id and token. While a renewal is in progress further triggers are ignored. If `renew()` rejects, log a warning (without secrets) and try again after 60 seconds.
- `stop()` ends the client, cancels any pending renewal timer, and prevents further reconnects.
- No log line, at any level, may contain the token, the password or a device key.

**`src/cloud/cloudProbe.ts` changes:**

- New optional arguments: `--status <mac>`. Argument parsing: the first argument that does not start with `--` and is not the value of `--status` is the config path (default unchanged).
- Without `--status` the behaviour is unchanged.
- With `--status <mac>`: sign in, list devices, find the device with that MAC (case-insensitive). If it is not found print `Probe failed: device <mac> is not in this account` and exit 1. Otherwise create a `CloudSession` (with `renew` wired to a fresh sign-in), register the device, and once connected send the status request `{ t: 'status', cols: ['Pow', 'Mod', 'SetTem', 'TemSen', 'WdSpd', 'Blo', 'TemUn', 'SwUpDn', 'Quiet', 'Tur', 'Lig'] }`.
  - Print `Connected to <broker>.` when connected.
  - Print `Status: <JSON of an object mapping each returned col to its value>` for the first `dat` pack received, then stop the session and exit 0.
  - If nothing arrives within 20 seconds print `Probe failed: no status reply within 20 seconds` and exit 1.
  - Never print the key, token or password.
- Export the argument parser for unit tests: `export function parseProbeArgs(argv: string[]): { configPath: string; statusMac?: string };` where `argv` is `process.argv.slice(2)`.

**Test vectors (computed with the reference implementation; assert these exactly):**

With key `abcdefghijklmnop` and message string `{"t":"dat","cols":["Pow","Mod"],"dat":[1,2]}`:

- `encryptPack({ t: 'dat', cols: ['Pow', 'Mod'], dat: [1, 2] }, 'abcdefghijklmnop')` is `YXKxFYFeM+k+056D/PV2gQ1oZ7caeZLlNSDKZRrSeyBtKtQf0XlBCj90bC0OBDG8`.
- `decryptPackTolerant` of that string returns `{ t: 'dat', cols: ['Pow', 'Mod'], dat: [1, 2] }`.
- `decryptPackTolerant('YXKxFYFeM+k+056D/PV2gQ1oZ7caeZLlNSDKZRrSeyDFKY7EWD9ccy3VBGkvKeFa', 'abcdefghijklmnop')` (the same message with zero-byte padding) returns the same object.

**Steps:**

- [ ] **Step 1:** Run `npm install mqtt@^5.16.1 --save`. Confirm `package.json` lists it under `dependencies`.
- [ ] **Step 2:** Write `test/cloudSession.test.mjs` importing from `../dist/cloud/cloudSession.js` and `../dist/cloud/cloudProbe.js`. Use a fake MQTT client built on `node:events` `EventEmitter` that records `subscribe` and `publish` calls and lets the test emit `connect`, `close`, `error` and `message`. Cover: the three vectors; `buildEnvelope` with and without a tag; `topicsFor`, `requestTopic`, `macFromTopic` (including a topic with extra segments and an unrelated topic); `randomCid` and `randomClientId` formats; unknown region; the connect URL and options (assert the password option equals the token and `rejectUnauthorized` is false); subscribe on connect and on late `registerDevice`; `send` publishes to `request/<mac>` an envelope whose pack decrypts to the message; `publish` returns false before connect and for an unregistered device; an incoming `response/<mac>/x` message reaches the handler with kind `response` and a `status/<mac>` message with kind `status`; a malformed payload and an undecryptable pack do not throw and do not call the handler; renewal after a `Not authorized` error reconnects with the new credentials and calls `renew` once; renewal after 3 closes; `stop()` ends the client; a check that no collected log line contains the token or the key (use a recording log); `parseProbeArgs` for no arguments, a path only, `--status <mac>` only, and both in either order.
- [ ] **Step 3:** Run `npm test`. Expected: the build passes and the new test file fails because `dist/cloud/cloudSession.js` does not exist.
- [ ] **Step 4:** Implement `src/cloud/cloudSession.ts`, then the probe changes.
- [ ] **Step 5:** Run `npm test`. Expected: all tests pass (the 33 existing tests plus the new ones).
- [ ] **Step 6:** README: in the `Cloud-only units (experimental)` section add the `--status <mac>` probe usage and one sentence that the connection to the Gree broker does not verify the broker certificate because the broker uses a custom one. CHANGELOG: add `## [2.3.3-dry.3] - 2026-11-22` above the previous entry with two bullets (cloud messaging session; probe `--status`).
- [ ] **Step 7:** Run `npm version 2.3.3-dry.3 --no-git-tag-version`, then `npm test` and `npm run lint`. Expected: all tests pass, lint clean.
- [ ] **Step 8:** Commit everything in one commit with message `feat: add Gree cloud messaging session and status probe`.
