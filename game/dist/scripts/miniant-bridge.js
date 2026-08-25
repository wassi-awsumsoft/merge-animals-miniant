const SDK_WAIT_MS = 8000;
const PROGRESS_INTERVAL_MS = 30000;
const SAVE_INTERVAL_MS = 15000;
const SCORE_POLL_INTERVAL_MS = 500;
const SCORE_KEY = "scoreBest";
const LOCAL_STORAGE_KEYS = ["scoreBest", "isGuide"];

const embedded = window.parent !== window;
const statusEl = document.getElementById("miniant-status");

let miniantActive = false;
let readySent = false;
let resultSent = false;
let terminated = false;
let startedAt = Date.now();
let progressTimer = 0;
let saveTimer = 0;
let scoreTimer = 0;
let pendingCloudBlob = null;
let latestScore = 0;
let gameplayStarted = false;

function setStatus(text) {
	if (statusEl) {
		statusEl.textContent = text;
	}
}

function hideStatus() {
	if (statusEl) {
		statusEl.hidden = true;
	}
}

function installStorageFallback() {
	const storage = navigator.storage || {};
	storage.persisted ||= async () => false;
	storage.persist ||= async () => false;
	try {
		Object.defineProperty(navigator, "storage", {
			value: storage,
			configurable: true
		});
	} catch {
		// Some browsers expose navigator.storage as read-only; Construct can continue without it.
	}
}

function applySafeAreaInsets(context) {
	const safeAreaInsets = context?.ui?.safeAreaInsets || {};
	const root = document.documentElement;
	root.style.setProperty("--miniant-safe-top", `${Number(safeAreaInsets.top || 0)}px`);
	root.style.setProperty("--miniant-safe-right", `${Number(safeAreaInsets.right || 0)}px`);
	root.style.setProperty("--miniant-safe-bottom", `${Number(safeAreaInsets.bottom || 0)}px`);
	root.style.setProperty("--miniant-safe-left", `${Number(safeAreaInsets.left || 0)}px`);
}

function getRuntime() {
	try {
		return window.c3_runtimeInterface?._GetLocalRuntime?.() || null;
	} catch {
		return null;
	}
}

function readBestScore() {
	const raw = window.localStorage.getItem(SCORE_KEY);
	const score = raw ? Number(raw) : 0;
	return Number.isFinite(score) && score > 0 ? score : 0;
}

function getConstructInterfaces() {
	const runtime = getRuntime();
	const iRuntime = runtime?.GetIRuntime?.() || null;
	return { runtime, iRuntime };
}

function readScoreText(iRuntime) {
	const rawText = iRuntime?.objects?.Game_TextScore?.getFirstInstance?.()?.text;
	const score = Number.parseInt(String(rawText || "").replace(/[^\d-]/g, ""), 10);
	return Number.isFinite(score) && score > 0 ? score : 0;
}

function readCurrentScore() {
	const { iRuntime } = getConstructInterfaces();
	const globalScore = Number(iRuntime?.globalVars?.Game_score);
	const textScore = readScoreText(iRuntime);
	const bestScore = readBestScore();
	latestScore = Math.max(
		latestScore,
		Number.isFinite(globalScore) && globalScore > 0 ? globalScore : 0,
		textScore,
		bestScore
	);
	return latestScore;
}

function getGameStatus() {
	const { runtime, iRuntime } = getConstructInterfaces();
	const globals = iRuntime?.globalVars || {};
	const layoutName = runtime?.GetMainRunningLayout?.()?.GetName?.() || "";
	return {
		layoutName,
		score: readCurrentScore(),
		timer: Number(globals.Game_timer),
		isPaused: Number(globals.Game_isPause) === 1
	};
}

function monitorScoreAndEndState() {
	if (!miniantActive || terminated || resultSent) {
		return;
	}
	const status = getGameStatus();
	if (status.layoutName === "GamePlay" && status.timer > 0) {
		gameplayStarted = true;
	}
	if (gameplayStarted && status.timer <= 0) {
		void reportResultOnce("completed");
	}
}

function canCaptureRuntimeSave(runtime) {
	try {
		return !!runtime?._SaveToJsonString && !!runtime.GetMainRunningLayout?.();
	} catch {
		return false;
	}
}

async function captureConstructState() {
	const runtime = getRuntime();
	const localStorageSnapshot = {};
	for (const key of LOCAL_STORAGE_KEYS) {
		const value = window.localStorage.getItem(key);
		if (value !== null) {
			localStorageSnapshot[key] = value;
		}
	}

	let c3save = null;
	try {
		if (canCaptureRuntimeSave(runtime)) {
			c3save = await runtime._SaveToJsonString();
		}
	} catch (error) {
		c3save = null;
	}

	return {
		version: 1,
		savedAt: Date.now(),
		score: readCurrentScore(),
		scoreBest: readBestScore(),
		localStorage: localStorageSnapshot,
		c3save
	};
}

async function saveMiniAntState() {
	if (!miniantActive || terminated || !window.MiniAnt?.state?.save) {
		return;
	}
	await window.MiniAnt.state.save(await captureConstructState());
}

async function restoreCloudBlob(blob) {
	if (!blob || typeof blob !== "object") {
		return;
	}
	for (const [key, value] of Object.entries(blob.localStorage || {})) {
		if (LOCAL_STORAGE_KEYS.includes(key) && typeof value === "string") {
			window.localStorage.setItem(key, value);
		}
	}

	const runtime = getRuntime();
	if (blob.c3save && runtime?.LoadFromJsonString) {
		try {
			await runtime.LoadFromJsonString(blob.c3save);
		} catch (error) {
			console.warn("MiniAnt cloud save restore fell back to local storage only.", error);
		}
	}
}

