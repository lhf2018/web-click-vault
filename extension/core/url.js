const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
]);

const INTERNAL_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "edge://",
  "about:",
  "devtools://",
  "view-source:",
  "brave://",
  "opera://",
  "vivaldi://",
];

/**
 * @param {string} url
 * @returns {boolean}
 */
export function isCountableUrl(url) {
  if (!url || typeof url !== "string") return false;
  const lower = url.toLowerCase();
  if (INTERNAL_PREFIXES.some((p) => lower.startsWith(p))) return false;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * @param {string} url
 * @returns {string | null}
 */
export function canonicalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    const keys = [...u.searchParams.keys()];
    for (const key of keys) {
      if (TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith("utm_")) {
        u.searchParams.delete(key);
      }
    }
    let path = u.pathname || "/";
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    u.pathname = path;
    return `${u.origin}${u.pathname}${u.search}`;
  } catch {
    return null;
  }
}

/**
 * Rough registrable-domain style host key (good enough without PSL).
 * @param {string} host
 */
export function hostKey(host) {
  const parts = String(host || "").toLowerCase().split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const last = parts[parts.length - 1];
  const second = parts[parts.length - 2];
  // common second-level: co.uk, com.cn etc. — keep last 3 if middle is short
  if (second.length <= 3 && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  return `${second}.${last}`;
}

/**
 * Heuristic page-type score 0–1. No content analysis.
 * @param {string} url
 */
export function pageTypeScore(url) {
  try {
    const u = new URL(url);
    const path = `${u.pathname}${u.search}`.toLowerCase();
    if (
      /\/(search|s|find|query|results?)(\/|$|\?)/.test(path) ||
      u.searchParams.has("q") ||
      u.searchParams.has("query") ||
      u.searchParams.has("keyword")
    ) {
      return 0.55;
    }
    if (/\/(list|category|tag|tags|archive|page\/\d+)(\/|$)/.test(path)) {
      return 0.55;
    }
    if (path === "/" || path === "") return 0.75;
    if (/\.(html?|md|pdf)$/i.test(u.pathname) || u.pathname.split("/").filter(Boolean).length >= 2) {
      return 0.92;
    }
    return 0.85;
  } catch {
    return 0.6;
  }
}
