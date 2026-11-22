# Follow Units By MAC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a locally controlled unit stops answering (for example because the router gave it a new IP address), the plugin finds it again by its MAC address without anyone editing the config.

**Background:** The units sit on a routed subnet (192.168.55.0/24) that the Homebridge host (192.168.54.97/24) reaches through the router, so broadcast discovery does not reach them. The plugin sends unicast discovery packets to the `ip` values typed in the config. In September 2026 those addresses went stale and every unit was unreachable for months. The existing code already handles a discovery reply from a new address correctly: `registerDevice` updates `accessory.context.device.address` (log line `address has changed`) and the accessory then sends to and accepts messages from the new address. The only missing piece is making a discovery packet reach the unit's new address.

**Architecture:** Two additions to the platform's discovery, both using the existing discovery socket and the existing reply handling:
1. Cached addresses: the last known address of every cached local accessory is added to the unicast discovery targets at start-up.
2. Address sweep: while a configured local unit is lost, the platform periodically sends the discovery packet to every host address in the /24 of that unit's last known address.

Pure helpers live in a new `src/addressSweep.ts` and are unit tested. Cloud controlled units are never swept.

**Tech Stack:** TypeScript 6, ES modules (`nodenext`), Node 22 `dgram`, Node test runner.

## Global Constraints

- Package name stays `homebridge-gree-5m5`. Version becomes `3.1.0`.
- No new dependencies.
- No change to how units are controlled, bound or polled. The only behaviour changes are the two additions above and the bookkeeping they need.
- Cloud controlled units (`cloudControl: true`) and bridged sub-devices (MAC containing `@`) are never swept and never count as lost.
- The sweep must never send to an address outside the /24 of a unit's last known IPv4 address, never to the network address (`.0`) or broadcast address (`.255`), and never to one of the host's own addresses.
- A failure in the new code (bad cached address, socket error, unexpected config value) must never throw out of a timer or event handler. Wrap and log at debug level.
- Code style: single quotes, 2-space indent, semicolons, trailing commas on multiline, max line length 160, braces on all blocks. `npm run lint` must pass with zero warnings.
- Imports between source files use the `.js` extension.
- No em dashes in any text written (docs, comments, commit messages, log messages).
- Run all commands from the repository root.

---

### Task 1: Cached addresses and address sweep

**Files:**
- Create: `src/addressSweep.ts`
- Create: `test/addressSweep.test.mjs`
- Modify: `src/settings.ts`, `src/platformAccessory.ts`, `src/platform.ts`
- Modify: `README.md`, `CHANGELOG.md`, `package.json`, `package-lock.json`, `src/version.ts` (regenerated)

#### Part A: pure helpers (`src/addressSweep.ts`), test first

Exact exports:

```ts
// true for a dotted IPv4 address with four parts, each 0 to 255, no leading or trailing spaces
export function isIPv4(address: unknown): address is string;

// '192.168.55.13' -> '192.168.55'; undefined when the address is not IPv4
export function subnetPrefix(address: unknown): string | undefined;

// all host addresses prefix.1 .. prefix.254, in ascending order, without any address listed in exclude
export function sweepTargets(prefix: string, exclude: string[]): string[];

// a unit is lost when it has not answered for longer than lostAfterMs.
// lastResponseAt is 0 when it has never answered since start; then it is lost once startedAt is older than lostAfterMs.
export function isLost(lastResponseAt: number, startedAt: number, now: number, lostAfterMs: number): boolean;

// a subnet may be swept when it has never been swept (lastSweepAt undefined) or the last sweep is at least minIntervalMs ago
export function sweepDue(lastSweepAt: number | undefined, now: number, minIntervalMs: number): boolean;
```

- [ ] Write `test/addressSweep.test.mjs` (import from `../dist/addressSweep.js`) covering: `isIPv4` for valid addresses, `'cloud'`, `''`, `undefined`, `'192.168.55'`, `'192.168.55.256'`, `'192.168.55.13 '`, `'a.b.c.d'`; `subnetPrefix` for a valid address and for `'cloud'`; `sweepTargets` returns 254 addresses for an empty exclude list, first `prefix.1`, last `prefix.254`, never `.0` or `.255`, and omits excluded addresses (including one outside the subnet, which changes nothing); `isLost` for: answered recently (false), answered longer ago than the limit (true), never answered and started recently (false), never answered and started long ago (true), exactly at the limit (false); `sweepDue` for undefined (true), recent (false), exactly at the interval (true).
- [ ] Run `npm test`; expect the new file to fail because the module does not exist.
- [ ] Implement `src/addressSweep.ts`. Run `npm test`; expect all tests to pass.

#### Part B: settings (`src/settings.ts`)

Add at the end of the file:

```ts
export const LOST_AFTER = 90; // seconds without any answer after which a local device counts as lost
export const SWEEP_MIN_INTERVAL = 300; // seconds between two address searches of the same subnet
export const SWEEP_BATCH_SIZE = 16; // discovery packets sent per batch during an address search
export const SWEEP_BATCH_DELAY = 50; // milliseconds between batches
```

#### Part C: accessory (`src/platformAccessory.ts`)

- [ ] Add a public field next to `public key?: string;`:

```ts
  // time (ms since epoch) of the last package processed from the device, 0 if none since start
  public lastResponseAt = 0;
```

- [ ] In `processPack`, directly after the existing guard that returns for a pack without a string type, add `this.lastResponseAt = Date.now();`. Change nothing else in the accessory.

#### Part D: platform (`src/platform.ts`)

