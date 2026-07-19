/// <reference lib="dom" />

import {
	changesRatioDefault,
	changesRatioMax,
	changesRatioMin,
	gitPaneRatioDefault,
	gitPaneRatioMax,
	gitPaneRatioMin,
	reviewSidebarWidthDefault,
	reviewSidebarWidthMax,
	reviewSidebarWidthMin,
} from "../workspace-review-types.ts";

export {
	changesRatioDefault,
	changesRatioMax,
	changesRatioMin,
	gitPaneRatioDefault,
	gitPaneRatioMax,
	gitPaneRatioMin,
	reviewSidebarWidthDefault,
	reviewSidebarWidthMax,
	reviewSidebarWidthMin,
};
export const workspaceGap = 12;
export const workspaceInset = 7;
export const workspaceStructuralGap = workspaceGap / 2;
export const resizeKeyboardStep = 16;
export const resizeKeyboardLargeStep = 48;

const minimumPaneSize = 320;
const minimumReviewColumnSize = 320;
const minimumSidebarSectionSize = 96;

export function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(Math.max(value, minimum), maximum);
}

export function calculateGitSplit(
	containerWidth: number,
	ratio = gitPaneRatioDefault,
): { chat: number; git: number; ratio: number } {
	const available = Math.max(0, containerWidth - workspaceStructuralGap);
	const persistedRatio = clamp(ratio, gitPaneRatioMin, gitPaneRatioMax);
	const minimum = Math.min(minimumPaneSize, available / 2);
	const git = clamp(available * persistedRatio, minimum, available - minimum);
	return {
		chat: available - git,
		git,
		ratio: available ? git / available : persistedRatio,
	};
}

export function calculateSidebarSplit(
	containerWidth: number,
	width = reviewSidebarWidthDefault,
): number {
	const maximum = Math.min(
		reviewSidebarWidthMax,
		Math.max(
			reviewSidebarWidthMin,
			containerWidth - workspaceStructuralGap - minimumReviewColumnSize,
		),
	);
	return clamp(width, reviewSidebarWidthMin, maximum);
}

export function calculateChangesSplit(
	containerHeight: number,
	ratio = changesRatioDefault,
): { changes: number; history: number; ratio: number } {
	const available = Math.max(0, containerHeight - workspaceInset * 2 - workspaceGap);
	const persistedRatio = clamp(ratio, changesRatioMin, changesRatioMax);
	const minimum = Math.min(minimumSidebarSectionSize, available / 2);
	const changes = clamp(available * persistedRatio, minimum, available - minimum);
	return {
		changes,
		history: available - changes,
		ratio: available ? changes / available : persistedRatio,
	};
}

export function keyboardDelta(key: string, shiftKey = false): number {
	const magnitude = shiftKey ? resizeKeyboardLargeStep : resizeKeyboardStep;
	if (key === "ArrowLeft" || key === "ArrowUp") return -magnitude;
	if (key === "ArrowRight" || key === "ArrowDown") return magnitude;
	return 0;
}

type LayoutValues = {
	changesRatio: number;
	gitPaneRatio: number;
	reviewSidebarWidth: number;
};

type LayoutElements = {
	app: HTMLElement;
	changesSection: HTMLElement;
	changesSeparator: HTMLElement;
	chat: HTMLElement;
	gitSeparator: HTMLElement;
	reviewBody: HTMLElement;
	root: HTMLElement;
	sidebarSeparator: HTMLElement;
};

type LayoutOptions = LayoutElements & {
	hasChanges: () => boolean;
	onCommit: (values: LayoutValues) => void;
	preferences: Partial<LayoutValues>;
};

