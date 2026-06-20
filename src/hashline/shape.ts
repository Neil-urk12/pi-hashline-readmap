/**
 * Hashline line-shape correction — pure helpers that normalize model output
 * to match the original line shape when the model accidentally wrapped,
 * merged, or echoed adjacent lines.
 *
 * Three concerns: collapse wrap-runs back to a single line
 * (`restoreOldWrappedLines`), strip an anchor-line echo from the start of
 * `insert_after` dst (`stripInsertAnchorEcho`), and strip range-boundary
 * echoes from start/end of dst (`stripRangeBoundaryEcho`).
 *
 * Consumed by `apply.ts`. No state, no I/O.
 */
import { stripAllWhitespace, wsEq } from "./refs.js";

/**
 * When a model splits a single original line into multiple lines (e.g. wrapping
 * a long expression), detect this and restore the original single-line form.
 * Ported from oh-my-pi.
 */
export function restoreOldWrappedLines(oldLines: string[], newLines: string[]): string[] {
	if (oldLines.length === 0 || newLines.length < 2) return newLines;

	const canonToOld = new Map<string, { line: string; count: number }>();
	for (const line of oldLines) {
		const canon = stripAllWhitespace(line);
		const bucket = canonToOld.get(canon);
		if (bucket) bucket.count++;
		else canonToOld.set(canon, { line, count: 1 });
	}
	const candidates: { start: number; len: number; replacement: string; canon: string }[] = [];
	for (let start = 0; start < newLines.length; start++) {
		for (let len = 2; len <= 10 && start + len <= newLines.length; len++) {
			const span = newLines.slice(start, start + len);
			if (span.some((line) => line.trim().length === 0)) continue;
			const canonSpan = stripAllWhitespace(span.join(""));
			const old = canonToOld.get(canonSpan);
			if (old && old.count === 1 && canonSpan.length >= 6) {
				candidates.push({ start, len, replacement: old.line, canon: canonSpan });
			}
		}
	}
	if (candidates.length === 0) return newLines;
	const canonCounts = new Map<string, number>();
	for (const c of candidates) {
		canonCounts.set(c.canon, (canonCounts.get(c.canon) ?? 0) + 1);
	}
	const uniqueCandidates = candidates.filter((c) => (canonCounts.get(c.canon) ?? 0) === 1);
	if (uniqueCandidates.length === 0) return newLines;
	uniqueCandidates.sort((a, b) => b.start - a.start);
	const out = [...newLines];
	for (const c of uniqueCandidates) {
		out.splice(c.start, c.len, c.replacement);
	}
	return out;
}

export function stripInsertAnchorEcho(anchorLine: string, dst: string[]): string[] {
	if (dst.length > 1 && wsEq(dst[0], anchorLine)) return dst.slice(1);
	return dst;
}

export function stripRangeBoundaryEcho(fileLines: string[], start: number, end: number, dst: string[]): string[] {
	const count = end - start + 1;
	if (dst.length <= 1 || dst.length <= count) return dst;
	let out = dst;
	if (start - 2 >= 0 && wsEq(out[0], fileLines[start - 2])) out = out.slice(1);
	if (end < fileLines.length && out.length > 0 && wsEq(out[out.length - 1], fileLines[end])) out = out.slice(0, -1);
	return out;
}
