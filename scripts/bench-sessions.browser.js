// Browser driver for bench-sessions.ts. Run the launcher, not this file.
import { appendFile } from "node:fs/promises";
import { join } from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const [base, root, count = "12"] = process.argv.slice(2);
const iterations = Number(count);
const info = await fetch(new URL("/bench/info", base)).then((r) => r.json());
const browser = await chromium.launch({
	headless: true,
	executablePath: Bun.which("chromium"),
});
const results = [];
const errors = [];
const post = async (path, payload = {}) => {
	const response = await fetch(new URL(path, base), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(payload),
	});
	if (!response.ok)
		throw new Error(`${path}: ${response.status} ${await response.text()}`);
};
const status = () => fetch(new URL("/bench/status", base)).then((r) => r.json());
const waitIdle = async () => {
	for (let i = 0; i < 600; i++) {
		if (!(await status()).activity) return;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error("Agent did not settle");
};

async function checkClientMarkers() {
	const context = await browser.newContext();
	await context.route("**/bench-client-test", (route) =>
		route.fulfill({
			contentType: "text/html",
			body: '<main id="session-transition" data-session-performance-enabled></main><main id="messages"></main>',
		}),
	);
	await context.route("**/app/session-performance.js?benchmark", async (route) =>
		route.fulfill({
			contentType: "application/javascript",
			body: await Bun.file(
				join(import.meta.dir, "../static/app/session-performance.js"),
			).text(),
		}),
	);
	const page = await context.newPage();
	await page.goto("http://bench.invalid/bench-client-test");
	const records = await page.evaluate(async () => {
		if (window.isSecureContext || "randomUUID" in crypto)
			throw new Error("Expected an insecure HTTP context");
		const perf = await import("/app/session-performance.js?benchmark");
		const records = [];
		document.body.addEventListener("pi-ui-session-performance", (event) =>
			records.push(event.detail),
		);
		const frame = () =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(resolve)),
			);
		const transition = document.getElementById("session-transition");
		transition.removeAttribute("data-session-performance-enabled");
		perf.startSessionPerformanceMeasurement();
		perf.readTransitionState("loading", 1);
		perf.transcriptPatched(1, "disabled-run");
		perf.readTransitionState("idle", 1);
		await frame();
		await frame();
		if (records.length) throw new Error("Disabled client emitted metrics");
		transition.setAttribute("data-session-performance-enabled", "");
		perf.startSessionPerformanceMeasurement();
		perf.readTransitionState("loading", 1);
		perf.transcriptPatched(99, "wrong-generation");
		perf.transcriptPatched(1, "test-run");
		await frame();
		await frame();
		perf.readTransitionState("idle", 1);
		await frame();
		await frame();
		// A cancelled or superseded transition must not produce a later record.
		perf.startSessionPerformanceMeasurement();
		perf.readTransitionState("loading", 2);
		perf.transcriptPatched(2, "test-run");
		perf.readTransitionState("error", 2);
		await frame();
		perf.readTransitionState("loading", 3);
		perf.transcriptPatched(3, "test-run");
		perf.readTransitionState("idle", 3);
		await frame();
		await frame();
		return records;
	});
	await context.close();
	if (
		records.length !== 2 ||
		records[0].runId !== "test-run" ||
		records[0].origin !== "command" ||
		records[0].firstTranscriptFrameMs >= records[0].readyObservedMs ||
		records[1].origin !== "observer" ||
		records[1].generation !== 3
	)
		throw new Error(`Client marker probe failed: ${JSON.stringify(records)}`);
}

