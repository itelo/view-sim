(async () => {
  const siteCard = document.getElementById("site");
  const toggle = document.getElementById("toggle");
  const hostLabel = document.getElementById("host");
  const unsupported = document.getElementById("unsupported");

  document.getElementById("settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
  document.getElementById("support").addEventListener("click", (event) => {
    event.preventDefault();
    chrome.tabs.create({ url: event.currentTarget.href });
    window.close();
  });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let host = null;
  try {
    const url = new URL(tab?.url ?? "");
    if (url.protocol === "http:" || url.protocol === "https:") host = url.hostname;
  } catch {}

  if (host == null) {
    unsupported.hidden = false;
    return;
  }

  const { enabledHosts = [] } = await chrome.storage.local.get("enabledHosts");
  hostLabel.textContent = host;
  hostLabel.title = host;
  toggle.checked = enabledHosts.includes(host);
  siteCard.hidden = false;

  toggle.addEventListener("change", async () => {
    // Site access is requested per site, inside the click's user gesture. The browser can close the
    // popup while its prompt is up, so the background is told first and finishes the job if so.
    if (toggle.checked) {
      chrome.runtime.sendMessage({ type: "pendingEnable", host, tabId: tab.id }).catch(() => {});
      const granted = await chrome.permissions.request({ origins: [`*://${host}/*`] }).catch(() => false);
      if (!granted) {
        toggle.checked = false;
        return;
      }
    }
    toggle.disabled = true;
    await chrome.runtime.sendMessage({ type: "setEnabled", host, enabled: toggle.checked, tabId: tab.id });
    toggle.disabled = false;
  });
})();
