# Dry mode switch for homebridge-gree-ac (stage 1)

Date: 2026-11-22
Base: eibenp/homebridge-gree-airconditioner v2.3.2
Owner: Ned (fork under GitHub account 5m5me)

## Goal

Let Apple Home turn Gree dry mode on and off, so Home automations can run
"1 hour after sunrise: Dry on" and "1 hour before sunset: Dry off".

## Scope

In scope:

- A per-device option `dryControlEnabled` (default false).
- A "Dry" Switch service inside each AC accessory when the option is on.
- Confirm-and-resend for dry commands (up to 2 resends).
- Heater-Cooler "off" request powers the unit off when it is in dry mode
  (only when `dryControlEnabled` is on).

Out of scope (stage 1):

- Fan-only mode changes, fan speed or swing control in dry mode.
- The Gym unit (cloud-only Wi-Fi module). That is stage 2.
- The upstream bug where a mode request is dropped while a power command is
  pending.
- Any other behaviour change to Cool, Heat or Auto.

## Behaviour

Definitions: "dry active" means the unit reports power on and mode dry (Mod = 2).

| Event | Result |
|---|---|
| Dry switch set on | Send power on (if off) and mode dry (if not dry). If `xFanEnabled`, also xFan on when it is off. |
| Dry switch set off, unit is dry active | Send power off. |
| Dry switch set off, unit not dry active | No command. Switch stays off. |
| Heater-Cooler Active set to INACTIVE, unit is dry active, option on | Send power off. |
| Heater-Cooler set active or mode picked (Cool, Heat, Auto) while dry | Existing upstream logic changes the mode. Dry switch updates to off from the unit's reply. |
| Unit put in dry by remote or Gree+ | Dry switch shows on at the next status update (about 10 s). |
| Unit leaves dry by any route | Dry switch shows off at the next status update. |

Switch state is derived from the unit's reported status. The one exception is
the short window while a dry request is waiting for confirmation: during it the
switch shows the requested state, and it is set to the unit's real state when
the request is confirmed or given up.

A Heater-Cooler "off" that arrives while a dry-on request is still waiting for
confirmation cancels that request and powers the unit off once dry has landed.

## Confirm and resend

After a dry on or off command is sent, the accessory records the desired dry
state. A timer checks every 3 seconds:

- If the unit's reported state matches the desired state: done.
- Otherwise resend the command, ignoring the pending flags. At most 2 resends.
- After the last check fails: log a warning and set the Dry switch to the
  unit's real state.

A new dry request replaces any earlier desired state and restarts the count.
A dry request that arrives while another command is pending is not dropped:
it is sent anyway and the timer confirms it.

A Heater-Cooler "on" or mode change, or a Fan "on", cancels any dry request
still waiting for confirmation, so the retry never fights the user.

## Components

- `src/dryControl.ts` (new, pure functions, no Homebridge imports):
  - `isDryActive(power, mode)`
  - `buildDryCommand(desiredOn, state)` returns the command map to send, or
    `null` when nothing needs sending.
  - `nextRetryAction(desiredOn, state, attemptsMade, maxResends)` returns
    `'done' | 'resend' | 'giveUp'`.
- `src/platformAccessory.ts`: create or remove the Switch service, register
  handlers, call the pure functions, own the retry timer, update the switch in
  `updateStatus`, and the Heater-Cooler off change.
- `src/settings.ts`, `config.schema.json`, `README.md`, `CHANGELOG.md`: the new
  option and its documentation.
- `test/dryControl.test.mjs`: unit tests for the pure functions with
  `node --test` against the compiled output.

## Packaging and install

- Keep the package name `homebridge-gree-ac` and platform name so existing
  accessories, rooms and automations are kept.
- Version `2.3.3-dry.1`.
- Compiled `dist/` is committed on a `release` branch of the fork so the
  Homebridge server can install without building.
- Rollback: reinstall stock `homebridge-gree-ac@2.3.2`.

Known trade-off: accepting an upstream update in the Homebridge UI overwrites
this version.

## Testing

1. Unit tests for `dryControl.ts`.
2. Lint and build pass (`npm run lint`, `npm run build`).
3. On the Bedroom unit, with debug logging on: Dry on, Dry off, Heater-Cooler
   off while dry, Cool picked while dry, dry selected from the remote.
4. Then enable `dryControlEnabled` on Lounge Room, Board Room and Retreat.
