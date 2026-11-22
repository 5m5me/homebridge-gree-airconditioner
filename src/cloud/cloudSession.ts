import { createCipheriv, createDecipheriv, randomBytes, randomInt } from 'node:crypto';
import { connect as mqttPackageConnect, IClientOptions } from 'mqtt';

export const GREE_MQTT_SERVERS: Record<string, string> = {
  'Australia': 'mqtt-au.gree.com',
  'China Mainland': 'mqtt.gree.com',
  'East South Asia': 'mqtt-hk.gree.com',
  'Europe': 'mqtt-eu.gree.com',
  'India': 'mqtt-in.gree.com',
  'Middle East': 'mqtt-me.gree.com',
  'North American': 'mqtt-na.gree.com',
  'Russia': 'mqtt-ru.gree.com',
  'South American': 'mqtt-sa.gree.com',
};
export const GREE_MQTT_PORT = 1984;

const RENEW_RETRY_MS = 60_000;
const CLOSES_BEFORE_RENEW = 3;

export interface CloudEnvelope {
  cid: string;
  i: number;
  pack: string;
  t: string;
  tcid: string;
  uid: number;
  tag?: string;
}

export function encryptPack(message: unknown, key: string): string {
  const cipher = createCipheriv('aes-128-ecb', Buffer.from(key, 'utf8'), null);
  return Buffer.concat([cipher.update(JSON.stringify(message), 'utf8'), cipher.final()]).toString('base64');
}

// Incoming packs may not use PKCS7 padding: decrypt without unpadding and cut everything after the last '}'
export function decryptPackTolerant(base64: string, key: string): Record<string, unknown> {
  const decipher = createDecipheriv('aes-128-ecb', Buffer.from(key, 'utf8'), null);
  decipher.setAutoPadding(false);
  const text = Buffer.concat([decipher.update(Buffer.from(base64, 'base64')), decipher.final()]).toString('utf8');
  const end = text.lastIndexOf('}');
  return JSON.parse(end >= 0 ? text.slice(0, end + 1) : text) as Record<string, unknown>;
}

export function buildEnvelope(mac: string, pack: string, userId: number, cid: string, tag?: string): CloudEnvelope {
  const envelope: CloudEnvelope = { cid, i: 0, pack, t: 'pack', tcid: mac, uid: userId };
  if (tag) {
    envelope.tag = tag;
  }
  return envelope;
}

export function topicsFor(mac: string): string[] {
  return [`response/${mac}/#`, `status/${mac}/#`, `connect/${mac}`];
}

export function requestTopic(mac: string): string {
  return `request/${mac}`;
}

export function macFromTopic(topic: string): string | undefined {
  const parts = topic.split('/');
  if (parts.length >= 2 && parts[1] && ['response', 'status', 'connect'].includes(parts[0])) {
    return parts[1];
  }
  return undefined;
}

export function randomCid(): string {
  return String(randomInt(1, 10)) + Array.from({ length: 9 }, () => String(randomInt(0, 10))).join('');
}

export function randomClientId(): string {
  return `app_${randomBytes(8).toString('hex')}`;
}

// minimal shape of the mqtt client this module uses, so tests can supply a fake
export interface MqttClientLike {
  on(event: 'connect' | 'close' | 'error' | 'message', listener: (...args: never[]) => void): unknown;
  subscribe(topics: string[], options: { qos: 0 | 1 | 2 }, callback?: (err?: Error | null) => void): unknown;
  publish(topic: string, payload: string, options: { qos: 0 | 1 | 2 }, callback?: (err?: Error | null) => void): unknown;
  end(force?: boolean): unknown;
}
export type MqttConnect = (url: string, options: Record<string, unknown>) => MqttClientLike;

export interface CloudSessionLog {
  info(message: string): void;
  warn(message: string): void;
  debug(message: string): void;
}
export type PackHandler = (pack: Record<string, unknown>, kind: 'response' | 'status') => void;

// adapts the richer type of the mqtt package's connect function to MqttConnect
const defaultConnect: MqttConnect = (url, options) => mqttPackageConnect(url, options as IClientOptions) as unknown as MqttClientLike;

interface RegisteredDevice {
  mac: string;
  key: string;
  handler: PackHandler;
}

export class CloudSession {
  private readonly broker: string;
  private readonly log?: CloudSessionLog;
  private readonly connectFn: MqttConnect;
  private readonly renew?: () => Promise<{ userId: number; token: string }>;
  private readonly devices = new Map<string, RegisteredDevice>();
  private userId: number;
  private token: string;
  private client?: MqttClientLike;
  private started = false;
  private stopped = false;
  private isConnected = false;
  private closeCount = 0;
  private renewing = false;
  private renewTimer?: NodeJS.Timeout;

  constructor(options: {
    region: string;
    userId: number;
    token: string;
    log?: CloudSessionLog;
    connect?: MqttConnect;
    renew?: () => Promise<{ userId: number; token: string }>;
  }) {
    const broker = GREE_MQTT_SERVERS[options.region];
    if (!broker) {
      throw new Error(`Unknown cloud region: ${options.region}`);
    }
    this.broker = broker;
    this.userId = options.userId;
    this.token = options.token;
    this.log = options.log;
    this.connectFn = options.connect ?? defaultConnect;
    this.renew = options.renew;
  }

