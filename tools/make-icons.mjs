// Renders extension/icons/logo.svg to the PNG sizes the manifest needs, using the MCP server's Playwright.
// Usage: node tools/make-icons.mjs  (after `npm install` in mcp-server/)
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../mcp-server/package.json", import.meta.url));
const { chromium } = require("playwright");

const svg = readFileSync(new URL("../extension/icons/logo.svg", import.meta.url), "utf8");
const browser = await chromium.launch();
for (const size of [16, 32, 48, 128]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: new URL(`../extension/icons/icon${size}.png`, import.meta.url).pathname, omitBackground: true });
  await page.close();
}
await browser.close();
console.log("icons written");
