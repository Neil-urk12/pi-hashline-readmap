/**
 * DiffBuilder — the deep module that owns the construction of every diff-shaped
 * projection a mutation tool emits.
 *
 * Two entry points:
 *   - buildAllDiffs: the live projection `edit.ts` and `write.ts` reach for.
 *   - buildPendingDiffSnapshot: the freeze-friendly projection `pending-diff-preview.ts`
 *     stashes into its frozen `data` field.
 *
 * Both are pure functions over their inputs. No session state, no I/O, no subprocess.
 *
 * Runs `Diff.diffLines` exactly once per call site: the parts array feeds both the
 * string-diff formatter and the entry builder. The compact short-circuit
 * (`LINE:HASH|old → LINE:HASH|new`) produces entries from the line arrays directly,
 * without serializing through a string and parsing it back.
 */
import * as Diff from "diff";
import { computeLineHash, isHashlineInitialized } from "./hashline.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type DiffEntry =
	| { kind: "context"; oldLine: number; newLine: number; text: string }
	| { kind: "add"; newLine: number; text: string }
	| { kind: "remove"; oldLine: number; text: string }
	| { kind: "meta"; text: string };

export type DiffSpan =
	| { kind: "equal"; text: string }
	| { kind: "add"; text: string }
	| { kind: "remove"; text: string };

export type InlineDiff = {
	removeLineIndex: number;
	addLineIndex: number;
	removeSpans: DiffSpan[];
	addSpans: DiffSpan[];
};

export type DiffBlockRange = {
	kind: "add" | "remove";
	startLine: number;
	endLine: number;
};

export type DiffData = {
	version: 1;
	entries: DiffEntry[];
	stats: { added: number; removed: number; context: number };
	language?: string;
	blockRanges?: DiffBlockRange[];
	inlineDiffs?: InlineDiff[];
};

export type InlineDiffLine =
	| { type: "add"; newNum: number; content: string }
	| { type: "del"; oldNum: number; content: string }
	| { type: "ctx"; oldNum: number; newNum: number; content: string };

export type ParsedInlineDiff = {
	lines: InlineDiffLine[];
	added: number;
	removed: number;
	chars: number;
};

export type InlineDiffMetadata =
	| { kind: "no-change"; path: string }
	| { kind: "diff"; path: string; summary: string; language: string; oldContent: string; newContent: string }
	| { kind: "new-file"; path: string; language: string; content: string; lines: number };

// ─── Constants ───────────────────────────────────────────────────────────────

export const MAX_INLINE_DIFF_LINE_LENGTH = 4096;
export const MAX_INLINE_DIFF_TOKENS = 512;
export const MAX_INLINE_DIFF_CELLS = 200_000;
export const MAX_INLINE_DIFF_PAIRS = 200;

/**
 * Size gate for InlineDiffMetadata construction. Below this combined size of
 * old + new content, the deep module produces an InlineDiffMetadata; above, it
 * leaves `inlineDiff` undefined (the caller renders a header + the truncated
 * placeholder instead).
 */
export const MAX_INLINE_DIFF_CONTENT_CHARS = 200_000;

const INLINE_SIMILARITY_THRESHOLD = 0.35;
const INLINE_TOKEN_PATTERN = /([A-Za-z_$][\w$]*|\d+|\s+|[^A-Za-z_$\w\s]+)/gu;

// ─── Language map (single authority) ──────────────────────────────────────────

const EXT_LANG: Record<string, string> = {
	ts: "typescript",
	tsx: "tsx",
	js: "javascript",
	jsx: "jsx",
	mjs: "javascript",
	cjs: "javascript",
	py: "python",
	rb: "ruby",
	rs: "rust",
	go: "go",
	java: "java",
	c: "c",
	cpp: "cpp",
	cc: "cpp",
	cxx: "cpp",
	h: "c",
	hpp: "cpp",
	cs: "csharp",
	swift: "swift",
	kt: "kotlin",
	html: "html",
	css: "css",
	scss: "scss",
	json: "json",
	yaml: "yaml",
	yml: "yaml",
	toml: "toml",
	md: "markdown",
	markdown: "markdown",
	sql: "sql",
	sh: "bash",
	bash: "bash",
	zsh: "bash",
	lua: "lua",
	php: "php",
	dart: "dart",
	xml: "xml",
	graphql: "graphql",
	svelte: "svelte",
	vue: "vue",
};

