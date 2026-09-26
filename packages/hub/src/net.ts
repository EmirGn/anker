import os from 'node:os';

export interface LanAddress {
  address: string;
  interface: string;
  kind: 'lan' | 'tailscale' | 'other';
}

/** IPv4 addresses a phone could use to reach this machine. */
export function lanAddresses(): LanAddress[] {
  const out: LanAddress[] = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const kind = a.address.startsWith('100.') && isCgnat(a.address)
        ? 'tailscale'
        : /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)
          ? 'lan'
          : 'other';
      out.push({ address: a.address, interface: name, kind });
    }
  }
  const rank = { lan: 0, tailscale: 1, other: 2 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind]);
}

function isCgnat(ip: string): boolean {
  const second = Number(ip.split('.')[1]);
  return second >= 64 && second <= 127;
}
