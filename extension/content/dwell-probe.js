/**
 * Visible-dwell probe. Only counts time while document is visible.
 * Sends ticks to the service worker; reads only bounded title/theme metadata and code-block presence for passive souvenirs.
 */
(() => {
  if (window.__assetMeterProbeInstalled) return;
  window.__assetMeterProbeInstalled = true;

  let visibleSince = document.visibilityState === "visible" ? Date.now() : null;
  let accumMs = 0;
  let lastSent = 0;

  function flush() {
    if (visibleSince == null) return;
    accumMs += Math.max(0, Date.now() - visibleSince);
    visibleSince = null;
  }

  function currentDwell() {
    const live = visibleSince != null ? Math.max(0, Date.now() - visibleSince) : 0;
    return accumMs + live;
  }

  function send(type, extra = {}) {
    try {
      chrome.runtime.sendMessage({
        type,
        pageElements: {
          title: document.title.slice(0, 120),
          siteName: (document.querySelector('meta[property="og:site_name"]')?.content || '').slice(0, 50),
          color: (document.querySelector('meta[name="theme-color"]')?.content || '').slice(0, 32),
          hasCode: !!document.querySelector('pre code, pre[class*="language"], pre[class*="highlight"]'),
        },
        dwellMs: currentDwell(),
        visible: document.visibilityState === "visible",
        ...extra,
      });
    } catch {
      // extension context invalidated
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      visibleSince = Date.now();
      send("DWELL_VISIBLE");
    } else {
      flush();
      send("DWELL_TICK");
    }
  });

  window.addEventListener("pagehide", () => {
    flush();
    send("DWELL_TICK", { pagehide: true });
  });

  // Heartbeat while visible
  setInterval(() => {
    if (document.visibilityState !== "visible") return;
    const now = Date.now();
    if (now - lastSent < 4000) return;
    lastSent = now;
    send("DWELL_TICK");
  }, 5000);

  // Initial ping
  send("DWELL_TICK", { boot: true });
})();