function inferLanguage(path: string): string | undefined {
	const leaf = path.split(/[\\/]/).pop() ?? path;
	const ext = leaf.includes(".") ? leaf.split(".").pop()?.toLowerCase() : undefined;
	return ext ? EXT_LANG[ext] : undefined;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface AllDiffsResult {
	/** String diff for prompt-visible output (compact short-circuit for single-line edits). */
	diff: string;
	/** Structured entries for TUI rendering. */
	diffData: DiffData;
	/** InlineDiffMetadata for the new diff-renderer; undefined when content exceeds the size gate or no changes. */
	inlineDiff?: InlineDiffMetadata;
	/** "+N -M" summary string; always populated when inlineDiff is "diff". */
	summary: string;
	/** Shiki language id from the EXT_LANG map (single authority). */
	language: string | undefined;
	/** 1-indexed line number of the first change in newContent. */
	firstChangedLine: number | undefined;
}

export interface BuildAllDiffsOptions {
	blockRanges?: readonly DiffBlockRange[];
}

export function buildAllDiffs(
	oldContent: string,
	newContent: string,
	path: string,
	options: BuildAllDiffsOptions = {},
): AllDiffsResult {
	const language = inferLanguage(path);
	const { entries, diff, firstChangedLine } = buildEntriesAndDiff(oldContent, newContent);
	const stats = buildStats(entries);

	const inlineDiff = buildInlineDiff(oldContent, newContent, path, language);
	const summary =
		inlineDiff?.kind === "diff" ? inlineDiff.summary : summarizeDiffCounts(stats.added, stats.removed);

	const { blockRanges } = options;
	const inlineDiffs = buildInlineDiffs(entries);
	const diffData: DiffData = {
		version: 1,
		entries,
		stats,
		...(language ? { language } : {}),
		...(blockRanges?.length ? { blockRanges: [...blockRanges] } : {}),
		...(inlineDiffs ? { inlineDiffs } : {}),
	};

	return {
		diff,
		diffData,
		...(inlineDiff ? { inlineDiff } : {}),
		summary,
		language,
		firstChangedLine,
	};
}

export interface PendingDiffSnapshot {
	diff: string;
	entries: DiffEntry[];
	firstChangedLine: number | undefined;
}

export function buildPendingDiffSnapshot(
	previousContent: string,
	nextContent: string,
): PendingDiffSnapshot {
	const { entries, diff, firstChangedLine } = buildEntriesAndDiff(previousContent, nextContent);
	return { diff, entries, firstChangedLine };
}

// ─── Internal: produce (entries, diff string, firstChangedLine) from one pass ─

interface EntriesAndDiff {
	entries: DiffEntry[];
	diff: string;
	firstChangedLine: number | undefined;
}

function buildEntriesAndDiff(oldContent: string, newContent: string): EntriesAndDiff {
	if (oldContent === newContent) {
		return { entries: [], diff: "", firstChangedLine: undefined };
	}

	const oldLines = oldContent.split("\n");
	const newLines = newContent.split("\n");

	// Compact short-circuit: single-line replacement. Requires the hashline WASM
	// to be initialized (computeLineHash throws otherwise). When uninitialized,
	// fall through to the full-diff branch — same path the old generateDiffString took.
	if (isHashlineInitialized() && oldLines.length === newLines.length) {
		let changedIndex = -1;
		let changeCount = 0;
		for (let i = 0; i < oldLines.length; i++) {
			if (oldLines[i] !== newLines[i]) {
				changedIndex = i;
				changeCount++;
				if (changeCount > 1) break;
			}
		}
		if (changeCount === 1 && changedIndex >= 0) {
			const lineNum = changedIndex + 1;
			const oldLine = oldLines[changedIndex] ?? "";
			const newLine = newLines[changedIndex] ?? "";
			const oldHash = computeLineHash(lineNum, oldLine);
			const newHash = computeLineHash(lineNum, newLine);
			return {
				entries: [
					{ kind: "remove", oldLine: lineNum, text: oldLine },
					{ kind: "add", newLine: lineNum, text: newLine },
				],
				diff: `${lineNum}:${oldHash}|${oldLine} → ${lineNum}:${newHash}|${newLine}`,
				firstChangedLine: lineNum,
			};
		}
	}

	if (isHashlineInitialized() && oldLines.length === newLines.length + 1) {
		let deletedIndex = -1;
		let j = 0;
		let failed = false;
		for (let i = 0; i < oldLines.length; i++) {
			if (j < newLines.length && oldLines[i] === newLines[j]) {
				j++;
				continue;
			}
			if (deletedIndex === -1) {
				deletedIndex = i;
				continue;
			}
			failed = true;
			break;
		}
		if (!failed && deletedIndex !== -1 && j === newLines.length) {
			const lineNum = deletedIndex + 1;
			const oldLine = oldLines[deletedIndex] ?? "";
			const oldHash = computeLineHash(lineNum, oldLine);
			return {
				entries: [{ kind: "remove", oldLine: lineNum, text: oldLine }],
				diff: `${lineNum}:${oldHash}|${oldLine} → [deleted]`,
				firstChangedLine: lineNum,
			};
		}
	}

	// Fall back to full unified diff: one Diff.diffLines() call, two consumers.
	const parts = Diff.diffLines(oldContent, newContent);
	const stringResult = formatDiffString(parts);
	const entries = parseFullDiffEntriesFromParts(parts);
	return {
		entries,
		diff: stringResult.diff,
		firstChangedLine: stringResult.firstChangedLine,
	};
}

// ─── Internal: string-diff formatter (consumes parts) ────────────────────────

function formatDiffString(parts: Diff.Change[]): { diff: string; firstChangedLine: number | undefined } {
	const output: string[] = [];
	let oldLineNum = 1;
	let newLineNum = 1;
	let lastWasChange = false;
	let firstChangedLine: number | undefined;

	for (let i = 0; i < parts.length; i++) {
		const part = parts[i]!;
		const raw = part.value.split("\n");
		if (raw[raw.length - 1] === "") raw.pop();

		if (part.added || part.removed) {
			if (firstChangedLine === undefined) firstChangedLine = newLineNum;
			for (const line of raw) {
				if (part.added) {
					output.push(`+${newLineNum} ${line}`);
					newLineNum++;
				} else {
					output.push(`-${oldLineNum} ${line}`);
					oldLineNum++;
				}
			}
			lastWasChange = true;
			continue;
		}

		const nextPartIsChange = i < parts.length - 1 && (parts[i + 1]!.added || parts[i + 1]!.removed);
		if (lastWasChange || nextPartIsChange) {
			const contextLines = 4;
			let linesToShow = raw;
			let skipStart = 0;
			let skipEnd = 0;

			if (!lastWasChange) {
				skipStart = Math.max(0, raw.length - contextLines);
				linesToShow = raw.slice(skipStart);
			}
			if (!nextPartIsChange && linesToShow.length > contextLines) {
				skipEnd = linesToShow.length - contextLines;
				linesToShow = linesToShow.slice(0, contextLines);
			}

			if (skipStart > 0) {
				output.push(`      ...`);
				oldLineNum += skipStart;
				newLineNum += skipStart;
			}
			for (const line of linesToShow) {
				output.push(` ${oldLineNum} ${line}`);
				oldLineNum++;
				newLineNum++;
			}
			if (skipEnd > 0) {
				output.push(`      ...`);
				oldLineNum += skipEnd;
				newLineNum += skipEnd;
			}
		} else {
			oldLineNum += raw.length;
			newLineNum += raw.length;
		}
		lastWasChange = false;
	}

	// Compute line-number width from actual max (preserves the original behavior).
	const lineNumWidth = Math.max(String(oldLineNum).length, String(newLineNum).length);
	const padded = output.map((line) => {
		// Lines start with: ' +N ' (context), '+N ' (add), '-N ' (remove), '      ...' (meta)
		const m = line.match(/^([+\- ]) +(\d+) (.*)$/);
		if (m) {
			const [, sign, num, rest] = m;
			return `${sign} ${String(num).padStart(lineNumWidth, " ")} ${rest}`;
		}
		// "      ..." stays as-is (pad to lineNumWidth).
		return line.replace(/^(\s+)\.\.\.$/, (_full, spaces) => `${" ".repeat(lineNumWidth + 2)}...`);
	});

	return { diff: padded.join("\n"), firstChangedLine };
}

// ─── Internal: entry builder (consumes parts) ─────────────────────────────────

function parseFullDiffEntriesFromParts(parts: Diff.Change[]): DiffEntry[] {
	const entries: DiffEntry[] = [];
	let nextOldLine = 1;
	let nextNewLine = 1;

	for (const part of parts) {
		const raw = part.value.split("\n");
		if (raw[raw.length - 1] === "") raw.pop();

		if (part.added) {
			for (const text of raw) {
				entries.push({ kind: "add", newLine: nextNewLine, text });
				nextNewLine++;
			}
		} else if (part.removed) {
			for (const text of raw) {
				entries.push({ kind: "remove", oldLine: nextOldLine, text });
				nextOldLine++;
			}
		} else {
			for (const text of raw) {
				const oldLine = nextOldLine;
				const lineDelta = nextNewLine - nextOldLine;
				const newLine = oldLine + lineDelta;
				entries.push({ kind: "context", oldLine, newLine, text });
				nextOldLine++;
				nextNewLine++;
			}
		}
	}

	return entries;
}

// ─── Internal: stats + summary ────────────────────────────────────────────────

function buildStats(entries: DiffEntry[]): DiffData["stats"] {
	return entries.reduce(
		(stats, entry) => {
			if (entry.kind === "add") stats.added++;
			else if (entry.kind === "remove") stats.removed++;
			else if (entry.kind === "context") stats.context++;
			return stats;
		},
		{ added: 0, removed: 0, context: 0 },
	);
}

export function summarizeDiffCounts(added: number, removed: number): string {
	return `+${added} -${removed}`;
}

// ─── Internal: inline-diff metadata (size gate + construction) ───────────────

function buildInlineDiff(
	oldContent: string,
	newContent: string,
	path: string,
	language: string | undefined,
): InlineDiffMetadata | undefined {
	if (oldContent === newContent) {
		return { kind: "no-change", path };
	}
	if (oldContent.length + newContent.length > MAX_INLINE_DIFF_CONTENT_CHARS) {
		return undefined;
	}
	const parsed = parseInlineDiff(oldContent, newContent);
	const summary = summarizeDiffCounts(parsed.added, parsed.removed);
	return {
		kind: "diff",
		path,
		summary,
		language: language ?? "text",
		oldContent,
		newContent,
	};
}

function parseInlineDiff(oldContent: string, newContent: string): ParsedInlineDiff {
	const parts = Diff.diffLines(oldContent, newContent);
	const lines: InlineDiffLine[] = [];
	let oldNum = 1;
	let newNum = 1;
	let added = 0;
	let removed = 0;
	let chars = 0;

	for (const part of parts) {
		const rawLines = part.value.split("\n");
		if (rawLines[rawLines.length - 1] === "") rawLines.pop();

		for (const content of rawLines) {
			chars += content.length;
			if (part.added) {
				lines.push({ type: "add", newNum, content });
				newNum += 1;
				added += 1;
			} else if (part.removed) {
				lines.push({ type: "del", oldNum, content });
				oldNum += 1;
				removed += 1;
			} else {
				lines.push({ type: "ctx", oldNum, newNum, content });
				oldNum += 1;
				newNum += 1;
			}
		}
	}

	return { lines, added, removed, chars };
}

// ─── Internal: word-level LCS inline diffs ────────────────────────────────────

function tokenizeInlineDiff(text: string): string[] {
	return text.match(INLINE_TOKEN_PATTERN) ?? (text ? [text] : []);
}

function longestCommonSubsequence(a: string[], b: string[]): Array<[number, number]> {
	const rows = a.length + 1;
	const cols = b.length + 1;
	const table: number[][] = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

	for (let i = a.length - 1; i >= 0; i--) {
		for (let j = b.length - 1; j >= 0; j--) {
			table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
		}
	}

	const pairs: Array<[number, number]> = [];
	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		if (a[i] === b[j]) {
			pairs.push([i, j]);
			i++;
			j++;
		} else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
			i++;
		} else {
			j++;
		}
	}

	return pairs;
}

