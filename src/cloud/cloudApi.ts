import { createCipheriv, createDecipheriv, createHash } from 'node:crypto';

const APP_ID = '4920681951525131286';
const APP_HASH = '0fa513124aa97781d1f3f40d61ca1a89';
const AES_KEY = Buffer.from('#G$&^jgfujy6ujxt', 'utf8');

export const GREE_CLOUD_SERVERS: Record<string, string> = {
  'Australia': 'https://augrih.gree.com',
  'China Mainland': 'https://grih.gree.com',
  'East South Asia': 'https://hkgrih.gree.com',
  'Europe': 'https://eugrih.gree.com',
  'India': 'https://ingrih.gree.com',
  'Middle East': 'https://megrih.gree.com',
  'North American': 'https://nagrih.gree.com',
  'Russia': 'https://rugrih.gree.com',
  'South American': 'https://sagrih.gree.com',
};

export const DEFAULT_CLOUD_REGION = 'Australia';

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

export interface CloudHome { id: number; name: string; }
export interface CloudCredentials { userId: number; token: string; }

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) =>
  Promise<{ ok: boolean; status: number; statusText: string; json(): Promise<unknown> }>;

export function md5(input: string): string {
  return createHash('md5').update(input, 'utf8').digest('hex');
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** UTC timestamp formatted as YYYY-MM-DD HH:MM:SS. */
export function formatTimestamp(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ` +
    `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`;
}

export function hashPassword(password: string, t: string): string {
  return md5(md5(md5(password) + password) + t);
}

export function buildBody(payload: Record<string, unknown>, date: Date, hashProps: string[]): Record<string, unknown> {
  const t = formatTimestamp(date);
  const r = Math.floor(date.getTime() / 1000);
  const vc = md5(`${APP_ID}_${APP_HASH}_${t}_${r}`);
  const values = hashProps.map((prop) => {
    const value = payload[prop];
    return Array.isArray(value) ? value.map((v) => String(v)).join('_') : String(value);
  });
  const datVc = md5(`${APP_HASH}_${values.join('_')}`);
  return {
    api: { appId: APP_ID, r, t, vc },
    datVc,
    ...payload,
  };
}

/** AES-128-ECB with PKCS7 padding, returned as base64. */
export function encryptBody(data: string): string {
  const cipher = createCipheriv('aes-128-ecb', AES_KEY, null);
  return Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]).toString('base64');
}

export function decryptBody(base64: string): string {
  const decipher = createDecipheriv('aes-128-ecb', AES_KEY, null);
  return Buffer.concat([decipher.update(Buffer.from(base64, 'base64')), decipher.final()]).toString('utf8');
}

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export class GreeCloudApi {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private credentials?: CloudCredentials;

  constructor(
    region: string,
    private readonly username: string,
    private readonly password: string,
    fetchImpl?: FetchLike,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (!Object.prototype.hasOwnProperty.call(GREE_CLOUD_SERVERS, region)) {
      throw new Error(`Unknown cloud region: ${region}`);
    }
    this.baseUrl = GREE_CLOUD_SERVERS[region];
    this.fetchImpl = fetchImpl ?? (fetch as unknown as FetchLike);
  }

  private async send(endpoint: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Gaen1': '5ac2bdf935bcca70',
        'Charset': 'utf-8',
      },
      body: encryptBody(JSON.stringify(body)),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    const json = await response.json() as { enRes?: unknown };
    if (typeof json?.enRes !== 'string') {
      throw new Error('Unexpected cloud response');
    }
    return JSON.parse(decryptBody(json.enRes)) as Record<string, unknown>;
  }

  async login(): Promise<CloudCredentials> {
    const date = this.now();
    const t = formatTimestamp(date);
    const body = buildBody({ psw: hashPassword(this.password, t), t, user: this.username }, date, ['user', 'psw', 't']);
    const data = await this.send('/App/UserLoginV2', body);

    if (data.r !== undefined && data.r !== 200) {
      throw new Error(`Cloud sign-in failed: ${typeof data.msg === 'string' && data.msg ? data.msg : 'unknown error'}`);
    }
    const source = (data.uid !== undefined ? data : data.data) as Record<string, unknown> | undefined;
    const userId = source?.uid;
    const token = source?.token;
    if (!userId || !token || typeof token !== 'string') {
      throw new Error('Cloud sign-in failed: unexpected reply');
    }
    this.credentials = { userId: Number(userId), token };
    return { ...this.credentials };
  }

  async getHomes(): Promise<CloudHome[]> {
    const { userId, token } = this.requireCredentials();
    const body = buildBody({ token, uid: userId }, this.now(), ['token', 'uid']);
    const data = await this.send('/App/GetHomes', body);
    const homes = Array.isArray(data.home) ? data.home as Array<Record<string, unknown>> : [];
    return homes.map((h) => ({ id: Number(h.id), name: trimmed(h.name) }));
  }

  async getDevices(homeId: number): Promise<CloudDeviceInfo[]> {
    const { userId, token } = this.requireCredentials();
    const body = buildBody({ token, homeId, uid: userId }, this.now(), ['token', 'uid', 'homeId']);
    const data = await this.send('/App/GetDevsInRoomsOfHomeV2', body);
    const rooms = Array.isArray(data.rooms) ? data.rooms as Array<Record<string, unknown>> : [];
    const devices: CloudDeviceInfo[] = [];
    for (const room of rooms) {
      const devs = Array.isArray(room.devs) ? room.devs as Array<Record<string, unknown>> : [];
      for (const dev of devs) {
        const model = trimmed(dev.model);
        const version = trimmed(dev.ver);
        const parentMac = trimmed(dev.pmac);
        const mid = dev.mid === undefined || dev.mid === null || dev.mid === '' ? '' : String(dev.mid).trim();
        devices.push({
          name: trimmed(dev.name),
          mac: trimmed(dev.mac),
          key: trimmed(dev.key),
          model: model || undefined,
          version: version || undefined,
          online: !(dev.online === 0 || dev.online === false),
          parentMac: parentMac || undefined,
          mid: mid || undefined,
        });
      }
    }
    return devices;
  }

  async getAllDevices(): Promise<CloudDeviceInfo[]> {
    const devices: CloudDeviceInfo[] = [];
    for (const home of await this.getHomes()) {
      devices.push(...await this.getDevices(home.id));
    }
    return devices;
  }

  private requireCredentials(): CloudCredentials {
    if (!this.credentials) {
      throw new Error('Not signed in');
    }
    return this.credentials;
  }
}
