import { CAP, MIN, WEIGHTS, NOISE_RANGE } from "./constants.js";

/**
 * @param {number} n
 * @param {number} lo
 * @param {number} hi
 */
function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * @param {number} n
 */
function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * @param {{ dwell: number, load: number, fresh: number, type: number }} s
 */
export function buildReason(s) {
  const parts = [];
  if (s.dwell >= 0.85) parts.push("停留充分");
  else if (s.dwell >= 0.55) parts.push(`停留适中`);
  else if (s.dwell >= 0.35) parts.push("停留较短");
  else parts.push("停留很短");

  if (s.load >= 0.7) parts.push("加载正常");
  else if (s.load >= 0.4) parts.push("加载偏慢");
  else parts.push("加载异常");

  if (s.fresh >= 0.95) parts.push("新域名");
  else if (s.fresh >= 0.7) parts.push("新路径");
  else if (s.fresh <= 0.45) parts.push("旧路径");

  return parts.join(" · ");
}

/**
 * @param {{ dwell: number, load: number, fresh: number, type: number }} scores
 * @param {number} [noise] -1..1 scale; if omitted uses Math.random in ±NOISE_RANGE
 */
export function computeDeposit(scores, noise) {
  const n =
    typeof noise === "number"
      ? clamp(noise, -NOISE_RANGE, NOISE_RANGE)
      : (Math.random() * 2 - 1) * NOISE_RANGE;

  const score =
    WEIGHTS.dwell * scores.dwell +
    WEIGHTS.load * scores.load +
    WEIGHTS.fresh * scores.fresh +
    WEIGHTS.type * scores.type;

  const raw = CAP * score * (1 + n);
  const deposit = round2(clamp(raw, MIN, CAP));

  return {
    score: round2(score),
    raw: round2(raw),
    deposit,
    noise: round2(n),
    reason: buildReason(scores),
  };
}

/**
 * Humanize dwell for UI.
 * @param {number} dwellMs
 */
export function formatDwell(dwellMs) {
  const s = Math.round(dwellMs / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}m${r}s` : `${m}m`;
}
