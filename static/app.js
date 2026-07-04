const fpsCounter = {
	frames: 0,
	lastSample: performance.now(),
	lastFrame: performance.now(),
	frameMs: 0,
	minFps: Number.POSITIVE_INFINITY,
	maxFps: 0,
	longFrames: 0,
};

initPerformancePanel();
requestAnimationFrame(tick);

function tick(now) {
	fpsCounter.frames += 1;
	fpsCounter.frameMs = now - fpsCounter.lastFrame;
	fpsCounter.lastFrame = now;

	if (fpsCounter.frameMs > 50) {
		fpsCounter.longFrames += 1;
	}

	const elapsed = now - fpsCounter.lastSample;
	if (elapsed >= 500) {
		const fps = Math.round((fpsCounter.frames * 1000) / elapsed);
		fpsCounter.minFps = Math.min(fpsCounter.minFps, fps);
		fpsCounter.maxFps = Math.max(fpsCounter.maxFps, fps);
		updatePerformancePanel(fps);
		fpsCounter.frames = 0;
		fpsCounter.lastSample = now;
	}

	requestAnimationFrame(tick);
}

function initPerformancePanel() {
	setText("perf-dpr", window.devicePixelRatio.toFixed(2));
	setText("perf-screen", `${screen.width}×${screen.height} @ ${screen.colorDepth}bit`);
	setText("perf-visibility", document.visibilityState);
	setText("perf-ua", navigator.userAgent);
	document.addEventListener("visibilitychange", () => {
		setText("perf-visibility", document.visibilityState);
	});
}

function updatePerformancePanel(fps) {
	const frameMs = fpsCounter.frameMs.toFixed(1);
	const fpsText = `${fps} fps · ${frameMs} ms`;
	const capHint = fps <= 65 ? " · likely 60Hz cap" : "";
	const range = `${fpsCounter.minFps}–${fpsCounter.maxFps} fps`;

	setText("fps-counter", fpsText + capHint);
	setText("perf-fps", `${fps}`);
	setText("perf-frame", `${frameMs} ms`);
	setText("perf-range", range);
	setText("perf-long-frames", String(fpsCounter.longFrames));

	const el = document.getElementById("fps-counter");
	if (el) {
		el.dataset.fps = String(fps);
	}
}

function setText(id, text) {
	const el = document.getElementById(id);
	if (el) {
		el.textContent = text;
	}
}
