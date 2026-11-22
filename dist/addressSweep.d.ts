/**
 * Pure helpers for finding a locally controlled unit again when its IP address has changed.
 */
export declare function isIPv4(address: unknown): address is string;
export declare function isPrivateIPv4(address: unknown): address is string;
export declare function lostAfterSeconds(statusUpdateInterval: unknown, minSeconds: number): number;
export declare function subnetPrefix(address: unknown): string | undefined;
export declare function sweepTargets(prefix: string, exclude: string[]): string[];
export declare function isLost(lastResponseAt: number, startedAt: number, now: number, lostAfterMs: number): boolean;
export declare function sweepDue(lastSweepAt: number | undefined, now: number, minIntervalMs: number): boolean;
