/**
 * Tests for computeInlineHighlights wrapper function
 * Validates: Requirements 2.8
 */

import { describe, it, expect } from "vitest";
import { computeInlineHighlights } from "../src/inline-diff.js";
import { parseDiff } from "../src/diff-parser.js";
import type { DiffLineEntry } from "../src/diff-types.js";

describe("computeInlineHighlights", () => {
  it("should create WeakMap with spans for add/remove pairs", () => {
    const diffText = `diff --git a/test.txt b/test.txt
@@ -1,2 +1,2 @@
- 1|hello world
+ 2|hello there`;

    const parsed = parseDiff(diffText);
    const highlights = computeInlineHighlights(parsed);

    // Find the remove and add line entries
    const removeEntry = parsed.entries.find(
      (e) => e.kind === "line" && e.lineKind === "remove"
    ) as DiffLineEntry;
    const addEntry = parsed.entries.find(
      (e) => e.kind === "line" && e.lineKind === "add"
    ) as DiffLineEntry;

    expect(removeEntry).toBeDefined();
    expect(addEntry).toBeDefined();

    // Both entries should have spans in the WeakMap
    const removeSpans = highlights.get(removeEntry);
    const addSpans = highlights.get(addEntry);

    expect(removeSpans).toBeDefined();
    expect(addSpans).toBeDefined();

    // The spans should highlight the changed word "world" -> "there"
    expect(removeSpans).toHaveLength(1);
    expect(addSpans).toHaveLength(1);

    // "world" starts at position 6 in "hello world"
    expect(removeSpans![0].start).toBe(6);
    expect(removeSpans![0].end).toBe(11);

    // "there" starts at position 6 in "hello there"
    expect(addSpans![0].start).toBe(6);
    expect(addSpans![0].end).toBe(11);
  });

  it("should handle unpaired add lines with empty spans", () => {
    const diffText = `diff --git a/test.txt b/test.txt
@@ -1,1 +1,2 @@
  1|existing line
+ 2|new line`;

    const parsed = parseDiff(diffText);
    const highlights = computeInlineHighlights(parsed);

    const addEntry = parsed.entries.find(
      (e) => e.kind === "line" && e.lineKind === "add"
    ) as DiffLineEntry;

    expect(addEntry).toBeDefined();

    // Unpaired add should have empty spans
    const addSpans = highlights.get(addEntry);
    expect(addSpans).toBeDefined();
    expect(addSpans).toEqual([]);
  });

  it("should handle unpaired remove lines with empty spans", () => {
    const diffText = `diff --git a/test.txt b/test.txt
@@ -1,2 +1,1 @@
- 1|deleted line
  2|existing line`;

    const parsed = parseDiff(diffText);
    const highlights = computeInlineHighlights(parsed);

    const removeEntry = parsed.entries.find(
      (e) => e.kind === "line" && e.lineKind === "remove"
    ) as DiffLineEntry;

    expect(removeEntry).toBeDefined();

    // Unpaired remove should have empty spans
    const removeSpans = highlights.get(removeEntry);
    expect(removeSpans).toBeDefined();
    expect(removeSpans).toEqual([]);
  });

  it("should handle multiple add/remove pairs", () => {
    const diffText = `diff --git a/test.txt b/test.txt
@@ -1,4 +1,4 @@
- 1|first old
+ 2|first new
- 3|second old
+ 4|second new`;

    const parsed = parseDiff(diffText);
    const highlights = computeInlineHighlights(parsed);

    // Find all line entries
    const lineEntries = parsed.entries.filter(
      (e) => e.kind === "line"
    ) as DiffLineEntry[];

    expect(lineEntries).toHaveLength(4);

    // All four entries should have spans
    for (const entry of lineEntries) {
      const spans = highlights.get(entry);
      expect(spans).toBeDefined();
      expect(Array.isArray(spans)).toBe(true);
    }
  });

  it("should not add context lines to WeakMap", () => {
    const diffText = `diff --git a/test.txt b/test.txt
@@ -1,3 +1,3 @@
  1|context line
- 2|old line
+ 3|new line`;

    const parsed = parseDiff(diffText);
    const highlights = computeInlineHighlights(parsed);

    const contextEntry = parsed.entries.find(
      (e) => e.kind === "line" && e.lineKind === "context"
    ) as DiffLineEntry;

    expect(contextEntry).toBeDefined();

    // Context lines should not be in the WeakMap
    const contextSpans = highlights.get(contextEntry);
    expect(contextSpans).toBeUndefined();
  });

  it("should handle empty diff", () => {
    const diffText = "";
    const parsed = parseDiff(diffText);
    const highlights = computeInlineHighlights(parsed);

    // Should return an empty WeakMap (no entries to process)
    expect(highlights).toBeInstanceOf(WeakMap);
  });

  it("should handle identical lines with empty spans", () => {
    const diffText = `diff --git a/test.txt b/test.txt
@@ -1,2 +1,2 @@
- 1|same content
+ 2|same content`;

    const parsed = parseDiff(diffText);
    const highlights = computeInlineHighlights(parsed);

    const removeEntry = parsed.entries.find(
      (e) => e.kind === "line" && e.lineKind === "remove"
    ) as DiffLineEntry;
    const addEntry = parsed.entries.find(
      (e) => e.kind === "line" && e.lineKind === "add"
    ) as DiffLineEntry;

    expect(removeEntry).toBeDefined();
    expect(addEntry).toBeDefined();

    // Identical lines should have empty spans
    const removeSpans = highlights.get(removeEntry);
    const addSpans = highlights.get(addEntry);

    expect(removeSpans).toEqual([]);
    expect(addSpans).toEqual([]);
  });
});