async function connect(slow = false, encoding) {
	const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
	const page = await context.newPage();
	page.on("pageerror", (error) => errors.push(String(error)));
	const cdp = await context.newCDPSession(page);
	await cdp.send("Network.enable");
	if (encoding) await context.setExtraHTTPHeaders({ "accept-encoding": encoding });
	await cdp.send("Performance.enable");
	const network = { encoded: 0, decoded: 0, encoding: "unknown" };
	const streams = new Set();
	cdp.on("Network.responseReceived", ({ requestId, response }) => {
		if (new URL(response.url).pathname !== "/stream") return;
		streams.add(requestId);
		network.encoding =
			Object.entries(response.headers).find(
				([name]) => name.toLowerCase() === "content-encoding",
			)?.[1] || "identity";
	});
	cdp.on("Network.dataReceived", ({ requestId, encodedDataLength, dataLength }) => {
		if (!streams.has(requestId)) return;
		network.encoded += encodedDataLength;
		network.decoded += dataLength;
	});
	await page.goto(base, { waitUntil: "domcontentloaded" });
	try {
		await page
			.getByText("bench small", { exact: true })
			.first()
			.waitFor({ timeout: 10_000 });
	} catch (error) {
		await Bun.write(join(root, "failed-page.html"), await page.content());
		await Bun.write(
			join(root, "failed-status.json"),
			JSON.stringify({ status: await status(), errors }, null, 2),
		);
		throw error;
	}
	await page.evaluate(() => {
		window.__sessionBench = { clients: [], elements: [] };
		document.body.addEventListener("pi-ui-session-performance", (event) =>
			window.__sessionBench.clients.push(event.detail),
		);
		const starts = new WeakMap();
		document.addEventListener(
			"datastar-fetch",
			(event) => {
				if (event.detail.type === "datastar-patch-elements")
					starts.set(event, performance.now());
			},
			{ capture: true },
		);
		document.addEventListener("datastar-fetch", (event) => {
			if (event.detail.type !== "datastar-patch-elements") return;
			window.__sessionBench.elements.push({
				selector: event.detail.argsRaw.selector || "multi-root",
				ms: performance.now() - starts.get(event),
			});
		});
	});
	if (slow)
		await cdp.send("Network.emulateNetworkConditions", {
			offline: false,
			latency: 50,
			downloadThroughput: 2 * 1024 * 1024,
			uploadThroughput: 1024 * 1024,
		});
	return { context, page, cdp, network };
}

async function metrics(client) {
	const { metrics } = await client.cdp.send("Performance.getMetrics");
	return Object.fromEntries(
		metrics
			.filter(({ name }) =>
				[
					"TaskDuration",
					"ScriptDuration",
					"LayoutDuration",
					"RecalcStyleDuration",
					"JSHeapUsedSize",
					"Nodes",
				].includes(name),
			)
			.map(({ name, value }) => [name, value]),
	);
}

function metricDelta(end, start) {
	return Object.fromEntries(
		Object.entries(end).map(([name, value]) => [
			name,
			name === "JSHeapUsedSize" || name === "Nodes"
				? value
				: (value - start[name]) * 1000,
		]),
	);
}

