import {
	type AnnotationSide,
	type FileDiffMetadata,
	type LineAnnotation,
	type SelectedLineRange,
} from "@pierre/diffs";

import type { WorkspaceReviewComment } from "../workspace-review-comments.ts";
import {
	createWorkspaceReviewCommentStore,
	type ReviewAnnotation,
	type ReviewCommentMetadata,
} from "./workspace-review-comment-state.ts";

export type {
	ReviewAnnotation,
	ReviewCommentMetadata,
} from "./workspace-review-comment-state.ts";

type ReviewCommentItem = Readonly<{ fileDiff: FileDiffMetadata }>;

type WorkspaceReviewCommentsOptions = Readonly<{
	clearSelection(): void;
	onAnnotationsChange(path: string): void;
	onSubmitted(): void;
	status: HTMLElement;
	submit(comments: readonly WorkspaceReviewComment[]): Promise<boolean>;
	submitButton: HTMLButtonElement;
}>;

export function createWorkspaceReviewComments(options: WorkspaceReviewCommentsOptions) {
	const store = createWorkspaceReviewCommentStore();
	let statusMessage: string | undefined;
	let submitting = false;

	options.submitButton.addEventListener("click", () => void submit());
	syncControls();

	function add(item: ReviewCommentItem, range: SelectedLineRange): void {
		const path = item.fileDiff.name;
		if (store.add(path, fileVersion(item.fileDiff), range)) changed(path);
	}

	function render(
		annotation: LineAnnotation<ReviewCommentMetadata> | ReviewAnnotation,
	): HTMLElement | undefined {
		if (!("side" in annotation)) return undefined;
		const { metadata } = annotation;
		const wrapper = document.createElement("div");
		wrapper.className = "w-full overflow-hidden";
		wrapper.dataset.reviewCommentId = metadata.id;
		const card = document.createElement("div");
		card.className =
			"mx-3 my-2 max-w-2xl whitespace-normal rounded-lg border border-border bg-card p-3 font-sans text-foreground shadow-sm";
		wrapper.append(card);

		const label = document.createElement("p");
		label.className = "mb-2 text-xs font-medium text-muted-foreground";
		label.textContent = rangeLabel(metadata.range, annotation.side);
		card.append(label);

		if (metadata.body === null) renderEditor(card, metadata.id);
		else renderSavedComment(card, metadata.id, metadata.body);
		return wrapper;
	}

	function renderEditor(card: HTMLElement, id: string): void {
		const textarea = document.createElement("textarea");
		textarea.className = "textarea min-h-20 w-full resize-y text-sm";
		textarea.placeholder = "Leave a comment for the agent…";
		textarea.setAttribute("aria-label", "Review comment");
		const actions = document.createElement("div");
		actions.className = "mt-2 flex items-center gap-2";
		const addButton = button("Add comment");
		addButton.disabled = true;
		const cancelButton = button("Cancel", "outline");
		const save = () => {
			const path = store.save(id, textarea.value);
			if (!path) return;
			changed(path);
			options.clearSelection();
		};
		addButton.addEventListener("click", save);
		cancelButton.addEventListener("click", () => remove(id));
		textarea.addEventListener("input", () => {
			addButton.disabled = textarea.value.trim() === "";
		});
		textarea.addEventListener("keydown", (event) => {
			if (event.key === "Escape") {
				event.preventDefault();
				remove(id);
			} else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				save();
			}
		});
		actions.append(addButton, cancelButton);
		card.append(textarea, actions);
		setTimeout(() => textarea.focus(), 0);
	}

	function renderSavedComment(card: HTMLElement, id: string, text: string): void {
		const body = document.createElement("p");
		body.className = "whitespace-pre-wrap text-sm leading-relaxed";
		body.textContent = text;
		const actions = document.createElement("div");
		actions.className = "mt-2";
		const removeButton = button("Remove", "ghost");
		removeButton.classList.add("text-destructive");
		removeButton.addEventListener("click", () => remove(id));
		actions.append(removeButton);
		card.append(body, actions);
	}

	function remove(id: string): void {
		const path = store.remove(id);
		if (!path) return;
		options.clearSelection();
		changed(path);
	}

	function changed(path: string): void {
		statusMessage = undefined;
		syncControls();
		options.onAnnotationsChange(path);
	}

	async function submit(): Promise<void> {
		const comments = store.savedComments();
		if (comments.length === 0 || store.hasDraft() || submitting) return;
		submitting = true;
		statusMessage = undefined;
		syncControls();
		const accepted = await options.submit(comments).catch(() => false);
		submitting = false;
		if (!accepted) {
			statusMessage = "Couldn’t send";
			syncControls();
			return;
		}
		store.reset();
		syncControls();
		options.onSubmitted();
	}

	function syncControls(): void {
		const count = store.savedComments().length;
		const draft = store.hasDraft();
		options.submitButton.classList.toggle("hidden", count === 0 && !draft);
		options.submitButton.disabled = count === 0 || draft || submitting;
		options.submitButton.textContent = submitting
			? "Sending…"
			: `Submit review${count > 0 ? ` (${count})` : ""}`;
		options.status.classList.toggle("hidden", !statusMessage);
		options.status.textContent = statusMessage ?? "";
	}

	function reconcileItems(items: readonly ReviewCommentItem[]): void {
		const removed = store.reconcileFiles(
			new Map(
				items
					.filter((item) => store.annotations.has(item.fileDiff.name))
					.map((item) => [item.fileDiff.name, fileVersion(item.fileDiff)]),
			),
		);
		if (removed.length === 0) return;
		options.clearSelection();
		statusMessage = "Changes updated; outdated comments removed";
		syncControls();
	}

	function reset(): void {
		store.reset();
		statusMessage = undefined;
		syncControls();
	}

	return {
		add,
		annotations: store.annotations,
		canAdd: () => !store.hasDraft(),
		reconcileItems,
		render,
		reset,
	};
}

function button(label: string, variant?: "ghost" | "outline"): HTMLButtonElement {
	const element = document.createElement("button");
	element.type = "button";
	element.className = "btn";
	element.dataset.size = "xs";
	if (variant) element.dataset.variant = variant;
	element.textContent = label;
	return element;
}

function fileVersion(file: FileDiffMetadata): string {
	return JSON.stringify(file);
}

function rangeLabel(range: SelectedLineRange, fallback: AnnotationSide): string {
	const startSide = range.side ?? fallback;
	const endSide = range.endSide ?? range.side ?? fallback;
	const sideName = (side: AnnotationSide) => (side === "additions" ? "new" : "old");
	if (startSide !== endSide) {
		return `${sideName(startSide)} line ${range.start} to ${sideName(
			endSide,
		)} line ${range.end}`;
	}
	const first = Math.min(range.start, range.end);
	const last = Math.max(range.start, range.end);
	return first === last
		? `${sideName(startSide)} line ${first}`
		: `${sideName(startSide)} lines ${first}–${last}`;
}
