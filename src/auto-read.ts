/**
 * Auto-read after write — appends hashline-anchored output to the result of
 * a successful write tool invocation, so the model has immediate anchors for
 * follow-up edits without a separate `read` call.
 *
 * Mirrors the policy in pi-hashline-edit-pro:
 * - Off by default. Opt in via `PI_HASHLINE_AUTO_READ=1` env var at startup,
 *   or toggle at runtime with the `/toggle-auto-read` slash command.
 * - Output is truncated at `AUTO_READ_MAX_LINES` with a pagination hint so
 *   large files don't blow up the model's context.
 * - All operations are best-effort. Auto-read failures must never block the
 *   underlying write or surface errors to the user.
 */
import { computeLineHash } from "./hashline.js";

/** Maximum lines emitted in an auto-read before truncation kicks in. */
export const AUTO_READ_MAX_LINES = 2000;

let autoReadEnabled =
	process.env.PI_HASHLINE_AUTO_READ === "1" || process.env.PI_HASHLINE_AUTO_READ === "true";

export function isAutoReadEnabled(): boolean {
	return autoReadEnabled;
}

export function setAutoReadEnabled(value: boolean): void {
	autoReadEnabled = value;
}

/** Flip the state and return the new value. */
export function toggleAutoRead(): boolean {
	autoReadEnabled = !autoReadEnabled;
	return autoReadEnabled;
}

/** Test-only: pin the state so env-based init doesn't leak across suites. */
export function __resetAutoReadForTest(value: boolean): void {
	autoReadEnabled = value;
}

export interface AutoReadOutput {
	/** Hashline-anchored lines, ready to append to a tool result. */
	output: string;
	/** Pagination hint when the file exceeded `maxLines`; empty otherwise. */
	paginationHint: string;
}

/**
 * Format the auto-read output for the given file content. Returns null when
 * the content is empty (no point emitting anchors for an empty file).
 *
 * The hashline format is the project's standard `LINE:HASH|content` shape so
 * the model can use the anchors for a follow-up edit without re-reading.
 */
export function formatAutoReadOutput(content: string, maxLines: number): AutoReadOutput | null {
	// Normalize CRLF to LF before splitting so we don't hash lines that carry
	// a trailing \r. This matches the project's convention for read/edit.
	const normalized = content.replace(/\r\n/g, "\n");
	const allLines = normalized.split("\n");
	// An all-empty split (e.g. "\n\n\n") yields ["", "", "", ""]. Treat that
	// the same as an empty file — nothing meaningful to anchor.
	const visibleLines = allLines.filter((line) => line !== "");
	if (visibleLines.length === 0) return null;

	const truncated = visibleLines.length > maxLines;
	const displayLines = truncated ? visibleLines.slice(0, maxLines) : visibleLines;
	const output = displayLines.map((line, i) => `${i + 1}:${computeHash(line, i + 1)}|${line}`).join("\n");

	const paginationHint = truncated
		? `\n\n[Showing lines 1-${maxLines} of ${visibleLines.length}. Use offset=${maxLines + 1} to continue.]`
		: "";

	return { output, paginationHint };
}

/**
 * Local hash function — uses the project's hashLine so the anchors match what
 * the read tool emits. We keep this isolated from hashLines() so we can pass
 * each line individually without the full-document re-split that hashLines
 * does internally (we already have the split array).
 */
function computeHash(line: string, lineNumber: number): string {
	return computeLineHash(lineNumber, line);
}
