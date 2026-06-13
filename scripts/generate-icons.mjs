import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const svgPath = resolve(__dirname, "../public/icon.svg");
const svg = readFileSync(svgPath, "utf8");

const sizes = [
  { name: "icon-512.png",         size: 512 },
  { name: "icon-192.png",         size: 192 },
  { name: "apple-touch-icon.png", size: 180 },
];

for (const { name, size } of sizes) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: size },
  });
  const png = resvg.render().asPng();
  const out = resolve(__dirname, "../public", name);
  writeFileSync(out, png);
  console.log(`✓ ${name} (${size}x${size})`);
}
