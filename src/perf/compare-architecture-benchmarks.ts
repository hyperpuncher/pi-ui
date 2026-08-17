import Type, { type Static } from "typebox";
import { Compile } from "typebox/compile";

const stageSchema = Type.Object({
	p50Ms: Type.Number(),
	p95Ms: Type.Number(),
});
const streamingFrameSchema = Type.Object({
	name: Type.String(),
	stages: Type.Object({
		markdownParse: stageSchema,
		codeBlockRender: stageSchema,
		kitaRender: stageSchema,
		sseEncode: stageSchema,
		total: stageSchema,
	}),
	deadlineMisses: Type.Record(Type.String(), Type.Number()),
});
const schedulerSchema = Type.Object({
	hz: Type.Number(),
	renderCostMs: Type.Number(),
	skippedDeadlines: Type.Number(),
	maximumTimerLatenessMs: Type.Number(),
});
const sessionFixtureSchema = Type.Object({
	clientCount: Type.Number(),
	concurrency: Type.Number(),
	messageCount: Type.Number(),
	firstContentP50Ms: Type.Number(),
	firstContentP95Ms: Type.Number(),
	enhancementCompleteP50Ms: Type.Number(),
	enhancementCompleteP95Ms: Type.Number(),
	renderedHtmlBytes: Type.Number(),
	elementPatchBytes: Type.Number(),
	batchZstdElementPatchBytes: Type.Number(),
	fullPatchCount: Type.Number(),
	targetedPatchCount: Type.Number(),
});
const architectureBenchmarkSchema = Type.Object({
	type: Type.Literal("pi-ui-architecture-benchmark"),
	schemaVersion: Type.Number(),
	configuration: Type.Object({
		samples: Type.Number(),
		messageCounts: Type.Array(Type.Number()),
		clientCounts: Type.Array(Type.Number()),
		supportedDisplayRates: Type.Array(Type.Number()),
	}),
	streamingFrames: Type.Array(streamingFrameSchema),
	scheduler: Type.Array(schedulerSchema),
	sessionLoading: Type.Object({ fixtures: Type.Array(sessionFixtureSchema) }),
});
const architectureBenchmarkValidator = Compile(architectureBenchmarkSchema);

type ArchitectureBenchmark = Static<typeof architectureBenchmarkSchema>;
type Metric = {
	name: string;
	baseline: number;
	candidate: number;
	deltaPercent: number | null;
	classification: "improved" | "stable" | "regressed";
};
type CompareOptions = {
	baselinePath: string;
	candidatePath: string;
	noisePercent: number;
	failOnRegression: boolean;
};

const timingFields = [
	"firstContentP50Ms",
	"firstContentP95Ms",
	"enhancementCompleteP50Ms",
	"enhancementCompleteP95Ms",
] as const;
const sizeFields = [
	"renderedHtmlBytes",
	"elementPatchBytes",
	"batchZstdElementPatchBytes",
	"fullPatchCount",
	"targetedPatchCount",
] as const;

if (import.meta.main) {
	const options = readOptions(Deno.args);
	const [baseline, candidate] = await Promise.all([
		readBenchmark(options.baselinePath),
		readBenchmark(options.candidatePath),
	]);
	assertCompatible(baseline, candidate);
	const baselineMetrics = collectMetrics(baseline);
	const candidateMetrics = collectMetrics(candidate);
	const metrics: Metric[] = [];
	for (const [name, baselineValue] of baselineMetrics) {
		const candidateValue = candidateMetrics.get(name);
		if (candidateValue === undefined) {
			throw new Error(`Candidate is missing metric: ${name}`);
		}
		const deltaPercent =
			baselineValue === 0
				? candidateValue === 0
					? 0
					: null
				: ((candidateValue - baselineValue) / baselineValue) * 100;
		const classification = classify(
			baselineValue,
			candidateValue,
			deltaPercent,
			options.noisePercent,
		);
		metrics.push({
			name,
			baseline: baselineValue,
			candidate: candidateValue,
			deltaPercent,
			classification,
		});
	}
	const regressions = metrics.filter((metric) => metric.classification === "regressed");
	const result = {
		type: "pi-ui-architecture-benchmark-comparison",
		schemaVersion: 1,
		noisePercent: options.noisePercent,
		baselinePath: options.baselinePath,
		candidatePath: options.candidatePath,
		summary: {
			metricCount: metrics.length,
			improved: metrics.filter((metric) => metric.classification === "improved")
				.length,
			stable: metrics.filter((metric) => metric.classification === "stable").length,
			regressed: regressions.length,
		},
		metrics,
	};
	console.log(JSON.stringify(result, null, 2));
	if (options.failOnRegression && regressions.length > 0) Deno.exit(1);
}

