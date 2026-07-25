function money(n) {
  const v = Number(n) || 0;
  return `¥${v.toFixed(2)}`;
}

function shortHost(hostOrUrl) {
  if (!hostOrUrl) return "";
  try {
    if (hostOrUrl.includes("://")) return new URL(hostOrUrl).host.replace(/^www\./, "");
    return String(hostOrUrl).replace(/^www\./, "");
  } catch {
    return String(hostOrUrl);
  }
}

function renderWeek(week) {
  const chart = document.getElementById("weekChart");
  const list = Array.isArray(week) ? week : [];
  const max = Math.max(1, ...list.map((d) => d.asset || 0));
  const sum = list.reduce((acc, d) => acc + (d.asset || 0), 0);
  document.getElementById("weekTotal").textContent = money(sum);

  chart.innerHTML = "";
  list.forEach((day) => {
    const col = document.createElement("div");
    col.className = `week-col${day.isToday ? " is-today" : ""}`;
    const h = Math.max(4, Math.round(((day.asset || 0) / max) * 56));
    col.innerHTML = `
      <div class="week-bar-wrap" title="${day.dayKey} · ${money(day.asset)} · ${day.visits} 次">
        <div class="week-bar" style="height:${h}px"></div>
      </div>
      <span>${day.weekday}</span>
    `;
    chart.appendChild(col);
  });
}

/**
 * @param {any} state
 * @param {any[]} [week]
 */
function render(state, week) {
  document.getElementById("todayAsset").textContent = money(state.todayAsset);
  document.getElementById("todayVisits").textContent = `今日 ${state.todayVisits || 0} 次`;
  document.getElementById("totalVisits").textContent = `至今 ${state.totalVisits || 0} 页`;
  document.getElementById("totalAsset").textContent = money(state.totalAsset);

  renderWeek(week || []);

  const recoveries = state.pendingRecoveries || [];
  const recoverBox = document.getElementById("recoverBox");
  if (recoveries.length) {
    recoverBox.classList.remove("hidden");
    document.getElementById("recoverHint").textContent =
      `有 ${recoveries.length} 个未结算草稿（标签异常关闭或扩展重启）。可补结算入账，或丢弃。`;
  } else {
    recoverBox.classList.add("hidden");
  }

  const last = state.recentEntries?.[0];
  if (last) {
    document.getElementById("lastAmount").textContent = `+${money(last.amount)}`;
    document.getElementById("lastReason").textContent = last.reason || "";
    document.getElementById("lastHost").textContent = shortHost(last.host || last.url);
  } else {
    document.getElementById("lastAmount").textContent = "—";
    document.getElementById("lastReason").textContent = "还没有入账记录";
    document.getElementById("lastHost").textContent = "";
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEntries = (state.recentEntries || [])
    .filter((e) => e.ts >= todayStart.getTime())
    .slice(0, 6);
  const trailSection = document.getElementById("trailSection");
  const trailList = document.getElementById("trailList");
  trailList.innerHTML = "";
  if (!todayEntries.length) {
    trailSection.classList.add("hidden");
  } else {
    trailSection.classList.remove("hidden");
    todayEntries.forEach((entry, i) => {
      const chip = document.createElement("div");
      chip.className = "chip";
      chip.style.animationDelay = `${i * 40}ms`;
      chip.innerHTML = `<strong>+${money(entry.amount)}</strong><span>${shortHost(entry.host || entry.url)}</span>`;
      trailList.appendChild(chip);
    });
  }

  const box = document.getElementById("achieveBox");
  if (state.pendingAchievement) {
    box.classList.remove("hidden");
    document.getElementById("achieveTitle").textContent = state.pendingAchievement.title;
    document.getElementById("achieveHint").textContent = state.pendingAchievement.hint;
  } else {
    box.classList.add("hidden");
  }
}

async function request(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload });
}

async function refresh() {
  const res = await request("GET_STATE");
  if (res?.ok) render(res.state, res.week);
}

document.getElementById("dismissAchieve").addEventListener("click", async () => {
  const res = await request("DISMISS_ACHIEVEMENT");
  if (res?.ok) render(res.state, res.week);
});

document.getElementById("recoverSettle").addEventListener("click", async () => {
  const res = await request("RECOVER_SETTLE");
  if (res?.ok) render(res.state, res.week);
});

document.getElementById("recoverDiscard").addEventListener("click", async () => {
  const res = await request("RECOVER_DISCARD");
  if (res?.ok) render(res.state, res.week);
});

document.getElementById("openOptions").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

refresh();
