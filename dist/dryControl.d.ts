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
export declare function isDryActive(power: boolean, mode: number): boolean;
/**
 * Returns the command to send to reach the desired dry state, or null if nothing needs sending.
 * Turning dry off only powers the unit off when it is actually running in dry mode.
 */
export declare function buildDryCommand(desiredOn: boolean, state: DryState): Record<string, number> | null;
/**
 * Decides what the retry timer should do next.
 * 'done' when the unit already matches the desired dry state (or, for dry off, is no longer in dry).
 */
export declare function nextRetryAction(desiredOn: boolean, state: DryState, resendsMade: number, maxResends: number): DryRetryAction;
