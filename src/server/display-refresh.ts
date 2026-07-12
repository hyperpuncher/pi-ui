import {
	maximumDisplayHz,
	minimumDisplayHz,
} from "../state/streaming-frame-scheduler.ts";

export type DisplayRefreshUpdate = {
	hz: number;
};

export async function readDisplayRefreshUpdate(
	request: Request,
): Promise<DisplayRefreshUpdate | undefined> {
	if (!request.headers.get("content-type")?.includes("application/json")) {
		return undefined;
	}
	const body: unknown = await request.json().catch(() => undefined);
	if (!isRecord(body) || typeof body.hz !== "number" || !Number.isFinite(body.hz)) {
		return undefined;
	}
	if (body.hz < minimumDisplayHz || body.hz > maximumDisplayHz) return undefined;
	return { hz: body.hz };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
