(async () => {
  const DEVICES = self.MFSIM_DEVICES;
  const devicesContainer = document.getElementById("devices");
  const zoomSelect = document.getElementById("zoom");
  const frameCheckbox = document.getElementById("frame");
  const syncCheckbox = document.getElementById("syncNav");
  const hostList = document.getElementById("hosts");
  const noHosts = document.getElementById("no-hosts");
  const status = document.getElementById("status");
  const bridgeCheckbox = document.getElementById("bridge");
  const bridgeStatus = document.getElementById("bridge-status");
  const allSitesSection = document.getElementById("all-sites");

  const stored = await chrome.storage.local.get(["defaults", "enabledHosts"]);
  const defaults = { ...self.MFSIM_DEFAULTS, ...stored.defaults };

  for (const device of DEVICES) {
    const checkbox = Object.assign(document.createElement("input"), {
      type: "checkbox",
      value: device.id,
      checked: defaults.devices.includes(device.id),
    });
    const label = document.createElement("label");
    label.className = "check";
    const meta = Object.assign(document.createElement("span"), {
      className: "device-meta",
      textContent: `${device.width}×${device.height}`,
    });
    label.append(checkbox, ` ${device.name} `, meta);
    devicesContainer.append(label);
  }
  zoomSelect.value = String(defaults.zoom);
  frameCheckbox.checked = defaults.frame;
  syncCheckbox.checked = defaults.syncNav;
  bridgeCheckbox.checked = defaults.bridge !== false;

  let statusTimer;
  const save = async () => {
    const devices = [...devicesContainer.querySelectorAll("input:checked")].map((input) => input.value);
    if (devices.length === 0) {
      status.textContent = "Pick at least one device.";
      return;
    }
    await chrome.storage.local.set({
      defaults: {
        devices,
        zoom: zoomSelect.value,
        frame: frameCheckbox.checked,
        syncNav: syncCheckbox.checked,
        bridge: bridgeCheckbox.checked,
      },
    });
    status.textContent = "Saved";
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => (status.textContent = ""), 1500);
  };
  for (const input of [devicesContainer, zoomSelect, frameCheckbox, syncCheckbox, bridgeCheckbox]) input.addEventListener("change", save);

  const refreshBridgeStatus = async () => {
    const response = await chrome.runtime.sendMessage({ type: "bridgeStatus" }).catch(() => null);
    if (!bridgeCheckbox.checked) bridgeStatus.textContent = "off";
    else bridgeStatus.textContent = response?.connected ? "connected" : "waiting for the MCP server";
  };
  refreshBridgeStatus();
  setInterval(refreshBridgeStatus, 2000);

  const allSites = { origins: ["<all_urls>"] };
  allSitesSection.hidden = await chrome.permissions.contains(allSites);
  document.getElementById("grant-all").addEventListener("click", async () => {
    if (await chrome.permissions.request(allSites)) allSitesSection.hidden = true;
  });

  const renderHosts = (enabledHosts) => {
    hostList.replaceChildren(
      ...enabledHosts.map((host) => {
        const item = document.createElement("li");
        const button = Object.assign(document.createElement("button"), { textContent: "Turn off" });
        button.addEventListener("click", async () => {
          await chrome.runtime.sendMessage({ type: "setEnabled", host, enabled: false });
          await chrome.storage.local.remove(`host:${host}`);
        });
        item.append(host, button);
        return item;
      }),
    );
    noHosts.hidden = enabledHosts.length > 0;
  };
  renderHosts(stored.enabledHosts ?? []);
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.enabledHosts) renderHosts(changes.enabledHosts.newValue ?? []);
  });
})();