async function switchTo(clients, target, scenario, iteration) {
	const before = await status();
	if (before.path === info.fixtures[target].path)
		throw new Error(`Already on ${target}`);
	const generation = before.transition.generation + 1;
	const starts = await Promise.all(
		clients.map(async (client) => ({
			metrics: await metrics(client),
			network: { ...client.network },
			elements: await client.page.evaluate(
				() => window.__sessionBench.elements.length,
			),
		})),
	);
	await clients[0].page
		.getByRole("button", { name: `bench ${target}`, exact: true })
		.first()
		.click();
	await Promise.all(
		clients.map(({ page }) =>
			page.waitForFunction(
				(generation) =>
					window.__sessionBench.clients.some(
						(value) => value.generation === generation,
					),
				generation,
				{ timeout: 60_000 },
			),
		),
	);
	const atReady = await Promise.all(clients.map((client) => metrics(client)));
	// Include deferred highlighting separately from time-to-first-content/readiness.
	await new Promise((resolve) => setTimeout(resolve, 250));
	const after = await status();
	if (after.path !== info.fixtures[target].path)
		throw new Error("Wrong selected session");
	const observations = await Promise.all(
		clients.map(async (client, i) => {
			const end = await metrics(client);
			const dom = await client.page.evaluate(
				async ({ generation, start }) => ({
					client: window.__sessionBench.clients.find(
						(value) => value.generation === generation,
					),
					elements: window.__sessionBench.elements.slice(start),
					transcriptSignature: Array.from(
						new Uint8Array(
							await crypto.subtle.digest(
								"SHA-256",
								new TextEncoder().encode(
									document.getElementById("messages").textContent,
								),
							),
						),
						(byte) => byte.toString(16).padStart(2, "0"),
					).join(""),
					visibleMessages: document.querySelectorAll(
						'#messages article[id^="message-"]',
					).length,
				}),
				{ generation, start: starts[i].elements },
			);
			return {
				...dom,
				browser: metricDelta(end, starts[i].metrics),
				browserAtReady: metricDelta(atReady[i], starts[i].metrics),
				browserAfterReady: metricDelta(end, atReady[i]),
				network: {
					encoding: client.network.encoding,
					encodedBodyBytes: client.network.encoded - starts[i].network.encoded,
					decodedBodyBytes: client.network.decoded - starts[i].network.decoded,
				},
			};
		}),
	);
	const result = {
		scenario,
		iteration,
		target,
		generation,
		observations,
		memory: after.memory,
		serverWindow: {
			spans: Object.fromEntries(
				Object.entries(after.metrics.spans).map(([name, span]) => [
					name,
					{
						count: span.count - before.metrics.spans[name].count,
						totalMs: span.totalMs - before.metrics.spans[name].totalMs,
					},
				]),
			),
			patches: Object.fromEntries(
				Object.entries(after.metrics.patches).map(([name, patch]) => [
					name,
					Object.fromEntries(
						Object.entries(patch).map(([field, value]) => [
							field,
							value - before.metrics.patches[name][field],
						]),
					),
				]),
			),
		},
	};
	results.push(result);
	await appendFile(join(root, "browser.jsonl"), `${JSON.stringify(result)}\n`);
	console.log(
		`${scenario} ${iteration}: ${observations.map(({ client }) => `${client.origin} content=${client.firstTranscriptFrameMs.toFixed(1)}ms ready=${client.readyFrameMs.toFixed(1)}ms`).join("; ")}`,
	);
}

