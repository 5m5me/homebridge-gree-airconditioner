export declare const GREE_CLOUD_SERVERS: Record<string, string>;
export declare const DEFAULT_CLOUD_REGION = "Australia";
export interface CloudDeviceInfo {
    name: string;
    mac: string;
    key: string;
    model?: string;
    version?: string;
    online: boolean;
    parentMac?: string;
    mid?: string;
}
export interface CloudHome {
    id: number;
    name: string;
}
export interface CloudCredentials {
    userId: number;
    token: string;
}
export type FetchLike = (url: string, init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
}) => Promise<{
    ok: boolean;
    status: number;
    statusText: string;
    json(): Promise<unknown>;
}>;
export declare function md5(input: string): string;
/** UTC timestamp formatted as YYYY-MM-DD HH:MM:SS. */
export declare function formatTimestamp(date: Date): string;
export declare function hashPassword(password: string, t: string): string;
export declare function buildBody(payload: Record<string, unknown>, date: Date, hashProps: string[]): Record<string, unknown>;
/** AES-128-ECB with PKCS7 padding, returned as base64. */
export declare function encryptBody(data: string): string;
export declare function decryptBody(base64: string): string;
export declare class GreeCloudApi {
    private readonly username;
    private readonly password;
    private readonly now;
    private readonly baseUrl;
    private readonly fetchImpl;
    private credentials?;
    constructor(region: string, username: string, password: string, fetchImpl?: FetchLike, now?: () => Date);
    private send;
    private static requireOk;
    login(): Promise<CloudCredentials>;
    getHomes(): Promise<CloudHome[]>;
    getDevices(homeId: number): Promise<CloudDeviceInfo[]>;
    getAllDevices(): Promise<CloudDeviceInfo[]>;
    private requireCredentials;
}
