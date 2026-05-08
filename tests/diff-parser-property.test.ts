/**
 * Property-based tests for diff parser
 * 
 * **Validates: Requirements 1.6**
 * 
 * Property 1: Statistics consistency
 * - Generate random unified diffs with known line counts
 * - Verify parsed stats match expected counts (added + removed + context = total lines)
 * - Verify hunk count matches number of @@ headers
 * - Verify file count matches number of diff --git headers
 */

import { describe, it, expect, beforeAll } from "vitest";
import { parseDiff } from "../src/diff-parser";
import { ensureHashInit } from "../src/hashline";
import * as fc from "fast-check";

describe("parseDiff - Property-based tests", () => {
  beforeAll(() => {
    ensureHashInit();
  });

  describe("Property 1: Statistics consistency", () => {
    it("should have consistent statistics for randomly generated diffs", () => {
      fc.assert(
        fc.property(
          // Generate random diff components
          fc.record({
            fileCount: fc.integer({ min: 0, max: 5 }),
            hunksPerFile: fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 0, maxLength: 5 }),
            linesPerHunk: fc.array(
              fc.record({
                added: fc.integer({ min: 0, max: 10 }),
                removed: fc.integer({ min: 0, max: 10 }),
                context: fc.integer({ min: 0, max: 10 }),
              }),
              { minLength: 0, maxLength: 15 }
            ),
          }),
          (config) => {
            // Build a unified diff string from the configuration
            const { fileCount, hunksPerFile, linesPerHunk } = config;
            
            let diffText = "";
            let expectedAdded = 0;
            let expectedRemoved = 0;
            let expectedContext = 0;
            let expectedHunks = 0;
            let expectedFiles = fileCount;
            let hunkIndex = 0;

            for (let fileIdx = 0; fileIdx < fileCount; fileIdx++) {
              // Add file header
              diffText += `diff --git a/file${fileIdx}.txt b/file${fileIdx}.txt\n`;
              
              const numHunks = hunksPerFile[fileIdx] || 0;
              
              for (let hunkIdx = 0; hunkIdx < numHunks; hunkIdx++) {
                if (hunkIndex >= linesPerHunk.length) break;
                
                const hunkLines = linesPerHunk[hunkIndex];
                const { added, removed, context } = hunkLines;
                
                // Skip empty hunks
                if (added === 0 && removed === 0 && context === 0) {
                  hunkIndex++;
                  continue;
                }
                
                expectedHunks++;
                expectedAdded += added;
                expectedRemoved += removed;
                expectedContext += context;
                
                // Add hunk header
                const oldCount = removed + context;
                const newCount = added + context;
                const oldStart = 1 + hunkIdx * 10;
                const newStart = 1 + hunkIdx * 10;
                diffText += `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n`;
                
                // Add context lines
                for (let i = 0; i < context; i++) {
                  diffText += ` ${oldStart + i}|context line ${i}\n`;
                }
                
                // Add removed lines
                for (let i = 0; i < removed; i++) {
                  diffText += `-${oldStart + context + i}|removed line ${i}\n`;
                }
                
                // Add added lines
                for (let i = 0; i < added; i++) {
                  diffText += `+${newStart + context + i}|added line ${i}\n`;
                }
                
                hunkIndex++;
              }
            }

            // Parse the generated diff
            const result = parseDiff(diffText);

            // Verify statistics consistency
            // Property 1a: added + removed + context should equal the count of line entries
            const lineEntries = result.entries.filter(e => e.kind === "line");
            const actualLineCount = lineEntries.length;
            const expectedLineCount = expectedAdded + expectedRemoved + expectedContext;
            
            expect(actualLineCount).toBe(expectedLineCount);
            
            // Property 1b: parsed stats should match expected counts
            expect(result.stats.added).toBe(expectedAdded);
            expect(result.stats.removed).toBe(expectedRemoved);
            expect(result.stats.context).toBe(expectedContext);
            
            // Property 1c: hunk count should match number of @@ headers
            expect(result.stats.hunks).toBe(expectedHunks);
            
            // Property 1d: file count should match number of diff --git headers
            expect(result.stats.files).toBe(expectedFiles);
            
            // Property 1e: stats.lines should match total number of lines in diff
            const totalLines = diffText.split("\n").length;
            expect(result.stats.lines).toBe(totalLines);
          }
        ),
        { numRuns: 100 } // Run 100 random test cases
      );
    });

    it("should handle edge case: empty diff", () => {
      fc.assert(
        fc.property(fc.constant(""), (diffText) => {
          const result = parseDiff(diffText);
          
          // Empty diff should have zero stats except for lines count
          expect(result.stats.added).toBe(0);
          expect(result.stats.removed).toBe(0);
          expect(result.stats.context).toBe(0);
          expect(result.stats.hunks).toBe(0);
          expect(result.stats.files).toBe(0);
          expect(result.stats.lines).toBe(1); // Empty string splits to [""]
        })
      );
    });

    it("should handle diffs with only file headers (no hunks)", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10 }),
          (fileCount) => {
            let diffText = "";
            for (let i = 0; i < fileCount; i++) {
              diffText += `diff --git a/file${i}.txt b/file${i}.txt\n`;
            }
            
            const result = parseDiff(diffText);
            
            expect(result.stats.files).toBe(fileCount);
            expect(result.stats.hunks).toBe(0);
            expect(result.stats.added).toBe(0);
            expect(result.stats.removed).toBe(0);
            expect(result.stats.context).toBe(0);
          }
        ),
        { numRuns: 50 }
      );
    });

    it("should handle diffs with lines but no explicit hunk headers (implicit hunk)", () => {
      fc.assert(
        fc.property(
          fc.record({
            added: fc.integer({ min: 0, max: 10 }),
            removed: fc.integer({ min: 0, max: 10 }),
            context: fc.integer({ min: 0, max: 10 }),
          }),
          (lines) => {
            const { added, removed, context } = lines;
            
            // Skip if all zero (would be empty diff)
            if (added === 0 && removed === 0 && context === 0) {
              return true;
            }
            
            let diffText = "";
            let lineNum = 1;
            
            // Add context lines
            for (let i = 0; i < context; i++) {
              diffText += ` ${lineNum++}|context line ${i}\n`;
            }
            
            // Add removed lines
            for (let i = 0; i < removed; i++) {
              diffText += `-${lineNum++}|removed line ${i}\n`;
            }
            
            // Add added lines
            for (let i = 0; i < added; i++) {
              diffText += `+${lineNum++}|added line ${i}\n`;
            }
            
            const result = parseDiff(diffText);
            
            // Should create implicit hunk
            expect(result.stats.hunks).toBe(1);
            expect(result.stats.added).toBe(added);
            expect(result.stats.removed).toBe(removed);
            expect(result.stats.context).toBe(context);
            
            // Verify implicit hunk header was created
            const hunkEntry = result.entries.find(e => e.kind === "hunk");
            expect(hunkEntry).toBeDefined();
            expect(hunkEntry?.raw).toBe("@@ -1 +1 @@");
          }
        ),
        { numRuns: 50 }
      );
    });

    it("should maintain consistency across multiple files and hunks", () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              fileName: fc.string({ minLength: 1, maxLength: 20 }),
              hunks: fc.array(
                fc.record({
                  added: fc.integer({ min: 0, max: 5 }),
                  removed: fc.integer({ min: 0, max: 5 }),
                  context: fc.integer({ min: 0, max: 5 }),
                }),
                { minLength: 0, maxLength: 3 }
              ),
            }),
            { minLength: 1, maxLength: 5 }
          ),
          (files) => {
            let diffText = "";
            let totalAdded = 0;
            let totalRemoved = 0;
            let totalContext = 0;
            let totalHunks = 0;
            let totalFiles = files.length;
            
            for (const file of files) {
              diffText += `diff --git a/${file.fileName} b/${file.fileName}\n`;
              
              for (let hunkIdx = 0; hunkIdx < file.hunks.length; hunkIdx++) {
                const hunk = file.hunks[hunkIdx];
                const { added, removed, context } = hunk;
                
                // Skip empty hunks
                if (added === 0 && removed === 0 && context === 0) {
                  continue;
                }
                
                totalHunks++;
                totalAdded += added;
                totalRemoved += removed;
                totalContext += context;
                
                const oldCount = removed + context;
                const newCount = added + context;
                const oldStart = 1 + hunkIdx * 10;
                const newStart = 1 + hunkIdx * 10;
                diffText += `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n`;
                
                let lineNum = oldStart;
                
                // Add context lines
                for (let i = 0; i < context; i++) {
                  diffText += ` ${lineNum++}|context ${i}\n`;
                }
                
                // Add removed lines
                for (let i = 0; i < removed; i++) {
                  diffText += `-${lineNum++}|removed ${i}\n`;
                }
                
                // Add added lines (use newStart for line numbers)
                for (let i = 0; i < added; i++) {
                  diffText += `+${newStart + context + i}|added ${i}\n`;
                }
              }
            }
            
            const result = parseDiff(diffText);
            
            // Verify all statistics match
            expect(result.stats.files).toBe(totalFiles);
            expect(result.stats.hunks).toBe(totalHunks);
            expect(result.stats.added).toBe(totalAdded);
            expect(result.stats.removed).toBe(totalRemoved);
            expect(result.stats.context).toBe(totalContext);
            
            // Verify line entries sum matches
            const lineEntries = result.entries.filter(e => e.kind === "line");
            expect(lineEntries.length).toBe(totalAdded + totalRemoved + totalContext);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
