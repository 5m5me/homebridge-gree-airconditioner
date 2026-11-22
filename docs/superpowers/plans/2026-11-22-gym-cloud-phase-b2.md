# Gym Cloud Phase B2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a unit marked `cloudControl` in the config be controlled through the Gree cloud session, using the same accessory class (Heater Cooler, Fan, Dry switch) as local units.

**Architecture:** The accessory gets an optional `cloudSend` hook and a public `processPack` method. When `cloudSend` is set, outgoing encrypted packs go to it instead of the UDP socket, and the cloud session feeds decrypted packs to `processPack`. The platform signs in once at start-up, opens one `CloudSession`, and registers each `cloudControl` unit from the cloud device list. Local units are untouched.

**Tech Stack:** TypeScript 6, ES modules (`nodenext`), Homebridge 2 API, the existing `src/cloud/cloudApi.ts` and `src/cloud/cloudSession.ts`.

## Live facts this plan is based on (2026-11-22)

- The account signs in to region `Australia` and lists the Gym unit: `mac=580d0d872e16`, `ver=V3.2.M`, `mid=10001`.
- A status request `{ t: 'status', cols: [...] }` (no `mac` field) over the session returns a `dat` pack. The pack contains many more columns than requested (over 100), including `Pow`, `Mod`, `SetTem`, `TemSen`, `WdSpd`, `Blo`, `TemUn`, `SwUpDn`, `Quiet`, `Tur`, `Lig`, with the same meanings and value ranges as local units (`TemSen` 71 for 31 degrees C, the usual offset of 40).

## Global Constraints

- Package name stays `homebridge-gree-ac`. Version becomes `2.4.0-cloud.1`.
- No new dependencies.
- No behaviour change for any device without `cloudControl: true`, and none at all when the config has no `cloud` account. In particular the local message flow (`handleMessage` for UDP) must behave exactly as before.
- Never print or log the password, the session token or a device key, at any log level. The device key must not be stored in `accessory.context` (it is written to disk).
- A cloud failure (sign-in rejected, network down, broker down, a malformed message, an exception anywhere in the cloud path) must never crash the plugin or disturb the local units. No unhandled promise rejections.
- Code style: single quotes, 2-space indent, semicolons, trailing commas on multiline, max line length 160, braces on all blocks. `npm run lint` must pass with zero warnings.
- Imports between source files use the `.js` extension.
- No em dashes in any text written (docs, comments, commit messages, log messages).
- Run all commands from the repository root.

---

### Task 1: Cloud-controlled accessory and platform wiring

**Files:**
- Modify: `src/settings.ts`
- Modify: `src/platformAccessory.ts`
- Modify: `src/platform.ts`
- Modify: `config.schema.json`, `README.md`, `CHANGELOG.md`, `package.json`, `package-lock.json`, `src/version.ts` (regenerated)

**Interfaces consumed (already exist):**

From `src/cloud/cloudApi.ts`:
- `class GreeCloudApi { constructor(region: string, username: string, password: string); login(): Promise<{ userId: number; token: string }>; getAllDevices(): Promise<CloudDeviceInfo[]>; }`
- `interface CloudDeviceInfo { name: string; mac: string; key: string; model?: string; version?: string; online: boolean; parentMac?: string; mid?: string; }`
- `DEFAULT_CLOUD_REGION` (`'Australia'`)

From `src/cloud/cloudSession.ts` (read the file for the exact current constructor options):
- `class CloudSession { constructor(options: { region; userId; token; log?; connect?; renew?; now? }); start(): void; stop(): void; readonly connected: boolean; registerDevice(mac: string, key: string, handler: (pack: Record<string, unknown>, kind: 'response' | 'status') => void): void; publish(mac: string, pack: string, tag?: string): boolean; }`
- `interface CloudSessionLog { info(message: string): void; warn(message: string): void; debug(message: string): void; }`

From `src/settings.ts`: `CloudConfig { username?: string; password?: string; region?: string; }`.

#### Part A: settings

- [ ] In `interface DeviceConfig` add `cloudControl?: boolean;` directly after `dryControlEnabled?: boolean;`.
- [ ] Add at the end of the file: `export const CLOUD_MIN_STATUS_INTERVAL = 30; // seconds, lowest status polling interval for cloud controlled devices`.

#### Part B: accessory (`src/platformAccessory.ts`)

- [ ] Add a public field to class `GreeAirConditioner`, next to `public key?: string;`:

```ts
  // set for cloud controlled devices: sends an encrypted pack through the cloud session, returns false if it could not be sent
  public cloudSend?: (pack: string, tag?: string) => boolean;
```

