import { createCipheriv, createDecipheriv, createHash } from 'node:crypto';
const APP_ID = '4920681951525131286';
const APP_HASH = '0fa513124aa97781d1f3f40d61ca1a89';
const AES_KEY = Buffer.from('#G$&^jgfujy6ujxt', 'utf8');
export const GREE_CLOUD_SERVERS = {
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
const REQUEST_TIMEOUT_MS = 30000;
export function md5(input) {
    return createHash('md5').update(input, 'utf8').digest('hex');
}
function pad2(n) {
    return String(n).padStart(2, '0');
}
/** UTC timestamp formatted as YYYY-MM-DD HH:MM:SS. */
export function formatTimestamp(date) {
    return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ` +
        `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`;
}
export function hashPassword(password, t) {
    return md5(md5(md5(password) + password) + t);
}
export function buildBody(payload, date, hashProps) {
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
export function encryptBody(data) {
    const cipher = createCipheriv('aes-128-ecb', AES_KEY, null);
    return Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]).toString('base64');
}
export function decryptBody(base64) {
    const decipher = createDecipheriv('aes-128-ecb', AES_KEY, null);
    return Buffer.concat([decipher.update(Buffer.from(base64, 'base64')), decipher.final()]).toString('utf8');
}
function trimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
}
export class GreeCloudApi {
    username;
    password;
    now;
    baseUrl;
    fetchImpl;
    credentials;
    constructor(region, username, password, fetchImpl, now = () => new Date()) {
        this.username = username;
        this.password = password;
        this.now = now;
        if (!Object.prototype.hasOwnProperty.call(GREE_CLOUD_SERVERS, region)) {
            throw new Error(`Unknown cloud region: ${region}`);
        }
        this.baseUrl = GREE_CLOUD_SERVERS[region];
        this.fetchImpl = fetchImpl ?? fetch;
    }
    async send(endpoint, body) {
        const response = await this.fetchImpl(`${this.baseUrl}${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Gaen1': '5ac2bdf935bcca70',
                'Charset': 'utf-8',
            },
            body: encryptBody(JSON.stringify(body)),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }
        const json = await response.json();
        if (typeof json?.enRes !== 'string') {
            throw new Error('Unexpected cloud response');
        }
        let data;
        try {
            data = JSON.parse(decryptBody(json.enRes));
        }
        catch {
            // the parse error text is not passed on: it can quote part of the reply, which may hold the session token
            throw new Error('Unexpected cloud response');
        }
        if (typeof data !== 'object' || data === null) {
            throw new Error('Unexpected cloud response');
        }
        return data;
    }
    // a reply carrying a result code other than 200 is a failure (for example an expired session)
    static requireOk(data, what) {
        if (data.r !== undefined && data.r !== 200) {
            throw new Error(`Cloud ${what} failed: ${typeof data.msg === 'string' && data.msg ? data.msg : `result ${String(data.r)}`}`);
        }
    }
    async login() {
        const date = this.now();
        const t = formatTimestamp(date);
        const body = buildBody({ psw: hashPassword(this.password, t), t, user: this.username }, date, ['user', 'psw', 't']);
        const data = await this.send('/App/UserLoginV2', body);
        if (data.r !== undefined && data.r !== 200) {
            throw new Error(`Cloud sign-in failed: ${typeof data.msg === 'string' && data.msg ? data.msg : 'unknown error'}`);
        }
        const source = (data.uid !== undefined ? data : data.data);
        const userId = source?.uid;
        const token = source?.token;
        if (!userId || !token || typeof token !== 'string') {
            throw new Error('Cloud sign-in failed: unexpected reply');
        }
        this.credentials = { userId: Number(userId), token };
        return { ...this.credentials };
    }
    async getHomes() {
        const { userId, token } = this.requireCredentials();
        const body = buildBody({ token, uid: userId }, this.now(), ['token', 'uid']);
        const data = await this.send('/App/GetHomes', body);
        GreeCloudApi.requireOk(data, 'home list');
        if (!Array.isArray(data.home)) {
            throw new Error('Cloud home list failed: unexpected reply');
        }
        const homes = data.home;
        return homes.map((h) => ({ id: Number(h.id), name: trimmed(h.name) }));
    }
    async getDevices(homeId) {
        const { userId, token } = this.requireCredentials();
        const body = buildBody({ token, homeId, uid: userId }, this.now(), ['token', 'uid', 'homeId']);
        const data = await this.send('/App/GetDevsInRoomsOfHomeV2', body);
        GreeCloudApi.requireOk(data, 'device list');
        if (!Array.isArray(data.rooms)) {
            throw new Error('Cloud device list failed: unexpected reply');
        }
        const rooms = data.rooms;
        const devices = [];
        for (const room of rooms) {
            const devs = Array.isArray(room.devs) ? room.devs : [];
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
    async getAllDevices() {
        const devices = [];
        for (const home of await this.getHomes()) {
            devices.push(...await this.getDevices(home.id));
        }
        return devices;
    }
    requireCredentials() {
        if (!this.credentials) {
            throw new Error('Not signed in');
        }
        return this.credentials;
    }
}
//# sourceMappingURL=cloudApi.js.map