Read the file first: the constructor (where `this.pluginAddresses` is built by `getNetworkAddresses`), `configureAccessory`, `bindCallback` (it starts discovery and the repeating scan), `sendScan`, `handleMessage` (discovery replies lead to `registerDevice`), and `registerDevice` (the `address has changed` block, and the two places where `new GreeAirConditioner(...)` is constructed: the cloud path and the local path).

- [ ] Fields: `private acs: Record<string, GreeAirConditioner> = {};`, `private startedAt = Date.now();`, `private lastSweepAt: Record<string, number> = {};`, `private sweepTimers: Array<ReturnType<typeof setTimeout>> = [];`, `private lostLogged: Record<string, boolean> = {};`.

- [ ] In `registerDevice`, in both places where a `GreeAirConditioner` is constructed, store it: `this.acs[deviceInfo.mac] = ac;`.

- [ ] Cached addresses. In `configureAccessory`, after the existing code that stores the accessory in `this.devices`, add: if the accessory is a Heater Cooler accessory (`!accessory.context.deviceType || accessory.context.deviceType === 'HeaterCooler'`), its `context.device.cloud !== true`, its MAC does not contain `@`, and `isIPv4(accessory.context.device.address)`, and that address is not already a key of `this.pluginAddresses`, then set `this.pluginAddresses[address] = '255.255.255.255';` (the existing marker for a unicast discovery target) and log at debug level `Cached device address added to discovery list: <address>`. Wrap this in try/catch; on error log at debug level and continue. Do not add an address that lies inside a directly connected network that the broadcast scan already covers if the existing configured-`ip` code has a helper or pattern for that check which is easy to reuse; if reusing it is not straightforward, add the address regardless (a redundant unicast packet is harmless) and say so in your report.

- [ ] Address sweep. Add a method `private sweepForLostDevices(): void` and call it from wherever the periodic discovery scan runs (each time `sendScan()` is called on the repeating timer, and not on the very first scan at start-up). The whole method body is inside try/catch that logs at debug level.
  - Build the list of candidate units: entries of `this.config.devices` that are not `disabled`, do not have `cloudControl === true`, and whose `mac` matches `/^[a-f0-9]{12}$/`.
  - For each candidate: `const ac = this.acs[mac]`. `lastResponseAt = ac?.lastResponseAt ?? 0`. It is lost when `isLost(lastResponseAt, this.startedAt, Date.now(), LOST_AFTER * 1000)`.
  - When a unit that was logged as lost is no longer lost, log at info level `Device <mac> is answering again` and clear its `lostLogged` flag.
  - For each lost unit: last known address = `this.devices[mac]?.context?.device?.address` if `isIPv4`, else the unit's configured `ip` if `isIPv4`, else none. With no address, skip the unit (log once at debug level). Otherwise take `subnetPrefix(address)`.
  - The first time a unit is found lost, log at warn level `Device <mac> is not answering at <address>, searching <prefix>.0/24 for it` and set its `lostLogged` flag. Do not repeat this warning while it stays lost.
  - Collect the distinct prefixes of all lost units. For each prefix where `sweepDue(this.lastSweepAt[prefix], Date.now(), SWEEP_MIN_INTERVAL * 1000)`: set `this.lastSweepAt[prefix] = Date.now()` and start a sweep of that prefix.
  - A sweep: `const targets = sweepTargets(prefix, <the host's own IPv4 addresses>)`. Send the same discovery message that `sendScan` sends (`{ t: 'scan' }` as a Buffer) to each target on `UDP_SCAN_PORT` through `this.socket`, in batches of `SWEEP_BATCH_SIZE` with `SWEEP_BATCH_DELAY` ms between batches, using `setTimeout`. Keep each timer handle in `this.sweepTimers` and remove it when it fires. Send errors are ignored apart from one debug line per sweep. Log at debug level `Address search of <prefix>.0/24 started (<n> addresses)`.
  - The host's own IPv4 addresses: obtain them the same way the existing code does when it builds `pluginAddresses` (it reads the network interfaces); if the existing code keeps them somewhere reusable, use that, otherwise read `os.networkInterfaces()` in a small private helper.

- [ ] Shutdown: in the existing `shutdown` handler (added for the cloud session), clear every timer in `this.sweepTimers`.

- [ ] Confirm by reading the code, and state in your report, that a discovery reply arriving from a new address for an already registered unit reaches the `address has changed` block in `registerDevice`, and that nothing earlier in `handleMessage` discards replies from addresses that are not in `pluginAddresses` or not previously known. If something does discard them, do not work around it silently: report NEEDS_CONTEXT with the code.

#### Part E: docs and version

- [ ] README: in the 5m5 fork note at the top add one sentence: the plugin follows locally controlled units by MAC address, so a unit whose IP address changes is found again automatically within a few minutes, as long as it stays in the same /24 network as its last known address. In the description of the device `ip` parameter add that it is the starting address for a unit on another subnet and no longer needs updating when the address changes within that subnet.
- [ ] CHANGELOG: add `## [3.1.0] - 2026-11-22` at the top of the entries with bullets: last known addresses of cached units are used for discovery at start-up; a unit which stops answering is searched for in the /24 of its last known address (at most every 5 minutes per subnet).
- [ ] Run `npm version 3.1.0 --no-git-tag-version`.

#### Verification and commit

- [ ] `npm test`: all tests pass (66 existing plus the new ones) with a clean build.
- [ ] `npm run lint`: clean.
- [ ] `node -e "import('./dist/index.js').then(m => console.log(typeof m.default))"` prints `function`.
- [ ] Commit everything in one commit with message `feat: follow locally controlled units by MAC when their address changes`.
