import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = join(root, "game", "dist");

const entries = [
	"box2d.wasm",
	"box2d.wasm.js",
	"data.json",
	"icons",
	"images",
	"index.html",
	"media",
	"miniant.json",
	"offline.json",
	"scripts/c3runtime.js",
	"scripts/dispatchworker.js",
	"scripts/jobworker.js",
	"scripts/main.js",
	"scripts/miniant-bridge.js",
	"scripts/modernjscheck.js",
	"scripts/offlineclient.js",
	"scripts/opus.wasm.js",
	"scripts/opus.wasm.wasm",
	"scripts/project",
	"scripts/supportcheck.js",
	"style.css"
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const entry of entries) {
	await cp(join(root, entry), join(output, entry), {
		recursive: true,
		filter: (path) => !/\.DS_Store$/.test(path)
	});
}

console.log(`Static MiniAnt build written to ${output}`);
