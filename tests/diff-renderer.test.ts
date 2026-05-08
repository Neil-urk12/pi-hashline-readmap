import { describe, it, expect, beforeEach } from "vitest";
import {
  parseDiff,
  buildSplitRows,
  tokenizeInlineDiff,
  computeInlineDiffSpans,
  visibleWidth,
  truncateToWidth,
  assignLineNumbers,
} from "../src/diff-renderer-core.js";
import { RENDERING_CONSTANTS } from "../src/diff-types.js";

describe("parseDiff", () => {
  it("parses a simple unified diff with one hunk", () => {
    const diff = `--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,3 @@
 Hello
-world
+world!
 Bye`;
    const result = parseDiff(diff);
    expect(result.entries.length).toBeGreaterThan(0);
    // Check stats
    expect(result.stats.added).toBe(1);
    expect(result.stats.removed).toBe(1);
    // Check that line numbers got assigned
    const lines = result.entries.filter((e) => e.kind === "line") as any[];
    const removals = lines.filter((l) => l.type === "removal");
    const additions = lines.filter((l) => l.type === "addition");
    expect(removals[0].oldLineNumber).toBe(2);
    expect(additions[0].newLineNumber).toBe(2);
  });

  it("handles empty diff", () => {
    const result = parseDiff("");
    expect(result.entries).toHaveLength(0);
    expect(result.stats).toEqual({ added: 0, removed: 0 });
  });

  it("skips file headers in split rows", () => {
    const diff = `--- a/foo
+++ b/foo
@@ -1 +1 @@
-foo
+bar`;
    const rows = buildSplitRows(parseDiff(diff).entries);
    // Should have a hunk-header row and one change row, not file-header rows
    expect(rows.some((r) => r.hunkHeader)).toBe(true);
    expect(rows.some((r) => r.left?.entry?.kind === "file-header")).toBe(false);
  });
});

describe("tokenizeInlineDiff", () => {
  it("splits into words, whitespace, and punctuation", () => {
    const text = "const x = 42;";
    const tokens = tokenizeInlineDiff(text);
    expect(tokens).toEqual(["const", " ", "x", " ", "=", " ", "42", ";"]);
  });

  it("handles mixed symbols", () => {
    const text = "a.b(c).d";
    const tokens = tokenizeInlineDiff(text);
    expect(tokens).toEqual(["a", ".", "b", "(", "c", ")", ".", "d"]);
  });

  it("tokenizes whitespace correctly", () => {
    const text = "  spaced  out  ";
    const tokens = tokenizeInlineDiff(text);
    expect(tokens).toEqual(["  ", "spaced", "  ", "out", "  "]);
  });
});

describe("computeInlineDiffSpans", () => {
  it("detects single token change", () => {
    const left = "const x = 1;";
    const right = "const x = 2;";
    const { left: lspans, right: rspans } = computeInlineDiffSpans(left, right);
    // Expect one diff span for the number
    expect(lspans.some((s) => s.kind === "delete" && s.start > 0)).toBe(true);
    expect(rspans.some((s) => s.kind === "insert" && s.start > 0)).toBe(true);
  });

  it("gates on long lines", () => {
    const long = "a".repeat(800);
    const { left, right } = computeInlineDiffSpans(long, long.slice(0, -10));
    expect(left.length).toBe(1);
    expect(right.length).toBe(1);
    expect(left[0].kind).toBe("delete");
    expect(right[0].kind).toBe("insert");
  });

  it("returns empty spans for identical lines", () => {
    const text = "same";
    const { left, right } = computeInlineDiffSpans(text, text);
    expect(left).toEqual([]);
    expect(right).toEqual([]);
  });
});

describe("buildSplitRows", () => {
  it("pairs removals and additions", () => {
    const diff = `@@ -1,3 +1,3 @@
 context
-removed
+added
 context`;
    const parsed = parseDiff(diff);
    const rows = buildSplitRows(parsed.entries);
    // Should have: hunk header row, context row, change row, context row? Wait parse includes context lines before and after hunk; pattern may yield context line then removal+addition then context.
    // Actually sequence: context, removal, addition, context? Since hunk includes context lines? The diff above shows context line before and after. The hunk header says -1,3 +1,3, lines: context (line1), removal (line2), addition (line2 replaced), context (line3). So parse sees:
    // line: context (content "context")
    // line: removal ("removed")
    // line: addition ("added")
    // line: context ("context")
    // buildSplitRows pairs removal+addition into one row.
    const changeRows = rows.filter((r) => r.rowKind === "removal" || r.rowKind === "addition");
    expect(changeRows.length).toBeGreaterThan(0);
  });

  it("handles lone addition and deletion", () => {
    const diff = `@@ -1 +1,2 @@
-old
+new
+extra`;
    const parsed = parseDiff(diff);
    const rows = buildSplitRows(parsed.entries);
    // First row: old only (removal), second row: new+extra? Actually pairing: removal list size 1, addition size 2 -> two rows: row0: left removal, right addition (new); row1: left null, right addition (extra). So one row with left only, one row with right only.
    const onlyRemoval = rows.find((r) => r.left && !r.right);
    const onlyAddition = rows.find((r) => !r.left && r.right);
    expect(onlyRemoval).toBeDefined();
    expect(onlyAddition).toBeDefined();
  });
});

describe("truncateToWidth", () => {
  it("truncates long text with ellipsis", () => {
    const long = "a".repeat(100);
    const truncated = truncateToWidth(long, 10);
    expect(visibleWidth(truncated)).toBeLessThanOrEqual(10);
    expect(truncated.endsWith("…")).toBe(true);
  });

  it("no ellipsis if within width", () => {
    const short = "hello";
    const truncated = truncateToWidth(short, 10, "");
    expect(truncated).toBe(short);
  });
});

describe("RENDERING_CONSTANTS", () => {
  it("has sane values", () => {
    expect(RENDERING_CONSTANTS.MIN_SPLIT_COLUMN_WIDTH).toBeGreaterThan(0);
    expect(RENDERING_CONSTANTS.MAX_INLINE_DIFF_LINE_LENGTH).toBeGreaterThan(0);
  });
});
