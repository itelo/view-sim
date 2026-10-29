// Renders the demo site on a phone and a laptop with the headless renderer and checks the PNGs:
// right size, transparent corners, opaque middle. Exits non-zero on failure. Used by CI.
//
//   node tools/smoke-test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "mcp-server/package.json"));
const { chromium } = require("playwright");
const { headlessScreenshot, closeHeadless } = await import(path.join(root, "mcp-server/headless.mjs"));

const showcase = readFileSync(path.join(root, "tools/demo-site/showcase.html"));
const route = (r) => (new URL(r.request().url()).hostname === "smoke.test" ? r.fulfill({ contentType: "text/html", body: showcase }) : r.abort());

// Reads pixel alpha values by drawing the PNG on a canvas.
const browser = await chromium.launch();
const page = await browser.newPage();
const alphaAt = (data, points) =>
  page.evaluate(
    async ({ data, points }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = Object.assign(document.createElement("canvas"), { width: image.width, height: image.height });
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      return points.map(([x, y]) => context.getImageData(Math.round(x * image.width), Math.round(y * image.height), 1, 1).data[3]);
    },
    { data, points },
  );

let failed = false;
for (const device of [{ id: "iphone-15-pro", browser: "chrome" }, { id: "macbook-pro-14", browser: "chrome" }]) {
  try {
    const shot = await headlessScreenshot({ url: "https://smoke.test/", device, engine: "chromium", waitMs: 0, route, maxWidth: 800 });
    assert.equal(shot.title, "Fernway Coffee");
    assert.ok(shot.width > 300 && shot.height > 300, `unexpected size ${shot.width}×${shot.height}`);
    const [corner, middle] = await alphaAt(shot.data, [[0, 0], [0.5, 0.5]]);
    assert.equal(corner, 0, "the corner should be transparent");
    assert.equal(middle, 255, "the middle should be opaque");
    console.log(`ok   ${device.id}: ${shot.width}×${shot.height}`);
  } catch (error) {
    failed = true;
    console.error(`FAIL ${device.id}: ${error.message}`);
  }
}
await browser.close();
await closeHeadless();
process.exit(failed ? 1 : 0);
