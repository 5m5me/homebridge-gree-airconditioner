import { createCipheriv, createDecipheriv, randomBytes, randomInt } from 'node:crypto';
import { connect as mqttPackageConnect } from 'mqtt';
export const GREE_MQTT_SERVERS = {
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
const RENEW_RETRY_MAX_MS = 30 * 60_000;
const RENEW_MIN_INTERVAL_MS = 5 * 60_000;
const ERROR_FALLBACK_MS = 30_000;
const CLOSES_BEFORE_RENEW = 3;
export function encryptPack(message, key) {
    const cipher = createCipheriv('aes-128-ecb', Buffer.from(key, 'utf8'), null);
    return Buffer.concat([cipher.update(JSON.stringify(message), 'utf8'), cipher.final()]).toString('base64');
}
// Incoming packs may not use PKCS7 padding: decrypt without unpadding and cut everything after the last '}'
export function decryptPackTolerant(base64, key) {
    const decipher = createDecipheriv('aes-128-ecb', Buffer.from(key, 'utf8'), null);
    decipher.setAutoPadding(false);
    const text = Buffer.concat([decipher.update(Buffer.from(base64, 'base64')), decipher.final()]).toString('utf8');
    const end = text.lastIndexOf('}');
    return JSON.parse(end >= 0 ? text.slice(0, end + 1) : text);
}
export function buildEnvelope(mac, pack, userId, cid, tag) {
    const envelope = { cid, i: 0, pack, t: 'pack', tcid: mac, uid: userId };
    if (tag) {
        envelope.tag = tag;
    }
    return envelope;
}
export function topicsFor(mac) {
    return [`response/${mac}/#`, `status/${mac}/#`, `connect/${mac}`];
}
export function requestTopic(mac) {
    return `request/${mac}`;
}
export function macFromTopic(topic) {
    const parts = topic.split('/');
    if (parts.length >= 2 && parts[1] && ['response', 'status', 'connect'].includes(parts[0])) {
        return parts[1];
    }
    return undefined;
}
// replaces every occurrence of each secret with [redacted]; empty secrets are ignored
export function redactSecrets(text, secrets) {
    let result = text;
    // longest first, so a secret that contains another one is replaced as a whole
    for (const secret of secrets.filter((s) => s !== '').sort((a, b) => b.length - a.length)) {
        result = result.split(secret).join('[redacted]');
    }
    return result;
}
export function randomCid() {
    return String(randomInt(1, 10)) + Array.from({ length: 9 }, () => String(randomInt(0, 10))).join('');
}
export function randomClientId() {
    return `app_${randomBytes(8).toString('hex')}`;
}
// adapts the richer type of the mqtt package's connect function to MqttConnect
const defaultConnect = (url, options) => mqttPackageConnect(url, options);
export class CloudSession {
    broker;
    log;
    connectFn;
    renew;
    now;
    devices = new Map();
    userId;
    token;
    previousToken;
    client;
    started = false;
    stopped = false;
    isConnected = false;
    closeCount = 0;
    renewing = false;
    renewTimer;
    fallbackTimer;
    lastRenewAttemptAt;
    renewFailures = 0;
    lastErrorMessage;
    constructor(options) {
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
        this.now = options.now ?? Date.now;
    }
    get connected() {
        return this.isConnected;
    }
    start() {
        if (this.started || this.stopped) {
            return;
        }
        this.started = true;
        this.openClient();
    }
    stop() {
        this.stopped = true;
        this.isConnected = false;
        if (this.renewTimer) {
            clearTimeout(this.renewTimer);
            this.renewTimer = undefined;
        }
        if (this.fallbackTimer) {
            clearTimeout(this.fallbackTimer);
            this.fallbackTimer = undefined;
        }
        const client = this.client;
        this.client = undefined;
        client?.end(true);
    }
    registerDevice(mac, key, handler) {
        this.devices.set(mac.toLowerCase(), { mac, key, handler });
        if (this.isConnected && this.client) {
            this.subscribeDevice(this.client, mac);
        }
    }
    publish(mac, pack, tag) {
        const device = this.devices.get(mac.toLowerCase());
        if (!this.client || !this.isConnected || !device) {
            return false;
        }
        const envelope = buildEnvelope(device.mac, pack, this.userId, randomCid(), tag);
        this.client.publish(requestTopic(device.mac), JSON.stringify(envelope), { qos: 1 }, (err) => {
            if (err) {
                this.log?.warn(`Cloud publish to ${device.mac} failed: ${this.redact(err.message)}`);
            }
        });
        return true;
    }
    send(mac, message) {
        const device = this.devices.get(mac.toLowerCase());
        if (!device) {
            return false;
        }
        return this.publish(mac, encryptPack(message, device.key));
    }
    openClient() {
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
            reconnectOnConnackError: true,
        });
        this.client = client;
        // events from a client that has been replaced are ignored
        client.on('connect', (() => {
            if (this.client !== client || this.stopped) {
                return;
            }
            this.isConnected = true;
            this.closeCount = 0;
            this.lastErrorMessage = undefined;
            this.log?.info(`Connected to ${this.broker}`);
            for (const device of this.devices.values()) {
                this.subscribeDevice(client, device.mac);
            }
        }));
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
        }));
        client.on('error', ((err) => {
            if (this.client !== client || this.stopped) {
                return;
            }
            const raw = typeof err?.message === 'string' ? err.message : '';
            const message = this.redact(raw);
            if (message !== this.lastErrorMessage) {
                this.lastErrorMessage = message;
                this.log?.warn(`Cloud connection error: ${message}`);
            }
            else {
                this.log?.debug(`Cloud connection error repeated: ${message}`);
            }
            if (raw.includes('Not authorized') || raw.includes('Bad username or password')) {
                this.startRenewal();
            }
            // the library may not reconnect after a refusal: make sure the session recovers on its own
            this.scheduleFallback();
        }));
        client.on('message', ((topic, payload) => {
            if (this.client !== client || this.stopped) {
                return;
            }
            this.handleMessage(topic, payload);
        }));
    }
    subscribeDevice(client, mac) {
        client.subscribe(topicsFor(mac), { qos: 1 }, (err) => {
            if (err) {
                this.log?.warn(`Cloud subscribe for ${mac} failed: ${this.redact(err.message)}`);
            }
        });
    }
    handleMessage(topic, payload) {
        let device;
        let pack;
        let kind;
        try {
            const mac = macFromTopic(topic);
            device = mac ? this.devices.get(mac.toLowerCase()) : undefined;
            if (!device) {
                return;
            }
            if (topic.startsWith('connect/')) {
                this.log?.debug(`Cloud connect message for ${device.mac}`);
                return;
            }
            kind = topic.startsWith('response/') ? 'response' : 'status';
            const envelope = JSON.parse(payload.toString('utf8'));
            if (typeof envelope.pack !== 'string' || envelope.pack === '') {
                return;
            }
            pack = decryptPackTolerant(envelope.pack, device.key);
        }
        catch {
            // the payload and the error text are not logged
            this.log?.debug('Could not process a cloud message');
            return;
        }
        try {
            device.handler(pack, kind);
        }
        catch {
            // the error text is not logged
            this.log?.warn('A cloud device handler failed');
        }
    }
    redact(text) {
        const secrets = [this.token];
        if (this.previousToken) {
            secrets.push(this.previousToken);
        }
        for (const device of this.devices.values()) {
            secrets.push(device.key);
        }
        return redactSecrets(text, secrets);
    }
    // after an error, make sure a new client is opened if the session is still not connected 30 seconds later
    scheduleFallback() {
        if (this.fallbackTimer || this.stopped || this.renewing) {
            return;
        }
        this.fallbackTimer = setTimeout(() => {
            this.fallbackTimer = undefined;
            if (this.stopped || this.renewing || this.isConnected) {
                return;
            }
            this.log?.info('Opening a new cloud connection after an error');
            try {
                const old = this.client;
                this.client = undefined;
                try {
                    old?.end(true);
                }
                catch {
                    // the old client is already replaced
                }
                this.openClient();
            }
            catch {
                this.log?.warn('Opening a new cloud connection failed');
                this.scheduleFallback();
            }
        }, ERROR_FALLBACK_MS);
    }
    startRenewal() {
        if (!this.renew || this.renewing || this.stopped) {
            return;
        }
        this.renewing = true;
        // at least 5 minutes between renewal attempts, so a broker-only outage cannot cause a storm of sign-ins
        const wait = this.lastRenewAttemptAt === undefined ? 0 : this.lastRenewAttemptAt + RENEW_MIN_INTERVAL_MS - this.now();
        if (wait > 0) {
            this.log?.debug(`Signing in again is deferred for ${Math.ceil(wait / 1000)} seconds`);
            this.scheduleRenewal(wait);
            return;
        }
        this.attemptRenewal();
    }
    scheduleRenewal(delayMs) {
        this.renewTimer = setTimeout(() => {
            this.renewTimer = undefined;
            this.attemptRenewal();
        }, delayMs);
    }
    attemptRenewal() {
        const renew = this.renew;
        if (!renew || this.stopped) {
            return;
        }
        this.lastRenewAttemptAt = this.now();
        this.log?.info('Signing in to the Gree cloud again');
        let pending;
        try {
            pending = Promise.resolve(renew());
        }
        catch {
            this.renewalFailed();
            return;
        }
        pending.then((credentials) => {
            if (this.stopped) {
                return;
            }
            try {
                this.applyCredentials(credentials);
            }
            catch {
                this.renewalFailed();
            }
        }, () => this.renewalFailed());
    }
    applyCredentials(credentials) {
        this.previousToken = this.token;
        this.userId = credentials.userId;
        this.token = credentials.token;
        this.closeCount = 0;
        this.isConnected = false;
        const old = this.client;
        this.client = undefined;
        old?.end(true);
        this.openClient();
        this.renewFailures = 0;
        this.renewing = false;
    }
    renewalFailed() {
        if (this.stopped) {
            return;
        }
        this.renewFailures += 1;
        const delay = Math.min(RENEW_RETRY_MS * 2 ** (this.renewFailures - 1), RENEW_RETRY_MAX_MS);
        // the error text is not logged
        this.log?.warn(`Signing in to the Gree cloud again failed, retrying in ${Math.round(delay / 1000)} seconds`);
        this.scheduleRenewal(delay);
    }
}
//# sourceMappingURL=cloudSession.js.map