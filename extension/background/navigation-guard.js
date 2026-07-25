import { DEDUPE_WINDOW_MS } from "../core/constants.js";
import { canonicalizeUrl, isCountableUrl } from "../core/url.js";

/**
 * @param {string} url
 * @param {Record<string, number>} recentVisitMap
 * @param {number} [now]
 */
export function shouldCountVisit(url, recentVisitMap, now = Date.now()) {
  if (!isCountableUrl(url)) {
    return { ok: false, reason: "excluded" };
  }
  const canonical = canonicalizeUrl(url);
  if (!canonical) {
    return { ok: false, reason: "bad_url" };
  }
  const last = recentVisitMap[canonical];
  if (typeof last === "number" && now - last < DEDUPE_WINDOW_MS) {
    return { ok: false, reason: "deduped", canonical };
  }
  return { ok: true, canonical };
}

/**
 * Prune old dedupe keys to keep storage small.
 * @param {Record<string, number>} map
 * @param {number} [now]
 */
export function pruneRecentVisitMap(map, now = Date.now()) {
  const next = {};
  for (const [k, ts] of Object.entries(map || {})) {
    if (now - ts < DEDUPE_WINDOW_MS * 4) next[k] = ts;
  }
  return next;
}
