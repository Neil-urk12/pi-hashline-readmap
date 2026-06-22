import { describe, expect, it, beforeAll } from "vitest";
import {
	buildAllDiffs,
	MAX_INLINE_DIFF_CONTENT_CHARS,
	MAX_INLINE_DIFF_LINE_LENGTH,
	MAX_INLINE_DIFF_PAIRS,
	MAX_INLINE_DIFF_TOKENS,
	summarizeDiffCounts,
} from "../src/diff-builder.js";
import { ensureHashInit } from "../src/hashline.js";

function countByKind(entries: Array<{ kind: string }>, kind: string): number {
	return entries.filter((entry) => entry.kind === kind).length;
}

function joinSpans(spans: Array<{ text: string }>): string {
	return spans.map((span) => span.text).join("");
}

describe("DiffBuilder.buildAllDiffs", () => {
	beforeAll(async () => {
		await ensureHashInit();
	});

	// ─── Identity / no-change ──────────────────────────────────────────────

	it("returns empty diff + no-change inlineDiff when old === new", () => {
		const r = buildAllDiffs("a\nb\nc\n", "a\nb\nc\n", "x.ts");
		expect(r.diff).toBe("");
		expect(r.firstChangedLine).toBeUndefined();
		expect(r.diffData.entries).toEqual([]);
		expect(r.diffData.stats).toEqual({ added: 0, removed: 0, context: 0 });
		expect(r.inlineDiff).toEqual({ kind: "no-change", path: "x.ts" });
		expect(r.summary).toBe("+0 -0");
	});

	// ─── Compact short-circuit (single-line replacement) ──────────────────

	it("emits compact format for single-line replacement and builds entries from line arrays directly", () => {
		const oldContent = "line one\nline two\nline three";
		const newContent = "line one\nline TWO\nline three";
		const r = buildAllDiffs(oldContent, newContent, "sample.ts");

		expect(r.diff).toMatch(/^2:[0-9a-f]{3}\|line two → 2:[0-9a-f]{3}\|line TWO$/);
		expect(r.firstChangedLine).toBe(2);
		expect(r.diffData.entries).toEqual([
			{ kind: "remove", oldLine: 2, text: "line two" },
			{ kind: "add", newLine: 2, text: "line TWO" },
		]);
		expect(r.diffData.stats).toEqual({ added: 1, removed: 1, context: 0 });
	});

	it("escapes '→' inside the new line text in the compact format", () => {
		const oldContent = "line one\nconst text = 'old';\nline three";
		const newContent = "line one\nconst text = 'new → 2:def|not a separator';\nline three";
		const r = buildAllDiffs(oldContent, newContent, "sample.ts");

		expect(r.diffData.entries).toEqual([
			{ kind: "remove", oldLine: 2, text: "const text = 'old';" },
			{ kind: "add", newLine: 2, text: "const text = 'new → 2:def|not a separator';" },
		]);
	});

	// ─── Compact short-circuit (single-line deletion) ──────────────────────

	it("emits compact deletion format and builds entries from line arrays directly", () => {
		const oldContent = "line one\nline two\nline three";
		const newContent = "line one\nline three";
		const r = buildAllDiffs(oldContent, newContent, "sample.ts");

		expect(r.diff).toMatch(/^2:[0-9a-f]{3}\|line two → \[deleted\]$/);
		expect(r.firstChangedLine).toBe(2);
		expect(r.diffData.entries).toEqual([{ kind: "remove", oldLine: 2, text: "line two" }]);
		expect(r.diffData.stats).toEqual({ added: 0, removed: 1, context: 0 });
	});

	// ─── Compact short-circuit: set_line-style ─────────────────────────────

	it("set_line replacing content on one line uses compact format", () => {
		const oldContent = "aaa\nbbb\nccc";
		const newContent = "aaa\nBBB\nccc";
		const r = buildAllDiffs(oldContent, newContent, "sample.ts");

		expect(r.diff).toMatch(/2:[0-9a-f]{3}\|bbb → 2:[0-9a-f]{3}\|BBB/);
	});

	// ─── Full unified diff (multi-line) ────────────────────────────────────

	it("builds versioned entries, stats, and language for full multi-line diffs", () => {
		const oldContent = ["const one = 1;", "const two = 2;", "const three = 3;", "const four = 4;"].join("\n");
		const newContent = ["const one = 1;", "const two = 22;", "const three = 33;", "const four = 4;"].join("\n");
		const r = buildAllDiffs(oldContent, newContent, "sample.ts");

		expect(r.diffData.version).toBe(1);
		expect(r.diffData.language).toBe("typescript");
		expect(r.diffData.entries).toHaveLength(r.diff.split("\n").length);
		expect(r.diffData.entries.some((entry) => entry.kind === "context" && entry.oldLine === 1 && entry.newLine === 1 && entry.text === "const one = 1;")).toBe(true);
		expect(r.diffData.entries.some((entry) => entry.kind === "remove" && entry.oldLine === 2 && entry.text === "const two = 2;")).toBe(true);
		expect(r.diffData.entries.some((entry) => entry.kind === "add" && entry.newLine === 2 && entry.text === "const two = 22;")).toBe(true);
		expect(r.diffData.stats).toEqual({
			added: countByKind(r.diffData.entries, "add"),
			removed: countByKind(r.diffData.entries, "remove"),
			context: countByKind(r.diffData.entries, "context"),
		});
	});

	it("multi-line change preserves full unified diff format with context lines", () => {
		const oldContent = "line one\nline two\nline three\nline four";
		const newContent = "line one\nLINE TWO\nLINE THREE\nline four";
		const r = buildAllDiffs(oldContent, newContent, "sample.ts");

		expect(r.diff).toContain("+");
		expect(r.diff).toContain("-");
		expect(r.firstChangedLine).toBeDefined();
		expect(r.diffData.entries.some((e) => e.kind === "context" && e.text === "line one")).toBe(true);
		expect(r.diffData.entries.some((e) => e.kind === "context" && e.text === "line four")).toBe(true);
	});

	// ─── Language resolution (single authority) ────────────────────────────

	it("resolves shiki language from the merged EXT_LANG map", () => {
		expect(buildAllDiffs("x", "y", "src/tool.ts").language).toBe("typescript");
		expect(buildAllDiffs("x", "y", "src/view.tsx").language).toBe("tsx");
		expect(buildAllDiffs("x", "y", "README.md").language).toBe("markdown");
		expect(buildAllDiffs("x", "y", "data.json").language).toBe("json");
	});

	it("omits language for unknown extensions", () => {
		const r = buildAllDiffs("alpha\nbeta", "alpha\nBETA", "sample.unknownext");
		expect(r.language).toBeUndefined();
		expect(r.diffData.language).toBeUndefined();
	});

	// ─── InlineDiffMetadata ────────────────────────────────────────────────

	it("produces InlineDiffMetadata when content is below the size gate", () => {
		const r = buildAllDiffs("const value = 1;\n", "const value = 2;\n", "x.ts");
		expect(r.inlineDiff?.kind).toBe("diff");
		if (r.inlineDiff?.kind !== "diff") throw new Error("expected diff variant");
		expect(r.inlineDiff.language).toBe("typescript");
		expect(r.inlineDiff.summary).toBe("+1 -1");
	});

	it("omits InlineDiffMetadata when content exceeds the size gate", () => {
		const oldContent = "x".repeat(MAX_INLINE_DIFF_CONTENT_CHARS);
		const newContent = "y".repeat(MAX_INLINE_DIFF_CONTENT_CHARS);
		const r = buildAllDiffs(oldContent, newContent, "x.ts");
		expect(r.inlineDiff).toBeUndefined();
	});

	it("uses 'text' as fallback language when path has unknown extension", () => {
		const r = buildAllDiffs("a\n", "b\n", "noext");
		expect(r.inlineDiff?.kind).toBe("diff");
		if (r.inlineDiff?.kind !== "diff") throw new Error("expected diff variant");
		expect(r.inlineDiff.language).toBe("text");
	});

	// ─── Inline diff (word-level LCS) ──────────────────────────────────────

	it("adds inline spans for similar compact rename rows", () => {
		const oldContent = "function greet(firstName: string) { return firstName; }";
		const newContent = "function greet(displayName: string) { return displayName; }";
		const r = buildAllDiffs(oldContent, newContent, "sample.ts");

		expect(r.diffData.inlineDiffs).toHaveLength(1);
		const inline = r.diffData.inlineDiffs![0]!;
		expect(inline.removeLineIndex).toBe(0);
		expect(inline.addLineIndex).toBe(1);
		expect(joinSpans(inline.removeSpans)).toBe("function greet(firstName: string) { return firstName; }");
		expect(joinSpans(inline.addSpans)).toBe("function greet(displayName: string) { return displayName; }");
		expect(inline.removeSpans.some((span) => span.kind === "remove" && span.text.includes("firstName"))).toBe(true);
		expect(inline.addSpans.some((span) => span.kind === "add" && span.text.includes("displayName"))).toBe(true);
	});

	it("skips lines longer than the inline diff cap", () => {
		const oldContent = "prefix";
		const newContent = `prefix ${"b".repeat(MAX_INLINE_DIFF_LINE_LENGTH + 1)}`;
		const r = buildAllDiffs(oldContent, newContent, "sample.ts");
		expect(r.diffData.inlineDiffs ?? []).toHaveLength(0);
	});

	it("skips token-heavy lines before allocating inline diff tables", () => {
		const oldContent = "a";
		const newContent = Array.from({ length: MAX_INLINE_DIFF_TOKENS + 1 }, (_, index) => `b${index}`).join(" ");
		const r = buildAllDiffs(oldContent, newContent, "sample.ts");
		expect(r.diffData.inlineDiffs ?? []).toHaveLength(0);
	});

	it("does not create inline diffs for added-only or removed-only changes", () => {
		const addedOnly = buildAllDiffs("alpha", "alpha\nbeta", "sample.ts");
		expect(addedOnly.diffData.inlineDiffs ?? []).toHaveLength(0);

		const removedOnly = buildAllDiffs("alpha\nbeta", "alpha", "sample.ts");
		expect(removedOnly.diffData.inlineDiffs ?? []).toHaveLength(0);
	});

	it("caps total inline diff pair work", () => {
		const pairs = MAX_INLINE_DIFF_PAIRS + 5;
		const oldLines = Array.from({ length: pairs }, (_, index) => `a${index} foo`);
		const newLines = oldLines.map((line, index) => `${line.replace("foo", "bar")}${index}`);
		const r = buildAllDiffs(oldLines.join("\n"), newLines.join("\n"), "sample.ts");
		// At least one pair, but not all pairs (cap fired).
		expect(r.diffData.inlineDiffs?.length).toBeGreaterThan(0);
		expect(r.diffData.inlineDiffs?.length).toBeLessThanOrEqual(MAX_INLINE_DIFF_PAIRS);
	});

	// ─── blockRanges option ────────────────────────────────────────────────

	it("passes blockRanges through to DiffData when provided", () => {
		const r = buildAllDiffs("a\n", "b\n", "x.ts", {
			blockRanges: [{ kind: "remove", startLine: 1, endLine: 1 }],
		});
		expect(r.diffData.blockRanges).toEqual([{ kind: "remove", startLine: 1, endLine: 1 }]);
	});

	it("omits blockRanges from DiffData when not provided", () => {
		const r = buildAllDiffs("a\n", "b\n", "x.ts");
		expect(r.diffData.blockRanges).toBeUndefined();
	});
});

describe("DiffBuilder.summarizeDiffCounts", () => {
	it("formats added and removed counts", () => {
		expect(summarizeDiffCounts(2, 1)).toBe("+2 -1");
		expect(summarizeDiffCounts(0, 3)).toBe("+0 -3");
	});
});
