import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { CloudDeviceInfo, DEFAULT_CLOUD_REGION, GreeCloudApi } from './cloudApi.js';
import { CloudConfig, PLATFORM_NAME } from '../settings.js';

const DEFAULT_CONFIG_PATH = '/var/lib/homebridge/config.json';

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

async function main(): Promise<number> {
  const configPath = process.argv[2] || DEFAULT_CONFIG_PATH;
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
    console.log(`Probe failed: ${err instanceof Error ? err.message : 'could not read the config'}`);
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
    await api.login();
    console.log(`Signed in. Region: ${region}.`);
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exitCode = code;
  });
}
