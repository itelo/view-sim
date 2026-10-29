# Releasing

Notes for the maintainer.

## Extension

1. Bump `version` in `extension/manifest.json`.
2. Commit, then tag and push: `git tag v1.2.0 && git push origin v1.2.0`. The tag must match the manifest version.
3. The **Release** workflow lints, builds `view-sim-extension-<version>.zip` and attaches it to a GitHub release.
4. Upload that zip to each store. Listing text, permission reasons and images are in [`store/`](store/listing.md).
   - Chrome Web Store: https://chrome.google.com/webstore/devconsole
   - Firefox Add-ons: `npx web-ext@8 sign --source-dir extension --channel listed --api-key … --api-secret …`, or upload the zip at https://addons.mozilla.org/developers/
   - Edge Add-ons: https://partner.microsoft.com/dashboard/microsoftedge/

## MCP server (npm and the MCP registry)

1. Bump `version` in `mcp-server/package.json` **and** both `version` fields in `mcp-server/server.json`.
2. Publish to npm (the `prepack` script copies the extension files it needs into `vendor/`):
   ```bash
   cd mcp-server
   npm login            # once per machine
   npm publish
   ```
3. Publish to the official MCP registry (https://registry.modelcontextprotocol.io), which other directories read from:
   ```bash
   brew install mcp-publisher            # or see github.com/modelcontextprotocol/registry
   cd mcp-server
   mcp-publisher login github            # signs in as itelo; allows io.github.itelo/* names
   mcp-publisher publish
   ```
   The registry checks that `mcpName` in the published npm package matches `name` in `server.json`.
4. Optional directories that don't read the registry automatically: https://smithery.ai (sign in with GitHub, "Add server", point it at this repo) and https://glama.ai/mcp/servers (submit the repo URL).

## Images

`node tools/store-images.mjs` rebuilds `docs/*.png` and `store/images/*.png` after visual changes.