try {
	await checkClientMarkers();
	let clients = [await connect()];
	// First use and repeated same-workspace/different-workspace opens, with warm OS file caches.
	for (let i = 0; i < iterations; i++) {
		for (const target of ["small", "medium", "large", "output", "image", "other"])
			await switchTo(clients, target, "one-client", i);
	}
	clients.push(await connect());
	for (let i = 0; i < iterations; i++)
		await switchTo(clients, i % 2 ? "other" : "small", "two-clients", i);
	for (let i = 0; i < Math.min(iterations, 6); i++) {
		if ((await status()).path !== info.fixtures.small.path)
			await switchTo(clients, "small", "running-setup", i);
		if ((await status()).model !== "faux/faux-1")
			throw new Error("Benchmark must use only the local faux model");
		await post("/prompt", { prompt: "stream a benchmark answer" });
		if (!(await status()).activity) throw new Error("Scripted model did not start");
		await switchTo(clients, "other", "leave-running", i);
		await switchTo(clients, "small", "return-running", i);
		await post("/abort");
		await waitIdle();
		await switchTo(clients, "other", "completed-setup", i);
		await switchTo(clients, "small", "return-idle", i);
		await post("/prompt", { prompt: "finish in the background" });
		await switchTo(clients, "other", "leave-to-complete", i);
		let completed = false;
		for (let n = 0; n < 600; n++) {
			if (
				(await status()).backgrounds.some(
					(s) =>
						s.path === info.fixtures.small.path && s.status === "completed",
				)
			) {
				completed = true;
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		if (!completed) throw new Error("Background model did not complete");
		await switchTo(clients, "small", "return-completed", i);
	}
	for (const client of clients) await client.context.close();
	for (const encoding of ["br", "gzip", "identity"]) {
		await post("/sessions/resume", { sessionPath: info.fixtures.small.path });
		clients = [await connect(false, encoding)];
		for (let i = 0; i < Math.min(iterations, 6); i++)
			await switchTo(
				clients,
				i % 2 ? "small" : "large",
				`one-client-${encoding}`,
				i,
			);
		for (const client of clients) await client.context.close();
	}
	await post("/sessions/resume", { sessionPath: info.fixtures.small.path });
	clients = [await connect(true), await connect(true)];
	for (let i = 0; i < Math.min(iterations, 8); i++)
		await switchTo(clients, i % 2 ? "small" : "large", "two-clients-50ms-2MiBps", i);
	for (const client of clients) await client.context.close();
	await post("/bench/flush");
	const server = (await Bun.file(join(root, "server.jsonl")).text())
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	for (const row of results) {
		const record = server.find(
			(s) =>
				s.type === "pi-ui-session-performance" &&
				s.runId === row.observations[0].client.runId &&
				s.transition.generation === row.generation,
		);
		if (!record) throw new Error(`No server record for generation ${row.generation}`);
		const ownership = record.transition.ownership;
		if (
			row.scenario === "return-running" &&
			ownership.targetBackgroundLookup !== "hit"
		)
			throw new Error("Running-return fixture finished too soon");
		if (
			row.scenario === "return-completed" &&
			ownership.targetBackgroundLookup !== "miss"
		)
			throw new Error("Completed fixture was not released");
		if (
			row.scenario.startsWith("one-client-") &&
			row.observations[0].network.encoding !==
				row.scenario.slice("one-client-".length)
		)
			throw new Error("Compression negotiation did not match the scenario");
		if (row.observations.some((o) => o.visibleMessages === 0))
			throw new Error("Selected transcript was empty");
		if (
			row.scenario !== "return-running" &&
			new Set(row.observations.map((o) => o.transcriptSignature)).size !== 1
		)
			throw new Error("Clients did not render the same idle transcript");
	}
	const summary = {};
	const stats = (values) => {
		values.sort((a, b) => a - b);
		return {
			n: values.length,
			min: values[0],
			median: values[Math.floor(values.length / 2)],
			p95: values[Math.ceil(values.length * 0.95) - 1],
			max: values.at(-1),
		};
	};
	for (const result of results) {
		const key = `${result.scenario}/${result.target}`;
		(summary[key] ||= []).push(result);
	}
	for (const [key, rows] of Object.entries(summary))
		summary[key] = {
			contentFrameMs: stats(
				rows.map((r) => r.observations[0].client.firstTranscriptFrameMs),
			),
			warmContentFrameMs: stats(
				rows
					.filter((r) => r.iteration > 0)
					.map((r) => r.observations[0].client.firstTranscriptFrameMs),
			),
			readyFrameMs: stats(rows.map((r) => r.observations[0].client.readyFrameMs)),
			encodedBodyBytes: stats(
				rows.map((r) => r.observations[0].network.encodedBodyBytes),
			),
			decodedBodyBytes: stats(
				rows.map((r) => r.observations[0].network.decodedBodyBytes),
			),
			browserTaskMs: stats(rows.map((r) => r.observations[0].browser.TaskDuration)),
			browserAtReadyTaskMs: stats(
				rows.map((r) => r.observations[0].browserAtReady.TaskDuration),
			),
			browserAfterReadyTaskMs: stats(
				rows.map((r) => r.observations[0].browserAfterReady.TaskDuration),
			),
			browserLayoutMs: stats(
				rows.map((r) => r.observations[0].browser.LayoutDuration),
			),
			browserStyleMs: stats(
				rows.map((r) => r.observations[0].browser.RecalcStyleDuration),
			),
			serverReadyMs: stats(
				rows
					.map(
						(r) =>
							server.find(
								(s) =>
									s.type === "pi-ui-session-performance" &&
									s.runId === r.observations[0].client.runId &&
									s.transition.generation === r.generation,
							)?.transition.spans.runtimeReady.totalMs,
					)
					.filter((v) => v !== undefined),
			),
		};
	await Bun.write(
		join(root, "summary.json"),
		JSON.stringify(
			{
				info,
				chromium: browser.version(),
				iterations,
				conditions:
					"headless Chromium; 1440x1000; warm OS cache; 250ms observation tail; two-rAF frame estimates, not measured paint; CDP encoded bytes exclude headers/TLS",
				errors,
				summary,
			},
			null,
			2,
		),
	);
	if (errors.length) throw new Error(`Browser errors: ${errors.join("\n")}`);
	console.log(`summary: ${join(root, "summary.json")}`);
} finally {
	await browser.close();
}
