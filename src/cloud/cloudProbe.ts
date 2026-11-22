import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { CloudDeviceInfo, DEFAULT_CLOUD_REGION, GreeCloudApi } from './cloudApi.js';
import { CloudSession, GREE_MQTT_SERVERS } from './cloudSession.js';
import { CloudConfig, PLATFORM_NAME } from '../settings.js';

const DEFAULT_CONFIG_PATH = '/var/lib/homebridge/config.json';
const STATUS_COLS = ['Pow', 'Mod', 'SetTem', 'TemSen', 'WdSpd', 'Blo', 'TemUn', 'SwUpDn', 'Quiet', 'Tur', 'Lig'];
const STATUS_TIMEOUT_MS = 20_000;

export function parseProbeArgs(argv: string[]): { configPath: string; statusMac?: string } {
  let configPath: string | undefined;
  let statusMac: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--status') {
      statusMac = argv[i + 1];
      i++;
    } else if (!argv[i].startsWith('--') && configPath === undefined) {
      configPath = argv[i];
    }
  }
  return { configPath: configPath || DEFAULT_CONFIG_PATH, statusMac };
}

export function formatDeviceLine(device: CloudDeviceInfo): string {
  return [
    device.name,
    `mac=${device.mac}`,
    `model=${device.model || '-'}`,
    `ver=${device.version || '-'}`,
    `online=${device.online ? 'yes' : 'no'}`,
    `parent=${device.parentMac || '-'}`,
    `mid=${device.mid || '-'}`,
    `key=${device.key ? 'present' : 'missing'}`,
  ].join(' | ');
}

type SessionOptions = ConstructorParameters<typeof CloudSession>[0];

// exported with an injectable session factory so the failure paths can be tested without a network
export async function readStatus(
  api: Pick<GreeCloudApi, 'getAllDevices' | 'login'>,
  region: string,
  login: { userId: number; token: string },
  mac: string,
  createSession: (options: SessionOptions) => CloudSession = (options) => new CloudSession(options),
): Promise<number> {
  const device = (await api.getAllDevices()).find((d) => d.mac.toLowerCase() === mac.toLowerCase());
  if (!device) {
    console.log(`Probe failed: device ${mac} is not in this account`);
    return 1;
  }
  if (typeof device.key !== 'string' || device.key.length !== 16) {
    console.log(`Probe failed: device ${mac} has no usable key`);
    return 1;
  }
  return new Promise<number>((resolve) => {
    let session: CloudSession | undefined;
    const timers: { timeout?: NodeJS.Timeout; poll?: NodeJS.Timeout } = {};
    const finish = (code: number, line: string): void => {
      clearTimeout(timers.timeout);
      clearInterval(timers.poll);
      session?.stop();
      console.log(line);
      resolve(code);
    };
    try {
      session = createSession({ region, userId: login.userId, token: login.token, renew: () => api.login() });
    } catch (err) {
      finish(1, `Probe failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      return;
    }
    const active = session;
    active.registerDevice(device.mac, device.key, (pack) => {
      if (pack.t !== 'dat' || !Array.isArray(pack.cols) || !Array.isArray(pack.dat)) {
        return;
      }
      const values: Record<string, unknown> = {};
      (pack.cols as unknown[]).forEach((col, index) => {
        values[String(col)] = (pack.dat as unknown[])[index];
      });
      finish(0, `Status: ${JSON.stringify(values)}`);
    });
    timers.timeout = setTimeout(() => finish(1, 'Probe failed: no status reply within 20 seconds'), STATUS_TIMEOUT_MS);
    active.start();
    // the session has no connect callback, so poll the connected flag until the status request has been sent
    timers.poll = setInterval(() => {
      if (active.connected) {
        clearInterval(timers.poll);
        console.log(`Connected to ${GREE_MQTT_SERVERS[region]}.`);
        try {
          active.send(device.mac, { t: 'status', cols: STATUS_COLS });
        } catch {
          finish(1, 'Probe failed: could not send the status request');
        }
      }
    }, 100);
  });
}

async function main(): Promise<number> {
  const { configPath, statusMac } = parseProbeArgs(process.argv.slice(2));
  let cloud: CloudConfig | undefined;
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as { platforms?: Array<Record<string, unknown>> };
    const platform = (config.platforms ?? []).find((p) => p.platform === PLATFORM_NAME);
    if (!platform) {
      console.log(`Probe failed: no ${PLATFORM_NAME} platform in the config`);
      return 2;
    }
    cloud = platform.cloud as CloudConfig | undefined;
  } catch (err) {
    // the error text is not printed: a JSON parse error can quote part of the config file, which holds the password
    const code = (err as { code?: string }).code;
    console.log(`Probe failed: could not read the config file${code ? ` (${code})` : ' (not valid JSON)'}`);
    return 1;
  }
  if (!cloud?.username) {
    console.log('Probe failed: cloud username is missing in the config');
    return 2;
  }
  if (!cloud.password) {
    console.log('Probe failed: cloud password is missing in the config');
    return 2;
  }

  try {
    const region = cloud.region || DEFAULT_CLOUD_REGION;
    const api = new GreeCloudApi(region, cloud.username, cloud.password);
    const login = await api.login();
    console.log(`Signed in. Region: ${region}.`);
    if (statusMac) {
      return await readStatus(api, region, login, statusMac);
    }
    let total = 0;
    for (const home of await api.getHomes()) {
      const devices = await api.getDevices(home.id);
      console.log(`Home: ${home.name} (${devices.length} devices)`);
      for (const device of devices) {
        console.log(formatDeviceLine(device));
      }
      total += devices.length;
    }
    console.log(`Devices: ${total}`);
    return 0;
  } catch (err) {
    console.log(`Probe failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    return 1;
  }
}

function isMainModule(): boolean {
  try {
    // realpath: the plugin folder can be reached through a symlink
    return !!process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main().then((code) => {
    process.exitCode = code;
  });
}