function readOptions(args: readonly string[]): CompareOptions {
	const paths: string[] = [];
	let noisePercent = 5;
	let failOnRegression = false;
	for (let index = 0; index < args.length; index += 1) {
		const value = args[index];
		if (value === "--noise") {
			noisePercent = Number(args[++index]);
			if (!Number.isFinite(noisePercent) || noisePercent < 0) {
				throw new Error("--noise must be a non-negative number");
			}
		} else if (value === "--fail-on-regression") {
			failOnRegression = true;
		} else if (value.startsWith("-")) {
			throw new Error(`Unknown argument: ${value}`);
		} else {
			paths.push(value);
		}
	}
	if (paths.length !== 2) {
		throw new Error(
			"Usage: perf:compare <baseline.json> <candidate.json> [--noise 5] [--fail-on-regression]",
		);
	}
	return {
		baselinePath: paths[0],
		candidatePath: paths[1],
		noisePercent,
		failOnRegression,
	};
}

async function readBenchmark(path: string): Promise<ArchitectureBenchmark> {
	const parsed = JSON.parse(await Deno.readTextFile(path));
	if (!architectureBenchmarkValidator.Check(parsed)) {
		throw new Error(`${path} is not a valid pi-ui architecture benchmark`);
	}
	return parsed;
}

function assertCompatible(
	baseline: ArchitectureBenchmark,
	candidate: ArchitectureBenchmark,
): void {
	if (baseline.schemaVersion !== candidate.schemaVersion) {
		throw new Error("Benchmark schema versions do not match");
	}
	for (const key of [
		"samples",
		"messageCounts",
		"clientCounts",
		"supportedDisplayRates",
	] as const) {
		const baselineValue = JSON.stringify(baseline.configuration[key]);
		const candidateValue = JSON.stringify(candidate.configuration[key]);
		if (baselineValue !== candidateValue) {
			throw new Error(`Benchmark configurations differ at ${key}`);
		}
	}
}

function collectMetrics(benchmark: ArchitectureBenchmark): Map<string, number> {
	const metrics = new Map<string, number>();
	for (const fixture of benchmark.streamingFrames) {
		const prefix = `streaming/${fixture.name}`;
		for (const stageName of [
			"markdownParse",
			"codeBlockRender",
			"kitaRender",
			"sseEncode",
			"total",
		] as const) {
			const stage = fixture.stages[stageName];
			metrics.set(`${prefix}/${stageName}/p50Ms`, stage.p50Ms);
			metrics.set(`${prefix}/${stageName}/p95Ms`, stage.p95Ms);
		}
		for (const [hz, value] of Object.entries(fixture.deadlineMisses)) {
			metrics.set(`${prefix}/deadlineMisses/${hz}Hz`, value);
		}
	}
	for (const scheduler of benchmark.scheduler) {
		const prefix = `scheduler/${scheduler.hz}Hz/${scheduler.renderCostMs}ms`;
		metrics.set(`${prefix}/skippedDeadlines`, scheduler.skippedDeadlines);
		metrics.set(`${prefix}/maximumTimerLatenessMs`, scheduler.maximumTimerLatenessMs);
	}
	for (const fixture of benchmark.sessionLoading.fixtures) {
		const prefix =
			`restore/${fixture.clientCount}clients/` +
			`${fixture.messageCount}messages/c${fixture.concurrency}`;
		for (const field of [...timingFields, ...sizeFields]) {
			metrics.set(`${prefix}/${field}`, fixture[field]);
		}
	}
	return metrics;
}

function classify(
	baseline: number,
	candidate: number,
	deltaPercent: number | null,
	noisePercent: number,
): Metric["classification"] {
	if (baseline === 0) return candidate === 0 ? "stable" : "regressed";
	if (deltaPercent === null || Math.abs(deltaPercent) <= noisePercent) return "stable";
	return deltaPercent < 0 ? "improved" : "regressed";
}
