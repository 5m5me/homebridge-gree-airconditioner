import { CloudDeviceInfo, GreeCloudApi } from './cloudApi.js';
import { CloudSession } from './cloudSession.js';
export declare function parseProbeArgs(argv: string[]): {
    configPath: string;
    statusMac?: string;
};
export declare function formatDeviceLine(device: CloudDeviceInfo): string;
type SessionOptions = ConstructorParameters<typeof CloudSession>[0];
export declare function readStatus(api: Pick<GreeCloudApi, 'getAllDevices' | 'login'>, region: string, login: {
    userId: number;
    token: string;
}, mac: string, createSession?: (options: SessionOptions) => CloudSession): Promise<number>;
export {};
