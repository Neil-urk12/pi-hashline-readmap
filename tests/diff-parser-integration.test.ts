import { describe, it, expect, beforeAll } from "vitest";
import { parseDiff } from "../src/diff-parser";
import { generateDiffString } from "../src/edit-diff";
import { ensureHashInit } from "../src/hashline";

describe("parseDiff integration with generateDiffString", () => {
  beforeAll(() => {
    ensureHashInit();
  });

  it("parses output from generateDiffString for single line change", () => {
    const oldContent = "line one\nline two\nline three";
    const newContent = "line one\nline TWO\nline three";
    
    const { diff } = generateDiffString(oldContent, newContent);
    const result = parseDiff(diff);
    
    expect(result.stats.added).toBe(1);
    expect(result.stats.removed).toBe(1);
    expect(result.stats.context).toBeGreaterThan(0);
    
    const lineEntries = result.entries.filter(e => e.kind === "line");
    expect(lineEntries.length).toBeGreaterThan(0);
    
    // Verify we have the removed and added lines
    const removedEntry = lineEntries.find(e => e.kind === "line" && e.lineKind === "remove");
    const addedEntry = lineEntries.find(e => e.kind === "line" && e.lineKind === "add");
    
    expect(removedEntry).toBeDefined();
    expect(addedEntry).toBeDefined();
    expect(removedEntry?.content).toBe("line two");
    expect(addedEntry?.content).toBe("line TWO");
  });

  it("parses output from generateDiffString for multi-line changes", () => {
    const oldContent = "line one\nline two\nline three\nline four";
    const newContent = "line one\nLINE TWO\nLINE THREE\nline four";
    
    const { diff } = generateDiffString(oldContent, newContent);
    const result = parseDiff(diff);
    
    expect(result.stats.added).toBe(2);
    expect(result.stats.removed).toBe(2);
    
    const lineEntries = result.entries.filter(e => e.kind === "line");
    const removedEntries = lineEntries.filter(e => e.kind === "line" && e.lineKind === "remove");
    const addedEntries = lineEntries.filter(e => e.kind === "line" && e.lineKind === "add");
    
    expect(removedEntries).toHaveLength(2);
    expect(addedEntries).toHaveLength(2);
  });

  it("parses output from generateDiffString for additions only", () => {
    const oldContent = "line one\nline three";
    const newContent = "line one\nline two\nline three";
    
    const { diff } = generateDiffString(oldContent, newContent);
    const result = parseDiff(diff);
    
    expect(result.stats.added).toBe(1);
    expect(result.stats.removed).toBe(0);
    
    const addedEntry = result.entries.find(e => e.kind === "line" && e.lineKind === "add");
    expect(addedEntry).toBeDefined();
    if (addedEntry?.kind === "line") {
      expect(addedEntry.content).toBe("line two");
    }
  });

  it("parses output from generateDiffString for deletions only", () => {
    const oldContent = "line one\nline two\nline three";
    const newContent = "line one\nline three";
    
    const { diff } = generateDiffString(oldContent, newContent);
    const result = parseDiff(diff);
    
    expect(result.stats.added).toBe(0);
    expect(result.stats.removed).toBe(1);
    
    const removedEntry = result.entries.find(e => e.kind === "line" && e.lineKind === "remove");
    expect(removedEntry).toBeDefined();
    if (removedEntry?.kind === "line") {
      expect(removedEntry.content).toBe("line two");
    }
  });

  it("handles empty diff from identical content", () => {
    const content = "line one\nline two";
    const { diff } = generateDiffString(content, content);
    const result = parseDiff(diff);
    
    expect(result.stats.added).toBe(0);
    expect(result.stats.removed).toBe(0);
    expect(result.stats.context).toBe(0);
  });

  it("maintains correct line numbers across changes", () => {
    const oldContent = "a\nb\nc\nd\ne\nf\ng\nh\ni\nj";
    const newContent = "a\nB\nc\nd\ne\nf\nG\nh\ni\nj";
    
    const { diff } = generateDiffString(oldContent, newContent);
    const result = parseDiff(diff);
    
    const lineEntries = result.entries.filter(e => e.kind === "line");
    
    // Find the first change (line 2: b -> B)
    const firstRemoved = lineEntries.find(e => e.kind === "line" && e.lineKind === "remove" && e.content === "b");
    const firstAdded = lineEntries.find(e => e.kind === "line" && e.lineKind === "add" && e.content === "B");
    
    expect(firstRemoved?.oldLineNumber).toBe(2);
    expect(firstAdded?.newLineNumber).toBe(2);
    
    // Find the second change (line 7: g -> G)
    const secondRemoved = lineEntries.find(e => e.kind === "line" && e.lineKind === "remove" && e.content === "g");
    const secondAdded = lineEntries.find(e => e.kind === "line" && e.lineKind === "add" && e.content === "G");
    
    expect(secondRemoved?.oldLineNumber).toBe(7);
    expect(secondAdded?.newLineNumber).toBe(7);
  });

  it("handles context lines with ellipsis", () => {
    const oldContent = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
    const newContent = oldContent.replace("line 10", "LINE 10");
    
    const { diff } = generateDiffString(oldContent, newContent);
    const result = parseDiff(diff);
    
    // Should have context lines and the change
    expect(result.stats.added).toBe(1);
    expect(result.stats.removed).toBe(1);
    expect(result.stats.context).toBeGreaterThan(0);
    
    // Check for ellipsis meta entries
    const metaEntries = result.entries.filter(e => e.kind === "meta");
    const hasEllipsis = metaEntries.some(e => e.raw.includes("..."));
    expect(hasEllipsis).toBe(true);
  });

  it("computes total line count correctly", () => {
    const oldContent = "line one\nline two\nline three";
    const newContent = "line one\nline TWO\nline three";
    
    const { diff } = generateDiffString(oldContent, newContent);
    const result = parseDiff(diff);
    
    // Total lines should match the number of lines in the diff string
    const expectedLines = diff.split("\n").length;
    expect(result.stats.lines).toBe(expectedLines);
  });
});
