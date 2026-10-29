# view-sim-mcp

MCP server for [view-sim](https://github.com/itelo/view-sim): open sites on phones, tablets, MacBooks and big displays, navigate and take transparent PNG screenshots, either through the view-sim browser extension or headlessly with Playwright.

```bash
claude mcp add view-sim -- npx -y view-sim-mcp
```

Headless screenshots need Playwright's browsers once:

```bash
npx -y playwright@1.64.1 install chromium webkit
```

To let only view-sim's extension connect to the bridge, set `VIEW_SIM_EXTENSION_IDS` to its extension id (comma-separated for several browsers):

```bash
claude mcp add view-sim -e VIEW_SIM_EXTENSION_IDS=<chrome-extension-id>,view-sim@itelo -- npx -y view-sim-mcp
```

See the [main README](https://github.com/itelo/view-sim#mcp-server) for the tools and how the bridge works.

MIT licensed. If view-sim saves you time, you can [support it on GitHub Sponsors](https://github.com/sponsors/itelo).
