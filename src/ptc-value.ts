import { computeLineHash, escapeControlCharsForDisplay } from "./hashline.js";
import type { DiffData } from "./diff-builder.js";
import type { ContextHygieneMetadata } from "./context-hygiene.js";

export interface PtcLine {
  line: number;
  hash: string;
  anchor: string;
  raw: string;
  display: string;
}

export interface PtcWarningSymbol {
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  parentName?: string;
}
export interface PtcWarning {
  code: string;
  message: string;
  tier?: "camelCase" | "substring";
  symbol?: PtcWarningSymbol;
  otherCandidates?: PtcWarningSymbol[];
}

export interface PtcError {
  code: string;
  message: string;
  hint?: string;
  details?: unknown;
}

export interface PtcRange {
  startLine: number;
  endLine: number;
  totalLines?: number;
}

export interface PtcFileGroup {
  path: string;
  ranges: PtcRange[];
  lines: PtcLine[];
}

export interface SemanticSummary {
  classification: "no-op" | "whitespace-only" | "semantic" | "mixed";
  difftasticAvailable: boolean;
  movedBlocks?: number;
}
export interface PtcEditResult {
  tool: "edit";
  ok: boolean;
  path: string;
  summary: string;
  diff: string;
  diffData?: DiffData;
  firstChangedLine: number | undefined;
  warnings: string[];
  noopEdits: unknown[];
  semanticSummary?: SemanticSummary;
}

export function buildPtcLine(line: number, raw: string): PtcLine {
  const hash = computeLineHash(line, raw);
  return {
    line,
    hash,
    anchor: `${line}:${hash}`,
    raw,
    display: escapeControlCharsForDisplay(raw),
  };
}

export function buildPtcLines(startLine: number, rawLines: string[]): PtcLine[] {
  return rawLines.map((raw, index) => buildPtcLine(startLine + index, raw));
}

export function renderPtcLine(line: PtcLine): string {
  return `${line.anchor}|${line.display}`;
}

export function renderPtcLines(lines: PtcLine[]): string {
  return lines.map(renderPtcLine).join("\n");
}

export function buildPtcWarning(
  code: string,
  message: string,
  metadata: Omit<PtcWarning, "code" | "message"> = {},
): PtcWarning {
  return { code, message, ...metadata };
}

export function buildPtcError(
  code: string,
  message: string,
  hint?: string,
  details?: unknown,
): PtcError {
  return {
    code,
    message,
    ...(hint !== undefined ? { hint } : {}),
    ...(details !== undefined ? { details } : {}),
  };
}

/**
 * Options for `buildToolError` — the deep module that owns the
 * `{ content, isError, details: { ptcValue: { tool, ok: false, ... } } }`
 * error envelope. Call sites supply intent (tool/code/message + optional
 * path, hint, details, ptcValue overlay, contextHygiene); the factory owns
 * the shape.
 *
 * The `ptcValue` overlay is the seam that lets write.ts's `binary-content`
 * and `bare-cr` errors spread an existing result's ptcValue (lines,
 * warnings) into the error envelope without rebuilding the shape inline.
 */
export interface BuildToolErrorOptions<TTool extends string> {
	path?: string;
	hint?: string;
	details?: unknown;
	ptcValue?: Record<string, unknown>;
	contextHygiene?: ContextHygieneMetadata;
}

/**
 * Build the standard tool error envelope. Replaces the 13-line raw shape
 * (`{ content: [...], isError: true, details: { ptcValue: { tool, ok: false, path, error } } }`)
 * that was previously repeated in read/grep/sg/write/edit.
 *
 * The factory narrows `ptcValue.tool` to the literal string passed in
 * (so `buildToolError("read", ...)` returns `ptcValue.tool: "read"`) and
 * pins `ok: false` as part of the error contract. The `ptcValue` overlay
 * (when supplied) is spread into the envelope before the factory-owned
 * `tool` and `ok: false`, so call sites can't accidentally widen the
 * error contract.
 */
export function buildToolError<TTool extends string>(
	tool: TTool,
	code: string,
	message: string,
	opts?: BuildToolErrorOptions<TTool>,
): {
	content: [{ type: "text"; text: string }];
	isError: true;
	details: {
		ptcValue: { tool: TTool; ok: false; path?: string; error: PtcError } & Record<string, unknown>;
		contextHygiene?: ContextHygieneMetadata;
	};
} {
	return {
		content: [{ type: "text" as const, text: message }],
		isError: true as const,
		details: {
			ptcValue: {
				...opts?.ptcValue,
				tool,
				ok: false as const,
				...(opts?.path !== undefined ? { path: opts.path } : {}),
				error: buildPtcError(code, message, opts?.hint, opts?.details),
			},
			...(opts?.contextHygiene ? { contextHygiene: opts.contextHygiene } : {}),
		},
	};
}

export function buildPtcRange(startLine: number, endLine: number, totalLines?: number): PtcRange {
  return totalLines === undefined ? { startLine, endLine } : { startLine, endLine, totalLines };
}

export function buildPtcFileGroup(path: string, ranges: PtcRange[], lines: PtcLine[]): PtcFileGroup {
  return {
    path,
    ranges: ranges.map((range) => ({ ...range })),
    lines: lines.map((line) => ({ ...line })),
  };
}

export function buildPtcEditResult(input: {
  ok?: boolean;
  path: string;
  summary: string;
  diff: string;
  diffData?: DiffData;
  firstChangedLine: number | undefined;
  warnings: string[];
  noopEdits: unknown[];
  semanticSummary?: SemanticSummary;
}): PtcEditResult {
  return {
    tool: "edit",
    ok: input.ok ?? true,
    path: input.path,
    summary: input.summary,
    diff: input.diff,
    ...(input.diffData ? { diffData: input.diffData } : {}),
    firstChangedLine: input.firstChangedLine,
    warnings: [...input.warnings],
    noopEdits: [...input.noopEdits],
    ...(input.semanticSummary ? { semanticSummary: input.semanticSummary } : {}),
  };
}
