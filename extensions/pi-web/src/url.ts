const MAX_REDIRECTS = 5;

const METADATA_HOSTS = new Set([
  "metadata",
  "metadata.google.internal",
  "instance-data",
  "metadata.azure.com",
]);

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => Number(part));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = octets;
  if (a === 0) return true; // unspecified / this network
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0) return true; // reserved / test nets
  if (a === 198 && (b === 18 || b === 51)) return true; // benchmarking
  if (a >= 224) return true; // multicast / reserved / broadcast
  return false;
}

function isPrivateIpv6(host: string): boolean {
  const h = host.split("%")[0].toLowerCase();
  if (h === "::" || h === "::1") return true;
  // IPv4-mapped
  const mapped = h.match(/^::ffff:(.+)$/);
  if (mapped) {
    const rest = mapped[1];
    if (rest.includes(".")) return isPrivateIpv4(rest);
    // ::ffff:7f00:1 style
    const hexParts = rest.split(":");
    if (hexParts.length === 2) {
      const value =
        (Number.parseInt(hexParts[0], 16) << 16) |
        Number.parseInt(hexParts[1], 16);
      if (Number.isFinite(value)) {
        const ip = [
          (value >>> 24) & 255,
          (value >>> 16) & 255,
          (value >>> 8) & 255,
          value & 255,
        ].join(".");
        return isPrivateIpv4(ip);
      }
    }
  }
  // link-local fe80::/10
  const firstBlock = h.split(":")[0];
  const first = Number.parseInt(firstBlock || "0", 16);
  if (!Number.isNaN(first) && first >= 0xfe80 && first <= 0xfebf) return true;
  // unique local fc00::/7
  if (!Number.isNaN(first) && first >= 0xfc00 && first <= 0xfdff) return true;
  return false;
}

export function isUnsafeHost(hostname: string): boolean {
  let host = hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host === "") return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (METADATA_HOSTS.has(host)) return true;

  // IPv6 literal
  if (host.includes(":")) {
    return isPrivateIpv6(host);
  }

  // IPv4 literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return isPrivateIpv4(host);
  }

  // Reject alternate numeric encodings that may be interpreted as IPs.
  if (/^0x[0-9a-f]+$/i.test(host) || /^\d+$/.test(host)) return true;

  return false;
}

export function assertSafeUrl(input: string | URL): void {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("URL must use http or https");
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error("URL must not include credentials");
  }
  if (isUnsafeHost(url.hostname)) {
    throw new Error("URL target is not allowed");
  }
}

export function isSafeUrl(input: string | URL): boolean {
  try {
    assertSafeUrl(input);
    return true;
  } catch {
    return false;
  }
}

export { MAX_REDIRECTS };
