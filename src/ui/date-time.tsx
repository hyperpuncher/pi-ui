import { formatFullDateTime } from "../utils/locale.ts";

type DateTimeProps = {
	class?: string | false;
	dateTime?: string;
	label: string;
};

export function DateTime({ class: className, dateTime, label }: DateTimeProps) {
	const date = dateTime ? new Date(dateTime) : undefined;
	const title =
		date && !Number.isNaN(date.getTime()) ? formatFullDateTime(date) : undefined;
	return (
		<time class={["pi-date", className]} datetime={dateTime} title={title} safe>
			{label}
		</time>
	);
}
