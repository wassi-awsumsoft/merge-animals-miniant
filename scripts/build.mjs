import { access, cp, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
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

await mkdir(output, { recursive: true });

for (const entry of entries) {
	await cp(join(root, entry), join(output, entry), {
		recursive: true,
		filter: (path) => !/\.DS_Store$/.test(path)
	});
}

await access(join(output, "index.html"));
const outputFiles = await readdir(output);
if (outputFiles.length === 0) {
	throw new Error(`Static MiniAnt build output is empty: ${output}`);
}

console.log(`Static MiniAnt build written to game/dist (${outputFiles.length} top-level entries)`);
