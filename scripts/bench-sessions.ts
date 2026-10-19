// Build assets, then run: bun scripts/bench-sessions.ts [iterations, default 12].
// Requires Chromium on PATH and an installed Playwright package.
// Set PLAYWRIGHT_MODULE if Playwright does not resolve locally.
// Enables PI_UI_PERF=1 only in the private server child, using a local faux model.
// Results stay in the printed temporary directory; no user credentials are inherited.
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// The child runs outside the checkout, with a private home and no user credentials.
const directory = process.argv[3];
if (process.argv[2] === "--serve" && directory) {
	await serve(directory);
} else {
	const iterations = Number(process.argv[2] ?? 12);
	if (!Number.isInteger(iterations) || iterations < 1 || iterations > 100)
		throw new Error("Use an iteration count from 1 to 100");
	const root = await mkdtemp(join(tmpdir(), "pi-ui-session-bench-"));
	await Bun.write(join(root, "changes.patch"), Bun.spawnSync(["git", "diff"]).stdout);
	await Bun.write(join(root, "bench-sessions.ts"), Bun.file(import.meta.path));
	await Bun.write(
		join(root, "bench-sessions.browser.js"),
		Bun.file(join(import.meta.dir, "bench-sessions.browser.js")),
	);
	const home = join(root, "home");
	const agent = join(home, ".pi/agent");
	await mkdir(agent, { recursive: true });
	await mkdir(join(root, "other"));
	const env = {
		PATH: process.env.PATH,
		HOME: home,
		PI_CODING_AGENT_DIR: agent,
		XDG_CONFIG_HOME: join(root, "config"),
		XDG_CACHE_HOME: join(root, "cache"),
		XDG_DATA_HOME: join(root, "data"),
		PI_UI_PERF: "1",
		PI_UI_PERF_FILE: join(root, "server.jsonl"),
		PI_UI_NO_UPDATE_CHECK: "1",
	};
	// Give every newly created real SDK runtime an independent, local streaming provider.
	const fauxPath = Bun.resolveSync(
		"@earendil-works/pi-ai/providers/faux",
		import.meta.dir,
	);
	await Bun.write(
		join(agent, "bench.ts"),
		`
import { fauxProvider, fauxAssistantMessage } from ${JSON.stringify(fauxPath)};
export default function(pi) {
	const faux = fauxProvider({ tokensPerSecond: 1024, tokenSize: { min: 32, max: 32 } });
	faux.setResponses(Array.from({ length: 100 }, () => fauxAssistantMessage("streaming benchmark output. ".repeat(160))));
	pi.registerProvider(faux.provider);
}
`,
	);
	await Bun.write(
		join(agent, "settings.json"),
		JSON.stringify({
			defaultProvider: "faux",
			defaultModel: "faux-1",
			extensions: [join(agent, "bench.ts")],
			compaction: { enabled: false },
			retry: { enabled: false },
		}),
	);
	await Bun.write(
		join(agent, "auth.json"),
		JSON.stringify({ faux: { type: "api_key", key: "local-benchmark" } }),
	);
	await Bun.write(
		join(root, "config/pi-ui/config.json"),
		JSON.stringify({ updateCheck: false, autoTitle: { enabled: false } }),
	);
	const child = Bun.spawn(
		[
			process.execPath,
			"--tsconfig-override",
			resolve("tsconfig.json"),
			resolve(import.meta.path),
			"--serve",
			root,
		],
		{
			cwd: root,
			env,
			stdout: Bun.file(join(root, "server.log")),
			stderr: Bun.file(join(root, "server-errors.log")),
		},
	);
	try {
		for (let i = 0; !(await Bun.file(join(root, "ready.json")).exists()); i++) {
			if (child.exitCode !== null || i > 600)
				throw new Error(`Benchmark server failed. See ${root}`);
			await Bun.sleep(100);
		}
		const { url } = await Bun.file(join(root, "ready.json")).json();
		console.log(`fixtures and results: ${root}`);
		console.log(`server: ${url}`);
		const browser = Bun.spawn(
			[
				process.execPath,
				join(import.meta.dir, "bench-sessions.browser.js"),
				url,
				root,
				process.argv[2] ?? "12",
			],
			{
				env: process.env,
				stdout: "inherit",
				stderr: "inherit",
			},
		);
		if (await browser.exited)
			throw new Error(`Browser benchmark failed. See ${root}`);
	} finally {
		child.kill("SIGTERM");
		await child.exited;
	}
}

