export declare const GREE_MQTT_SERVERS: Record<string, string>;
export declare const GREE_MQTT_PORT = 1984;
export interface CloudEnvelope {
    cid: string;
    i: number;
    pack: string;
    t: string;
    tcid: string;
    uid: number;
    tag?: string;
}
export declare function encryptPack(message: unknown, key: string): string;
export declare function decryptPackTolerant(base64: string, key: string): Record<string, unknown>;
export declare function buildEnvelope(mac: string, pack: string, userId: number, cid: string, tag?: string): CloudEnvelope;
export declare function topicsFor(mac: string): string[];
export declare function requestTopic(mac: string): string;
export declare function macFromTopic(topic: string): string | undefined;
export declare function redactSecrets(text: string, secrets: string[]): string;
export declare function randomCid(): string;
export declare function randomClientId(): string;
export interface MqttClientLike {
    on(event: 'connect' | 'close' | 'error' | 'message', listener: (...args: never[]) => void): unknown;
    subscribe(topics: string[], options: {
        qos: 0 | 1 | 2;
    }, callback?: (err?: Error | null) => void): unknown;
    publish(topic: string, payload: string, options: {
        qos: 0 | 1 | 2;
    }, callback?: (err?: Error | null) => void): unknown;
    end(force?: boolean): unknown;
}
export type MqttConnect = (url: string, options: Record<string, unknown>) => MqttClientLike;
export interface CloudSessionLog {
    info(message: string): void;
    warn(message: string): void;
    debug(message: string): void;
}
export type PackHandler = (pack: Record<string, unknown>, kind: 'response' | 'status') => void;
export declare class CloudSession {
    private readonly broker;
    private readonly log?;
    private readonly connectFn;
    private readonly renew?;
    private readonly now;
    private readonly devices;
    private userId;
    private token;
    private previousToken?;
    private client?;
    private started;
    private stopped;
    private isConnected;
    private closeCount;
    private renewing;
    private renewTimer?;
    private fallbackTimer?;
    private lastRenewAttemptAt?;
    private renewFailures;
    private lastErrorMessage?;
    constructor(options: {
        region: string;
        userId: number;
        token: string;
        log?: CloudSessionLog;
        connect?: MqttConnect;
        renew?: () => Promise<{
            userId: number;
            token: string;
        }>;
        now?: () => number;
    });
    get connected(): boolean;
    start(): void;
    stop(): void;
    registerDevice(mac: string, key: string, handler: PackHandler): void;
    publish(mac: string, pack: string, tag?: string): boolean;
    send(mac: string, message: unknown): boolean;
    private openClient;
    private subscribeDevice;
    private handleMessage;
    private redact;
    private scheduleFallback;
    private startRenewal;
    private scheduleRenewal;
    private attemptRenewal;
    private applyCredentials;
    private renewalFailed;
}
