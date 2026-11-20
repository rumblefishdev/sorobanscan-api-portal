import { isIPv4, isIPv6 } from "node:net";

/** What a request is counted by when its address can't be read: one shared bucket, never none. */
const UNKNOWN = "unknown";

/**
 * The key a request is counted by, from the `X-Hub-Viewer-Ip` header. The explorer's CloudFront
 * function writes it from `event.viewer.ip`, a bare IPv4 or IPv6 address with no port and no
 * brackets, and overwrites whatever the client sent under that name, so only CloudFront's value
 * arrives: a client can't pick its own key by sending the header itself.
 *
 * An IPv4 address is its own key. An IPv6 client usually holds a whole /64 or more, so counting by
 * the full address would let one client mint a fresh key per request; the key is the first 56 bits
 * instead. A value that is missing or isn't one bare address (a port, brackets, a list, spaces)
 * falls into one shared "unknown" key: a stranger is not left uncounted.
 */
export function clientKey(viewerIp: string | undefined): string {
  if (!viewerIp) return UNKNOWN;
  if (isIPv4(viewerIp)) return viewerIp;
  if (!isIPv6(viewerIp)) return UNKNOWN;
  const groups = expandIPv6(viewerIp);
  const [g0, g1, g2, g3] = groups ?? [];
  if (g0 === undefined || g1 === undefined || g2 === undefined || g3 === undefined) return UNKNOWN;
  // 3 whole groups (48 bits) and the high byte of the fourth (8 more).
  return `${g0.toString(16)}:${g1.toString(16)}:${g2.toString(16)}:${(g3 >> 8).toString(16)}00::/56`;
}

/** The eight 16-bit groups of an address `isIPv6` has accepted, or undefined if it has no such form. */
function expandIPv6(address: string): number[] | undefined {
  let text = address;
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  // A dotted tail (`::ffff:198.51.100.10`) is two groups.
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const [a, b, c, d, ...extra] = tail.split(".").map(Number);
    if (a === undefined || b === undefined || c === undefined || d === undefined || extra.length) {
      return undefined;
    }
    text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return undefined;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return undefined;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...rest].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g)) ? groups : undefined;
}
