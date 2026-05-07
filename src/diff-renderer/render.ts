// Portions adapted from @heyhuynhgiabuu/pi-diff by huynhgiabuu, MIT License.
import { codeToANSI } from "@shikijs/cli";
import * as Diff from "diff";
import type { InlineDiffLine, ParsedInlineDiff, RenderInlineDiffOptions } from "./model.js";

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
const THEME = process.env.DIFF_THEME ?? "github-dark";
const HIGHLIGHT_TIMEOUT_MS = 2_000;

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
  return value === undefined ? " ".repeat(width) : String(value).padStart(width, " ");
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

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error("Shiki highlight timed out")), ms).unref?.();
    }),
  ]);
}

async function highlightLines(code: string, language: string): Promise<string[]> {
  if (!code || code.length > MAX_HL_CHARS) return code.split("\n");
  const key = `${THEME}:${language}:${code.length}:${code}`;
  const cached = highlightCache.get(key);
  if (cached) return cached;
  try {
    const highlighted = await withTimeout(codeToANSI(code, language as any, THEME as any), HIGHLIGHT_TIMEOUT_MS);
    return cacheSet(key, highlighted.replace(/\n$/, "").split("\n"));
  } catch {
    return code.replace(/\n$/, "").split("\n");
  }
}

function changedWordRanges(oldText: string, newText: string): { oldRanges: Array<[number, number]>; newRanges: Array<[number, number]> } {
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

function injectRanges(text: string, ranges: Array<[number, number]>, bg: string): string {
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
    highlighted.set(i, injectRanges(oldLine.content, ranges.oldRanges, BG_DEL_WORD));
    highlighted.set(i + 1, injectRanges(newLine.content, ranges.newRanges, BG_ADD_WORD));
  }
  return highlighted;
}

function limitLines(lines: InlineDiffLine[], maxLines: number): { lines: InlineDiffLine[]; omitted: number } {
  if (lines.length <= maxLines) return { lines, omitted: 0 };
  return { lines: lines.slice(0, maxLines), omitted: lines.length - maxLines };
}

async function renderUnified(diff: ParsedInlineDiff, options: RenderInlineDiffOptions): Promise<string> {
  const limited = limitLines(diff.lines, options.maxLines);
  const lineWidth = Math.max(1, String(Math.max(...diff.lines.map((line) => line.oldNum ?? line.newNum ?? 0), 1)).length);
  const wordHighlights = pairWordHighlights(limited.lines);
  const code = limited.lines.map((line) => line.content).join("\n");
  const highlighted = await highlightLines(code, options.language);
  const rows: string[] = [];

  for (let i = 0; i < limited.lines.length; i++) {
    const line = limited.lines[i]!;
    const prefix = line.type === "add" ? "+" : line.type === "del" ? "-" : " ";
    const fg = line.type === "add" ? FG_ADD : line.type === "del" ? FG_DEL : FG_DIM;
    const bg = line.type === "add" ? BG_ADD : line.type === "del" ? BG_DEL : "";
    const number = lineNumber(line.type === "add" ? line.newNum : line.oldNum, lineWidth);
    const codeText = wordHighlights.get(i) ?? highlighted[i] ?? line.content;
    rows.push(fit(`${bg}${fg}${prefix}${number} │ ${codeText}${RESET}`, options.width));
  }

  if (limited.omitted > 0) rows.push(`${DIM}… ${limited.omitted} more diff lines${RESET}`);
  return rows.join("\n");
}

async function renderSplit(diff: ParsedInlineDiff, options: RenderInlineDiffOptions): Promise<string> {
  if (options.width < 120) return renderUnified(diff, options);
  const half = Math.max(30, Math.floor((options.width - 3) / 2));
  const limited = limitLines(diff.lines, options.maxLines);
  const lineWidth = Math.max(1, String(Math.max(...diff.lines.map((line) => line.oldNum ?? line.newNum ?? 0), 1)).length);
  const wordHighlights = pairWordHighlights(limited.lines);
  const code = limited.lines.map((line) => line.content).join("\n");
  const highlighted = await highlightLines(code, options.language);
  const rows: string[] = [];

  for (let i = 0; i < limited.lines.length; i++) {
    const line = limited.lines[i]!;
    const codeText = wordHighlights.get(i) ?? highlighted[i] ?? line.content;
    const left = line.type === "del"
      ? `${BG_DEL}${FG_DEL}-${lineNumber(line.oldNum, lineWidth)} │ ${codeText}${RESET}`
      : `${DIM} ${lineNumber(line.oldNum, lineWidth)} │ ${line.type === "add" ? "" : codeText}${RESET}`;
    const right = line.type === "add"
      ? `${BG_ADD}${FG_ADD}+${lineNumber(line.newNum, lineWidth)} │ ${codeText}${RESET}`
      : `${DIM} ${lineNumber(line.newNum, lineWidth)} │ ${line.type === "del" ? "" : codeText}${RESET}`;
    rows.push(`${fit(left, half)} │ ${fit(right, half)}`);
  }

  if (limited.omitted > 0) rows.push(`${DIM}… ${limited.omitted} more diff lines${RESET}`);
  return rows.join("\n");
}

export async function renderInlineDiff(diff: ParsedInlineDiff, options: RenderInlineDiffOptions): Promise<string> {
  return renderSplit(diff, options);
}

export async function renderNewFilePreview(content: string, options: RenderInlineDiffOptions): Promise<string> {
  const rawLines = content.split("\n");
  if (rawLines[rawLines.length - 1] === "") rawLines.pop();
  const shown = rawLines.slice(0, options.maxLines);
  const highlighted = await highlightLines(shown.join("\n"), options.language);
  const rows = highlighted.map((line, index) => fit(`${DIM}${String(index + 1).padStart(4, " ")} │${RESET} ${line}`, options.width));
  const omitted = rawLines.length - shown.length;
  if (omitted > 0) rows.push(`${DIM}… ${omitted} more lines${RESET}`);
  return rows.join("\n");
}
