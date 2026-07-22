import {
	type AnnotationSide,
	type DiffLineAnnotation,
	type SelectedLineRange,
} from "@pierre/diffs";

import type { WorkspaceReviewComment } from "../workspace-review-comments.ts";

export type ReviewCommentMetadata = {
	body: string | null;
	id: string;
	range: SelectedLineRange;
};

export type ReviewAnnotation = DiffLineAnnotation<ReviewCommentMetadata>;

export function createWorkspaceReviewCommentStore() {
	const annotations = new Map<string, ReviewAnnotation[]>();
	const fileVersions = new Map<string, string>();
	let sequence = 0;

	function add(path: string, fileVersion: string, range: SelectedLineRange): boolean {
		if (hasDraft()) return false;
		const annotation: ReviewAnnotation = {
			lineNumber: Math.max(range.start, range.end),
			metadata: {
				body: null,
				id: `review-comment-${++sequence}`,
				range: { ...range },
			},
			side: annotationSide(range),
		};
		annotations.set(path, [...(annotations.get(path) ?? []), annotation]);
		fileVersions.set(path, fileVersion);
		return true;
	}

	function save(id: string, body: string): string | undefined {
		const text = body.trim();
		if (!text) return undefined;
		return replace(id, (current) => ({
			...current,
			metadata: { ...current.metadata, body: text },
		}));
	}

	function remove(id: string): string | undefined {
		for (const [path, current] of annotations) {
			const next = current.filter((annotation) => annotation.metadata.id !== id);
			if (next.length === current.length) continue;
			if (next.length > 0) annotations.set(path, next);
			else {
				annotations.delete(path);
				fileVersions.delete(path);
			}
			return path;
		}
		return undefined;
	}

	function reconcileFiles(files: ReadonlyMap<string, string>): string[] {
		const removed: string[] = [];
		for (const path of annotations.keys()) {
			if (files.get(path) === fileVersions.get(path)) continue;
			annotations.delete(path);
			fileVersions.delete(path);
			removed.push(path);
		}
		return removed;
	}

	function hasDraft(): boolean {
		for (const current of annotations.values()) {
			if (current.some((annotation) => annotation.metadata.body === null)) {
				return true;
			}
		}
		return false;
	}

	function savedComments(): WorkspaceReviewComment[] {
		const comments: WorkspaceReviewComment[] = [];
		for (const [path, current] of annotations) {
			for (const annotation of current) {
				const body = annotation.metadata.body;
				if (body === null) continue;
				comments.push({
					body,
					endLine: annotation.metadata.range.end,
					endSide:
						annotation.metadata.range.endSide ??
						annotation.metadata.range.side ??
						annotation.side,
					path,
					startLine: annotation.metadata.range.start,
					startSide: annotation.metadata.range.side ?? annotation.side,
				});
			}
		}
		return comments;
	}

	function reset(): void {
		annotations.clear();
		fileVersions.clear();
	}

	function replace(
		id: string,
		update: (annotation: ReviewAnnotation) => ReviewAnnotation,
	): string | undefined {
		for (const [path, current] of annotations) {
			const index = current.findIndex(
				(annotation) => annotation.metadata.id === id,
			);
			if (index < 0) continue;
			const next = [...current];
			next[index] = update(next[index]);
			annotations.set(path, next);
			return path;
		}
		return undefined;
	}

	return {
		add,
		annotations: annotations as ReadonlyMap<string, ReviewAnnotation[]>,
		hasDraft,
		reconcileFiles,
		remove,
		reset,
		save,
		savedComments,
	};
}

function annotationSide(range: SelectedLineRange): AnnotationSide {
	return range.endSide ?? range.side ?? "additions";
}
