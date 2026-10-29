// Copies the extension files the headless renderer needs into vendor/, so the npm package works
// without the rest of the repo. Runs on `npm pack` / `npm publish` (prepack); postpack removes it
// again so that in the repo the renderer always uses extension/ directly.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendor = path.join(root, "vendor");
rmSync(vendor, { recursive: true, force: true });
if (process.argv[2] === "clean") process.exit(0);

const extension = path.resolve(root, "../extension");
for (const file of ["shared/devices.js", "simulator/simulator.js", "simulator/simulator.css"]) {
  mkdirSync(path.dirname(path.join(vendor, file)), { recursive: true });
  cpSync(path.join(extension, file), path.join(vendor, file));
}
// render.html points at ../../extension/; next to the copies it points at ./ instead.
const renderPage = readFileSync(path.join(root, "render/render.html"), "utf8").replaceAll("../../extension/", "./");
writeFileSync(path.join(vendor, "render.html"), renderPage);
console.error(`vendored extension files into ${path.relative(process.cwd(), vendor) || "."}`);
