/**
 * Pure helpers to decide whether an accessory context changed and must be saved.
 * No Homebridge imports here so it can be unit tested on its own.
 */
function sortKeys(value) {
    if (Array.isArray(value)) {
        return value.map(sortKeys);
    }
    if (value !== null && typeof value === 'object') {
        const source = value;
        const sorted = {};
        for (const key of Object.keys(source).sort()) {
            sorted[key] = sortKeys(source[key]);
        }
        return sorted;
    }
    return value;
}
// stable text form of an accessory context, used to tell whether anything stored in it changed
export function contextSnapshot(context) {
    try {
        return JSON.stringify(sortKeys(context)) ?? '';
    }
    catch {
        return '';
    }
}
// true when the context must be saved: no snapshot yet, no usable current snapshot, or the current snapshot differs from the last saved one
export function contextChanged(lastSaved, current) {
    return lastSaved === undefined || current === '' || lastSaved !== current;
}
//# sourceMappingURL=contextSave.js.map