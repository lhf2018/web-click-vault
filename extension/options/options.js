function escapeText(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

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
      <span>${escapeText(f.host)} · Score ${Number(f.score || 0).toFixed(3)} · Noise ${(((f.noise || 0) * 100)).toFixed(1)}%</span>
    </div>
    <div class="score-rows">
      ${rows
        .map(
          ([label, score, weight]) => `
        <div class="score-row">
          <span>${label} ×${Number(weight) || "-"}</span>
          <div class="bar"><i style="width:${Math.max(4, (score || 0) * 100)}%"></i></div>
          <em>${pct(score)}</em>
        </div>`
        )
        .join("")}
    </div>
    <p class="formula-meta">
      ${escapeText(f.reason)}<br />
      ${(f.extras || []).map(effect => `${escapeText(effect.name)}：额外 +${Math.round(effect.bonus*100)}%`).join(" · ")}<br />
      ${f.multiplier > 1 ? `基础入账 ${money(f.baseAmount)} × 商店倍率 ${Number(f.multiplier)}<br />` : ""}
      停留 ${Math.round((f.dwellMs || 0) / 1000)}s · 加载 ${Math.round(f.loadMs || 0)}ms ·
      新鲜度 ${escapeText(f.freshKind || "-")} · 来源 ${f.dwellSource === "probe" ? "可见性探针" : "标签估算"}
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

  document.getElementById("autoSettleRecoveries").checked = state.settings?.autoSettleRecoveries === true;

  renderWeek(week);
  renderFormula(state);
}

const settingInputs = {
  countSpaNavigations: document.getElementById("countSpa"),
  showFormulaDebug: document.getElementById("showFormula"),
  autoSettleRecoveries: document.getElementById("autoSettleRecoveries"),
};
let settingsRevision = 0;
let saveQueue = Promise.resolve();

async function refresh() {
  const revision = settingsRevision;
  try {
    const res = await request("GET_STATE");
    if (res?.ok && revision === settingsRevision) fill(res.state, res.week);
  } catch {
    document.getElementById("settingsHint").textContent = "无法连接扩展后台，请重新加载扩展后打开设置。";
  }
}

function saveSetting(key, input) {
  const value = input.checked;
  const revision = ++settingsRevision;
  const hint = document.getElementById("settingsHint");
  hint.textContent = "正在保存…";
  // Save only the changed setting; older replies must not undo a newer click.
  saveQueue = saveQueue.then(async () => {
    try {
      const res = await request("SET_SETTINGS", { [key]: value });
      if (!res?.ok) throw new Error(res?.error || "保存失败，请重试。");
      if (res.state?.settings?.[key] !== value) {
        throw new Error("扩展后台仍是旧版本，设置尚未保存。请到 chrome://extensions 重新加载「网页资产计」，再重新打开设置。" );
      }
      if (revision === settingsRevision) {
        fill(res.state, res.week);
        hint.textContent = "设置已保存。";
      }
    } catch (error) {
      if (revision === settingsRevision) hint.textContent = error.message || "保存失败，请重试。";
    }
  });
  return saveQueue;
}

for (const [key, input] of Object.entries(settingInputs)) {
  input.addEventListener("change", () => saveSetting(key, input));
}

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

const backupHint = document.getElementById('backupHint');
const exportButton = document.getElementById('exportData');
const importButton = document.getElementById('importData');
const importFile = document.getElementById('importFile');
exportButton.addEventListener('click', async () => {
  exportButton.disabled = true;
  try {
    const res = await request('EXPORT_BACKUP');
    if (!res?.ok || !res.backup) throw new Error(res?.error || '导出失败');
    const url = URL.createObjectURL(new Blob([JSON.stringify(res.backup, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    const date = new Date();
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    link.download = `网页资产计-${day}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    backupHint.textContent = '备份已导出';
  } catch (error) { backupHint.textContent = error.message; }
  finally { exportButton.disabled = false; }
});
importButton.addEventListener('click', () => importFile.click());
importFile.addEventListener('change', async () => {
  const file = importFile.files?.[0];
  if (!file) return;
  importButton.disabled = true;
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error('备份不能超过 10 MB');
    let backup;
    try { backup = JSON.parse(await file.text()); } catch { throw new Error('无法读取备份文件'); }
    if (backup?.format !== 'web-click-vault' || backup.version !== 1 || !backup.state) throw new Error('不是有效的账本备份');
    if (!confirm('导入将覆盖当前账本，并清除正在计时的会话。继续？')) return;
    await saveQueue;
    ++settingsRevision;
    const res = await request('IMPORT_BACKUP', { backup });
    if (!res?.ok) throw new Error(res?.error || '导入失败');
    fill(res.state, res.week);
    backupHint.textContent = '账本已导入';
  } catch (error) { backupHint.textContent = error.message; }
  finally { importButton.disabled = false; importFile.value = ''; }
});
