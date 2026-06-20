/**
 * Hashline apply engine — the state machine that turns a list of
 * `HashlineEditItem`s into a new file body.
 *
 * Pipeline phases (private to the module):
 *   1. parse each edit into a `ParsedEdit` (refs + dst text-shape)
 *   2. validate hashes against the live file (with ±N relocation + fuzzy
 *      content recovery when the anchor is stale)
 *   3. detect pasted real anchors (delegates to paste-detect)
 *   4. deduplicate identical edits; warn on conflicting same-target edits
 *   5. sort bottom-up for stable splice
 *   6. apply each edit (single / range / insert-after), running shape
 *      recovery and noop detection
 *
 * Throws `HashlineMismatchError` if any anchor cannot be relocated; throws
 * `PasteDetectedError` if `new_text` contains a real-anchor paste.
 */
import { throwIfAborted } from "../runtime.js";
import { buildPtcLine, type PtcLine } from "../ptc-value.js";
import { computeLineHash, escapeControlCharsForDisplay, HASHLINE_HASH_LEN } from "./core.js";
import {
	CONFUSABLE_HYPHENS_RE,
	normalizeConfusableHyphensInLines,
	parseLineRef,
	restoreIndentPaired,
	splitDst,
	stripAllWhitespace,
	stripMergeOperatorChars,
	stripNewLinePrefixes,
	stripTrailingContinuationTokens,
} from "./refs.js";
import { detectPastedRealAnchors, PasteDetectedError } from "./paste-detect.js";
import { restoreOldWrappedLines, stripInsertAnchorEcho, stripRangeBoundaryEcho } from "./shape.js";

export type HashlineEditItem =
	| { set_line: { anchor: string; new_text: string } }
	| { replace_lines: { start_anchor: string; end_anchor: string; new_text: string } }
	| { insert_after: { anchor: string; new_text: string; text?: string } }
	| { replace: { old_text: string; new_text: string; all?: boolean } };

interface HashMismatch {
	line: number;
	expected: string;
	actual: string;
	expectedContent?: string;
}

export class HashlineMismatchError extends Error {
	readonly updatedAnchors: PtcLine[];

	constructor(message: string, updatedAnchors: PtcLine[]) {
		super(message);
		this.name = "HashlineMismatchError";
		this.updatedAnchors = updatedAnchors;
	}
}

type ParsedRef = { line: number; hash: string; content?: string };

type ParsedSpec =
	| { kind: "single"; ref: ParsedRef }
	| { kind: "range"; start: ParsedRef; end: ParsedRef }
	| { kind: "insertAfter"; after: ParsedRef };

interface ParsedEdit {
	spec: ParsedSpec;
	dstLines: string[];
}

interface NoopEdit {
	editIndex: number;
	loc: string;
	currentContent: string;
}

const HASH_RELOCATION_WINDOW_BASE = 20;
const HASH_RELOCATION_WINDOW_CAP = 100;

// ─── Edit parser ────────────────────────────────────────────────────────

function parseHashlineEditItem(edit: HashlineEditItem): ParsedEdit {
	if ("set_line" in edit) {
		return {
			spec: { kind: "single", ref: parseLineRef(edit.set_line.anchor) },
			dstLines: stripNewLinePrefixes(splitDst(edit.set_line.new_text)),
		};
	}
	if ("replace_lines" in edit) {
		const start = parseLineRef(edit.replace_lines.start_anchor);
		const end = parseLineRef(edit.replace_lines.end_anchor);
		return {
			spec: start.line === end.line ? { kind: "single", ref: start } : { kind: "range", start, end },
			dstLines: stripNewLinePrefixes(splitDst(edit.replace_lines.new_text)),
		};
	}
	if ("insert_after" in edit) {
		return {
			spec: { kind: "insertAfter", after: parseLineRef(edit.insert_after.anchor) },
			dstLines: stripNewLinePrefixes(splitDst(edit.insert_after.new_text ?? edit.insert_after.text ?? "")),
		};
	}
	throw new Error("replace edits are applied separately");
}

