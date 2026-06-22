/**
 * Boundary duplication detector — catches the common LLM failure mode where
 * a model generates a replacement that duplicates the line on either side
 * of the edit, producing two adjacent identical lines in the resulting file.
 *
 * Classic example: the model intends to add a function body but ends the
 * replacement with the same `}` that already follows the original line,
 * so the file ends up with `}\n}`. We surface this as a warning with the
 * surviving line's `LINE:HASH` reference so the model can issue a follow-up
 * edit to remove the duplicate.
 *
 * Comparison is raw (no trimming), matching the policy documented by
 * pi-hashline-edit-pro: trimming would cause false positives when
 * surrounding code uses different indentation.
 */
import { computeLineHash } from "./hashline/core.js";
import { parseLineRef } from "./hashline/refs.js";

export type BoundaryEdge = "leading" | "trailing";

export interface BoundaryWarning {
	/** Index of the edit in the input `edits` array. */
	editIndex: number;
	/** Which edge of the replacement is the duplicate. */
	edge: BoundaryEdge;
	/** The duplicated line content (for echoing back to the model). */
	duplicateContent: string;
	/** 1-indexed line number of the surviving line (post-edit). */
	survivingLine: number;
	/** `LINE:HASH` reference anchor for the surviving line. */
	referenceAnchor: string;
}

export type BoundaryEditInfo =
	| { type: "set_line"; originalLine: number; newLines: readonly string[] }
	| {
			type: "replace_lines";
			originalStart: number;
			originalEnd: number;
			newLines: readonly string[];
	  }
	| {
			type: "replace";
			originalStart: number;
			originalLength: number;
			newLines: readonly string[];
	  };

interface NormalizedEdit {
	editIndex: number;
	originalStart: number; // 1-indexed
	originalEnd: number; // 1-indexed, inclusive
	newLines: readonly string[];
}

function normalize(edits: readonly BoundaryEditInfo[]): NormalizedEdit[] {
	return edits.map((edit, editIndex) => {
		switch (edit.type) {
			case "set_line":
				return {
					editIndex,
					originalStart: edit.originalLine,
					originalEnd: edit.originalLine,
					newLines: edit.newLines,
				};
			case "replace_lines":
				return {
					editIndex,
					originalStart: edit.originalStart,
					originalEnd: edit.originalEnd,
					newLines: edit.newLines,
				};
			case "replace":
				return {
					editIndex,
					originalStart: edit.originalStart,
					originalEnd: edit.originalStart + edit.originalLength - 1,
					newLines: edit.newLines,
				};
		}
	});
}

export function detectBoundaryDuplications(
	originalLines: readonly string[],
	edits: readonly BoundaryEditInfo[],
): BoundaryWarning[] {
	const warnings: BoundaryWarning[] = [];
	const normalized = normalize(edits);

	for (const edit of normalized) {
		const firstNew = edit.newLines[0];
		const lastNew = edit.newLines[edit.newLines.length - 1];

		// Leading edge: replacement's first line == line before the edit.
		const precedingIdx = edit.originalStart - 2; // 0-indexed; -1 means no preceding line
		if (firstNew !== undefined && precedingIdx >= 0 && originalLines[precedingIdx] === firstNew) {
			const survivingLineNumber = precedingIdx + 1; // 1-indexed
			warnings.push({
				editIndex: edit.editIndex,
				edge: "leading",
				duplicateContent: firstNew,
				survivingLine: survivingLineNumber,
				referenceAnchor: `${survivingLineNumber}:${computeLineHash(
					survivingLineNumber,
					originalLines[precedingIdx],
				)}`,
			});
		}

		// Trailing edge: replacement's last line == line after the edit.
		const followingIdx = edit.originalEnd; // 0-indexed; == length means no following line
		if (lastNew !== undefined && followingIdx < originalLines.length && originalLines[followingIdx] === lastNew) {
			const survivingLineNumber = followingIdx + 1; // 1-indexed
			warnings.push({
				editIndex: edit.editIndex,
				edge: "trailing",
				duplicateContent: lastNew,
				survivingLine: survivingLineNumber,
				referenceAnchor: `${survivingLineNumber}:${computeLineHash(
					survivingLineNumber,
					originalLines[followingIdx],
				)}`,
			});
		}
	}

	return warnings;
}

