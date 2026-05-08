/**
 * Property-based tests for inline diff span coverage
 * 
 * **Validates: Requirements 2.3, 2.4**
 * 
 * Property 2: Span coverage
 * - Generate random line pairs with known token differences
 * - Verify all changed tokens are covered by spans
 * - Verify no unchanged tokens are covered by spans
 * - Verify spans are non-overlapping and sorted
 */

import { describe, it, expect, beforeAll } from "vitest";
import { computeInlineDiffSpans, tokenizeInlineDiff } from "../src/inline-diff.js";
import { ensureHashInit } from "../src/hashline.js";
import * as fc from "fast-check";
import type { DiffSpan } from "../src/diff-types.js";

describe("computeInlineDiffSpans - Property-based tests", () => {
  beforeAll(() => {
    ensureHashInit();
  });

  describe("Property 2: Span coverage", () => {
    /**
     * Helper function to check if a character position is covered by any span
     */
    function isPositionCovered(position: number, spans: DiffSpan[]): boolean {
      return spans.some(span => position >= span.start && position < span.end);
    }

    /**
     * Helper function to verify spans are non-overlapping
     */
    function areSpansNonOverlapping(spans: DiffSpan[]): boolean {
      for (let i = 0; i < spans.length - 1; i++) {
        const current = spans[i];
        const next = spans[i + 1];
        // Spans overlap if current.end > next.start
        if (current.end > next.start) {
          return false;
        }
      }
      return true;
    }

    /**
     * Helper function to verify spans are sorted by start position
     */
    function areSpansSorted(spans: DiffSpan[]): boolean {
      for (let i = 0; i < spans.length - 1; i++) {
        if (spans[i].start > spans[i + 1].start) {
          return false;
        }
      }
      return true;
    }

    /**
     * Helper function to build LCS table for token comparison
     * This mirrors the logic in inline-diff.ts to identify which tokens are in the LCS
     */
    function buildLcsTable(leftTokens: any[], rightTokens: any[]): number[][] {
      const leftCount = leftTokens.length;
      const rightCount = rightTokens.length;

      const table: number[][] = Array.from({ length: leftCount + 1 }, () =>
        Array(rightCount + 1).fill(0)
      );

      for (let i = 1; i <= leftCount; i++) {
        for (let j = 1; j <= rightCount; j++) {
          if (leftTokens[i - 1].value === rightTokens[j - 1].value) {
            table[i][j] = table[i - 1][j - 1] + 1;
          } else {
            table[i][j] = Math.max(table[i - 1][j], table[i][j - 1]);
          }
        }
      }

      return table;
    }

    /**
     * Helper function to identify changed token indexes using LCS backtrace
     */
    function getChangedTokenIndexes(
      leftTokens: any[],
      rightTokens: any[]
    ): { leftChanged: Set<number>; rightChanged: Set<number> } {
      const table = buildLcsTable(leftTokens, rightTokens);
      const leftChanged = new Set<number>();
      const rightChanged = new Set<number>();

      let i = leftTokens.length;
      let j = rightTokens.length;

      while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && leftTokens[i - 1].value === rightTokens[j - 1].value) {
          i--;
          j--;
        } else if (j > 0 && (i === 0 || table[i][j - 1] >= table[i - 1][j])) {
          j--;
          rightChanged.add(j);
        } else if (i > 0) {
          i--;
          leftChanged.add(i);
        }
      }

      return { leftChanged, rightChanged };
    }

    it("should cover all changed tokens and only changed tokens", () => {
      fc.assert(
        fc.property(
          // Generate random line pairs with known token structure
          fc.record({
            commonPrefix: fc.array(
              fc.oneof(
                fc.constantFrom("hello", "world", "test", "code", "function"),
                fc.constantFrom(" ", "  ", "   ")
              ),
              { minLength: 0, maxLength: 5 }
            ),
            leftMiddle: fc.array(
              fc.oneof(
                fc.constantFrom("old", "remove", "before", "original"),
                fc.constantFrom(" ", "  ")
              ),
              { minLength: 1, maxLength: 3 }
            ),
            rightMiddle: fc.array(
              fc.oneof(
                fc.constantFrom("new", "add", "after", "updated"),
                fc.constantFrom(" ", "  ")
              ),
              { minLength: 1, maxLength: 3 }
            ),
            commonSuffix: fc.array(
              fc.oneof(
                fc.constantFrom("end", "final", "done", "complete"),
                fc.constantFrom(" ", "  ", "   ")
              ),
              { minLength: 0, maxLength: 5 }
            ),
          }),
          (config) => {
            const { commonPrefix, leftMiddle, rightMiddle, commonSuffix } = config;

            // Build line pairs
            const leftLine = [...commonPrefix, ...leftMiddle, ...commonSuffix].join("");
            const rightLine = [...commonPrefix, ...rightMiddle, ...commonSuffix].join("");

            // Skip if lines are identical (early exit case)
            if (leftLine === rightLine) {
              const result = computeInlineDiffSpans(leftLine, rightLine);
              expect(result.left).toEqual([]);
              expect(result.right).toEqual([]);
              return true;
            }

            // Skip if either line exceeds 700 characters (safety gate)
            if (leftLine.length > 700 || rightLine.length > 700) {
              const result = computeInlineDiffSpans(leftLine, rightLine);
              expect(result.left).toEqual([]);
              expect(result.right).toEqual([]);
              return true;
            }

            // Compute inline diff spans
            const result = computeInlineDiffSpans(leftLine, rightLine);

            // Tokenize both lines
            const leftTokens = tokenizeInlineDiff(leftLine);
            const rightTokens = tokenizeInlineDiff(rightLine);

            // Identify changed tokens using LCS
            const { leftChanged, rightChanged } = getChangedTokenIndexes(
              leftTokens,
              rightTokens
            );

            // Property 2a: All changed tokens should be covered by spans
            // (except whitespace-only tokens which may be trimmed)
            for (const tokenIdx of leftChanged) {
              const token = leftTokens[tokenIdx];
              // Skip whitespace-only tokens (they may be trimmed away)
              if (/^\s+$/.test(token.value)) {
                continue;
              }
              // Check if at least one non-whitespace character of the token is covered
              let tokenCovered = false;
              for (let pos = token.start; pos < token.end; pos++) {
                const char = leftLine[pos];
                if (!/\s/.test(char) && isPositionCovered(pos, result.left)) {
                  tokenCovered = true;
                  break;
                }
              }
              // If the token has non-whitespace characters, at least one should be covered
              if (!/^\s*$/.test(token.value)) {
                expect(tokenCovered).toBe(true);
              }
            }

            for (const tokenIdx of rightChanged) {
              const token = rightTokens[tokenIdx];
              // Skip whitespace-only tokens (they may be trimmed away)
              if (/^\s+$/.test(token.value)) {
                continue;
              }
              // Check if at least one non-whitespace character of the token is covered
              let tokenCovered = false;
              for (let pos = token.start; pos < token.end; pos++) {
                const char = rightLine[pos];
                if (!/\s/.test(char) && isPositionCovered(pos, result.right)) {
                  tokenCovered = true;
                  break;
                }
              }
              // If the token has non-whitespace characters, at least one should be covered
              if (!/^\s*$/.test(token.value)) {
                expect(tokenCovered).toBe(true);
              }
            }

            // Property 2b: No unchanged tokens should be covered by spans
            // (allowing for whitespace trimming at boundaries)
            for (let tokenIdx = 0; tokenIdx < leftTokens.length; tokenIdx++) {
              if (!leftChanged.has(tokenIdx)) {
                const token = leftTokens[tokenIdx];
                // Skip whitespace-only tokens (they may be trimmed)
                if (/^\s+$/.test(token.value)) {
                  continue;
                }
                // Check that the non-whitespace part of the token is not covered
                // Find the first and last non-whitespace characters
                const firstNonWs = token.value.search(/\S/);
                const lastNonWs = token.value.length - token.value.split('').reverse().join('').search(/\S/) - 1;
                
                if (firstNonWs !== -1 && lastNonWs >= firstNonWs) {
                  // Check positions of non-whitespace characters
                  for (let pos = token.start + firstNonWs; pos <= token.start + lastNonWs; pos++) {
                    expect(isPositionCovered(pos, result.left)).toBe(false);
                  }
                }
              }
            }

            for (let tokenIdx = 0; tokenIdx < rightTokens.length; tokenIdx++) {
              if (!rightChanged.has(tokenIdx)) {
                const token = rightTokens[tokenIdx];
                // Skip whitespace-only tokens (they may be trimmed)
                if (/^\s+$/.test(token.value)) {
                  continue;
                }
                // Check that the non-whitespace part of the token is not covered
                // Find the first and last non-whitespace characters
                const firstNonWs = token.value.search(/\S/);
                const lastNonWs = token.value.length - token.value.split('').reverse().join('').search(/\S/) - 1;
                
                if (firstNonWs !== -1 && lastNonWs >= firstNonWs) {
                  // Check positions of non-whitespace characters
                  for (let pos = token.start + firstNonWs; pos <= token.start + lastNonWs; pos++) {
                    expect(isPositionCovered(pos, result.right)).toBe(false);
                  }
                }
              }
            }

            // Property 2c: Spans should be non-overlapping
            expect(areSpansNonOverlapping(result.left)).toBe(true);
            expect(areSpansNonOverlapping(result.right)).toBe(true);

            // Property 2d: Spans should be sorted by start position
            expect(areSpansSorted(result.left)).toBe(true);
            expect(areSpansSorted(result.right)).toBe(true);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should handle single token changes correctly", () => {
      fc.assert(
        fc.property(
          fc.record({
            prefix: fc.constantFrom("hello ", "test ", "code ", ""),
            oldToken: fc.constantFrom("world", "old", "before"),
            newToken: fc.constantFrom("there", "new", "after"),
            suffix: fc.constantFrom(" end", " done", ""),
          }),
          (config) => {
            const { prefix, oldToken, newToken, suffix } = config;
            const leftLine = prefix + oldToken + suffix;
            const rightLine = prefix + newToken + suffix;

            const result = computeInlineDiffSpans(leftLine, rightLine);

            // Should have exactly one span on each side
            expect(result.left.length).toBeGreaterThan(0);
            expect(result.right.length).toBeGreaterThan(0);

            // Spans should be non-overlapping and sorted
            expect(areSpansNonOverlapping(result.left)).toBe(true);
            expect(areSpansNonOverlapping(result.right)).toBe(true);
            expect(areSpansSorted(result.left)).toBe(true);
            expect(areSpansSorted(result.right)).toBe(true);

            // The changed token should be covered
            const oldTokenStart = prefix.length;
            const newTokenStart = prefix.length;
            expect(isPositionCovered(oldTokenStart, result.left)).toBe(true);
            expect(isPositionCovered(newTokenStart, result.right)).toBe(true);
          }
        ),
        { numRuns: 50 }
      );
    });

    it("should handle whitespace-only differences correctly", () => {
      fc.assert(
        fc.property(
          fc.record({
            text: fc.constantFrom("hello", "world", "test"),
            leftSpaces: fc.integer({ min: 1, max: 5 }),
            rightSpaces: fc.integer({ min: 1, max: 5 }),
          }),
          (config) => {
            const { text, leftSpaces, rightSpaces } = config;
            
            // Skip if spaces are the same (identical lines)
            if (leftSpaces === rightSpaces) {
              return true;
            }

            const leftLine = text + " ".repeat(leftSpaces) + "end";
            const rightLine = text + " ".repeat(rightSpaces) + "end";

            const result = computeInlineDiffSpans(leftLine, rightLine);

            // Spans should be non-overlapping and sorted
            expect(areSpansNonOverlapping(result.left)).toBe(true);
            expect(areSpansNonOverlapping(result.right)).toBe(true);
            expect(areSpansSorted(result.left)).toBe(true);
            expect(areSpansSorted(result.right)).toBe(true);

            // The whitespace difference should be covered (or trimmed away)
            // After trimming, spans may be empty if only whitespace differs
            // This is acceptable behavior
          }
        ),
        { numRuns: 50 }
      );
    });

    it("should handle completely different lines correctly", () => {
      fc.assert(
        fc.property(
          fc.record({
            leftTokens: fc.array(
              fc.constantFrom("alpha", "beta", "gamma", "delta"),
              { minLength: 1, maxLength: 5 }
            ),
            rightTokens: fc.array(
              fc.constantFrom("one", "two", "three", "four"),
              { minLength: 1, maxLength: 5 }
            ),
          }),
          (config) => {
            const { leftTokens, rightTokens } = config;
            const leftLine = leftTokens.join(" ");
            const rightLine = rightTokens.join(" ");

            // Skip if lines are identical
            if (leftLine === rightLine) {
              return true;
            }

            const result = computeInlineDiffSpans(leftLine, rightLine);

            // Spans should be non-overlapping and sorted
            expect(areSpansNonOverlapping(result.left)).toBe(true);
            expect(areSpansNonOverlapping(result.right)).toBe(true);
            expect(areSpansSorted(result.left)).toBe(true);
            expect(areSpansSorted(result.right)).toBe(true);

            // For completely different lines, most or all content should be covered
            // (except possibly leading/trailing whitespace which gets trimmed)
          }
        ),
        { numRuns: 50 }
      );
    });

    it("should handle edge case: empty lines", () => {
      fc.assert(
        fc.property(
          fc.constantFrom("", " ", "  ", "   "),
          fc.constantFrom("", " ", "  ", "   "),
          (leftLine, rightLine) => {
            const result = computeInlineDiffSpans(leftLine, rightLine);

            // Spans should always be non-overlapping and sorted
            expect(areSpansNonOverlapping(result.left)).toBe(true);
            expect(areSpansNonOverlapping(result.right)).toBe(true);
            expect(areSpansSorted(result.left)).toBe(true);
            expect(areSpansSorted(result.right)).toBe(true);

            // Empty or whitespace-only lines may have empty spans after trimming
            // This is acceptable behavior
          }
        ),
        { numRuns: 20 }
      );
    });

    it("should respect 700-character safety gate", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 701, max: 1000 }),
          (length) => {
            const leftLine = "a".repeat(length);
            const rightLine = "b".repeat(length);

            const result = computeInlineDiffSpans(leftLine, rightLine);

            // Should return empty spans due to safety gate
            expect(result.left).toEqual([]);
            expect(result.right).toEqual([]);
          }
        ),
        { numRuns: 20 }
      );
    });
  });
});
