# view-sim-mcp

MCP server for [view-sim](https://github.com/itelo/view-sim): open sites on phones, tablets, MacBooks and big displays, navigate and take transparent PNG screenshots, either through the view-sim browser extension or headlessly with Playwright. It can also frame screenshots taken by other tools, such as Playwright MCP, in a device.

```bash
claude mcp add view-sim -- npx -y view-sim-mcp
```

The first headless screenshot or frame downloads Playwright's Chromium (and WebKit for Safari devices) once, which can take a minute. Set `VIEW_SIM_NO_BROWSER_INSTALL=1` to turn that off and install them yourself with `npx -y playwright@1.64.1 install chromium webkit`.

To let only view-sim's extension connect to the bridge, set `VIEW_SIM_EXTENSION_IDS` to its extension id (comma-separated for several browsers):

```bash
claude mcp add view-sim -e VIEW_SIM_EXTENSION_IDS=<chrome-extension-id>,view-sim@itelo -- npx -y view-sim-mcp
```

See the [main README](https://github.com/itelo/view-sim#mcp-server) for the tools and how the bridge works.

MIT licensed. If view-sim saves you time, you can [support it on GitHub Sponsors](https://github.com/sponsors/itelo).
