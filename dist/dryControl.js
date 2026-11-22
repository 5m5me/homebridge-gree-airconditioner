import commands from './commands.js';
export function isDryActive(power, mode) {
    return power && mode === commands.mode.value.dry;
}
/**
 * Returns the command to send to reach the desired dry state, or null if nothing needs sending.
 * Turning dry off only powers the unit off when it is actually running in dry mode.
 */
export function buildDryCommand(desiredOn, state) {
    const dryActive = isDryActive(state.power, state.mode);
    if (desiredOn) {
        if (dryActive) {
            return null;
        }
        const command = {};
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
export function nextRetryAction(desiredOn, state, resendsMade, maxResends) {
    if (isDryActive(state.power, state.mode) === desiredOn) {
        return 'done';
    }
    return resendsMade < maxResends ? 'resend' : 'giveUp';
}
//# sourceMappingURL=dryControl.js.map