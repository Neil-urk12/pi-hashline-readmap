/**
 * Refs — `LINE:HASH` parsing + dst text-shape helpers.
 *
 * Pure: no hash state, no I/O. `parseLineRef` is the public entry point
 * used by edit/pending-diff-preview; the rest are internal helpers that
 * shape destination text before apply.
 */
import { HASHLINE_HASH_LEN, HASHLINE_PREFIX_RE } from "./core.js";

export function parseLineRef(ref: string): { line: number; hash: string; content?: string } {
	const contentMatch = ref.match(/^[^|]*\|(.*)$/);
	const contentAfterPipe = contentMatch ? contentMatch[1] : undefined;
	const cleaned = ref.replace(/\|.*$/, "").replace(/ {2}.*$/, "").trim();
	const normalized = cleaned.replace(/\s*:\s*/, ":");
	const match = normalized.match(new RegExp(`^(\\d+):([0-9a-fA-F]{${HASHLINE_HASH_LEN}})$`));
	if (!match) throw new Error(`Invalid line reference "${ref}". Expected "LINE:HASH" (e.g. "5:abc").`);
	const line = Number.parseInt(match[1], 10);
	if (line < 1) throw new Error(`Line number must be >= 1, got ${line} in "${ref}".`);
	return { line, hash: match[2], content: contentAfterPipe };
}

// ─── DST preprocessing ──────────────────────────────────────────────────

const DIFF_PLUS_RE = /^\+(?!\+)/;
const HASH_ONLY_PREFIX_RE = /^[0-9a-f]{3}\|/;

export function splitDst(dst: string): string[] {
	if (dst === "") return [];
	const normalized = dst.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n$/, "");
	return normalized.split("\n");
}

export function stripNewLinePrefixes(lines: string[]): string[] {
	let hashCount = 0;
	let hashOnlyCount = 0;
	let plusCount = 0;
	let nonEmpty = 0;

	for (const l of lines) {
		if (!l.length) continue;
		nonEmpty++;
		if (HASHLINE_PREFIX_RE.test(l)) hashCount++;
		else if (HASH_ONLY_PREFIX_RE.test(l)) hashOnlyCount++;
		if (DIFF_PLUS_RE.test(l)) plusCount++;
	}

	if (!nonEmpty) return lines;
	const stripHash = hashCount > 0 && hashCount >= nonEmpty * 0.5;
	const stripHashOnly = !stripHash && nonEmpty >= 2 && hashOnlyCount > 0 && hashOnlyCount >= nonEmpty * 0.5;
	const stripPlus = !stripHash && !stripHashOnly && plusCount > 0 && plusCount >= nonEmpty * 0.5;
	if (!stripHash && !stripHashOnly && !stripPlus) return lines;

	return lines.map((l) =>
		stripHash
			? l.replace(HASHLINE_PREFIX_RE, "")
			: stripHashOnly
				? l.replace(HASH_ONLY_PREFIX_RE, "")
				: stripPlus
					? l.replace(DIFF_PLUS_RE, "")
					: l,
	);
}

// ─── Whitespace / format helpers ─────────────────────────────────────────

/** Unicode confusable hyphens (em-dash, en-dash, minus, etc.) — exported for apply's noop-detection. */
export const CONFUSABLE_HYPHENS_RE = /[\u2010\u2011\u2012\u2013\u2014\u2212\uFE63\uFF0D]/g;

export function stripAllWhitespace(s: string): string {
	return s.replace(/\s+/g, "");
}

export function stripTrailingContinuationTokens(s: string): string {
	return s.replace(/(?:&&|\|\||\?\?|\?|:|=|,|\+|-|\*|\/|\.|\()\s*$/u, "");
}

export function stripMergeOperatorChars(s: string): string {
	return s.replace(/[|&?]/g, "");
}

export function normalizeConfusableHyphensInLines(lines: string[]): string[] {
	return lines.map((line) => line.replace(CONFUSABLE_HYPHENS_RE, "-"));
}

export function wsEq(a: string, b: string): boolean {
	return a === b || a.replace(/\s+/g, "") === b.replace(/\s+/g, "");
}

export function restoreIndent(tpl: string, line: string): string {
	if (!line.length) return line;
	const indent = tpl.match(/^\s*/)?.[0] ?? "";
	if (!indent.length || (line.match(/^\s*/)?.[0] ?? "").length > 0) return line;
	return indent + line;
}

export function restoreIndentPaired(old: string[], next: string[]): string[] {
	if (old.length !== next.length) return next;
	let changed = false;
	const out = next.map((line, i) => {
		const restored = restoreIndent(old[i], line);
		if (restored !== line) changed = true;
		return restored;
	});
	return changed ? out : next;
}