function pushMergedSpan(spans: DiffSpan[], span: DiffSpan): void {
	if (!span.text) return;
	const previous = spans[spans.length - 1];
	if (previous?.kind === span.kind) {
		previous.text += span.text;
		return;
	}
	spans.push({ ...span });
}

function buildInlineSpans(
	removeText: string,
	addText: string,
): { removeSpans: DiffSpan[]; addSpans: DiffSpan[] } | undefined {
	if (removeText.length > MAX_INLINE_DIFF_LINE_LENGTH || addText.length > MAX_INLINE_DIFF_LINE_LENGTH) {
		return undefined;
	}

	const removeTokens = tokenizeInlineDiff(removeText);
	const addTokens = tokenizeInlineDiff(addText);
	if (!removeTokens.length || !addTokens.length) return undefined;
	if (removeTokens.length > MAX_INLINE_DIFF_TOKENS || addTokens.length > MAX_INLINE_DIFF_TOKENS) return undefined;
	if ((removeTokens.length + 1) * (addTokens.length + 1) > MAX_INLINE_DIFF_CELLS) return undefined;

	const pairs = longestCommonSubsequence(removeTokens, addTokens);
	const meaningfulRemoveTokenCount = removeTokens.filter((token) => token.trim().length > 0).length;
	const meaningfulAddTokenCount = addTokens.filter((token) => token.trim().length > 0).length;
	const meaningfulEqualTokenCount = pairs.filter(([removeIndex, addIndex]) => {
		const removeToken = removeTokens[removeIndex] ?? "";
		const addToken = addTokens[addIndex] ?? "";
		return removeToken === addToken && removeToken.trim().length > 0 && addToken.trim().length > 0;
	}).length;
	const similarity = meaningfulEqualTokenCount / Math.max(meaningfulRemoveTokenCount, meaningfulAddTokenCount);
	if (similarity < INLINE_SIMILARITY_THRESHOLD) return undefined;

	const removeSpans: DiffSpan[] = [];
	const addSpans: DiffSpan[] = [];
	let removeCursor = 0;
	let addCursor = 0;

	for (const [removeIndex, addIndex] of pairs) {
		if (removeCursor < removeIndex) {
			pushMergedSpan(removeSpans, { kind: "remove", text: removeTokens.slice(removeCursor, removeIndex).join("") });
		}
		if (addCursor < addIndex) {
			pushMergedSpan(addSpans, { kind: "add", text: addTokens.slice(addCursor, addIndex).join("") });
		}
		pushMergedSpan(removeSpans, { kind: "equal", text: removeTokens[removeIndex]! });
		pushMergedSpan(addSpans, { kind: "equal", text: addTokens[addIndex]! });
		removeCursor = removeIndex + 1;
		addCursor = addIndex + 1;
	}

	if (removeCursor < removeTokens.length) {
		pushMergedSpan(removeSpans, { kind: "remove", text: removeTokens.slice(removeCursor).join("") });
	}
	if (addCursor < addTokens.length) {
		pushMergedSpan(addSpans, { kind: "add", text: addTokens.slice(addCursor).join("") });
	}

	if (!removeSpans.some((span) => span.kind === "remove") || !addSpans.some((span) => span.kind === "add")) {
		return undefined;
	}
	return { removeSpans, addSpans };
}

