# Dry Mode Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional "Dry" Switch service to each Gree AC accessory so Apple Home can turn dry mode on and off, with confirm-and-resend for dry commands.

**Architecture:** Pure decision functions live in a new `src/dryControl.ts` (no Homebridge imports) and are unit tested with `node --test` against compiled output. `src/platformAccessory.ts` owns the Switch service, its handlers and one retry timer, and calls the pure functions. The option is off by default so behaviour is unchanged unless `dryControlEnabled` is set.

**Tech Stack:** TypeScript 6, ES modules (`nodenext`), Homebridge 2 API, Node 22 built-in test runner, ESLint.

## Global Constraints

- Base: eibenp/homebridge-gree-airconditioner v2.3.2. Package name stays `homebridge-gree-ac`. Platform name stays `GREEAirConditioner`.
- Version becomes `2.3.3-dry.1`.
- New option name is exactly `dryControlEnabled` (boolean, default false).
- Dry mode is protocol value `Mod = 2` (`commands.mode.value.dry`).
- Retry: check every 3000 ms, at most 2 resends.
- No behaviour change when `dryControlEnabled` is false or absent.
- No changes to Cool, Heat, Auto, fan speed, swing or temperature logic beyond what the tasks state.
- Code style: single quotes, 2-space indent, semicolons, trailing commas on multiline, max line length 160, braces on all blocks. `npm run lint` must pass with zero warnings.
- Imports between source files use the `.js` extension (for example `./commands.js`).
- No em dashes in any text written (docs, comments, commit messages).
- Run all commands from the repository root.

---

### Task 1: Pure dry-control functions with tests

**Files:**
- Create: `src/dryControl.ts`
- Create: `test/dryControl.test.mjs`
- Modify: `package.json` (add `test` script)

**Interfaces:**
- Consumes: default export `commands` from `src/commands.ts` (`commands.power.code === 'Pow'`, `commands.mode.code === 'Mod'`, `commands.xFan.code === 'Blo'`, `commands.mode.value.dry === 2`).
- Produces:
  - `interface DryState { power: boolean; mode: number; xFanEnabled: boolean; xFanOn: boolean; }`
  - `type DryRetryAction = 'done' | 'resend' | 'giveUp';`
  - `isDryActive(power: boolean, mode: number): boolean`
  - `buildDryCommand(desiredOn: boolean, state: DryState): Record<string, number> | null`
  - `nextRetryAction(desiredOn: boolean, state: DryState, resendsMade: number, maxResends: number): DryRetryAction`

- [ ] **Step 1: Install dependencies**

Run: `npm ci`
Expected: completes without errors.

- [ ] **Step 2: Add the test script**

In `package.json`, inside `"scripts"`, add this entry after the `"lint"` line:

```json
    "test": "npm run build && node --test test/",
```

- [ ] **Step 3: Write the failing tests**

Create `test/dryControl.test.mjs`:

```js
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
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL. The build succeeds but the test file fails with `Cannot find module` for `dist/dryControl.js`.

- [ ] **Step 5: Write the implementation**

Create `src/dryControl.ts`:

```ts
import commands from './commands.js';

/**
 * Pure decision logic for dry mode control.
 * No Homebridge imports here so it can be unit tested on its own.
 */

export interface DryState {
  power: boolean;
  mode: number;
  xFanEnabled: boolean;
  xFanOn: boolean;
}

export type DryRetryAction = 'done' | 'resend' | 'giveUp';

export function isDryActive(power: boolean, mode: number): boolean {
  return power && mode === commands.mode.value.dry;
}

/**
 * Returns the command to send to reach the desired dry state, or null if nothing needs sending.
 * Turning dry off only powers the unit off when it is actually running in dry mode.
 */
export function buildDryCommand(desiredOn: boolean, state: DryState): Record<string, number> | null {
  const dryActive = isDryActive(state.power, state.mode);
  if (desiredOn) {
    if (dryActive) {
      return null;
    }
    const command: Record<string, number> = {};
    if (!state.power) {
      command[commands.power.code] = commands.power.value.on;
    }
    if (state.mode !== commands.mode.value.dry) {
      command[commands.mode.code] = commands.mode.value.dry;
    }
    if (state.xFanEnabled && !state.xFanOn) {
      command[commands.xFan.code] = commands.xFan.value.on;
    }
    return command;
  }
  if (!dryActive) {
    return null;
  }
  return { [commands.power.code]: commands.power.value.off };
}

/**
 * Decides what the retry timer should do next.
 * 'done' when the unit already matches the desired dry state (or, for dry off, is no longer in dry).
 */
