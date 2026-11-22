/**
 * Pure helpers to decide whether an accessory context changed and must be saved.
 * No Homebridge imports here so it can be unit tested on its own.
 */
export declare function contextSnapshot(context: unknown): string;
export declare function contextChanged(lastSaved: string | undefined, current: string): boolean;
