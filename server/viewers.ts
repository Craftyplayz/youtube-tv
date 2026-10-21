// A Viewer is every device and IP joined by a device having watched from an IP: one device on two IPs (say, a VPN
// switched off) joins those IPs, and one IP seen from two devices joins those devices. Returns each device's Viewer key.
export function linkViewers(sightings: { device: string; ip: string }[]) {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };
  for (const s of sightings) parent.set(find(`device:${s.device}`), find(`ip:${s.ip}`));
  return (device: string) => find(`device:${device}`);
}
