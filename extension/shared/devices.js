// Device and browser catalog shared by the background worker, the simulator page, the popup and the options page.
// width/height are the portrait screen size in CSS pixels. Phones and tablets lose statusBar off the top;
// desktops lose menuBar (the macOS menu bar). Browser UI is taken off on top of that by the simulator.
(() => {
  const DEVICES = [
    { id: "iphone-15-pro", name: "iPhone 15 Pro", os: "ios", type: "phone", width: 393, height: 852, statusBar: 54, dpr: 3, radius: 55, cutout: "island" },
    { id: "iphone-15-pro-max", name: "iPhone 15 Pro Max", os: "ios", type: "phone", width: 430, height: 932, statusBar: 54, dpr: 3, radius: 55, cutout: "island" },
    { id: "iphone-13-mini", name: "iPhone 13 mini", os: "ios", type: "phone", width: 375, height: 812, statusBar: 50, dpr: 3, radius: 44, cutout: "notch" },
    { id: "iphone-se", name: "iPhone SE", os: "ios", type: "phone", width: 375, height: 667, statusBar: 20, dpr: 2, radius: 0, cutout: "classic" },
    { id: "pixel-8", name: "Pixel 8", os: "android", type: "phone", width: 412, height: 915, statusBar: 32, dpr: 2.625, radius: 40, cutout: "punch", model: "Pixel 8" },
    { id: "galaxy-s23", name: "Galaxy S23", os: "android", type: "phone", width: 360, height: 780, statusBar: 32, dpr: 3, radius: 36, cutout: "punch", model: "SM-S911B" },
    { id: "ipad-mini", name: "iPad mini", os: "ios", type: "tablet", width: 744, height: 1133, statusBar: 24, dpr: 2, radius: 22, cutout: "none" },
    { id: "ipad-pro-11", name: "iPad Pro 11\"", os: "ios", type: "tablet", width: 834, height: 1194, statusBar: 24, dpr: 2, radius: 22, cutout: "none" },
    { id: "macbook-pro-14", name: "MacBook Pro 14\"", os: "macos", type: "laptop", width: 1512, height: 982, menuBar: 37, dpr: 2, cutout: "macnotch" },
    { id: "macbook-pro-16", name: "MacBook Pro 16\"", os: "macos", type: "laptop", width: 1728, height: 1117, menuBar: 37, dpr: 2, cutout: "macnotch" },
    { id: "imac-24", name: "iMac 24\"", os: "macos", type: "imac", width: 2240, height: 1260, menuBar: 25, dpr: 2, cutout: "none" },
    { id: "dell-u4025qw", name: "Dell UltraSharp 40\" (U4025QW)", os: "macos", type: "monitor", width: 2560, height: 1080, menuBar: 25, dpr: 2, cutout: "none" },
  ];

  const BROWSERS = [
    { id: "safari", name: "Safari", platforms: ["ios", "macos"] },
    { id: "chrome", name: "Google Chrome", platforms: ["ios", "android", "macos"] },
    { id: "firefox", name: "Firefox", platforms: ["ios", "android", "macos"] },
    { id: "zen", name: "Zen", platforms: ["macos"] },
  ];

  const browsersFor = (device) => BROWSERS.filter((candidate) => candidate.platforms.includes(device.os));
  const defaultBrowser = (device) => (device.os === "android" ? "chrome" : "safari");
  const resolveBrowser = (device, browserId) =>
    browsersFor(device).some((candidate) => candidate.id === browserId) ? browserId : defaultBrowser(device);

  // Desktops return null: they keep the real browser's UA, since the page is rendered by that engine anyway.
  const userAgentFor = (device, browserId) => {
    const browser = resolveBrowser(device, browserId);
    if (device.os === "ios") {
      const platform = device.type === "tablet" ? "iPad; CPU OS 17_5" : "iPhone; CPU iPhone OS 17_5";
      const tail = {
        safari: "Version/17.5 Mobile/15E148 Safari/604.1",
        chrome: "CriOS/124.0.6367.111 Mobile/15E148 Safari/604.1",
        firefox: "FxiOS/126.0 Mobile/15E148 Safari/605.1.15",
      }[browser];
      return `Mozilla/5.0 (${platform} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ${tail}`;
    }
    if (device.os === "android") {
      if (browser === "firefox") return "Mozilla/5.0 (Android 14; Mobile; rv:126.0) Gecko/126.0 Firefox/126.0";
      return `Mozilla/5.0 (Linux; Android 14; ${device.model}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36`;
    }
    return null;
  };

  const DEFAULTS = {
    devices: ["iphone-15-pro", "pixel-8"],
    zoom: "fit",
    frame: true,
    syncNav: true,
    bridge: true,
  };

  self.MFSIM_DEVICES = DEVICES;
  self.MFSIM_BROWSERS = BROWSERS;
  self.MFSIM_DEFAULTS = DEFAULTS;
  self.MFSIM_browsersFor = browsersFor;
  self.MFSIM_resolveBrowser = resolveBrowser;
  self.MFSIM_userAgentFor = userAgentFor;
})();
