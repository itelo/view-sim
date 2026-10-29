# Contributing

Thanks for helping. Bug reports, device requests and pull requests are all welcome.

## Running it

- **Extension:** no build step. Load `extension/` unpacked in Chrome (`chrome://extensions`, Developer mode) or as a temporary add-on in Firefox (`about:debugging`). Reload it there after changes.
- **MCP server:** `cd mcp-server && npm install && npm run install-browsers`, then point your MCP client at `node mcp-server/index.mjs`.
- **Demo pages:** serve the repo root (`python3 -m http.server 4580`) and open `http://localhost:4580/tools/demo-site/`. `tools/harness.html` runs the simulator without the extension.

## Before you open a pull request

```bash
npx -y web-ext@8 lint --source-dir extension   # expect one warning, about background.service_worker
node tools/smoke-test.mjs                      # headless render check
```

CI runs both. If you change how devices look, also run `node tools/store-images.mjs` and look at the images in `docs/` and `store/images/`.

## Adding a device

Devices live in `extension/shared/devices.js`. Use the CSS viewport size and pixel ratio of the real device, and the status bar height in CSS pixels. Both the extension and the headless renderer read that file, so one change covers both.

## Style

Plain JavaScript, no dependencies in the extension, and comments that explain why rather than what. Keep user-facing text short and plain.

By contributing, you agree that your work is released under the [MIT license](LICENSE).
