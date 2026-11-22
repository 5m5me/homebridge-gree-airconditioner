import { CloudDeviceInfo } from './cloudApi.js';
export declare function parseProbeArgs(argv: string[]): {
    configPath: string;
    statusMac?: string;
};
export declare function formatDeviceLine(device: CloudDeviceInfo): string;