// ─── Mismatch formatting ────────────────────────────────────────────────

function tokenSimilarity(a: string, b: string): number {
	const tokA = new Set(a.trim().split(/\s+/));
	const tokB = new Set(b.trim().split(/\s+/));
	if (tokA.size === 0 && tokB.size === 0) return 1;
	if (tokA.size === 0 || tokB.size === 0) return 0;
	let overlap = 0;
	for (const t of tokA) {
		if (tokB.has(t)) overlap++;
	}
	return overlap / Math.max(tokA.size, tokB.size);
}

function findSimilarLines(
	expectedContent: string,
	fileLines: string[],
	hintLine: number,
	maxSuggestions: number = 3,
): string[] {
	const SCAN_WINDOW = 50;
	const MIN_SIMILARITY = 0.3;
	const start = Math.max(0, hintLine - 1 - SCAN_WINDOW);
	const end = Math.min(fileLines.length, hintLine - 1 + SCAN_WINDOW + 1);
	const candidates: { line: number; score: number; content: string }[] = [];

	for (let i = start; i < end; i++) {
		const content = fileLines[i];
		if (!content.trim()) continue;
		const score = tokenSimilarity(expectedContent, content);
		if (score >= MIN_SIMILARITY) {
			candidates.push({ line: i + 1, score, content });
		}
	}

	candidates.sort((a, b) => b.score - a.score);
	return candidates.slice(0, maxSuggestions).map((c) => {
		const hash = computeLineHash(c.line, c.content);
		return `  ${c.line}:${hash}|${escapeControlCharsForDisplay(c.content)}`;
	});
}

function formatMismatchError(
	mismatches: HashMismatch[],
	fileLines: string[],
	relocationWindow: number,
): { message: string; updatedAnchors: PtcLine[] } {
	const mismatchSet = new Map<number, HashMismatch>();
	for (const m of mismatches) mismatchSet.set(m.line, m);
	const updatedAnchors: PtcLine[] = mismatches.map((m) => {
		const raw = fileLines[m.line - 1] ?? "";
		const hash = computeLineHash(m.line, raw);
		return {
			line: m.line,
			hash,
			anchor: `${m.line}:${hash}`,
			raw,
			display: escapeControlCharsForDisplay(raw),
		};
	});
	const displayLines = new Set<number>();
	for (const m of mismatches) {
		for (let i = Math.max(1, m.line - 2); i <= Math.min(fileLines.length, m.line + 2); i++) {
			displayLines.add(i);
		}
	}
	const sorted = [...displayLines].sort((a, b) => a - b);
	const out: string[] = [
		"Edit rejected — nothing was written. The anchor hash did not match the current file content.",
		`${mismatches.length} line${mismatches.length > 1 ? "s have" : " has"} changed since last read. Auto-relocation checks only within ±${relocationWindow} lines of each anchor. Use the updated LINE:HASH references shown below (>>> marks changed lines).`,
		"",
	];
	let prev = -1;
	for (const num of sorted) {
		if (prev !== -1 && num > prev + 1) out.push("    ...");
		prev = num;
		const content = fileLines[num - 1];
		const hash = computeLineHash(num, content);
		const prefix = `${num}:${hash}`;
		out.push(
			mismatchSet.has(num)
				? `>>> ${prefix}|${escapeControlCharsForDisplay(content)}`
				: `    ${prefix}|${escapeControlCharsForDisplay(content)}`,
		);
	}
	const withContent = mismatches.filter((m) => m.expectedContent !== undefined);
	if (withContent.length > 0) {
		for (const m of withContent) {
			const suggestions = findSimilarLines(m.expectedContent!, fileLines, m.line);
			if (suggestions.length > 0) {
				out.push("");
				out.push("Did you mean one of these nearby lines?");
				out.push(...suggestions);
			}
		}
	}

	return { message: out.join("\n"), updatedAnchors };
}