export function nextRetryAction(desiredOn: boolean, state: DryState, resendsMade: number, maxResends: number): DryRetryAction {
  if (isDryActive(state.power, state.mode) === desiredOn) {
    return 'done';
  }
  return resendsMade < maxResends ? 'resend' : 'giveUp';
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 13 tests, 0 failures.

- [ ] **Step 7: Lint**

Run: `npm run lint`
Expected: no errors, no warnings.

- [ ] **Step 8: Commit**

```bash
git add package.json src/dryControl.ts test/dryControl.test.mjs
git commit -m "feat: add pure dry mode control functions with tests"
```

---

### Task 2: Dry Switch service in the accessory

**Files:**
- Modify: `src/settings.ts` (option type and two constants)
- Modify: `src/platformAccessory.ts` (imports, fields, service creation, handlers, retry, status update)

**Interfaces:**
- Consumes from Task 1 (`src/dryControl.ts`): `DryState`, `isDryActive(power, mode)`, `buildDryCommand(desiredOn, state)`, `nextRetryAction(desiredOn, state, resendsMade, maxResends)`.
- Consumes existing members of class `GreeAirConditioner` in `src/platformAccessory.ts`: getters `this.power: boolean` and `this.mode: number`, `this.status: { [key: string]: unknown }`, `this.sendCommand(cmd: Record<string, unknown>)`, `this.getDeviceLabel()`, `this.deviceConfig`, `this.HeaterCooler`, `this.Fan`, `this.accessory`, `this.platform`.
- Produces: `DeviceConfig.dryControlEnabled?: boolean`, constants `DRY_RETRY_INTERVAL = 3000` and `DRY_MAX_RESENDS = 2` exported from `src/settings.ts`.

- [ ] **Step 1: Add the option and constants to settings**

In `src/settings.ts`, in `interface DeviceConfig`, add this line directly after `fanControlEnabled?: boolean;`:

```ts
  dryControlEnabled?: boolean;
```

At the end of `src/settings.ts`, after the `BINDING_TIMEOUT` line, add:

```ts

export const DRY_RETRY_INTERVAL = 3000; // milliseconds between dry command confirmation checks
export const DRY_MAX_RESENDS = 2; // how many times a dry command is resent if the device does not confirm it
```

- [ ] **Step 2: Add imports and fields**

In `src/platformAccessory.ts`, change the settings import to include the two constants:

```ts
import { PLATFORM_NAME, PLUGIN_NAME, DeviceConfig, TEMPERATURE_TABLE, MODIFY_VERTICAL_SWING_POSITION, TS_TYPE,
  TEMPERATURE_LIMITS, DEFAULT_DEVICE_CONFIG, DRY_RETRY_INTERVAL, DRY_MAX_RESENDS } from './settings.js';
```

Add this import directly after the line `import commands from './commands.js';`:

```ts
import type { DryState } from './dryControl.js';
import { isDryActive, buildDryCommand, nextRetryAction } from './dryControl.js';
```

In the class field list, directly after `private Fan?: Service;`, add:

```ts
  private Dry?: Service;
  private dryDesired?: boolean;
  private dryResends = 0;
  private dryTimer?: ReturnType<typeof setInterval>;
```

- [ ] **Step 3: Create or remove the Dry service**

In the constructor, find this existing block:

```ts
    this.HeaterCooler.setPrimaryService(true);
    this.TemperatureSensor?.setPrimaryService(false);
    this.Fan?.setPrimaryService(false);
```

Insert the following directly BEFORE it:

```ts
    // Dry switch service
    // subtype is used because other plugins or future versions may add more Switch services
    const ds = this.accessory.getServiceById(this.platform.Service.Switch, 'dry');
    if (this.deviceConfig.dryControlEnabled) {
      if (ds) {
        this.Dry = ds;
      } else {
        this.platform.log.debug(`[${this.getDeviceLabel()}] Add Dry child service`);
        this.Dry = this.accessory.addService(this.platform.Service.Switch, 'Dry ' + this.HeaterCooler.displayName, 'dry');
        this.Dry.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName);
        this.Dry.setCharacteristic(this.platform.Characteristic.ConfiguredName, 'Dry');
      }
    } else {
      this.platform.log.debug(`[${this.getDeviceLabel()}] Dry child service not allowed`,
        ds?.displayName !== undefined ? '(' + ds?.displayName + ')' : '');
      if (ds !== undefined) {
        this.platform.log.debug(`[${this.getDeviceLabel()}] Remove Dry child service (%s)`, ds.displayName);
        this.accessory.removeService(ds);
      }
    }

```

Then add one line to the existing block so it reads:

```ts
    this.HeaterCooler.setPrimaryService(true);
    this.TemperatureSensor?.setPrimaryService(false);
    this.Fan?.setPrimaryService(false);
    this.Dry?.setPrimaryService(false);
```

- [ ] **Step 4: Register the Dry handlers**

In the constructor, find the existing lines:

```ts
    this.Fan?.getCharacteristic(this.platform.Characteristic.Active)
      .onSet(this.setFanActive.bind(this))
      .onGet(this.getFanActive.bind(this));
```

Insert directly after them:

```ts
    this.Dry?.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setDryOn.bind(this))
      .onGet(this.getDryOn.bind(this));
```

- [ ] **Step 5: Change setActive, setFanActive and setTargetHeaterCoolerState**

Replace the whole existing `setActive` method with:

```ts
  async setActive(value: CharacteristicValue) {
    const powerValue = (value === this.platform.Characteristic.Active.ACTIVE);
    this.platform.log.debug(`[${this.getDeviceLabel()}] Set Heater-Cooler Active ->`, powerValue ? 'ACTIVE' : 'INACTIVE');
    if (powerValue) {
      // the user wants heating / cooling -> a pending dry request must not fight it
      this.stopDryRetry();
    } else if (this.Dry && isDryActive(this.power, this.mode)) {
      // "off" while the device is running in dry mode -> power the device off
      this.requestDry(false);
      return;
    }
    this.power = powerValue;
    if (powerValue &&
      this.Fan?.getCharacteristic(this.platform.Characteristic.Active).value === this.platform.Characteristic.Active.ACTIVE) {
      this.Fan?.getCharacteristic(this.platform.Characteristic.Active).updateValue(this.platform.Characteristic.Active.INACTIVE);
    }
  }
```

In the existing `setFanActive` method, add these lines directly after its `this.platform.log.debug(...)` line:

```ts
    if (powerValue) {
      this.stopDryRetry();
    }
```

In the existing `setTargetHeaterCoolerState` method, add this line as the first statement of the method body:

```ts
    this.stopDryRetry();
```

- [ ] **Step 6: Add the Dry methods**

Directly after the closing brace of the `setFanActive` method, add:

```ts
  async setDryOn(value: CharacteristicValue) {
    const desiredOn = (value === true);
    this.platform.log.debug(`[${this.getDeviceLabel()}] Set Dry On ->`, desiredOn);
    this.requestDry(desiredOn);
    if (desiredOn) {
      if (this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.Active).value === this.platform.Characteristic.Active.ACTIVE) {
        this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.Active).updateValue(this.platform.Characteristic.Active.INACTIVE);
      }
      if (this.Fan?.getCharacteristic(this.platform.Characteristic.Active).value === this.platform.Characteristic.Active.ACTIVE) {
        this.Fan?.getCharacteristic(this.platform.Characteristic.Active).updateValue(this.platform.Characteristic.Active.INACTIVE);
      }
    }
  }

  async getDryOn(): Promise<CharacteristicValue> {
    const dryOn = this.dryDesired !== undefined ? this.dryDesired : isDryActive(this.power, this.mode);
    this.platform.log.debug(`[${this.getDeviceLabel()}] Get Dry On ->`, dryOn);
    return dryOn;
  }

  private getDryState(): DryState {
    return {
      power: this.power,
      mode: this.mode,
      xFanEnabled: this.deviceConfig.xFanEnabled === true,
      xFanOn: (this.status[commands.xFan.code] || commands.xFan.value.off) === commands.xFan.value.on,
    };
  }

  // records the desired dry state, sends the command and starts the confirmation timer
  private requestDry(desiredOn: boolean) {
    this.stopDryRetry();
    this.dryDesired = desiredOn;
    this.sendDryCommand();
    this.dryTimer = setInterval(this.checkDry.bind(this), DRY_RETRY_INTERVAL);
  }

  private sendDryCommand() {
    if (this.dryDesired === undefined) {
      return;
    }
    const command = buildDryCommand(this.dryDesired, this.getDryState());
    if (command === null) {
      this.platform.log.debug(`[${this.getDeviceLabel()}] dry -> no change`);
      return;
    }
    this.platform.log.info(`[${this.getDeviceLabel()}] dry -> ${this.dryDesired ? 'on' : 'off'} %j`, command);
    this.sendCommand(command);
  }

  private checkDry() {
    if (this.dryDesired === undefined) {
      this.stopDryRetry();
      return;
    }
    const action = nextRetryAction(this.dryDesired, this.getDryState(), this.dryResends, DRY_MAX_RESENDS);
    if (action === 'resend') {
      this.dryResends++;
      this.platform.log.debug(`[${this.getDeviceLabel()}] dry -> not confirmed, resend ${this.dryResends}/${DRY_MAX_RESENDS}`);
      this.sendDryCommand();
      return;
    }
    if (action === 'giveUp') {
      this.platform.log.warn(`[${this.getDeviceLabel()}] Warning: dry ${this.dryDesired ? 'on' : 'off'} was not confirmed by the device`);
    }
    this.stopDryRetry();
    this.Dry?.getCharacteristic(this.platform.Characteristic.On).updateValue(isDryActive(this.power, this.mode));
  }

  private stopDryRetry() {
    if (this.dryTimer !== undefined) {
      clearInterval(this.dryTimer);
      this.dryTimer = undefined;
    }
    this.dryDesired = undefined;
    this.dryResends = 0;
  }
```

- [ ] **Step 7: Update the Dry switch from device status**

In the existing `updateStatus` method, find this block:

```ts
    // Fan Active
    if (this.Fan && (props.includes(commands.power.code) || props.includes(commands.mode.code))) {
      this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Fan Active) ->`, fanActive ? 'ACTIVE' : 'INACTIVE');
      this.Fan?.getCharacteristic(this.platform.Characteristic.Active)
        .updateValue(fanActive ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE);
    }
