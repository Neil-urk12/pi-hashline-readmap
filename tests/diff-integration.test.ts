import { describe, it, expect } from "vitest";
import {
	parseDiff,
	buildSplitRows,
	renderSplit,
} from "../src/diff-renderer-core.js";
import { buildStructuredDiff } from "../src/diff-output.js";
import { resolveDiffConfig } from "../src/diff-config.js";
import type { DiffData, RenderedRow } from "../src/diff-types.js";

// Minimal theme stub that wraps text with slot label for debugging
const debugTheme: any = {
	fg: (slot: string, text: string) => `\x1b[${slot}m${text}\x1b[39m`,
};

function expectSplit(diffData: DiffData): Extract<DiffData, { mode: "split" }> {
	expect(diffData.mode).toBe("split");
	if (diffData.mode !== "split") throw new Error("Expected split mode");
	return diffData;
}

describe("Split diff integration", () => {
	it("renders a single-line replacement with inline spans", () => {
		const oldContent = "const x = 1;\n";
		const newContent = "const x = 2;\n";
		const config = resolveDiffConfig();
		const diffData = expectSplit(
			buildStructuredDiff(oldContent, newContent, "split", config),
		);

		// Call renderSplit
		const rows = diffData.splitRows;
		const rendered = renderSplit(rows, config, debugTheme, {
			terminalWidth: 120,
		});

		// Expect at least one rendered row that contains both sides and separator
		const contentLines = rendered.filter((r) => !r.isMeta).map((r) => r.text);
		expect(contentLines.length).toBeGreaterThan(0);
		// Each line should contain the separator
		expect(contentLines[0]).toContain("│");
		// Check that the changed token (1 vs 2) has its own coloring via slot codes (toolDiffRemoved vs toolDiffAdded)
		// In our stub theme, the color slot names appear in the output.
		expect(contentLines[0]).toMatch(/toolDiffRemoved|toolDiffAdded/);
	});

	it("handles addition-only rows", () => {
		const oldContent = "line1\n";
		const newContent = "line1\nline2\n";
		const config = resolveDiffConfig();
		const diffData = expectSplit(
			buildStructuredDiff(oldContent, newContent, "split", config),
		);
		const rows = diffData.splitRows;
		const rendered = renderSplit(rows, config, debugTheme, {
			terminalWidth: 120,
		});

		// Should have at least one row where right side exists
		const withRight = rendered
			.filter((r: RenderedRow) => r.text.includes("line2"))
			.map((r) => r.text);
		expect(withRight.length).toBeGreaterThan(0);
	});

	it("handles deletion-only rows", () => {
		const oldContent = "line1\nline2\n";
		const newContent = "line1\n";
		const config = resolveDiffConfig();
		const diffData = expectSplit(
			buildStructuredDiff(oldContent, newContent, "split", config),
		);
		const rows = diffData.splitRows;
		const rendered = renderSplit(rows, config, debugTheme, {
			terminalWidth: 120,
		});

		// Some rows should contain the removed line "line2" on left side only; after render, left side colored as removed and right side empty
		const withRemoved = rendered
			.filter((r: RenderedRow) => r.text.includes("line2"))
			.map((r) => r.text);
		expect(withRemoved.length).toBeGreaterThan(0);
	});

	it("preserves hunk headers as meta rows", () => {
		const diff = `--- a.txt
+++ b.txt
@@ -1,3 +1,3 @@
-first
+first modified
 third`;
		const parsed = parseDiff(diff);
		const rows = buildSplitRows(parsed.entries);
		expect(rows.some((r) => r.hunkHeader)).toBe(true);
	});

	it("produces lines with stabilized ANSI", () => {
		const oldContent = "foo\n";
		const newContent = "bar\n";
		const config = resolveDiffConfig();
		const diffData = expectSplit(
			buildStructuredDiff(oldContent, newContent, "split", config),
		);
		const rendered = renderSplit(diffData.splitRows, config, debugTheme, {
			terminalWidth: 120,
		});

		// Every line should be a string (no undefined)
		rendered.forEach((row) => {
			expect(typeof row.text).toBe("string");
			expect(row.text.length).toBeGreaterThan(0);
		});
	});

	it("falls back to inline diff disabled when line too long", () => {
		const long = "a".repeat(800);
		const oldContent = long + "\n";
		const newContent = long + "b" + "\n"; // single char change but line length > 700 -> no token diff
		const config = resolveDiffConfig();
		const diffData = expectSplit(
			buildStructuredDiff(oldContent, newContent, "split", config),
		);
		// Still should have rows with highlights (full-line spans)
		const row = diffData.splitRows.find(
			(r) => r.left?.highlights && r.left.highlights.length > 0,
		);
		expect(row).toBeDefined();
	});
});
