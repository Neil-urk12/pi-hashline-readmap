/**
 * Hashline paste detection — pre-apply validation that catches when a model
 * pastes read output (with `LINE:HASH|` anchors) back into `new_text`.
 *
 * Called by `edit.ts` *before* `applyHashlineEdits` runs. Throws
 * `PasteDetectedError` with the offending line numbers so the caller can
 * surface them in the PTC error envelope.
 */
import { computeLineHash, HASHLINE_HASH_LEN, HASHLINE_PREFIX_RE } from "./core.js";
import type { PtcLine } from "../ptc-value.js";

/**
 * Detect lines in `dstLines` whose `LINE:HASH|` prefix matches a real
 * file-line anchor in `fileLines`. Used to catch the case where a model
 * pastes read output (with anchors) into `new_text`, which the silent
 * prefix-strip in `stripNewLinePrefixes` would otherwise turn into
 * cross-line content corruption or anchor-line duplication.
 *
 * Returns the set of offending line numbers. An empty result means no
 * real-anchor paste was detected. The check is per-line: a single
 * offending line in the dstLines is enough to reject the edit.
 */
export function detectPastedRealAnchors(
	dstLines: readonly string[],
	fileLines: readonly string[],
): { line: number; hash: string }[] {
	const offending: { line: number; hash: string }[] = [];
	// Real anchors are exactly HASHLINE_HASH_LEN hex chars; use a stricter capture
	// than HASHLINE_PREFIX_RE so a benign prefix like "5:longer|content"
	// (where "longer" isn't a real hash) is not flagged.
	const capture = new RegExp(`^(\\d+):([0-9a-fA-F]{${HASHLINE_HASH_LEN}})\\|`);
	for (const line of dstLines) {
		if (!HASHLINE_PREFIX_RE.test(line)) continue;
		const match = line.match(capture);
		if (!match) continue;
		const n = Number.parseInt(match[1], 10);
		const h = match[2].toLowerCase();
		if (n < 1 || n > fileLines.length) continue;
		const actual = computeLineHash(n, fileLines[n - 1]);
		if (actual === h) {
			offending.push({ line: n, hash: h });
		}
	}
	return offending;
}

export class PasteDetectedError extends Error {
	readonly offendingLines: PtcLine[];

	constructor(message: string, offendingLines: PtcLine[]) {
		super(message);
		this.name = "PasteDetectedError";
		this.offendingLines = offendingLines;
	}
}
