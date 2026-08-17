import {
	maximumDisplayHz,
	minimumDisplayHz,
} from "../state/streaming-frame-scheduler.ts";
import { isNumber, isRecord, isString } from "../utils/type-guards.ts";

const displayClientIdPattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DisplayRefreshUpdate = {
	clientId: string;
	hz: number;
};

export function isDisplayClientId(value: string): boolean {
	return displayClientIdPattern.test(value);
}

export async function readDisplayRefreshUpdate(
	request: Request,
): Promise<DisplayRefreshUpdate | undefined> {
	if (!request.headers.get("content-type")?.includes("application/json")) {
		return undefined;
	}
	const body = await request.json().catch(() => undefined);
	if (
		!isRecord(body) ||
		!isString(body.clientId) ||
		!isDisplayClientId(body.clientId) ||
		!isNumber(body.hz)
	) {
		return undefined;
	}
	if (body.hz < minimumDisplayHz || body.hz > maximumDisplayHz) return undefined;
	return { clientId: body.clientId, hz: body.hz };
}