export function bindWorkspaceReviewLayout(options: LayoutOptions) {
	const values: LayoutValues = {
		changesRatio: options.preferences.changesRatio ?? changesRatioDefault,
		gitPaneRatio: options.preferences.gitPaneRatio ?? gitPaneRatioDefault,
		reviewSidebarWidth:
			options.preferences.reviewSidebarWidth ?? reviewSidebarWidthDefault,
	};
	const narrow = matchMedia("(max-width: 80rem)");
	const listeners = new AbortController();
	let open = false;

	const sync = () => {
		const isNarrow = narrow.matches;
		options.gitSeparator.inert = isNarrow;
		options.sidebarSeparator.inert = false;
		options.changesSeparator.inert = false;
		const workspaceWidth = Math.max(0, options.app.clientWidth - workspaceInset * 2);
		if (!open || isNarrow) {
			options.chat.style.width = `${workspaceWidth}px`;
			options.chat.style.marginLeft = `${workspaceInset}px`;
			options.root.style.width = "100%";
		} else {
			const split = calculateGitSplit(workspaceWidth, values.gitPaneRatio);
			options.root.style.width = `${split.git + workspaceStructuralGap + workspaceInset}px`;
			options.chat.style.width = `${split.chat}px`;
			options.chat.style.marginLeft = `${split.git + workspaceStructuralGap + workspaceInset}px`;
		}
		const sidebar = calculateSidebarSplit(
			options.reviewBody.clientWidth,
			values.reviewSidebarWidth,
		);
		options.reviewBody.style.setProperty("--pi-review-sidebar-width", `${sidebar}px`);
		const sections = calculateChangesSplit(
			options.reviewBody.clientHeight + workspaceInset * 2,
			values.changesRatio,
		);
		options.changesSection.style.height = options.hasChanges()
			? `${sections.changes}px`
			: "0px";
		options.changesSeparator.style.display = options.hasChanges() ? "block" : "none";
		updateAria(
			splitAria(
				options.gitSeparator,
				values.gitPaneRatio * 100,
				gitPaneRatioMin * 100,
				gitPaneRatioMax * 100,
			),
		);
		updateAria(
			splitAria(
				options.sidebarSeparator,
				sidebar,
				reviewSidebarWidthMin,
				calculateSidebarSplit(
					options.reviewBody.clientWidth,
					reviewSidebarWidthMax,
				),
			),
		);
		updateAria(
			splitAria(
				options.changesSeparator,
				values.changesRatio * 100,
				changesRatioMin * 100,
				changesRatioMax * 100,
			),
		);
	};

	const commit = () => options.onCommit({ ...values });
	bindSeparator(
		options.gitSeparator,
		"horizontal",
		{
			current: () =>
				calculateGitSplit(
					options.app.clientWidth - workspaceInset * 2,
					values.gitPaneRatio,
				).git,
			fromPixels: (pixels) => {
				values.gitPaneRatio = clamp(
					pixels /
						Math.max(
							1,
							options.app.clientWidth -
								workspaceInset * 2 -
								workspaceStructuralGap,
						),
					gitPaneRatioMin,
					gitPaneRatioMax,
				);
			},
			reset: () => (values.gitPaneRatio = gitPaneRatioDefault),
			sync,
			commit,
		},
		listeners.signal,
	);
	bindSeparator(
		options.sidebarSeparator,
		"horizontal",
		{
			current: () =>
				calculateSidebarSplit(
					options.reviewBody.clientWidth,
					values.reviewSidebarWidth,
				),
			fromPixels: (pixels) => {
				values.reviewSidebarWidth = clamp(
					pixels,
					reviewSidebarWidthMin,
					reviewSidebarWidthMax,
				);
			},
			reset: () => (values.reviewSidebarWidth = reviewSidebarWidthDefault),
			sync,
			commit,
		},
		listeners.signal,
	);
	bindSeparator(
		options.changesSeparator,
		"vertical",
		{
			current: () =>
				calculateChangesSplit(
					options.reviewBody.clientHeight + workspaceInset * 2,
					values.changesRatio,
				).changes,
			fromPixels: (pixels) => {
				const available = Math.max(
					1,
					options.reviewBody.clientHeight - workspaceGap,
				);
				values.changesRatio = clamp(
					pixels / available,
					changesRatioMin,
					changesRatioMax,
				);
			},
			reset: () => (values.changesRatio = changesRatioDefault),
			sync,
			commit,
		},
		listeners.signal,
	);

	const observer = new ResizeObserver(sync);
	observer.observe(options.app);
	observer.observe(options.reviewBody);
	narrow.addEventListener("change", sync);
	sync();
	return {
		setOpen(next: boolean) {
			open = next;
			sync();
		},
		sync,
		values: () => ({ ...values }),
		cleanUp() {
			listeners.abort();
			observer.disconnect();
			narrow.removeEventListener("change", sync);
		},
	};
}

type SeparatorBinding = {
	commit: () => void;
	current: () => number;
	fromPixels: (pixels: number) => void;
	reset: () => void;
	sync: () => void;
};

function bindSeparator(
	element: HTMLElement,
	axis: "horizontal" | "vertical",
	binding: SeparatorBinding,
	signal: AbortSignal,
): void {
	let pointerId: number | undefined;
	let startCoordinate = 0;
	let startValue = 0;
	const coordinate = (event: PointerEvent) =>
		axis === "horizontal" ? event.clientX : event.clientY;
	element.addEventListener(
		"pointerdown",
		(event) => {
			if (pointerId !== undefined || element.inert) return;
			pointerId = event.pointerId;
			startCoordinate = coordinate(event);
			startValue = binding.current();
			element.setPointerCapture(event.pointerId);
			document.documentElement.classList.add("pi-resizing");
		},
		{ signal },
	);
	element.addEventListener(
		"pointermove",
		(event) => {
			if (event.pointerId !== pointerId) return;
			binding.fromPixels(startValue + coordinate(event) - startCoordinate);
			binding.sync();
		},
		{ signal },
	);
	const finish = (event: PointerEvent) => {
		if (event.pointerId !== pointerId) return;
		pointerId = undefined;
		document.documentElement.classList.remove("pi-resizing");
		binding.commit();
	};
	element.addEventListener("pointerup", finish, { signal });
	element.addEventListener("pointercancel", finish, { signal });
	element.addEventListener(
		"keydown",
		(event) => {
			const delta = keyboardDelta(event.key, event.shiftKey);
			if (!delta) return;
			event.preventDefault();
			binding.fromPixels(binding.current() + delta);
			binding.sync();
			binding.commit();
		},
		{ signal },
	);
	element.addEventListener(
		"dblclick",
		() => {
			binding.reset();
			binding.sync();
			binding.commit();
		},
		{ signal },
	);
}

function splitAria(
	element: HTMLElement,
	value: number,
	minimum: number,
	maximum: number,
): [HTMLElement, number, number, number] {
	return [element, value, minimum, maximum];
}

function updateAria([element, value, minimum, maximum]: [
	HTMLElement,
	number,
	number,
	number,
]): void {
	element.setAttribute("aria-valuemin", String(Math.round(minimum * 100) / 100));
	element.setAttribute("aria-valuemax", String(Math.round(maximum * 100) / 100));
	element.setAttribute("aria-valuenow", String(Math.round(value * 100) / 100));
}