- [ ] Extract pack processing. `handleMessage` currently decrypts the message into `pack`, logs `handleMessage - Package -> %j`, and then runs `switch ((pack.t as string).toLowerCase()) { ... }` with cases `bindok`, `dat`, `res` and `default`. Move that whole `switch` statement, unchanged, into a new public method and call it from `handleMessage` where the `switch` was:

```ts
  // processes a decrypted package from the device (used by the local message handler and by the cloud session)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public processPack(pack: any) {
    switch ((pack.t as string).toLowerCase()) {
      // ...the existing cases, moved without changes...
    }
  }
```

  The `default` case logs `handleMessage - Unknown message: %j` with a variable named `message` that exists only in `handleMessage`. In `processPack` log the `pack` instead (`this.platform.log.debug(..., pack)`), and keep the warning line as it is. Use the eslint-disable comment only if lint requires it. This is the only permitted edit to the moved code.

- [ ] In `processPack`, guard against a pack without a string `t`: if `typeof pack?.t !== 'string'`, log at debug level `processPack - package without type` and return.

- [ ] In `sendMessage`, the code computes `pack` (and `tag` for encryption version 2) and then builds a UDP `payload`. Directly after `pack` and `tag` are computed, and before `payload` is built, add:

```ts
    if (this.cloudSend) {
      if (!this.cloudSend(pack, tag === '' ? undefined : tag)) {
        this.platform.log.debug(`[${this.getDeviceLabel()}] sendMessage - not sent, the Gree cloud connection is not ready`);
      }
      return;
    }
```

- [ ] In `requestDeviceStatus`, cloud devices must not include the `mac` field. Replace the method body so that it sends `{ t: 'status', cols: this.getCols() }` when `this.cloudSend` is set, and the existing message otherwise.

#### Part C: platform (`src/platform.ts`)

- [ ] Imports: `GreeCloudApi`, `DEFAULT_CLOUD_REGION` and type `CloudDeviceInfo` from `./cloud/cloudApi.js`; `CloudSession` from `./cloud/cloudSession.js`; `CLOUD_MIN_STATUS_INTERVAL` and type `CloudConfig` from `./settings.js`.

- [ ] Private fields on `GreeACPlatform`: `private cloudSession?: CloudSession;`, `private cloudKeys: Record<string, string> = {};`, `private cloudRetryTimer?: ReturnType<typeof setTimeout>;`, `private cloudRetryDelay = 60;` (seconds), `private cloudStopped = false;`.

- [ ] Start-up: find where the platform starts device discovery after Homebridge has finished launching (the `didFinishLaunching` handler). After discovery is started there, call `this.startCloud();`. Also register a `shutdown` handler on `this.api` that sets `cloudStopped = true`, clears `cloudRetryTimer`, and calls `this.cloudSession?.stop()`. If a `shutdown` handler already exists, add these lines to it.

- [ ] Add method `private startCloud(): void`:
  - Read `const cloud = this.config.cloud as CloudConfig | undefined`.
  - Build the list of cloud devices from config: entries of `this.config.devices` with `cloudControl === true`, `disabled !== true`, and a `mac` matching `/^[a-f0-9]{12}$/` after lower-casing.
  - If that list is empty, return silently.
  - If `cloud?.username` or `cloud?.password` is missing, log one warning `Cloud control is enabled for a device but the Gree+ cloud account is not configured` and return.
  - Otherwise run an async routine, with every error caught:
    1. `const api = new GreeCloudApi(cloud.region || DEFAULT_CLOUD_REGION, cloud.username, cloud.password);`
    2. `const credentials = await api.login();`
    3. `const devices = await api.getAllDevices();`
    4. Create the session: `new CloudSession({ region, userId: credentials.userId, token: credentials.token, log: <adapter>, renew: () => api.login() })`, store it in `this.cloudSession`, call `start()`. The log adapter maps `info`, `warn` and `debug` to `this.log.info`, `this.log.warn` and `this.log.debug`, prefixing each message with `Gree cloud: `.
    5. For each configured cloud device: find the cloud record whose `mac` equals the configured MAC, comparing lower-cased. If none, log a warning `Device <mac> is set to cloud control but is not in the Gree+ cloud account` and continue. Otherwise call `this.registerCloudDevice(record)`.
    6. On success reset `cloudRetryDelay` to 60.
  - On any error: log a warning `Gree cloud start failed (<error message>), retrying in <n> seconds`, where the error message comes from the thrown `Error`. The cloud client's error messages are designed not to contain secrets; do not add the username, password, token or key to the log line. Then, unless `cloudStopped`, schedule `startCloud()` again after `cloudRetryDelay` seconds and double `cloudRetryDelay` up to a cap of 1800. If a session was created before the error, stop it and clear the field so a retry starts clean.
  - If `cloudStopped` becomes true while the routine is awaiting, do not create or start a session.