  get connected(): boolean {
    return this.isConnected;
  }

  start(): void {
    if (this.started || this.stopped) {
      return;
    }
    this.started = true;
    this.openClient();
  }

  stop(): void {
    this.stopped = true;
    this.isConnected = false;
    if (this.renewTimer) {
      clearTimeout(this.renewTimer);
      this.renewTimer = undefined;
    }
    const client = this.client;
    this.client = undefined;
    client?.end(true);
  }

  registerDevice(mac: string, key: string, handler: PackHandler): void {
    this.devices.set(mac.toLowerCase(), { mac, key, handler });
    if (this.isConnected && this.client) {
      this.subscribeDevice(this.client, mac);
    }
  }

  publish(mac: string, pack: string, tag?: string): boolean {
    const device = this.devices.get(mac.toLowerCase());
    if (!this.client || !this.isConnected || !device) {
      return false;
    }
    const envelope = buildEnvelope(device.mac, pack, this.userId, randomCid(), tag);
    this.client.publish(requestTopic(device.mac), JSON.stringify(envelope), { qos: 1 }, (err) => {
      if (err) {
        this.log?.warn(`Cloud publish to ${device.mac} failed: ${err.message}`);
      }
    });
    return true;
  }

  send(mac: string, message: unknown): boolean {
    const device = this.devices.get(mac.toLowerCase());
    if (!device) {
      return false;
    }
    return this.publish(mac, encryptPack(message, device.key));
  }

  private openClient(): void {
    const client = this.connectFn(`mqtts://${this.broker}:${GREE_MQTT_PORT}`, {
      clientId: randomClientId(),
      username: String(this.userId),
      password: this.token,
      protocolVersion: 4,
      clean: true,
      keepalive: 60,
      rejectUnauthorized: false,
      reconnectPeriod: 5000,
      connectTimeout: 30000,
    });
    this.client = client;
    // events from a client that has been replaced are ignored
    client.on('connect', (() => {
      if (this.client !== client || this.stopped) {
        return;
      }
      this.isConnected = true;
      this.closeCount = 0;
      this.log?.info(`Connected to ${this.broker}`);
      for (const device of this.devices.values()) {
        this.subscribeDevice(client, device.mac);
      }
    }) as (...args: never[]) => void);
    client.on('close', (() => {
      if (this.client !== client || this.stopped) {
        return;
      }
      this.isConnected = false;
      this.closeCount += 1;
      this.log?.debug(`Cloud connection closed (${this.closeCount})`);
      if (this.closeCount >= CLOSES_BEFORE_RENEW) {
        this.startRenewal();
      }
    }) as (...args: never[]) => void);
    client.on('error', ((err: Error) => {
      if (this.client !== client || this.stopped) {
        return;
      }
      const message = err?.message ?? '';
      this.log?.debug(`Cloud connection error: ${message}`);
      if (message.includes('Not authorized') || message.includes('Bad username or password')) {
        this.startRenewal();
      }
    }) as (...args: never[]) => void);
    client.on('message', ((topic: string, payload: Buffer) => {
      if (this.client !== client || this.stopped) {
        return;
      }
      this.handleMessage(topic, payload);
    }) as (...args: never[]) => void);
  }

  private subscribeDevice(client: MqttClientLike, mac: string): void {
    client.subscribe(topicsFor(mac), { qos: 1 }, (err) => {
      if (err) {
        this.log?.warn(`Cloud subscribe for ${mac} failed: ${err.message}`);
      }
    });
  }

  private handleMessage(topic: string, payload: Buffer): void {
    try {
      const mac = macFromTopic(topic);
      const device = mac ? this.devices.get(mac.toLowerCase()) : undefined;
      if (!device) {
        return;
      }
      if (topic.startsWith('connect/')) {
        this.log?.debug(`Cloud connect message for ${device.mac}`);
        return;
      }
      const kind = topic.startsWith('response/') ? 'response' : 'status';
      const envelope = JSON.parse(payload.toString('utf8')) as { pack?: unknown };
      if (typeof envelope.pack !== 'string' || envelope.pack === '') {
        return;
      }
      device.handler(decryptPackTolerant(envelope.pack, device.key), kind);
    } catch {
      // the payload and the error text are not logged
      this.log?.debug('Could not process a cloud message');
    }
  }

  private startRenewal(): void {
    if (!this.renew || this.renewing || this.stopped) {
      return;
    }
    this.renewing = true;
    this.attemptRenewal();
  }

  private attemptRenewal(): void {
    const renew = this.renew;
    if (!renew || this.stopped) {
      return;
    }
    this.log?.info('Signing in to the Gree cloud again');
    renew().then(
      (credentials) => {
        if (this.stopped) {
          return;
        }
        this.userId = credentials.userId;
        this.token = credentials.token;
        this.closeCount = 0;
        this.isConnected = false;
        const old = this.client;
        this.client = undefined;
        old?.end(true);
        this.renewing = false;
        this.openClient();
      },
      () => {
        // the error text is not logged
        this.log?.warn('Signing in to the Gree cloud again failed, retrying in 60 seconds');
        if (this.stopped) {
          return;
        }
        this.renewTimer = setTimeout(() => {
          this.renewTimer = undefined;
          this.attemptRenewal();
        }, RENEW_RETRY_MS);
      },
    );
  }
}
