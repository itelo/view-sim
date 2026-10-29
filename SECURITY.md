# Security

Please report security problems privately through [GitHub's security advisories](https://github.com/itelo/view-sim/security/advisories/new) rather than in a public issue. I'll reply as soon as I can.

## What to know about view-sim

- **The MCP bridge is local only.** The MCP server listens on `127.0.0.1:47820`, and the extension connects to it only when the bridge is on in its settings. The server refuses connections from web pages (anything that isn't an extension origin).
- **Lock it to view-sim.** By default, any installed browser extension could connect to the bridge. Set `VIEW_SIM_EXTENSION_IDS` to view-sim's extension id to allow only view-sim (see the README). In Chrome the id is checked against the connection's origin, which other extensions cannot fake. In Firefox the id comes from the extension's own hello message.
- **Frames are loosened on purpose.** On sites you turn the simulator on for, view-sim removes the `X-Frame-Options` and `Content-Security-Policy` headers from that site's own responses inside the device frames, so it can load there. The page in those frames runs without its CSP. Only turn it on for sites you want to preview.
