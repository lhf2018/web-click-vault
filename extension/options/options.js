function money(n) {
  return `¥${(Number(n) || 0).toFixed(2)}`;
}

function pct(n) {
  return `${Math.round((Number(n) || 0) * 100)}%`;
}

async function request(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload });
}

function renderWeek(week) {
  const board = document.getElementById("weekBoard");
  board.innerHTML = "";
  (week || []).forEach((day) => {
    const cell = document.createElement("div");
    cell.className = `week-cell${day.isToday ? " is-today" : ""}`;
    cell.innerHTML = `
      <div class="wd">${day.weekday} · ${day.label}</div>
      <strong>${money(day.asset)}</strong>
      <div class="meta">${day.visits || 0} 次</div>
    `;
    board.appendChild(cell);
  });
}

function renderFormula(state) {
  const card = document.getElementById("formulaCard");
  const panel = document.getElementById("formulaPanel");
  const show = state.settings?.showFormulaDebug !== false;
  card.style.display = show ? "" : "none";
  if (!show) return;

  const f = state.lastFormula;
  if (!f) {
    panel.className = "formula-empty";
    panel.textContent = "暂无入账记录。结算一笔后这里会显示明细。";
    return;
  }

  const scores = f.scores || {};
  const rows = [
    ["停留", scores.dwell, f.weights?.dwell],
    ["加载", scores.load, f.weights?.load],
    ["新鲜度", scores.fresh, f.weights?.fresh],
    ["类型", scores.type, f.weights?.type],
  ];

  panel.className = "formula-grid";
  panel.innerHTML = `
    <div class="formula-top">
      <strong>+${money(f.amount)}</strong>
      <span>${f.host || ""} · Score ${Number(f.score || 0).toFixed(3)} · Noise ${(((f.noise || 0) * 100)).toFixed(1)}%</span>
    </div>
    <div class="score-rows">
      ${rows
        .map(
          ([label, score, weight]) => `
        <div class="score-row">
          <span>${label} ×${weight ?? "-"}</span>
          <div class="bar"><i style="width:${Math.max(4, (score || 0) * 100)}%"></i></div>
          <em>${pct(score)}</em>
        </div>`
        )
        .join("")}
    </div>
    <p class="formula-meta">
      ${f.reason || ""}<br />
      停留 ${Math.round((f.dwellMs || 0) / 1000)}s · 加载 ${Math.round(f.loadMs || 0)}ms ·
      新鲜度 ${f.freshKind || "-"} · 来源 ${f.dwellSource === "probe" ? "可见性探针" : "标签估算"}
    </p>
  `;
}

function fill(state, week) {
  document.getElementById("sVisits").textContent = String(state.todayVisits || 0);
  document.getElementById("sTotalVisits").textContent = String(state.totalVisits || 0);
  document.getElementById("sToday").textContent = money(state.todayAsset);
  document.getElementById("sTotal").textContent = money(state.totalAsset);

  document.getElementById("countSpa").checked = !!state.settings?.countSpaNavigations;
  document.getElementById("showFormula").checked = state.settings?.showFormulaDebug !== false;

  renderWeek(week);
  renderFormula(state);
}

async function refresh() {
  const res = await request("GET_STATE");
  if (res?.ok) fill(res.state, res.week);
}

async function saveSettings() {
  const res = await request("SET_SETTINGS", {
    countSpaNavigations: document.getElementById("countSpa").checked,
    showFormulaDebug: document.getElementById("showFormula").checked,
  });
  const hint = document.getElementById("settingsHint");
  if (res?.ok) {
    fill(res.state, res.week);
    hint.textContent = "策略已更新。";
    setTimeout(() => {
      if (hint.textContent === "策略已更新。") hint.textContent = "";
    }, 1800);
  } else {
    hint.textContent = res?.error || "保存失败";
  }
}

document.getElementById("countSpa").addEventListener("change", saveSettings);
document.getElementById("showFormula").addEventListener("change", saveSettings);

document.getElementById("resetToday").addEventListener("click", async () => {
  if (!confirm("确定重置今日打开数与今日入账？累计资产会保留。")) return;
  const res = await request("RESET_TODAY");
  if (res?.ok) fill(res.state, res.week);
});

document.getElementById("resetAll").addEventListener("click", async () => {
  if (!confirm("确定清空全部本地账本数据？此操作不可恢复。")) return;
  const res = await request("RESET_ALL");
  if (res?.ok) fill(res.state, res.week);
});

refresh();
