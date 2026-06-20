/**
 * Hashline engine — re-export shell.
 *
 * The implementation lives in `src/hashline/`. This file exists so existing
 * imports (`from "../src/hashline.js"`) keep working unchanged.
 *
 * Module map:
 *   core.ts        — xxhash-backed 3-char line hash + display format
 *   refs.ts        — `LINE:HASH` parsing + dst text-shape helpers
 *   shape.ts       — wrap-collapse + echo stripping (line-shape correction)
 *   paste-detect.ts — real-anchor paste detection
 *   apply.ts       — applyHashlineEdits state machine + mismatch formatting
 */
export {
	ensureHashInit,
	computeLineHash,
	escapeControlCharsForDisplay,
	formatHashlineDisplay,
	hashLine,
	hashLines,
} from "./hashline/core.js";

export { parseLineRef } from "./hashline/refs.js";

export { detectPastedRealAnchors, PasteDetectedError } from "./hashline/paste-detect.js";

export { applyHashlineEdits, HashlineMismatchError, type HashlineEditItem } from "./hashline/apply.js";
