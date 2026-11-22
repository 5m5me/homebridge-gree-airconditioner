/**
 * Pure helpers to decide whether an accessory context changed and must be saved.
 * No Homebridge imports here so it can be unit tested on its own.
 */

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = sortKeys(source[key]);
    }
    return sorted;
  }
  return value;
}

// stable text form of an accessory context, used to tell whether anything stored in it changed
export function contextSnapshot(context: unknown): string {
  try {
    return JSON.stringify(sortKeys(context)) ?? '';
  } catch {
    return '';
  }
}

// true when the context must be saved: no snapshot yet, or the current snapshot differs from the last saved one
export function contextChanged(lastSaved: string | undefined, current: string): boolean {
  return lastSaved === undefined || lastSaved !== current;
}
