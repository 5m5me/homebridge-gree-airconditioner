import { Socket } from 'dgram';
import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';
import { GreeAirConditioner } from './platformAccessory.js';
export interface MyPlatformAccessory extends PlatformAccessory {
    bound?: boolean;
    registered?: boolean;
}
/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export declare class GreeACPlatform implements DynamicPlatformPlugin {
    readonly log: Logging;
    readonly config: PlatformConfig;
    readonly api: API;
    readonly Service: typeof Service;
    readonly Characteristic: typeof Characteristic;
    private devices;
    private processedDevices;
    private skippedDevices;
    private warningShown;
    private bridges;
    private socket;
    private pluginAddresses;
    ports: number[];
    private tempUnit;
    private cloudSession?;
    private cloudKeys;
    private cloudRetryTimer?;
    private cloudRetryDelay;
    private cloudStopped;
    private stopped;
    private acs;
    private startedAt;
    private lastSweepAt;
    private sweepTimers;
    private lostLogged;
    constructor(log: Logging, config: PlatformConfig, api: API);
    /**
     * Gree cloud control: signs in once, opens one cloud session and registers the configured cloudControl devices.
     * Never throws; on failure it retries with increasing delay.
     */
    private startCloud;
    private runCloud;
    private registerCloudDevice;
    /**
     * This function is invoked when homebridge restores cached accessories from disk at startup.
     * It should be used to set up event handlers for characteristics and update respective values.
     */
    configureAccessory(accessory: MyPlatformAccessory): void;
    /**
     * Accessories must only be registered once, previously created accessories
     * must not be registered again to prevent "duplicate UUID" errors.
     */
    bindCallback(): void;
    discoverDevices(): void;
    handleMessage: (msg: Buffer, rinfo: {
        address: string;
        family: string;
        port: number;
        size: number;
    }) => void;
    checkBindingStatus(bindNo: number, address: string, port: number, encryptionVersion: number, mac: string): void;
    registerDevice: (deviceInfo: any) => void;
    /**
     * Adds the last known address of a cached local accessory to the unicast discovery targets.
     * Never throws.
     */
    private addCachedAddress;
    /**
     * Looks for configured local devices that stopped answering and sends discovery packets to every host address
     * in the /24 of their last known address. Called from the repeating scan only. Never throws.
     */
    private sweepForLostDevices;
    /**
     * Sends the discovery message to every host address of the /24 in small batches. Never throws.
     */
    private startSweep;
    sendScan(): void;
    sendEncryptedMessage(message: unknown, mac: string, address: string, port: number, encryptionVersion: number, key?: string): void;
    getNetworkAddresses(bindInterfaces: any): Record<string, string>;
    getAccessory(mac: string): MyPlatformAccessory;
    sendACBindRequest(ac: GreeAirConditioner): void;
    checkACBindingStatus(bindNo: number, ac: GreeAirConditioner): void;
    handleACMessage: (ac: GreeAirConditioner, socket: Socket, msg: Buffer, rinfo: {
        address: string;
        family: string;
        port: number;
        size: number;
    }) => void;
}
