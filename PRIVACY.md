# Privacy

view-sim does not collect, store or send any personal data, browsing history or analytics. It has no accounts, no tracking and no remote servers.

- **Settings stay in your browser.** The devices, zoom and the list of sites you turned the simulator on for are saved with the browser's extension storage on your computer.
- **Site access is per site.** The extension only gets access to a website when you turn the simulator on for it from the toolbar button. Screenshots additionally need access to all websites, which you grant yourself from the settings page; the images are saved to your computer and nowhere else.
- **The MCP bridge stays on your computer.** When the MCP bridge is on in the settings, the extension connects to `ws://127.0.0.1:47820`, a server on your own machine that you start yourself (`view-sim-mcp`). That is the only network connection the extension makes on its own. Turn the bridge off in the settings and it makes none.
- **Pages load as usual.** Websites you open in the simulator are loaded by your browser exactly as they would be in a normal tab, under their own privacy policies.

Questions: open an issue at https://github.com/itelo/view-sim/issues.
