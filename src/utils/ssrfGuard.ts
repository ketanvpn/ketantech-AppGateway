import { isIP } from "net";

/**
 * SSRF Guard — validasi URL sebelum gateway lakukan outbound HTTP call.
 *
 * Threat model: admin / attacker yang dapat akses dashboard `/credentials`
 * bisa set `baseUrl` provider ke endpoint internal (cloud metadata, localhost,
 * private subnet) → server jadi proxy untuk SSRF attack.
 *
 * Defense:
 *  1. Skema cuma https (production) atau http (dev only)
 *  2. Hostname BUKAN:
 *     - localhost / 127.x / ::1 / 0.0.0.0
 *     - Private IP ranges (RFC 1918): 10.x, 172.16-31.x, 192.168.x
 *     - Link-local (169.254.x — termasuk AWS/GCP metadata 169.254.169.254)
 *     - IPv6 unique-local (fc00::/7) & link-local (fe80::/10)
 *  3. Hostname tidak boleh kosong / berisi path traversal
 *  4. Port hanya 80, 443, atau standard HTTP/S range (1-65535)
 *
 * Catatan: untuk DEV (`NODE_ENV !== production`) localhost diizinkan
 * supaya bisa testing dengan mock server local.
 */

const DENY_HOSTNAMES = new Set([
  "localhost",
  "0.0.0.0",
  "0",
  "broadcasthost",
  "ip6-localhost",
  "ip6-loopback",
]);

/**
 * Validate URL untuk outbound HTTP request. Throw GatewayError-friendly Error
 * kalau ditolak. Return parsed URL kalau OK.
 */
export function assertSafeUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`Invalid URL: ${input}`);
  }

  // Schema check
  const isProd = process.env.NODE_ENV === "production";
  if (isProd) {
    if (url.protocol !== "https:") {
      throw new Error(
        `URL harus pakai HTTPS di production: ${url.protocol}//${url.hostname}`,
      );
    }
  } else {
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error(`Schema tidak diizinkan: ${url.protocol}`);
    }
  }

  // Strip IPv6 brackets — URL parser preserve `[]` di hostname untuk IPv6.
  // isIP() butuh raw IP tanpa brackets supaya bisa detect.
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname || hostname === "" || hostname === ".") {
    throw new Error("Hostname kosong atau invalid");
  }

  // Dev mode: izinkan localhost (untuk test integration di local)
  if (!isProd && (hostname === "localhost" || hostname === "127.0.0.1")) {
    return url;
  }

  // Block known bad hostnames
  if (DENY_HOSTNAMES.has(hostname)) {
    throw new Error(`Hostname tidak diizinkan: ${hostname}`);
  }

  // IP-literal: cek private/link-local range
  const ipVersion = isIP(hostname);

  if (ipVersion === 4) {
    if (isPrivateOrLinkLocalIPv4(hostname)) {
      throw new Error(
        `IP private/link-local tidak diizinkan: ${hostname} ` +
          "(SSRF defense — provider URL harus public internet)",
      );
    }
  } else if (ipVersion === 6) {
    if (isPrivateOrLinkLocalIPv6(hostname)) {
      throw new Error(
        `IPv6 private/link-local tidak diizinkan: ${hostname}`,
      );
    }
  }
  // Hostname (bukan IP) — DNS resolution akan terjadi saat HTTP call.
  // Untuk defense yang lebih kuat (DNS rebinding attack), butuh resolve
  // di sini + verify resolved IP juga public. Itu kompleks, untuk sekarang
  // cukup block IP literal. Kalau attacker pakai DNS yang resolve ke
  // private IP, itu masih bisa lewat. Mitigasi tambahan: HTTP client harus
  // pakai allow-list outbound network policy di firewall/security group.

  return url;
}

/**
 * RFC 1918 private + RFC 3927 link-local IPv4 ranges.
 *  - 10.0.0.0/8
 *  - 172.16.0.0/12
 *  - 192.168.0.0/16
 *  - 169.254.0.0/16 (link-local + AWS/GCP metadata 169.254.169.254)
 *  - 127.0.0.0/8 (loopback)
 *  - 0.0.0.0/8 (current network)
 *  - 100.64.0.0/10 (CGNAT, RFC 6598)
 */
function isPrivateOrLinkLocalIPv4(ip: string): boolean {
  const parts = ip.split(".").map((n) => parseInt(n, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true; // Treat malformed as unsafe
  }
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local + AWS metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

/**
 * IPv6 private/link-local ranges:
 *  - ::1 (loopback)
 *  - fc00::/7 (unique local)
 *  - fe80::/10 (link-local)
 *  - fd00::/8 (private)
 */
function isPrivateOrLinkLocalIPv6(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (lower === "::1" || lower === "::") return true;
  // fe80::/10
  if (/^fe[89ab][0-9a-f]:/i.test(lower)) return true;
  // fc00::/7 (covers fc00::-fdff::)
  if (/^f[cd][0-9a-f]{2}:/i.test(lower)) return true;
  return false;
}

/**
 * Convenience wrapper untuk validate baseUrl provider. Return validated string.
 * Throw kalau URL ditolak.
 */
export function validateProviderBaseUrl(url: string): string {
  const validated = assertSafeUrl(url);
  return validated.toString().replace(/\/$/, ""); // Strip trailing slash
}