```

Insert directly after it:

```ts
    // Dry switch (not updated while a dry request is waiting for confirmation)
    if (this.Dry && this.dryDesired === undefined && (props.includes(commands.power.code) || props.includes(commands.mode.code))) {
      const dryActive = isDryActive(this.power, this.mode);
      this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Dry On) ->`, dryActive);
      this.Dry.getCharacteristic(this.platform.Characteristic.On).updateValue(dryActive);
    }
```

- [ ] **Step 8: Build, test and lint**

Run: `npm test`
Expected: build succeeds, 13 tests pass.

Run: `npm run lint`
Expected: no errors, no warnings.

- [ ] **Step 9: Commit**

```bash
git add src/settings.ts src/platformAccessory.ts
git commit -m "feat: add optional Dry switch service with command confirmation"
```

---

### Task 3: Config schema, documentation and version

**Files:**
- Modify: `config.schema.json`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json`, `package-lock.json` (version)

**Interfaces:**
- Consumes: option name `dryControlEnabled` from Task 2.
- Produces: nothing used by other tasks.

- [ ] **Step 1: Add the schema property**

In `config.schema.json`, find:

```json
            "fanControlEnabled": {
              "type": "boolean"
            },
```

Insert directly after it:

```json
            "dryControlEnabled": {
              "type": "boolean"
            },
