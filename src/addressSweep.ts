/**
 * Pure helpers for finding a locally controlled unit again when its IP address has changed.
 */

// true for a dotted IPv4 address with four parts, each 0 to 255, no leading or trailing spaces
export function isIPv4(address: unknown): address is string {
  if (typeof address !== 'string') {
    return false;
  }
  return /^(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)){3}$/.test(address);
}

// '192.168.55.13' -> '192.168.55'; undefined when the address is not IPv4
export function subnetPrefix(address: unknown): string | undefined {
  if (!isIPv4(address)) {
    return undefined;
  }
  return address.split('.').slice(0, 3).join('.');
}

// all host addresses prefix.1 .. prefix.254, in ascending order, without any address listed in exclude
export function sweepTargets(prefix: string, exclude: string[]): string[] {
  const excluded = new Set(exclude);
  const targets: string[] = [];
  for (let host = 1; host <= 254; host++) {
    const address = `${prefix}.${host}`;
    if (!excluded.has(address)) {
      targets.push(address);
    }
  }
  return targets;
}

// a unit is lost when it has not answered for longer than lostAfterMs.
// lastResponseAt is 0 when it has never answered since start; then it is lost once startedAt is older than lostAfterMs.
export function isLost(lastResponseAt: number, startedAt: number, now: number, lostAfterMs: number): boolean {
  const reference = lastResponseAt > 0 ? lastResponseAt : startedAt;
  return now - reference > lostAfterMs;
}

// a subnet may be swept when it has never been swept (lastSweepAt undefined) or the last sweep is at least minIntervalMs ago
export function sweepDue(lastSweepAt: number | undefined, now: number, minIntervalMs: number): boolean {
  return lastSweepAt === undefined || now - lastSweepAt >= minIntervalMs;
}