function setRuntimePaused(isPaused) {
	document.documentElement.classList.toggle("miniant-paused", isPaused);
	try {
		getRuntime()?.SetTimeScale?.(isPaused ? 0 : 1);
	} catch {
		// Construct internals vary by export mode; blocking input is still enough for MiniAnt pause.
	}
}

function stopTimers() {
	if (progressTimer) {
		window.clearInterval(progressTimer);
		progressTimer = 0;
	}
	if (saveTimer) {
		window.clearInterval(saveTimer);
		saveTimer = 0;
	}
	if (scoreTimer) {
		window.clearInterval(scoreTimer);
		scoreTimer = 0;
	}
}

function durationMs() {
	return Math.max(0, Date.now() - startedAt);
}

async function reportResultOnce(outcome = "abandoned") {
	if (!miniantActive || resultSent || !window.MiniAnt?.reportResult) {
		return;
	}
	resultSent = true;
	await saveMiniAntState();
	await window.MiniAnt.reportResult({
		outcome,
		score: readCurrentScore(),
		durationMs: durationMs(),
		detail: {
			source: "construct-export-wrapper",
			scoreSource: "Construct globalVars.Game_score"
		}
	});
}

function reportProgress() {
	if (!miniantActive || terminated || !window.MiniAnt?.reportProgress) {
		return;
	}
	void window.MiniAnt.reportProgress({
		checkpoint: "active_session",
		score: readCurrentScore(),
		tick: Math.floor(durationMs() / 1000)
	});
}

function waitForMiniAnt() {
	if (window.MiniAnt) {
		return Promise.resolve(window.MiniAnt);
	}
	return new Promise((resolve) => {
		const started = Date.now();
		const tick = () => {
			if (window.MiniAnt) {
				resolve(window.MiniAnt);
				return;
			}
			if (Date.now() - started >= SDK_WAIT_MS) {
				resolve(null);
				return;
			}
			window.setTimeout(tick, 50);
		};
		tick();
	});
}

function loadScript(src, options = {}) {
	return new Promise((resolve, reject) => {
		const script = document.createElement("script");
		script.src = src;
		script.async = false;
		if (options.type) {
			script.type = options.type;
		}
		script.addEventListener("load", resolve, { once: true });
		script.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
		document.body.appendChild(script);
	});
}

async function startConstructRuntime() {
	installStorageFallback();
	await loadScript("scripts/modernjscheck.js");
	await loadScript("scripts/supportcheck.js");
	await loadScript("scripts/offlineclient.js", { type: "module" });
	await loadScript("scripts/main.js", { type: "module" });
	waitForFirstFrame();
}

function waitForFirstFrame() {
	const tick = () => {
		const canvas = document.querySelector("canvas");
		const visible = canvas && canvas.offsetWidth > 0 && canvas.offsetHeight > 0 && getComputedStyle(canvas).display !== "none";
		if (visible) {
			hideStatus();
			void restoreCloudBlob(pendingCloudBlob).finally(() => {
				if (miniantActive && !readySent && window.MiniAnt?.ready) {
					readySent = true;
					void saveMiniAntState();
					void window.MiniAnt.ready();
				}
			});
			return;
		}
		window.requestAnimationFrame(tick);
	};
	window.requestAnimationFrame(tick);
}

async function bootMiniAnt() {
	const MiniAnt = await waitForMiniAnt();
	if (!MiniAnt) {
		setStatus("Unable to connect to MiniAnt.");
		return;
	}

	const context = await MiniAnt.init({ sdkVersion: 1 });
	miniantActive = true;
	startedAt = Date.now();
	applySafeAreaInsets(context);

	if (MiniAnt.state?.load) {
		try {
			const loaded = await MiniAnt.state.load();
			pendingCloudBlob = loaded?.blob || loaded || null;
		} catch (error) {
			console.warn("MiniAnt cloud state load failed.", error);
		}
	}

	MiniAnt.state?.onSaveRequest?.(() => captureConstructState());
	MiniAnt.on?.("pause", () => setRuntimePaused(true));
	MiniAnt.on?.("resume", () => {
		if (!terminated) {
			setRuntimePaused(false);
		}
	});
	MiniAnt.on?.("settings_changed", (settings) => {
		window.__miniantSettings = settings;
	});
	MiniAnt.on?.("terminate", () => {
		terminated = true;
		void reportResultOnce("abandoned").finally(() => {
			setRuntimePaused(true);
			stopTimers();
			document.documentElement.classList.add("miniant-terminated");
		});
	});

	progressTimer = window.setInterval(reportProgress, PROGRESS_INTERVAL_MS);
	saveTimer = window.setInterval(() => void saveMiniAntState(), SAVE_INTERVAL_MS);
	scoreTimer = window.setInterval(monitorScoreAndEndState, SCORE_POLL_INTERVAL_MS);
	await startConstructRuntime();
}

async function bootStandalone() {
	miniantActive = false;
	applySafeAreaInsets(null);
	await startConstructRuntime();
}

window.addEventListener("pagehide", () => {
	if (miniantActive && !terminated) {
		void reportResultOnce("abandoned");
	}
});

if (embedded) {
	void bootMiniAnt();
} else {
	void bootStandalone();
}
