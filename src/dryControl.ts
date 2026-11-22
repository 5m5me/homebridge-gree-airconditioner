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