/**
 * Input shape for the converter. We use a permissive structural type rather
 * than the project's `HashlineEditItem` directly because the runtime schema
 * (`hashlineEditItemSchema`) allows `additionalProperties: true`, so parsed
 * edits may carry extra keys such as `replace_symbol`. The adapter only
 * reads the keys it needs.
 */
export interface HashlineLikeEdit {
	set_line?: { anchor?: unknown; new_text?: unknown };
	replace_lines?: { start_anchor?: unknown; end_anchor?: unknown; new_text?: unknown };
	insert_after?: { anchor?: unknown; new_text?: unknown; text?: unknown };
	replace?: { old_text?: unknown; new_text?: unknown };
	[key: string]: unknown;
}

/**
 * Convert a list of edit items into the normalized shape the boundary
 * detector needs. Edits that don't have a known line range (`insert_after`,
 * or `replace` whose `old_text` cannot be located) are dropped — boundary
 * detection is meaningless for them.
 */
export function editsToBoundaryInfo(
	edits: readonly HashlineLikeEdit[],
	originalLines: readonly string[],
): BoundaryEditInfo[] {
	const out: BoundaryEditInfo[] = [];
	edits.forEach((edit) => {
		const setLine = edit.set_line;
		const replaceLines = edit.replace_lines;
		const replace = edit.replace;
		if (setLine && typeof setLine.anchor === "string" && typeof setLine.new_text === "string") {
			const parsed = parseLineRef(setLine.anchor);
			out.push({
				type: "set_line",
				originalLine: parsed.line,
				newLines: setLine.new_text.split("\n"),
			});
			return;
		}
		if (
			replaceLines &&
			typeof replaceLines.start_anchor === "string" &&
			typeof replaceLines.end_anchor === "string" &&
			typeof replaceLines.new_text === "string"
		) {
			const start = parseLineRef(replaceLines.start_anchor);
			const end = parseLineRef(replaceLines.end_anchor);
			out.push({
				type: "replace_lines",
				originalStart: start.line,
				originalEnd: end.line,
				newLines: replaceLines.new_text.split("\n"),
			});
			return;
		}
		if (replace && typeof replace.old_text === "string" && typeof replace.new_text === "string") {
			const startLine = findOldTextStartLine(originalLines, replace.old_text);
			if (startLine === undefined) return;
			const originalLength = replace.old_text.split("\n").length;
			out.push({
				type: "replace",
				originalStart: startLine,
				originalLength,
				newLines: replace.new_text.split("\n"),
			});
			return;
		}
		// replace_symbol uses ts-morph to rewrite a function/symbol body; the
		// mapping back to specific source lines is non-trivial, so we skip
		// boundary detection for it.
		// insert_after has no replacement region; nothing to check either.
	});
	return out;
}

function findOldTextStartLine(
	originalLines: readonly string[],
	oldText: string,
): number | undefined {
	if (oldText === "") return undefined;
	const needle = oldText.split("\n");
	const firstNeedle = needle[0];
	if (firstNeedle === undefined) return undefined;
	for (let i = 0; i < originalLines.length; i += 1) {
		if (originalLines[i] !== firstNeedle) continue;
		let matched = true;
		for (let j = 1; j < needle.length; j += 1) {
			if (originalLines[i + j] !== needle[j]) {
				matched = false;
				break;
			}
		}
		if (matched) return i + 1; // 1-indexed
	}
	return undefined;
}

/**
 * Convenience: detect boundary duplications and format each warning as a
 * human-readable string suitable for inclusion in an edit-tool response.
 */
export function detectBoundaryWarningsAsStrings(
	originalContent: string,
	edits: readonly HashlineLikeEdit[],
): string[] {
	const lines = originalContent.split("\n");
	const info = editsToBoundaryInfo(edits, lines);
	return detectBoundaryDuplications(lines, info).map((w) => {
		const side = w.edge === "leading" ? "preceding" : "following";
		return `boundary-duplication: ${side} line ${w.survivingLine} (${w.referenceAnchor}) is duplicated by the replacement's ${w.edge} line: ${JSON.stringify(w.duplicateContent)}`;
	});
}
