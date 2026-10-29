// Zips extension/ into dist/view-sim-extension-<version>.zip, the file to upload to the Chrome Web
// Store and addons.mozilla.org. Uses the `zip` command (macOS and Linux have it).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extension = path.join(root, "extension");
const { version } = JSON.parse(readFileSync(path.join(extension, "manifest.json"), "utf8"));
const output = path.join(root, "dist", `view-sim-extension-${version}.zip`);

mkdirSync(path.dirname(output), { recursive: true });
rmSync(output, { force: true });
// -X leaves out macOS extra attributes; the manifest must sit at the root of the zip.
execFileSync("zip", ["-r", "-X", "-q", output, ".", "-x", "*.DS_Store"], { cwd: extension, stdio: "inherit" });
console.log(path.relative(process.cwd(), output));
