import { describe, it, expect, beforeAll } from "vitest";
import { parseDiff } from "../src/diff-parser";
import { ensureHashInit } from "../src/hashline";

describe("parseDiff", () => {
  beforeAll(() => {
    ensureHashInit();
  });

  it("parses empty diff", () => {
    const result = parseDiff("");
    expect(result.entries).toHaveLength(1); // Just the empty line
    expect(result.stats.added).toBe(0);
    expect(result.stats.removed).toBe(0);
    expect(result.stats.context).toBe(0);
    expect(result.stats.hunks).toBe(0);
    expect(result.stats.files).toBe(0);
  });

  it("parses legacy format with additions", () => {
    const diff = `+1 line one
+2 line two`;
    const result = parseDiff(diff);
    
    expect(result.stats.added).toBe(2);
    expect(result.stats.removed).toBe(0);
    expect(result.stats.context).toBe(0);
    expect(result.stats.hunks).toBe(1); // Implicit hunk created
    
    const entries = result.entries.filter(e => e.kind === "line");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      kind: "line",
      lineKind: "add",
      content: "line one",
      oldLineNumber: null,
      newLineNumber: 1,
    });
  });

  it("parses legacy format with removals", () => {
    const diff = `-1 line one
-2 line two`;
    const result = parseDiff(diff);
    
    expect(result.stats.added).toBe(0);
    expect(result.stats.removed).toBe(2);
    expect(result.stats.context).toBe(0);
    
    const entries = result.entries.filter(e => e.kind === "line");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      kind: "line",
      lineKind: "remove",
      content: "line one",
      oldLineNumber: 1,
      newLineNumber: null,
    });
  });

  it("parses legacy format with context lines", () => {
    const diff = ` 1 line one
 2 line two`;
    const result = parseDiff(diff);
    
    expect(result.stats.added).toBe(0);
    expect(result.stats.removed).toBe(0);
    expect(result.stats.context).toBe(2);
    
    const entries = result.entries.filter(e => e.kind === "line");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      kind: "line",
      lineKind: "context",
      content: "line one",
      oldLineNumber: 1,
      newLineNumber: 1,
    });
  });

  it("parses mixed additions and removals", () => {
    const diff = ` 1 context
-2 removed
+2 added
 3 context`;
    const result = parseDiff(diff);
    
    expect(result.stats.added).toBe(1);
    expect(result.stats.removed).toBe(1);
    expect(result.stats.context).toBe(2);
    
    const lineEntries = result.entries.filter(e => e.kind === "line");
    expect(lineEntries).toHaveLength(4);
  });

  it("parses hunk headers", () => {
    const diff = `@@ -1,3 +1,3 @@
 1 context
-2 removed
+2 added`;
    const result = parseDiff(diff);
    
    expect(result.stats.hunks).toBe(1);
    
    const hunkEntry = result.entries.find(e => e.kind === "hunk");
    expect(hunkEntry).toBeDefined();
    expect(hunkEntry?.raw).toBe("@@ -1,3 +1,3 @@");
  });

  it("parses file headers", () => {
    const diff = `diff --git a/file.txt b/file.txt
@@ -1,1 +1,1 @@
-1 old
+1 new`;
    const result = parseDiff(diff);
    
    expect(result.stats.files).toBe(1);
    
    const fileEntry = result.entries.find(e => e.kind === "file");
    expect(fileEntry).toBeDefined();
    expect(fileEntry?.raw).toBe("diff --git a/file.txt b/file.txt");
  });

  it("maintains line number cursors across hunks", () => {
    const diff = `@@ -1,2 +1,2 @@
 1 line one
-2 line two
+2 line TWO
@@ -10,2 +10,2 @@
 10 line ten
-11 line eleven
+11 line ELEVEN`;
    const result = parseDiff(diff);
    
    const lineEntries = result.entries.filter(e => e.kind === "line");
    
    // First hunk
    expect(lineEntries[0]).toMatchObject({
      oldLineNumber: 1,
      newLineNumber: 1,
    });
    expect(lineEntries[1]).toMatchObject({
      oldLineNumber: 2,
      newLineNumber: null,
    });
    expect(lineEntries[2]).toMatchObject({
      oldLineNumber: null,
      newLineNumber: 2,
    });
    
    // Second hunk
    expect(lineEntries[3]).toMatchObject({
      oldLineNumber: 10,
      newLineNumber: 10,
    });
    expect(lineEntries[4]).toMatchObject({
      oldLineNumber: 11,
      newLineNumber: null,
    });
    expect(lineEntries[5]).toMatchObject({
      oldLineNumber: null,
      newLineNumber: 11,
    });
  });

  it("handles canonical format with pipe separator", () => {
    const diff = `+ 1|line one
- 2|line two
  3|context`;
    const result = parseDiff(diff);
    
    expect(result.stats.added).toBe(1);
    expect(result.stats.removed).toBe(1);
    expect(result.stats.context).toBe(1);
    
    const lineEntries = result.entries.filter(e => e.kind === "line");
    expect(lineEntries[0]).toMatchObject({
      kind: "line",
      lineKind: "add",
      content: "line one",
    });
    expect(lineEntries[1]).toMatchObject({
      kind: "line",
      lineKind: "remove",
      content: "line two",
    });
    expect(lineEntries[2]).toMatchObject({
      kind: "line",
      lineKind: "context",
      content: "context",
    });
  });

  it("treats unrecognized lines as meta", () => {
    const diff = `Some random text
+1 added line
Another random line`;
    const result = parseDiff(diff);
    
    const metaEntries = result.entries.filter(e => e.kind === "meta");
    expect(metaEntries).toHaveLength(2);
    expect(metaEntries[0]?.raw).toBe("Some random text");
    expect(metaEntries[1]?.raw).toBe("Another random line");
  });

  it("creates implicit hunk when lines appear before first hunk header", () => {
    const diff = `+1 line one
+2 line two`;
    const result = parseDiff(diff);
    
    expect(result.stats.hunks).toBe(1);
    
    const hunkEntry = result.entries.find(e => e.kind === "hunk");
    expect(hunkEntry).toBeDefined();
    expect(hunkEntry?.raw).toBe("@@ -1 +1 @@");
  });

  it("computes correct statistics for complex diff", () => {
    const diff = `diff --git a/file1.txt b/file1.txt
@@ -1,5 +1,5 @@
 1 context
-2 removed
+2 added
 3 context
diff --git a/file2.txt b/file2.txt
@@ -1,3 +1,4 @@
 1 context
+2 new line
 2 context`;
    const result = parseDiff(diff);
    
    expect(result.stats.files).toBe(2);
    expect(result.stats.hunks).toBe(2);
    expect(result.stats.added).toBe(2);
    expect(result.stats.removed).toBe(1);
    expect(result.stats.context).toBe(4);
  });

  it("handles hunk header with optional line counts", () => {
    const diff = `@@ -1 +1 @@
+1 single line`;
    const result = parseDiff(diff);
    
    expect(result.stats.hunks).toBe(1);
    const hunkEntry = result.entries.find(e => e.kind === "hunk");
    expect(hunkEntry).toBeDefined();
  });

  it("resets cursors on file headers", () => {
    const diff = `diff --git a/file1.txt b/file1.txt
@@ -5,2 +5,2 @@
-5 line five
+5 line FIVE
diff --git a/file2.txt b/file2.txt
@@ -1,2 +1,2 @@
-1 line one
+1 line ONE`;
    const result = parseDiff(diff);
    
    const lineEntries = result.entries.filter(e => e.kind === "line");
    
    // First file starts at line 5
    expect(lineEntries[0]).toMatchObject({
      oldLineNumber: 5,
    });
    
    // Second file resets to line 1
    expect(lineEntries[2]).toMatchObject({
      oldLineNumber: 1,
    });
  });
});