// ─── Main edit engine ───────────────────────────────────────────────────

export function applyHashlineEdits(
	content: string,
	edits: HashlineEditItem[],
	signal?: AbortSignal,
): { content: string; firstChangedLine: number | undefined; warnings?: string[]; noopEdits?: NoopEdit[] } {
	throwIfAborted(signal);
	if (!edits.length) return { content, firstChangedLine: undefined };

	// Compute adaptive relocation window based on edit batch size
	const relocationWindow = Math.min(Math.max(HASH_RELOCATION_WINDOW_BASE, edits.length * 5), HASH_RELOCATION_WINDOW_CAP);

	const fileLines = content.split("\n");
	const origLines = [...fileLines];
	let firstChanged: number | undefined;
	const noopEdits: NoopEdit[] = [];

	const parsed: (ParsedEdit & { idx: number })[] = edits.map((edit, idx) => ({
		...parseHashlineEditItem(edit),
		idx,
	}));

	function collectExplicitlyTouchedLines(): Set<number> {
		const touched = new Set<number>();
		for (const { spec } of parsed) {
			if (spec.kind === "single") touched.add(spec.ref.line);
			else if (spec.kind === "insertAfter") touched.add(spec.after.line);
			else for (let line = spec.start.line; line <= spec.end.line; line++) touched.add(line);
		}
		return touched;
	}
	let explicitlyTouchedLines = collectExplicitlyTouchedLines();

	// Build hash index for local-window relocation
	const lineHashes: string[] = [];
	const hashToLines = new Map<string, number[]>();
	for (let i = 0; i < fileLines.length; i++) {
		throwIfAborted(signal);
		const lineNumber = i + 1;
		const h = computeLineHash(lineNumber, fileLines[i]);
		lineHashes.push(h);
		const lines = hashToLines.get(h);
		if (lines) lines.push(lineNumber);
		else hashToLines.set(h, [lineNumber]);
	}

	const relocationNotes = new Set<string>();

	function findRelocationLine(expectedHash: string, hintLine: number, relocationWindow: number): number | undefined {
		const candidates = hashToLines.get(expectedHash);
		if (!candidates?.length) return undefined;

		const minLine = Math.max(1, hintLine - relocationWindow);
		const maxLine = Math.min(fileLines.length, hintLine + relocationWindow);
		let match: number | undefined;
		for (const candidate of candidates) {
			if (candidate < minLine || candidate > maxLine) continue;
			if (match !== undefined) return undefined; // ambiguous within window
			match = candidate;
		}
		return match;
	}

	// Validate all refs before mutation
	const mismatches: HashMismatch[] = [];

	function validate(ref: ParsedRef): boolean {
		if (ref.line < 1 || ref.line > fileLines.length)
			throw new Error(`Line ${ref.line} does not exist (file has ${fileLines.length} lines)`);
		const expected = ref.hash.toLowerCase();
		const originalLine = ref.line;
		const actual = lineHashes[originalLine - 1];
		if (actual === expected) return true;
		const relocated = findRelocationLine(expected, originalLine, relocationWindow);
		if (relocated !== undefined) {
			ref.line = relocated;
			relocationNotes.add(
				`Auto-relocated anchor ${originalLine}:${ref.hash} -> ${relocated}:${ref.hash} (window ±${relocationWindow}).`,
			);
			return true;
		}
		// Fuzzy content-based recovery: if anchor includes content after pipe,
		// look for a nearby line with high token similarity
		if (ref.content) {
			const FUZZY_THRESHOLD = 0.8;
			const FUZZY_SCAN = 50;
			const scanStart = Math.max(0, originalLine - 1 - FUZZY_SCAN);
			const scanEnd = Math.min(fileLines.length, originalLine - 1 + FUZZY_SCAN + 1);
			const fuzzyHits: { line: number; score: number }[] = [];
			for (let i = scanStart; i < scanEnd; i++) {
				const lineContent = fileLines[i];
				if (!lineContent.trim()) continue;
				const score = tokenSimilarity(ref.content, lineContent);
				if (score > FUZZY_THRESHOLD) {
					fuzzyHits.push({ line: i + 1, score });
				}
			}
			if (fuzzyHits.length === 1) {
				const hit = fuzzyHits[0];
				const newHash = computeLineHash(hit.line, fileLines[hit.line - 1]);
				ref.line = hit.line;
				ref.hash = newHash;
				relocationNotes.add(
					`Fuzzy-relocated anchor ${originalLine}:${expected} → ${hit.line}:${newHash} (similarity: ${hit.score.toFixed(2)})`,
				);
				return true;
			}
		}
		mismatches.push({ line: originalLine, expected: ref.hash, actual, expectedContent: ref.content });
		return false;
	}

	for (const { spec } of parsed) {
		throwIfAborted(signal);
		if (spec.kind === "single") {
			validate(spec.ref);
		} else if (spec.kind === "insertAfter") {
			validate(spec.after);
		} else {
			// Range: validate start > end before relocation
			if (spec.start.line > spec.end.line) {
				throw new Error(`Range start line ${spec.start.line} must be <= end line ${spec.end.line}`);
			}

			const originalStart = spec.start.line;
			const originalEnd = spec.end.line;
			const originalCount = originalEnd - originalStart + 1;

			const startOk = validate(spec.start);
			const endOk = validate(spec.end);

			// If both validated but relocation invalidated the range, revert and report mismatch
			if (startOk && endOk) {
				const relocatedCount = spec.end.line - spec.start.line + 1;
				const invalidRange = spec.start.line > spec.end.line;
				const scopeChanged = relocatedCount !== originalCount;
				if (invalidRange || scopeChanged) {
					spec.start.line = originalStart;
					spec.end.line = originalEnd;
					mismatches.push(
						{ line: originalStart, expected: spec.start.hash, actual: lineHashes[originalStart - 1] },
						{ line: originalEnd, expected: spec.end.hash, actual: lineHashes[originalEnd - 1] },
					);
				}
			}
		}
	}
	if (mismatches.length) {
		const formatted = formatMismatchError(mismatches, fileLines, relocationWindow);
		throw new HashlineMismatchError(formatted.message, formatted.updatedAnchors);
	}

	// Recompute after potential relocation
	explicitlyTouchedLines = collectExplicitlyTouchedLines();

	// Detect pasted real anchors in new_text — the model may have
	// accidentally pasted read output (with anchors) into new_text, which
	// stripNewLinePrefixes would otherwise silently turn into cross-line
	// content corruption or anchor-line duplication. Run after validation
	// so stale anchors on the edit itself have already been rejected.
	const offendingByLine = new Map<number, { line: number; hash: string }>();
	for (let i = 0; i < parsed.length; i++) {
		const edit = parsed[i];
		const rawEdit = edits[i];
		let rawNewText: string;
		let editAnchorLine: number | undefined;
		let editKind: "set_line" | "replace_lines" | "insert_after" | "replace";
		let replaceLinesEndAnchorLine: number | undefined;
		if ("set_line" in rawEdit) {
			rawNewText = rawEdit.set_line.new_text;
			editAnchorLine = edit.spec.kind === "single" ? edit.spec.ref.line : undefined;
			editKind = "set_line";
		} else if ("replace_lines" in rawEdit) {
			rawNewText = rawEdit.replace_lines.new_text;
			editKind = "replace_lines";
			if (edit.spec.kind === "range") {
				editAnchorLine = edit.spec.start.line;
				replaceLinesEndAnchorLine = edit.spec.end.line;
			}
		} else if ("insert_after" in rawEdit) {
			rawNewText = rawEdit.insert_after.new_text ?? rawEdit.insert_after.text ?? "";
			editAnchorLine = edit.spec.kind === "insertAfter" ? edit.spec.after.line : undefined;
			editKind = "insert_after";
		} else {
			continue; // legacy replace dialect — not subject to paste detection
		}
		const rawLines = splitDst(rawNewText);
		const detected = detectPastedRealAnchors(rawLines, fileLines);
		if (detected.length === 0) continue;
		// Filter: for insert_after with multi-line new_text, the first line
		// being a self-paste is handled by stripInsertAnchorEcho. Skip it.
		const filterFirst =
			editKind === "insert_after" && rawLines.length > 1 ? rawLines[0] : undefined;
		for (const d of detected) {
			// Filter: insert_after with multi-line new_text where the
			// offending line is the first line and matches the edit's
			// anchor is handled by stripInsertAnchorEcho. Skip it.
			if (filterFirst !== undefined) {
				const m = filterFirst.match(
					new RegExp(`^(\\d+):([0-9a-fA-F]{${HASHLINE_HASH_LEN}})\\|`),
				);
				if (m && Number.parseInt(m[1], 10) === d.line && d.line === editAnchorLine) {
					continue;
				}
			}
			// Filter: set_line/replace_lines with a self-paste is handled
			// by noop detection. For replace_lines, both the start and
			// end anchors are part of the edit — both lines should be
			// allowed to fall through to noop detection.
			let selfPasteAllowed = false;
			if (editKind === "set_line" && d.line === editAnchorLine) {
				selfPasteAllowed = true;
			} else if (editKind === "replace_lines") {
				if (
					d.line === editAnchorLine ||
					d.line === replaceLinesEndAnchorLine
				) {
					selfPasteAllowed = true;
				}
			}
			if (selfPasteAllowed) {
				continue;
			}
			offendingByLine.set(d.line, d);
		}
	}
	if (offendingByLine.size > 0) {
		const offendingLines: PtcLine[] = [];
		for (const d of offendingByLine.values()) {
			const raw = fileLines[d.line - 1] ?? "";
			offendingLines.push(buildPtcLine(d.line, raw));
		}
		const out: string[] = [
			"Edit rejected — nothing was written. new_text contains a LINE:HASH| prefix that matches a real anchor in the current file. This usually means read output was accidentally pasted into new_text instead of the bare content.",
			`${offendingLines.length} offending line${offendingLines.length > 1 ? "s" : ""}:`,
			"",
		];
		for (const line of offendingLines) {
			out.push(`>>> ${line.anchor}|${escapeControlCharsForDisplay(line.raw)}`);
		}
		out.push("");
		out.push(
			"Re-read the file and pass only the content after the `|` separator for these lines (no `LINE:HASH|` prefix).",
		);
		throw new PasteDetectedError(out.join("\n"), offendingLines);
	}

	// Detect conflicting duplicate single-target edits and deduplicate identical edits.
	// For single-target edits, keep the last identical occurrence so resolution remains last-wins.
	const duplicateTargetWarnings: string[] = [];
	const warnedSingleTargets = new Set<string>();
	const seenSingleTargets = new Map<string, string>();
	const seenSingleEditByKey = new Map<string, number>();
	const seenNonSingleEditByKey = new Map<string, number>();
	const dupes = new Set<number>();
	for (let i = 0; i < parsed.length; i++) {
		throwIfAborted(signal);
		const p = parsed[i];
		const lk =
			p.spec.kind === "single"
				? `s:${p.spec.ref.line}`
				: p.spec.kind === "range"
					? `r:${p.spec.start.line}:${p.spec.end.line}`
					: `i:${p.spec.after.line}`;
		const dstKey = p.dstLines.join("\n");
		const key = `${lk}|${dstKey}`;
		if (p.spec.kind === "single") {
			const previousIdx = seenSingleEditByKey.get(key);
			if (previousIdx !== undefined) dupes.add(previousIdx);
			seenSingleEditByKey.set(key, i);
			const previousDstKey = seenSingleTargets.get(lk);
			if (previousDstKey !== undefined && previousDstKey !== dstKey && !warnedSingleTargets.has(lk)) {
				duplicateTargetWarnings.push(
					`Warning: multiple edits target the same anchor ${p.spec.ref.line}:${p.spec.ref.hash} — only the last will apply`,
				);
				warnedSingleTargets.add(lk);
			}
			seenSingleTargets.set(lk, dstKey);
			continue;
		}
		if (seenNonSingleEditByKey.has(key)) {
			dupes.add(i);
		} else {
			seenNonSingleEditByKey.set(key, i);
		}
	}
	const deduped = parsed.filter((_, i) => !dupes.has(i));

	// Sort bottom-up for stable splice
	const sorted = deduped
		.map((p) => {
			const sl = p.spec.kind === "single" ? p.spec.ref.line : p.spec.kind === "range" ? p.spec.end.line : p.spec.after.line;
			const pr = p.spec.kind === "insertAfter" ? 1 : 0;
			return { ...p, sl, pr };
		})
		.sort((a, b) => b.sl - a.sl || a.pr - b.pr || a.idx - b.idx);

	function track(line: number) {
		if (firstChanged === undefined || line < firstChanged) firstChanged = line;
	}

	function maybeExpandSingleLineMerge(
		line: number,
		dst: string[],
	): { startLine: number; deleteCount: number; newLines: string[] } | null {
		if (dst.length !== 1) return null;
		if (line < 1 || line > fileLines.length) return null;

		const newLine = dst[0];
		const newCanon = stripAllWhitespace(newLine);
		const newCanonForMergeOps = stripMergeOperatorChars(newCanon);
		if (!newCanon.length) return null;

		const orig = fileLines[line - 1];
		const origCanon = stripAllWhitespace(orig);
		const origCanonForMatch = stripTrailingContinuationTokens(origCanon);
		const origCanonForMergeOps = stripMergeOperatorChars(origCanon);
		const origLooksLikeContinuation = origCanonForMatch.length < origCanon.length;
		if (!origCanon.length) return null;

		const nextIdx = line;
		const prevIdx = line - 2;

		// Case A: dst absorbed the next continuation line
		if (origLooksLikeContinuation && nextIdx < fileLines.length && !explicitlyTouchedLines.has(line + 1)) {
			const next = fileLines[nextIdx];
			const nextCanon = stripAllWhitespace(next);
			const a = newCanon.indexOf(origCanonForMatch);
			const b = newCanon.indexOf(nextCanon);
			if (a !== -1 && b !== -1 && a < b && newCanon.length <= origCanon.length + nextCanon.length + 32) {
				return { startLine: line, deleteCount: 2, newLines: [newLine] };
			}
		}

		// Case B: dst absorbed the previous continuation line
		if (prevIdx >= 0 && !explicitlyTouchedLines.has(line - 1)) {
			const prev = fileLines[prevIdx];
			const prevCanon = stripAllWhitespace(prev);
			const prevCanonForMatch = stripTrailingContinuationTokens(prevCanon);
			const prevLooksLikeContinuation = prevCanonForMatch.length < prevCanon.length;
			if (!prevLooksLikeContinuation) return null;
			const a = newCanonForMergeOps.indexOf(stripMergeOperatorChars(prevCanonForMatch));
			const b = newCanonForMergeOps.indexOf(origCanonForMergeOps);
			if (a !== -1 && b !== -1 && a < b && newCanon.length <= prevCanon.length + origCanon.length + 32) {
				return { startLine: line - 1, deleteCount: 2, newLines: [newLine] };
			}
		}

		return null;
	}

	// Apply edits bottom-up
	for (const { spec, dstLines, idx } of sorted) {
		throwIfAborted(signal);
		if (spec.kind === "single") {
			const merged = maybeExpandSingleLineMerge(spec.ref.line, dstLines);
			if (merged) {
				const orig = origLines.slice(merged.startLine - 1, merged.startLine - 1 + merged.deleteCount);
				let newL = restoreIndentPaired([orig[0] ?? ""], merged.newLines);
				if (orig.join("\n") === newL.join("\n") && orig.some((line) => CONFUSABLE_HYPHENS_RE.test(line))) {
					newL = normalizeConfusableHyphensInLines(newL);
				}
				if (orig.join("\n") === newL.join("\n")) {
					noopEdits.push({ editIndex: idx, loc: `${spec.ref.line}:${spec.ref.hash}`, currentContent: orig.join("\n") });
					continue;
				}
				fileLines.splice(merged.startLine - 1, merged.deleteCount, ...newL);
				track(merged.startLine);
				continue;
			}

			const orig = origLines.slice(spec.ref.line - 1, spec.ref.line);
			let stripped = stripRangeBoundaryEcho(origLines, spec.ref.line, spec.ref.line, dstLines);
			stripped = restoreOldWrappedLines(orig, stripped);
			let newL = restoreIndentPaired(orig, stripped);
			if (orig.join("\n") === newL.join("\n") && orig.some((line) => CONFUSABLE_HYPHENS_RE.test(line))) {
				newL = normalizeConfusableHyphensInLines(newL);
			}
			if (orig.length === newL.length && orig.join("\n") === newL.join("\n")) {
				noopEdits.push({ editIndex: idx, loc: `${spec.ref.line}:${spec.ref.hash}`, currentContent: orig.join("\n") });
				continue;
			}
			fileLines.splice(spec.ref.line - 1, 1, ...newL);
			track(spec.ref.line);
		} else if (spec.kind === "range") {
			const count = spec.end.line - spec.start.line + 1;
			const orig = origLines.slice(spec.start.line - 1, spec.start.line - 1 + count);
			let stripped = stripRangeBoundaryEcho(origLines, spec.start.line, spec.end.line, dstLines);
			stripped = restoreOldWrappedLines(orig, stripped);
			let newL = restoreIndentPaired(orig, stripped);
			if (orig.join("\n") === newL.join("\n") && orig.some((line) => CONFUSABLE_HYPHENS_RE.test(line))) {
				newL = normalizeConfusableHyphensInLines(newL);
			}
			if (orig.length === newL.length && orig.join("\n") === newL.join("\n")) {
				noopEdits.push({ editIndex: idx, loc: `${spec.start.line}:${spec.start.hash}`, currentContent: orig.join("\n") });
				continue;
			}
			fileLines.splice(spec.start.line - 1, count, ...newL);
			track(spec.start.line);
		} else {
			const anchor = origLines[spec.after.line - 1];
			const inserted = stripInsertAnchorEcho(anchor, dstLines);
			if (!inserted.length) {
				noopEdits.push({ editIndex: idx, loc: `${spec.after.line}:${spec.after.hash}`, currentContent: anchor });
				continue;
			}
			if (content === "" && spec.after.line === 1 && anchor === "") {
				fileLines.splice(0, 1, ...inserted);
				track(1);
				continue;
			}
			fileLines.splice(spec.after.line, 0, ...inserted);
			track(spec.after.line + 1);
		}
	}

	const warnings: string[] = [...relocationNotes, ...duplicateTargetWarnings];
	let diff = Math.abs(fileLines.length - origLines.length);
	for (let i = 0; i < Math.min(fileLines.length, origLines.length); i++) {
		if (fileLines[i] !== origLines[i]) diff++;
	}
	if (diff > edits.length * 4) {
		warnings.push(`Edit changed ${diff} lines across ${edits.length} operations — verify no unintended reformatting.`);
	}

	return {
		content: fileLines.join("\n"),
		firstChangedLine: firstChanged,
		...(warnings.length ? { warnings } : {}),
		...(noopEdits.length ? { noopEdits } : {}),
	};
}
