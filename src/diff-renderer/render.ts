import { highlightCode } from "@earendil-works/pi-coding-agent";
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

function padVisible(value: string, width: number): string {
	const pad = Math.max(0, width - visibleLength(value));
	return `${value}${" ".repeat(pad)}`;
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

function sgrClearsBackground(code: string): boolean {
	const match = code.match(/^\u001b\[([0-9;]*)m$/);
	if (!match) return false;
	const params = match[1] ? match[1].split(";").map((v) => Number.parseInt(v || "0", 10)) : [0];
	return params.some((v) => v === 0 || v === 49);
}

function reapplyBg(value: string, bg: string): string {
	if (!bg || !value.includes(RESET)) return value;
	return value.replace(new RegExp(RESET.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), (code) =>
		sgrClearsBackground(code) ? `${code}${bg}` : code,
	);
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
	fg = "",
): string {
	if (!ranges.length) return text;
	const plain = stripAnsi(text);
	let out = "";
	let cursor = 0;
	for (const [start, end] of ranges) {
		if (start > cursor) out += plain.slice(cursor, start);
		out += `${bg}${fg}${plain.slice(start, end)}${RESET}${fg ? `${fg}${bg}` : bg}`;
		cursor = end;
	}
	out += plain.slice(cursor);
	return fg ? `${fg}${out}` : out;
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
			injectRanges(oldLine.content, ranges.oldRanges, BG_DEL_WORD, FG_DEL),
		);
		highlighted.set(
			i + 1,
			injectRanges(newLine.content, ranges.newRanges, BG_ADD_WORD, FG_ADD),
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

function compactContextLines(
	lines: InlineDiffLine[],
	edgeContext = 3,
): InlineDiffLine[] {
	const changed = new Set<number>();
	for (let i = 0; i < lines.length; i++) {
		if (lines[i]?.type === "add" || lines[i]?.type === "del") {
			for (
				let j = Math.max(0, i - edgeContext);
				j <= Math.min(lines.length - 1, i + edgeContext);
				j++
			)
				changed.add(j);
		}
	}
	if (changed.size === 0) return lines;
	const out: InlineDiffLine[] = [];
	let omitted = 0;
	for (let i = 0; i < lines.length; i++) {
		if (changed.has(i)) {
			if (omitted > 0) {
				out.push({ type: "sep", content: `… ${omitted} unchanged lines …` });
				omitted = 0;
			}
			out.push(lines[i]!);
		} else {
			omitted += 1;
		}
	}
	if (omitted > 0)
		out.push({ type: "sep", content: `… ${omitted} unchanged lines …` });
	return out;
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
	if (options.width < 100) return renderUnified(diff, options);
	const totalWidth = Math.max(80, options.width);
	const dividerWidth = 1;
	const innerWidth = totalWidth - dividerWidth;
	const half = Math.max(30, Math.floor(innerWidth / 2));
	const rightHalf = Math.max(30, innerWidth - half);
	const limited = limitLines(compactContextLines(diff.lines), options.maxLines);
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
	const mid = `${DIM}│${RESET}`;
	const gutter = (value: number | undefined, sign: string) =>
		`${lineNumber(value, lineWidth)} ${sign} `;
	const cell = (
		line: InlineDiffLine | undefined,
		side: "old" | "new",
		index: number | undefined,
		width: number,
	): string => {
		if (!line) return " ".repeat(width);
		if (line.type === "sep")
			return padVisible(`${DIM}${line.content}${RESET}`, width);
		const isAdd = line.type === "add";
		const isDel = line.type === "del";
		const active = (side === "old" && !isAdd) || (side === "new" && !isDel);
		if (!active) return " ".repeat(width);
		const sign = isAdd ? "+" : isDel ? "-" : " ";
		const num = side === "old" ? line.oldNum : line.newNum;
		const fg = isAdd ? FG_ADD : isDel ? FG_DEL : FG_DIM;
		const bg = isAdd ? BG_ADD : isDel ? BG_DEL : "";
		const contentWidth = Math.max(1, width - 2);
		const body = `${gutter(num, sign)}${codeTextAt(index!)}`;
		const fitted = fit(`${fg}${body}${RESET}`, contentWidth);
		return bg
			? `${bg} ${reapplyBg(padVisible(fitted, contentWidth), bg)} ${RESET}`
			: ` ${padVisible(fitted, contentWidth)} `;
	};
	const pushPair = (left: string, right: string) => {
		rows.push(`${left}${mid}${right}`);
	};

	for (let i = 0; i < limited.lines.length; i++) {
		const line = limited.lines[i]!;
		if (line.type === "sep") {
			const text = `${DIM}${line.content}${RESET}`;
			pushPair(padVisible(text, half), padVisible(text, rightHalf));
			continue;
		}

	if (line.type === "del") {
		const delStart = i;
		while (i < limited.lines.length && limited.lines[i]?.type === "del") i++;
		const delEnd = i;

		// Only treat the following lines as additions if they are actually "add".
		// Otherwise the next line (usually a context line) would be consumed here
		// and rendered again in the main loop below, causing a duplicate row.
		let addCount = 0;
		let addStart = delEnd;
		if (limited.lines[delEnd]?.type === "add") {
			addStart = i;
			while (i < limited.lines.length && limited.lines[i]?.type === "add") i++;
		}
		const addEnd = i;
		addCount = addEnd - addStart;

		const rowCount = Math.max(delEnd - delStart, addCount);

		for (let row = 0; row < rowCount; row++) {
			const oldIndex = delStart + row;
			const newIdx = addCount > 0 ? addStart + row : undefined;
			pushPair(
				cell(limited.lines[oldIndex], "old", oldIndex, half),
				cell(newIdx !== undefined ? limited.lines[newIdx] : undefined, "new", newIdx, rightHalf),
			);
		}

		i--;
		continue;
	}

		if (line.type === "add") {
			pushPair(" ".repeat(half), cell(line, "new", i, rightHalf));
			continue;
		}

		pushPair(cell(line, "old", i, half), cell(line, "new", i, rightHalf));
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