function buildInlineDiffs(entries: DiffEntry[]): InlineDiff[] | undefined {
	const inlineDiffs: InlineDiff[] = [];
	let remainingPairs = MAX_INLINE_DIFF_PAIRS;

	for (let index = 0; index < entries.length; ) {
		if (entries[index]?.kind !== "remove") {
			index++;
			continue;
		}

		const removeStart = index;
		while (entries[index]?.kind === "remove") index++;
		const addStart = index;
		while (entries[index]?.kind === "add") index++;

		const removeCount = addStart - removeStart;
		const addCount = index - addStart;
		if (removeCount === 0 || addCount === 0 || removeCount !== addCount) continue;

		for (let offset = 0; offset < removeCount; offset++) {
			if (remainingPairs <= 0) break;
			remainingPairs--;

			const removeIndex = removeStart + offset;
			const addIndex = addStart + offset;
			const removeEntry = entries[removeIndex];
			const addEntry = entries[addIndex];
			if (removeEntry?.kind !== "remove" || addEntry?.kind !== "add") continue;

			const spans = buildInlineSpans(removeEntry.text, addEntry.text);
			if (!spans) continue;

			inlineDiffs.push({
				removeLineIndex: removeIndex,
				addLineIndex: addIndex,
				removeSpans: spans.removeSpans,
				addSpans: spans.addSpans,
			});
		}
	}

	return inlineDiffs.length ? inlineDiffs : undefined;
}