```

- [ ] **Step 2: Add the settings form entry**

In `config.schema.json`, find the layout entry whose `"key"` is `"devices[].fanControlEnabled"`. Directly after that entry's closing `},` insert:

```json
            {
              "key": "devices[].dryControlEnabled",
              "flex": "1 1 50%",
              "title": "Dry control enabled",
              "description": "If checked, a Dry switch is added to the device in Home App and dry mode support is enabled",
              "condition": {
                "functionBody": "return (model.devices && model.devices[arrayIndices] && model.devices[arrayIndices].mac && /^([a-f0-9]{12}|default|[a-f0-9]+@[a-f0-9]{12})$/.test(model.devices[arrayIndices].mac) && model.devices[arrayIndices].disabled !== true);"
              }
            },
```

- [ ] **Step 3: Verify the schema is valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('config.schema.json','utf8')); console.log('schema ok')"`
Expected: `schema ok`

- [ ] **Step 4: Document the option in the README**

In `README.md`, in both configuration examples, find each line:

```
                    "fanControlEnabled": false,
```

and add directly after each one:

```
                    "dryControlEnabled": false,
```

Then find the bullet that starts with `  * **fanControlEnabled** -` and add this bullet directly after it:

```
  * **dryControlEnabled** - by default dry mode is not supported by the plugin because Apple's Heater Cooler accessory does not support dry mode; setting this parameter to true adds a "Dry" switch to the device in the Home App: turning it on puts the device into dry mode, turning it off powers the device off if it is still in dry mode; dry commands are confirmed against the device status and resent up to 2 times
```

- [ ] **Step 5: Add the changelog entry**

In `CHANGELOG.md`, insert directly after the first line (`# Changelog`) and its following blank line:

```
## [2.3.3-dry.1] - 2026-11-22

Fork release (5m5me), based on v2.3.2.

- New optional parameter "dryControlEnabled": adds a "Dry" switch to the device in Home App
- Dry commands are confirmed against the device status and resent up to 2 times
- If dry control is enabled, turning the Heater Cooler off also powers off a device running in dry mode

```

- [ ] **Step 6: Bump the version**

Run: `npm version 2.3.3-dry.1 --no-git-tag-version`
Expected: prints `v2.3.3-dry.1`; `package.json` and `package-lock.json` show the new version.

- [ ] **Step 7: Build, test and lint**

Run: `npm test`
Expected: 13 tests pass.

Run: `npm run lint`
Expected: no errors, no warnings.

- [ ] **Step 8: Commit**

```bash
git add config.schema.json README.md CHANGELOG.md package.json package-lock.json
git commit -m "docs: document dryControlEnabled and bump version to 2.3.3-dry.1"
```