async function serve(root: string): Promise<void> {
	// The benchmark must never send a real model request or consume external credentials.
	const nativeFetch = globalThis.fetch;
	globalThis.fetch = Object.assign(
		(input: Parameters<typeof fetch>[0], init?: RequestInit) => {
			const url = new URL(input instanceof Request ? input.url : String(input));
			if (url.hostname !== "127.0.0.1")
				throw new Error(
					`External network disabled in benchmark: ${url.hostname}`,
				);
			return nativeFetch(input, init);
		},
		{ preconnect: nativeFetch.preconnect },
	);
	const { SessionManager } = await import("@earendil-works/pi-coding-agent");
	const { fauxAssistantMessage } = await import("@earendil-works/pi-ai/providers/faux");
	const fixtures: Record<string, { path: string; entries: number; fileBytes: number }> =
		{};
	for (const [name, count, cwd] of [
		["small", 20, process.env.HOME!],
		["medium", 200, process.env.HOME!],
		["large", 2000, process.env.HOME!],
		["other", 20, join(root, "other")],
		["output", 20, process.env.HOME!],
		["image", 20, process.env.HOME!],
	] as const) {
		const manager = SessionManager.create(cwd);
		manager.appendModelChange("faux", "faux-1");
		for (let i = 0; i < count / 2; i++) {
			manager.appendMessage({
				role: "user",
				content:
					name === "image"
						? [
								{ type: "text", text: `question ${i}` },
								{
									type: "image",
									mimeType: "image/png",
									data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1sAAAAASUVORK5CYII=",
								},
							]
						: `question ${i}`,
				timestamp: Date.now(),
			});
			const message = fauxAssistantMessage(
				`## answer ${i}\n\n${"Some **markdown**, a [link](https://example.com), and inline code `value`. ".repeat(12)}\n\n\`\`\`ts\n${Array.from({ length: 20 }, (_, n) => `const value${n} = ${i + n};`).join("\n")}\n\`\`\``,
			);
			message.provider = "faux";
			message.model = "faux-1";
			manager.appendMessage(message);
			if (i % 5 === 0)
				manager.appendMessage({
					role: "bashExecution",
					command: "git diff",
					output: "diff --git a/example.ts b/example.ts\n@@ -1 +1 @@\n-old\n+new\n".repeat(
						name === "output" ? 3000 : 20,
					),
					exitCode: 0,
					cancelled: false,
					truncated: false,
					timestamp: Date.now(),
				});
		}
		manager.appendSessionInfo(`bench ${name}`);
		const path = manager.getSessionFile()!;
		fixtures[name] = {
			path,
			entries: manager.getEntries().length,
			fileBytes: Bun.file(path).size,
		};
	}
	const managerOpenMs: Record<string, number[]> = {};
	for (const [name, fixture] of Object.entries(fixtures)) {
		managerOpenMs[name] = [];
		for (let i = 0; i < 20; i++) {
			const start = performance.now();
			const opened = SessionManager.open(fixture.path);
			if (opened.getEntries().length !== fixture.entries)
				throw new Error("Invalid fixture");
			managerOpenMs[name].push(performance.now() - start);
		}
	}
	const { createApp } = await import("../src/server/app.ts");
	const { appRoutes } = await import("../src/server/routes.ts");
	const { executeRoute } = await import("../src/server/route.ts");
	const { compressResponse } = await import("../src/server/compression.ts");
	const { sessionPerformance } = await import("../src/perf/session-performance.ts");
	const { flushSessionPerformanceLog } =
		await import("../src/perf/session-performance-log.ts");
	const app = await createApp();
	if (!app.context.resources.host) throw new Error("No real SDK runtime");
	const routes: import("../src/server/route.ts").RouteMap<typeof app.context> =
		appRoutes;
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		idleTimeout: 0,
		async fetch(request) {
			const url = new URL(request.url);
			if (url.pathname === "/bench/info")
				return Response.json({
					fixtures,
					managerOpenMs,
					bun: Bun.version,
					platform: process.platform,
					arch: process.arch,
					revision: Bun.spawnSync([
						"git",
						"-C",
						resolve(import.meta.dir, ".."),
						"rev-parse",
						"HEAD",
					])
						.stdout.toString()
						.trim(),
				});
			if (url.pathname === "/bench/status")
				return Response.json({
					path: app.context.store.currentSessionPath,
					model: app.context.store.currentModel,
					backgrounds: app.context.store
						.getSessionCatalog()
						.filter((s) => s.backgroundStatus)
						.map((s) => ({ path: s.path, status: s.backgroundStatus })),
					activity: app.context.store.activityText,
					transition: app.context.store.sessionTransition,
					metrics: sessionPerformance.snapshot(),
					memory: process.memoryUsage(),
				});
			if (url.pathname === "/bench/flush") {
				await flushSessionPerformanceLog();
				return new Response(null, { status: 204 });
			}
			const handler =
				request.method === "GET"
					? routes[url.pathname]?.GET
					: request.method === "POST"
						? routes[url.pathname]?.POST
						: undefined;
			const response = handler
				? await executeRoute(request, app.context, handler)
				: await app.context.serveStatic(request);
			return compressResponse(request, response);
		},
	});
	await Bun.write(
		join(root, "ready.json"),
		JSON.stringify({ url: String(server.url) }),
	);
	process.once(
		"SIGTERM",
		() =>
			void (async () => {
				await server.stop(true);
				await app.dispose();
				await flushSessionPerformanceLog();
				process.exit();
			})(),
	);
}
