import { highlightCode } from "@mariozechner/pi-coding-agent";
// Portions adapted from @heyhuynhgiabuu/pi-diff by huynhgiabuu, MIT License.
import * as Diff from "diff";
import type {
	InlineDiffLine,
	ParsedInlineDiff,
	RenderInlineDiffOptions,
} from "./model.js";

const MAX_HL_CHARS = 80_000;
const CACHE_LIMIT = 192;
const ANSI_RE = /\u001b\[[0-9;]*m/g;
const RESET = "\u001b[0m";
const DIM = "\u001b[2m";
const BG_ADD = "\u001b[48;2;22;38;32m";
const BG_DEL = "\u001b[48;2;45;25;25m";
const BG_ADD_WORD = "\u001b[48;2;35;75;50m";
const BG_DEL_WORD = "\u001b[48;2;80;35;35m";
const FG_ADD = "\u001b[38;2;100;180;120m";
const FG_DEL = "\u001b[38;2;200;100;100m";
const FG_DIM = "\u001b[38;2;120;120;120m";

const highlightCache = new Map<string, string[]>();

function stripAnsi(value: string): string {
	return value.replace(ANSI_RE, "");
}

function visibleLength(value: string): number {
	return stripAnsi(value).length;
}

function fit(value: string, width: number): string {
	if (width <= 0) return "";
	if (visibleLength(value) <= width) return value;
	const plain = stripAnsi(value);
	return `${plain.slice(0, Math.max(0, width - 1))}…`;
}

function lineNumber(value: number | undefined, width: number): string {
	return value === undefined
		? " ".repeat(width)
		: String(value).padStart(width, " ");
}

function keepBackgroundAcrossResets(value: string, bg: string): string {
	if (!bg || !value.includes(RESET)) return value;
	return value.replaceAll(RESET, `${RESET}${bg}`);
}

function fitColumn(value: string, width: number, padBg = ""): string {
	if (width <= 0) return "";
	const fitted = visibleLength(value) > width ? fit(value, width) : value;
	const pad = Math.max(0, width - visibleLength(fitted));
	if (!padBg) return `${fitted}${" ".repeat(pad)}`;
	const stable = keepBackgroundAcrossResets(fitted, padBg);
	return `${padBg}${stable}${" ".repeat(pad)}${RESET}`;
}

function cacheSet(key: string, value: string[]): string[] {
	if (highlightCache.has(key)) highlightCache.delete(key);
	highlightCache.set(key, value);
	while (highlightCache.size > CACHE_LIMIT) {
		const first = highlightCache.keys().next().value;
		if (first === undefined) break;
		highlightCache.delete(first);
	}
	return value;
}

function highlightLines(code: string, language: string): string[] {
	if (!code || code.length > MAX_HL_CHARS) return code.split("\n");
	const key = `${language}:${code.length}:${code}`;
	const cached = highlightCache.get(key);
	if (cached) return cached;
	try {
		return cacheSet(key, highlightCode(code, language));
	} catch {
		return code.replace(/\n$/, "").split("\n");
	}
}

function changedWordRanges(
	oldText: string,
	newText: string,
): { oldRanges: Array<[number, number]>; newRanges: Array<[number, number]> } {
	const oldRanges: Array<[number, number]> = [];
	const newRanges: Array<[number, number]> = [];
	let oldOffset = 0;
	let newOffset = 0;

	for (const part of Diff.diffWordsWithSpace(oldText, newText)) {
		const textLength = part.value.length;
		if (part.removed) oldRanges.push([oldOffset, oldOffset + textLength]);
		if (part.added) newRanges.push([newOffset, newOffset + textLength]);
		if (!part.added) oldOffset += textLength;
		if (!part.removed) newOffset += textLength;
	}

	return { oldRanges, newRanges };
}

function injectRanges(
	text: string,
	ranges: Array<[number, number]>,
	bg: string,
): string {
	if (!ranges.length) return text;
	const plain = stripAnsi(text);
	let out = "";
	let cursor = 0;
	for (const [start, end] of ranges) {
		if (start > cursor) out += plain.slice(cursor, start);
		out += `${bg}${plain.slice(start, end)}${RESET}`;
		cursor = end;
	}
	out += plain.slice(cursor);
	return out;
}

function pairWordHighlights(lines: InlineDiffLine[]): Map<number, string> {
	const highlighted = new Map<number, string>();
	for (let i = 0; i < lines.length - 1; i++) {
		const oldLine = lines[i];
		const newLine = lines[i + 1];
		if (oldLine?.type !== "del" || newLine?.type !== "add") continue;
		const ranges = changedWordRanges(oldLine.content, newLine.content);
		highlighted.set(
			i,
			injectRanges(oldLine.content, ranges.oldRanges, BG_DEL_WORD),
		);
		highlighted.set(
			i + 1,
			injectRanges(newLine.content, ranges.newRanges, BG_ADD_WORD),
		);
	}
	return highlighted;
}

function limitLines(
	lines: InlineDiffLine[],
	maxLines: number,
): { lines: InlineDiffLine[]; omitted: number } {
	if (lines.length <= maxLines) return { lines, omitted: 0 };
	return { lines: lines.slice(0, maxLines), omitted: lines.length - maxLines };
}

function renderUnified(
	diff: ParsedInlineDiff,
	options: RenderInlineDiffOptions,
): string {
	const limited = limitLines(diff.lines, options.maxLines);
	const lineWidth = Math.max(
		1,
		String(
			Math.max(...diff.lines.map((line) => line.oldNum ?? line.newNum ?? 0), 1),
		).length,
	);
	const wordHighlights = pairWordHighlights(limited.lines);
	const code = limited.lines.map((line) => line.content).join("\n");
	const highlighted = highlightLines(code, options.language);
	const rows: string[] = [];

	for (let i = 0; i < limited.lines.length; i++) {
		const line = limited.lines[i]!;
		const prefix = line.type === "add" ? "+" : line.type === "del" ? "-" : " ";
		const fg =
			line.type === "add" ? FG_ADD : line.type === "del" ? FG_DEL : FG_DIM;
		const bg = line.type === "add" ? BG_ADD : line.type === "del" ? BG_DEL : "";
		const number = lineNumber(
			line.type === "add" ? line.newNum : line.oldNum,
			lineWidth,
		);
		const codeText = wordHighlights.get(i) ?? highlighted[i] ?? line.content;
		rows.push(
			fit(`${bg}${fg}${prefix}${number} │ ${codeText}${RESET}`, options.width),
		);
	}

	if (limited.omitted > 0)
		rows.push(`${DIM}… ${limited.omitted} more diff lines${RESET}`);
	return rows.join("\n");
}

function renderSplit(
	diff: ParsedInlineDiff,
	options: RenderInlineDiffOptions,
): string {
	if (options.width < 120) return renderUnified(diff, options);
	const half = Math.max(30, Math.floor((options.width - 3) / 2));
	const limited = limitLines(diff.lines, options.maxLines);
	const lineWidth = Math.max(
		1,
		String(
			Math.max(...diff.lines.map((line) => line.oldNum ?? line.newNum ?? 0), 1),
		).length,
	);
	const wordHighlights = pairWordHighlights(limited.lines);
	const code = limited.lines.map((line) => line.content).join("\n");
	const highlighted = highlightLines(code, options.language);
	const rows: string[] = [];
	const codeTextAt = (index: number): string =>
		wordHighlights.get(index) ??
		highlighted[index] ??
		limited.lines[index]?.content ??
		"";
	const columnBg = (value: string): string =>
		value.startsWith(BG_DEL) ? BG_DEL : value.startsWith(BG_ADD) ? BG_ADD : "";
	const joinCols = (left: string, right: string) =>
		`${fitColumn(left, half, columnBg(left))} │ ${fitColumn(right, half, columnBg(right))}`;
	const blankLeft = `${DIM} ${lineNumber(undefined, lineWidth)} │${RESET}`;
	const blankRight = blankLeft;
	const border = `${DIM}${"─".repeat(half)}─┬─${"─".repeat(half)}${RESET}`;

	rows.push(border);
	rows.push(
		joinCols(
			`${DIM}${"old".padStart(Math.max(3, lineWidth + 2), " ")}${RESET}`,
			`${DIM}${"new".padStart(Math.max(3, lineWidth + 2), " ")}${RESET}`,
		),
	);

	for (let i = 0; i < limited.lines.length; i++) {
		const line = limited.lines[i]!;

		if (line.type === "del") {
			const delStart = i;
			while (i < limited.lines.length && limited.lines[i]?.type === "del") i++;
			const delEnd = i;
			const addStart = i;
			while (i < limited.lines.length && limited.lines[i]?.type === "add") i++;
			const addEnd = i;
			const rowCount = Math.max(delEnd - delStart, addEnd - addStart);

			for (let row = 0; row < rowCount; row++) {
				const oldIndex = delStart + row;
				const newIndex = addStart + row;
				const oldLine = oldIndex < delEnd ? limited.lines[oldIndex] : undefined;
				const newLine = newIndex < addEnd ? limited.lines[newIndex] : undefined;
				const left = oldLine
					? `${BG_DEL}${FG_DEL}-${lineNumber(oldLine.oldNum, lineWidth)} │ ${codeTextAt(oldIndex)}${RESET}`
					: blankLeft;
				const right = newLine
					? `${BG_ADD}${FG_ADD}+${lineNumber(newLine.newNum, lineWidth)} │ ${codeTextAt(newIndex)}${RESET}`
					: blankRight;
				rows.push(joinCols(left, right));
			}

			i--;
			continue;
		}

		if (line.type === "add") {
			const right = `${BG_ADD}${FG_ADD}+${lineNumber(line.newNum, lineWidth)} │ ${codeTextAt(i)}${RESET}`;
			rows.push(joinCols(blankLeft, right));
			continue;
		}

		const codeText = codeTextAt(i);
		const left = `${DIM} ${lineNumber(line.oldNum, lineWidth)} │ ${codeText}${RESET}`;
		const right = `${DIM} ${lineNumber(line.newNum, lineWidth)} │ ${codeText}${RESET}`;
		rows.push(joinCols(left, right));
	}

	if (limited.omitted > 0)
		rows.push(`${DIM}… ${limited.omitted} more diff lines${RESET}`);
	return rows.join("\n");
}

export function renderInlineDiff(
	diff: ParsedInlineDiff,
	options: RenderInlineDiffOptions,
): string {
	return renderSplit(diff, options);
}

export function renderNewFilePreview(
	content: string,
	options: RenderInlineDiffOptions,
): string {
	const rawLines = content.split("\n");
	if (rawLines[rawLines.length - 1] === "") rawLines.pop();
	const shown = rawLines.slice(0, options.maxLines);
	const highlighted = highlightLines(shown.join("\n"), options.language);
	const rows = highlighted.map((line, index) =>
		fit(
			`${DIM}${String(index + 1).padStart(4, " ")} │${RESET} ${line}`,
			options.width,
		),
	);
	const omitted = rawLines.length - shown.length;
	if (omitted > 0) rows.push(`${DIM}… ${omitted} more lines${RESET}`);
	return rows.join("\n");
}
