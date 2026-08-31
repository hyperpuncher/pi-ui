import {
	formatAdaptiveDateTime,
	formatExpandedDateTime,
} from "../../src/utils/date-time-format.ts";

export function hydrateDateTime(element) {
	const date = new Date(element.dateTime);
	if (Number.isNaN(date.getTime())) return;

	element.textContent = formatAdaptiveDateTime(date);
	element.title = formatExpandedDateTime(date);
}
