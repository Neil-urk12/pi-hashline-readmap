import { describe, it, expect, beforeAll } from "vitest";
import {
  tokenizeInlineDiff,
  computeInlineDiffSpans,
  mergeSpans,
  tokensToDiffSpans,
  normalizeCodeWhitespace,
} from "../src/inline-diff";
import { ensureHashInit } from "../src/hashline";
import type { DiffSpan, Token } from "../src/diff-types";

describe("inline-diff", () => {
  beforeAll(() => {
    ensureHashInit();
  });

  describe("normalizeCodeWhitespace", () => {
    it("converts tabs to 4 spaces", () => {
      expect(normalizeCodeWhitespace("\tindented")).toBe("    indented");
      expect(normalizeCodeWhitespace("a\tb\tc")).toBe("a    b    c");
    });

    it("leaves spaces unchanged", () => {
      expect(normalizeCodeWhitespace("  spaces")).toBe("  spaces");
    });

    it("handles mixed tabs and spaces", () => {
      expect(normalizeCodeWhitespace("\t  mixed")).toBe("      mixed");
    });
  });

  describe("tokenizeInlineDiff", () => {
    it("tokenizes whitespace sequences", () => {
      const tokens = tokenizeInlineDiff("a  b   c");
      expect(tokens).toHaveLength(5);
      expect(tokens[0]).toMatchObject({ value: "a", start: 0, end: 1 });
      expect(tokens[1]).toMatchObject({ value: "  ", start: 1, end: 3 });
      expect(tokens[2]).toMatchObject({ value: "b", start: 3, end: 4 });
      expect(tokens[3]).toMatchObject({ value: "   ", start: 4, end: 7 });
      expect(tokens[4]).toMatchObject({ value: "c", start: 7, end: 8 });
    });

    it("tokenizes word tokens", () => {
      const tokens = tokenizeInlineDiff("hello world");
      expect(tokens).toHaveLength(3);
      expect(tokens[0]).toMatchObject({ value: "hello", start: 0, end: 5 });
      expect(tokens[1]).toMatchObject({ value: " ", start: 5, end: 6 });
      expect(tokens[2]).toMatchObject({ value: "world", start: 6, end: 11 });
    });

    it("tokenizes punctuation separately", () => {
      const tokens = tokenizeInlineDiff("hello, world!");
      expect(tokens).toHaveLength(5);
      expect(tokens[0]).toMatchObject({ value: "hello", start: 0, end: 5 });
      expect(tokens[1]).toMatchObject({ value: ",", start: 5, end: 6 });
      expect(tokens[2]).toMatchObject({ value: " ", start: 6, end: 7 });
      expect(tokens[3]).toMatchObject({ value: "world", start: 7, end: 12 });
      expect(tokens[4]).toMatchObject({ value: "!", start: 12, end: 13 });
    });

    it("tokenizes underscores as part of words", () => {
      const tokens = tokenizeInlineDiff("my_variable");
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({ value: "my_variable", start: 0, end: 11 });
    });

    it("tokenizes numbers as part of words", () => {
      const tokens = tokenizeInlineDiff("var123");
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({ value: "var123", start: 0, end: 6 });
    });

    it("tokenizes Chinese characters individually", () => {
      const tokens = tokenizeInlineDiff("你好世界");
      expect(tokens).toHaveLength(4);
      expect(tokens[0]).toMatchObject({ value: "你", start: 0, end: 1 });
      expect(tokens[1]).toMatchObject({ value: "好", start: 1, end: 2 });
      expect(tokens[2]).toMatchObject({ value: "世", start: 2, end: 3 });
      expect(tokens[3]).toMatchObject({ value: "界", start: 3, end: 4 });
    });

    it("tokenizes mixed scripts", () => {
      const tokens = tokenizeInlineDiff("hello世界");
      expect(tokens).toHaveLength(3);
      expect(tokens[0]).toMatchObject({ value: "hello", start: 0, end: 5 });
      expect(tokens[1]).toMatchObject({ value: "世", start: 5, end: 6 });
      expect(tokens[2]).toMatchObject({ value: "界", start: 6, end: 7 });
    });

    it("tokenizes code with operators", () => {
      const tokens = tokenizeInlineDiff("x = y + z");
      expect(tokens).toHaveLength(9);
      expect(tokens[0]).toMatchObject({ value: "x", start: 0, end: 1 });
      expect(tokens[1]).toMatchObject({ value: " ", start: 1, end: 2 });
      expect(tokens[2]).toMatchObject({ value: "=", start: 2, end: 3 });
      expect(tokens[3]).toMatchObject({ value: " ", start: 3, end: 4 });
      expect(tokens[4]).toMatchObject({ value: "y", start: 4, end: 5 });
      expect(tokens[5]).toMatchObject({ value: " ", start: 5, end: 6 });
      expect(tokens[6]).toMatchObject({ value: "+", start: 6, end: 7 });
      expect(tokens[7]).toMatchObject({ value: " ", start: 7, end: 8 });
      expect(tokens[8]).toMatchObject({ value: "z", start: 8, end: 9 });
    });

    it("handles empty string", () => {
      const tokens = tokenizeInlineDiff("");
      expect(tokens).toHaveLength(0);
    });

    it("converts tabs to spaces before tokenizing", () => {
      const tokens = tokenizeInlineDiff("\thello");
      expect(tokens).toHaveLength(2);
      expect(tokens[0]).toMatchObject({ value: "    ", start: 0, end: 4 });
      expect(tokens[1]).toMatchObject({ value: "hello", start: 4, end: 9 });
    });
  });

  describe("mergeSpans", () => {
    it("merges adjacent spans", () => {
      const spans: DiffSpan[] = [
        { start: 0, end: 5 },
        { start: 5, end: 10 },
      ];
      const merged = mergeSpans(spans);
      expect(merged).toHaveLength(1);
      expect(merged[0]).toMatchObject({ start: 0, end: 10 });
    });

    it("merges overlapping spans", () => {
      const spans: DiffSpan[] = [
        { start: 0, end: 7 },
        { start: 5, end: 10 },
      ];
      const merged = mergeSpans(spans);
      expect(merged).toHaveLength(1);
      expect(merged[0]).toMatchObject({ start: 0, end: 10 });
    });

    it("keeps non-overlapping spans separate", () => {
      const spans: DiffSpan[] = [
        { start: 0, end: 5 },
        { start: 10, end: 15 },
      ];
      const merged = mergeSpans(spans);
      expect(merged).toHaveLength(2);
      expect(merged[0]).toMatchObject({ start: 0, end: 5 });
      expect(merged[1]).toMatchObject({ start: 10, end: 15 });
    });

    it("handles empty array", () => {
      const merged = mergeSpans([]);
      expect(merged).toHaveLength(0);
    });

    it("handles single span", () => {
      const spans: DiffSpan[] = [{ start: 0, end: 5 }];
      const merged = mergeSpans(spans);
      expect(merged).toHaveLength(1);
      expect(merged[0]).toMatchObject({ start: 0, end: 5 });
    });

    it("merges multiple adjacent spans", () => {
      const spans: DiffSpan[] = [
        { start: 0, end: 3 },
        { start: 3, end: 6 },
        { start: 6, end: 9 },
      ];
      const merged = mergeSpans(spans);
      expect(merged).toHaveLength(1);
      expect(merged[0]).toMatchObject({ start: 0, end: 9 });
    });

    it("merges complex overlapping pattern", () => {
      const spans: DiffSpan[] = [
        { start: 0, end: 5 },
        { start: 3, end: 8 },
        { start: 10, end: 15 },
        { start: 12, end: 20 },
      ];
      const merged = mergeSpans(spans);
      expect(merged).toHaveLength(2);
      expect(merged[0]).toMatchObject({ start: 0, end: 8 });
      expect(merged[1]).toMatchObject({ start: 10, end: 20 });
    });
  });

  describe("tokensToDiffSpans", () => {
    it("converts changed token indexes to character spans", () => {
      const tokens: Token[] = [
        { value: "hello", start: 0, end: 5 },
        { value: " ", start: 5, end: 6 },
        { value: "world", start: 6, end: 11 },
      ];
      const changedIndexes = new Set([0, 2]);
      const spans = tokensToDiffSpans("hello world", tokens, changedIndexes);
      
      expect(spans).toHaveLength(2);
      expect(spans[0]).toMatchObject({ start: 0, end: 5 });
      expect(spans[1]).toMatchObject({ start: 6, end: 11 });
    });

    it("trims leading whitespace from spans", () => {
      const tokens: Token[] = [
        { value: "  ", start: 0, end: 2 },
        { value: "hello", start: 2, end: 7 },
      ];
      const changedIndexes = new Set([0, 1]);
      const spans = tokensToDiffSpans("  hello", tokens, changedIndexes);
      
      // Whitespace-only token should be trimmed away
      expect(spans).toHaveLength(1);
      expect(spans[0]).toMatchObject({ start: 2, end: 7 });
    });

    it("trims trailing whitespace from spans", () => {
      const tokens: Token[] = [
        { value: "hello", start: 0, end: 5 },
        { value: "  ", start: 5, end: 7 },
      ];
      const changedIndexes = new Set([0, 1]);
      const spans = tokensToDiffSpans("hello  ", tokens, changedIndexes);
      
      // Trailing whitespace should be trimmed
      expect(spans).toHaveLength(1);
      expect(spans[0]).toMatchObject({ start: 0, end: 5 });
    });

    it("returns empty array for no changed tokens", () => {
      const tokens: Token[] = [
        { value: "hello", start: 0, end: 5 },
      ];
      const changedIndexes = new Set<number>();
      const spans = tokensToDiffSpans("hello", tokens, changedIndexes);
      
      expect(spans).toHaveLength(0);
    });

    it("merges adjacent changed tokens", () => {
      const tokens: Token[] = [
        { value: "hello", start: 0, end: 5 },
        { value: "_", start: 5, end: 6 },
        { value: "world", start: 6, end: 11 },
      ];
      const changedIndexes = new Set([0, 1, 2]);
      const spans = tokensToDiffSpans("hello_world", tokens, changedIndexes);
      
      // All adjacent tokens should merge into one span
      expect(spans).toHaveLength(1);
      expect(spans[0]).toMatchObject({ start: 0, end: 11 });
    });
  });

  describe("computeInlineDiffSpans", () => {
    it("returns empty spans for identical lines", () => {
      const result = computeInlineDiffSpans("hello world", "hello world");
      expect(result.left).toHaveLength(0);
      expect(result.right).toHaveLength(0);
    });

    it("returns empty spans for lines exceeding 700 characters", () => {
      const longLine = "x".repeat(701);
      const result = computeInlineDiffSpans(longLine, "short");
      expect(result.left).toHaveLength(0);
      expect(result.right).toHaveLength(0);
    });

    it("computes spans for completely different lines", () => {
      const result = computeInlineDiffSpans("hello", "world");
      
      // Both lines should be fully highlighted
      expect(result.left).toHaveLength(1);
      expect(result.left[0]).toMatchObject({ start: 0, end: 5 });
      expect(result.right).toHaveLength(1);
      expect(result.right[0]).toMatchObject({ start: 0, end: 5 });
    });

    it("computes spans for single token change", () => {
      const result = computeInlineDiffSpans("hello world", "hello earth");
      
      // Only "world" and "earth" should be highlighted
      expect(result.left).toHaveLength(1);
      expect(result.left[0]).toMatchObject({ start: 6, end: 11 });
      expect(result.right).toHaveLength(1);
      expect(result.right[0]).toMatchObject({ start: 6, end: 11 });
    });

    it("computes spans for whitespace-only differences", () => {
      const result = computeInlineDiffSpans("hello  world", "hello world");
      
      // Whitespace-only tokens get trimmed away, so no spans are returned
      // This is expected behavior per the design - whitespace trimming at span boundaries
      expect(result.left).toHaveLength(0);
      expect(result.right).toHaveLength(0);
    });

    it("handles addition at start", () => {
      const result = computeInlineDiffSpans("world", "hello world");
      
      expect(result.left).toHaveLength(0); // Nothing removed
      expect(result.right).toHaveLength(1);
      expect(result.right[0]).toMatchObject({ start: 0, end: 5 }); // "hello"
    });

    it("handles addition at end", () => {
      const result = computeInlineDiffSpans("hello", "hello world");
      
      expect(result.left).toHaveLength(0); // Nothing removed
      expect(result.right).toHaveLength(1);
      expect(result.right[0]).toMatchObject({ start: 6, end: 11 }); // "world"
    });

    it("handles removal at start", () => {
      const result = computeInlineDiffSpans("hello world", "world");
      
      expect(result.left).toHaveLength(1);
      expect(result.left[0]).toMatchObject({ start: 0, end: 5 }); // "hello"
      expect(result.right).toHaveLength(0); // Nothing added
    });

    it("handles removal at end", () => {
      const result = computeInlineDiffSpans("hello world", "hello");
      
      expect(result.left).toHaveLength(1);
      expect(result.left[0]).toMatchObject({ start: 6, end: 11 }); // "world"
      expect(result.right).toHaveLength(0); // Nothing added
    });

    it("handles multiple token changes", () => {
      const result = computeInlineDiffSpans("foo bar baz", "foo qux baz");
      
      // Only "bar" and "qux" should be highlighted
      expect(result.left).toHaveLength(1);
      expect(result.left[0]).toMatchObject({ start: 4, end: 7 }); // "bar"
      expect(result.right).toHaveLength(1);
      expect(result.right[0]).toMatchObject({ start: 4, end: 7 }); // "qux"
    });

    it("handles punctuation changes", () => {
      const result = computeInlineDiffSpans("hello, world", "hello. world");
      
      // Only comma and period should be highlighted
      expect(result.left).toHaveLength(1);
      expect(result.left[0]).toMatchObject({ start: 5, end: 6 }); // ","
      expect(result.right).toHaveLength(1);
      expect(result.right[0]).toMatchObject({ start: 5, end: 6 }); // "."
    });

    it("handles code with operator changes", () => {
      const result = computeInlineDiffSpans("x = y + z", "x = y - z");
      
      // Only "+" and "-" should be highlighted
      expect(result.left).toHaveLength(1);
      expect(result.left[0]).toMatchObject({ start: 6, end: 7 }); // "+"
      expect(result.right).toHaveLength(1);
      expect(result.right[0]).toMatchObject({ start: 6, end: 7 }); // "-"
    });

    it("handles variable name changes", () => {
      const result = computeInlineDiffSpans("const myVar = 1", "const yourVar = 1");
      
      // Only variable names should be highlighted
      expect(result.left).toHaveLength(1);
      expect(result.left[0]).toMatchObject({ start: 6, end: 11 }); // "myVar"
      expect(result.right).toHaveLength(1);
      expect(result.right[0]).toMatchObject({ start: 6, end: 13 }); // "yourVar"
    });

    it("handles Chinese character changes", () => {
      const result = computeInlineDiffSpans("你好世界", "你好地球");
      
      // Last two characters changed
      expect(result.left).toHaveLength(1);
      expect(result.left[0]).toMatchObject({ start: 2, end: 4 }); // "世界"
      expect(result.right).toHaveLength(1);
      expect(result.right[0]).toMatchObject({ start: 2, end: 4 }); // "地球"
    });

    it("handles mixed script changes", () => {
      const result = computeInlineDiffSpans("hello世界", "hello地球");
      
      // Only Chinese characters changed
      expect(result.left).toHaveLength(1);
      expect(result.left[0]).toMatchObject({ start: 5, end: 7 }); // "世界"
      expect(result.right).toHaveLength(1);
      expect(result.right[0]).toMatchObject({ start: 5, end: 7 }); // "地球"
    });

    it("handles empty left line", () => {
      const result = computeInlineDiffSpans("", "hello");
      
      expect(result.left).toHaveLength(0);
      expect(result.right).toHaveLength(1);
      expect(result.right[0]).toMatchObject({ start: 0, end: 5 });
    });

    it("handles empty right line", () => {
      const result = computeInlineDiffSpans("hello", "");
      
      expect(result.left).toHaveLength(1);
      expect(result.left[0]).toMatchObject({ start: 0, end: 5 });
      expect(result.right).toHaveLength(0);
    });

    it("handles both empty lines", () => {
      const result = computeInlineDiffSpans("", "");
      
      expect(result.left).toHaveLength(0);
      expect(result.right).toHaveLength(0);
    });

    it("handles tab normalization", () => {
      const result = computeInlineDiffSpans("\thello", "    hello");
      
      // Tab converted to 4 spaces, so lines should be identical
      expect(result.left).toHaveLength(0);
      expect(result.right).toHaveLength(0);
    });

    it("handles complex code change", () => {
      const result = computeInlineDiffSpans(
        "function oldName(x, y) {",
        "function newName(x, y) {"
      );
      
      // Only function name should be highlighted
      expect(result.left).toHaveLength(1);
      expect(result.left[0]).toMatchObject({ start: 9, end: 16 }); // "oldName"
      expect(result.right).toHaveLength(1);
      expect(result.right[0]).toMatchObject({ start: 9, end: 16 }); // "newName"
    });

    it("handles string literal changes", () => {
      const result = computeInlineDiffSpans(
        'const msg = "hello"',
        'const msg = "world"'
      );
      
      // Only string content should be highlighted
      expect(result.left).toHaveLength(1);
      expect(result.right).toHaveLength(1);
    });

    it("handles line with only whitespace changes", () => {
      const result = computeInlineDiffSpans("  hello", "    hello");
      
      // Whitespace-only differences get trimmed away
      // This is expected behavior per the design - whitespace trimming at span boundaries
      expect(result.left).toHaveLength(0);
      expect(result.right).toHaveLength(0);
    });
  });
});
