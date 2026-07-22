import { isRecord } from "./utils/type-guards.ts";

const maximumCommentCount = 100;
const maximumCommentLength = 20_000;
const maximumPathLength = 4_096;
const maximumReviewLength = 200_000;
const maximumLineNumber = 10_000_000;

export type WorkspaceReviewCommentSide = "additions" | "deletions";

export type WorkspaceReviewComment = Readonly<{
	body: string;
	endLine: number;
	endSide: WorkspaceReviewCommentSide;
	path: string;
	startLine: number;
	startSide: WorkspaceReviewCommentSide;
}>;

export function parseWorkspaceReviewComments(value: unknown): WorkspaceReviewComment[] {
	if (!isRecord(value) || !Array.isArray(value.comments)) {
		throw new Error("Missing or invalid review comments.");
	}
	if (value.comments.length === 0 || value.comments.length > maximumCommentCount) {
		throw new Error("A review must contain between 1 and 100 comments.");
	}
	const comments = value.comments.map((comment) => parseComment(comment));
	const length = comments.reduce(
		(total, comment) => total + comment.path.length + comment.body.length,
		0,
	);
	if (length > maximumReviewLength) {
		throw new Error("Review comments are too large.");
	}
	return comments;
}

export function formatWorkspaceReviewPrompt(
	comments: readonly WorkspaceReviewComment[],
): string {
	const entries = comments.map(
		(comment, index) =>
			`${index + 1}. ${comment.path}:${formatRange(comment)}\n${comment.body}`,
	);
	return ["address the following review comments:", ...entries].join("\n\n");
}

function parseComment(value: unknown): WorkspaceReviewComment {
	if (!isRecord(value)) throw new Error("Invalid review comment.");
	const body = requiredText(value.body, "comment body", maximumCommentLength);
	const path = requiredText(value.path, "comment path", maximumPathLength);
	if (path.includes("\r") || path.includes("\n") || path.includes("\0")) {
		throw new Error("Invalid comment path.");
	}
	return {
		body,
		endLine: lineNumber(value.endLine),
		endSide: side(value.endSide),
		path,
		startLine: lineNumber(value.startLine),
		startSide: side(value.startSide),
	};
}

function requiredText(value: unknown, label: string, maximum: number): string {
	if (typeof value !== "string") {
		throw new Error(`Missing or invalid ${label}.`);
	}
	const text = value.trim();
	if (!text || text.length > maximum) {
		throw new Error(`Missing or invalid ${label}.`);
	}
	return text;
}

function lineNumber(value: unknown): number {
	if (
		typeof value !== "number" ||
		!Number.isSafeInteger(value) ||
		value < 1 ||
		value > maximumLineNumber
	) {
		throw new Error("Invalid review comment line number.");
	}
	return value;
}

function side(value: unknown): WorkspaceReviewCommentSide {
	if (value !== "additions" && value !== "deletions") {
		throw new Error("Invalid review comment side.");
	}
	return value;
}

function formatRange(comment: WorkspaceReviewComment): string {
	const first = Math.min(comment.startLine, comment.endLine);
	const last = Math.max(comment.startLine, comment.endLine);
	return first === last ? String(first) : `${first}–${last}`;
}
