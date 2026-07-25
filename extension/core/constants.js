export const CAP = 10;
export const MIN = 0.3;
export const WEIGHTS = {
  dwell: 0.45,
  load: 0.2,
  fresh: 0.2,
  type: 0.15,
};
export const NOISE_RANGE = 0.08;
export const DEDUPE_WINDOW_MS = 90_000;
export const DWELL_CAP_MS = 180_000;
export const RECENT_ENTRIES_LIMIT = 50;
export const DAILY_HISTORY_DAYS = 14;
export const SCHEMA_VERSION = 2;

export const ACHIEVEMENTS = [
  {
    id: "start_ledger",
    threshold: 300,
    title: "开始记账",
    hint: "记录今天这批入账主要发生在什么浏览场景里。",
  },
  {
    id: "hold_impulse",
    threshold: 1000,
    title: "守住第一笔冲动",
    hint: "暂停一次非必要消费，或把一笔钱从「想买」改成「先等等」。",
  },
  {
    id: "keep_money",
    threshold: 3000,
    title: "把钱留住",
    hint: "转入一个真实储蓄目标，哪怕只是很小的一笔。",
  },
  {
    id: "month_surplus",
    threshold: 10000,
    title: "月底有余",
    hint: "做一次月度复盘，看看动态入账和现实开销之间发生了什么。",
  },
];

export const DEFAULT_SETTINGS = {
  /** false = 忽略 pushState / SPA 同文档路由，只计整页导航 */
  countSpaNavigations: false,
  /** 设置页显示公式拆解 */
  showFormulaDebug: true,
};