- [ ] Add method `private registerCloudDevice(record: CloudDeviceInfo): void`:
  - `const mac = record.mac.toLowerCase();`
  - Store the key: `this.cloudKeys[mac] = record.key;`. If the key is not a 16-character string, log a warning `Device <mac> has no usable cloud key` and return.
  - Call the existing `this.registerDevice({ mac, name: record.name, address: 'cloud', port: 0, encryptionVersion: 1, brand: 'gree', model: 'gree', ver: record.version, cloud: true })`. Do not put the key in this object.

- [ ] In `registerDevice`:
  - Near the top, after `devcfg` is computed: if `devcfg.cloudControl === true && deviceInfo.cloud !== true`, log at debug level `registerDevice - <mac> is cloud controlled, local registration skipped` and return. This keeps a local discovery reply from registering the unit locally.
  - In the final block that loads the Heater Cooler accessory (it creates `acsocket`, constructs `GreeAirConditioner`, attaches socket listeners and binds the socket): when `deviceInfo.cloud === true`, take a separate path that does not bind a socket or send a bind request:
    1. Create the UDP socket object exactly as the local path does and construct `const ac = new GreeAirConditioner(this, accessory, deviceConfig, accessory_ts?.context.device.mac, acsocket);`, but do not attach listeners, do not call `bind`, and close nothing. (The class requires a socket argument; an unbound socket is inert.)
    2. `const key = this.cloudKeys[deviceInfo.mac]; const session = this.cloudSession;` If either is missing, log a warning `[<label>] Cloud session is not available` and return.
    3. `ac.key = key;`
    4. `ac.cloudSend = (pack, tag) => session.publish(deviceInfo.mac, pack, tag);`
    5. `session.registerDevice(deviceInfo.mac, key, (pack) => { try { ac.processPack(pack); } catch (err) { this.log.warn(`[${ac.getDeviceLabel()}] Warning: cloud package could not be processed`); this.log.debug(...the error message only...); } });`
    6. `ac.accessory.bound = true; ac.initAccessory();`
    7. `this.log.success(`[${ac.getDeviceLabel()}] Device is bound through the Gree cloud -> ${deviceInfo.mac}`);`
    8. `ac.requestDeviceStatus();` then `setInterval(ac.requestDeviceStatus.bind(ac), Math.max(ac.deviceConfig.statusUpdateInterval, CLOUD_MIN_STATUS_INTERVAL) * 1000);`
  - The MAC used with the session (`publish` and `registerDevice`) must be the same string in both calls and must be the lower-case MAC from the cloud record.
  - The existing code logs the device key at debug level in the bridged-device path (`Device key ->`). Do not add any such line for cloud devices.

- [ ] The accessory's `handleMessage` compares `rinfo.address` with `accessory.context.device.address`. Cloud devices never receive UDP messages, so no change is needed there. Confirm that nothing else in the platform sends UDP to the address string `'cloud'` for a cloud device (for example the periodic scan uses configured `ip` values, not the accessory address). If something does, guard it and say so in your report.

#### Part D: config schema, docs, version

- [ ] `config.schema.json`: add device property `"cloudControl": { "type": "boolean" }` directly after `dryControlEnabled`, and a layout entry directly after the `devices[].dryControlEnabled` entry, copying that entry's structure and `condition`, with `"key": "devices[].cloudControl"`, `"title": "Control through Gree cloud"`, `"description": "For cloud-only units which do not answer on the local network. Requires the Gree+ cloud account above"`. Verify the file still parses as JSON.
- [ ] README: in the `Cloud-only units (experimental)` section, replace the sentence saying the cloud account is only used by the probe with an explanation of `cloudControl`: set it on a device (identified by its MAC as shown in Gree+) to control it through the cloud; such a device needs no `ip`; status is polled no faster than every 30 seconds; it needs internet access and depends on an unofficial Gree interface. Add `cloudControl` to both configuration examples (value `false`) after `dryControlEnabled`, and to the parameter list.
- [ ] CHANGELOG: add `## [2.4.0-cloud.1] - 2026-11-22` at the top of the entries with bullets: cloud control for cloud-only units (`cloudControl`); cloud session recovery and sign-in back-off.
- [ ] Run `npm version 2.4.0-cloud.1 --no-git-tag-version`.

#### Verification and commit

- [ ] `npm test`: expected all existing tests pass (66) and the build has no type errors.
- [ ] `npm run lint`: expected clean.
- [ ] `node -e "import('./dist/index.js').then(m => console.log(typeof m.default))"` prints `function`.
- [ ] `git diff` review of `src/platformAccessory.ts`: confirm the moved `switch` body is unchanged apart from the one permitted edit, by comparing the removed and added lines.
- [ ] Commit everything in one commit with message `feat: control cloud-only units through the Gree cloud session`.
