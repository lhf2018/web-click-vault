/**
 * Linear interpolate between points [[x,y], ...]
 * @param {number} x
 * @param {Array<[number, number]>} points sorted by x
 */
function lerpPoints(x, points) {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i += 1) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    if (x <= x1) {
      const t = (x - x0) / (x1 - x0 || 1);
      return y0 + (y1 - y0) * t;
    }
  }
  return points[points.length - 1][1];
}

/**
 * @param {number} dwellMs
 * @returns {number} 0–1
 */
export function scoreDwell(dwellMs) {
  const s = Math.max(0, dwellMs) / 1000;
  // <3 → 0.10; 3–15 → 0.35–0.55; 15–60 → 0.55–0.85; >60 → 0.85–1.00
  return lerpPoints(s, [
    [0, 0.1],
    [3, 0.1],
    [3.01, 0.35],
    [15, 0.55],
    [60, 0.85],
    [120, 1.0],
  ]);
}

/**
 * @param {number} loadMs
 * @returns {number} 0–1
 */
export function scoreLoad(loadMs) {
  const ms = Math.max(0, loadMs);
  if (ms < 200) return 0.35;
  if (ms <= 2500) {
    // sweet spot: 200–2500 → 0.70–1.00 peaking near 800–1200
    const peak = 1000;
    const dist = Math.abs(ms - peak);
    const maxDist = 1500;
    return 1 - (dist / maxDist) * 0.3;
  }
  if (ms <= 8000) {
    return lerpPoints(ms, [
      [2500, 0.7],
      [8000, 0.4],
    ]);
  }
  return 0.25;
}

/**
 * @param {'first_host' | 'new_path' | 'seen_path' | 'default'} kind
 */
export function scoreFresh(kind) {
  switch (kind) {
    case "first_host":
      return 1.0;
    case "new_path":
      return 0.75;
    case "seen_path":
      return 0.4;
    default:
      return 0.55;
  }
}

/**
 * @param {{
 *   dwellMs: number,
 *   loadMs: number,
 *   freshKind: 'first_host' | 'new_path' | 'seen_path' | 'default',
 *   typeScore: number,
 * }} input
 */
export function buildScores(input) {
  return {
    dwell: scoreDwell(input.dwellMs),
    load: scoreLoad(input.loadMs),
    fresh: scoreFresh(input.freshKind),
    type: Math.min(1, Math.max(0, input.typeScore)),
  };
}
