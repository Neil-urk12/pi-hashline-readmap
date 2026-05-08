/**
 * Diff Parser
 *
 * Parses unified diff text into structured ParsedDiff objects.
 * Recognizes canonical diff lines, hunk headers, file headers, and meta lines.
 * Maintains line number cursors across hunks for accurate numbering.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8
 */

import type {
  ParsedDiff,
  ParsedDiffEntry,
  DiffLineEntry,
  DiffMetaEntry,
  DiffStats,
  DiffLineKind,
} from "./diff-types.js";

/**
 * Regex patterns for diff line recognition
 */
const CANONICAL_LINE_PATTERN = /^([+\- ])(\s*\d+)\|(.*)$/;
const LEGACY_LINE_PATTERN = /^([+\- ])(\s*\d+)\s(.*)$/;
const HUNK_HEADER_PATTERN = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)$/;

/**
 * Parse a unified diff string into a structured ParsedDiff object.
 *
 * Algorithm:
 * 1. Split diff text into lines
 * 2. For each line:
 *    - Match against hunk header pattern
 *    - Match against canonical line pattern
 *    - Match against file header pattern
 *    - Classify as meta if no pattern matches
 * 3. Maintain oldLineCursor and newLineCursor to track line numbers
 * 4. Update cursors based on line kind (add increments new, remove increments old, context increments both)
 * 5. Compute lineNumberDelta to handle hunk transitions
 * 6. Accumulate statistics for each line type
 *
 * @param diffText - Unified diff string to parse
 * @returns Structured ParsedDiff with entries and statistics
 */
export function parseDiff(diffText: string): ParsedDiff {
  const lines = diffText.split("\n");
  const entries: ParsedDiffEntry[] = [];
  const stats: DiffStats = {
    added: 0,
    removed: 0,
    context: 0,
    hunks: 0,
    files: 0,
    lines: lines.length,
  };

  let oldLineCursor: number | null = null;
  let newLineCursor: number | null = null;
  let lineNumberDelta = 0;
  let currentHunkIndex = 0;
  let hasSeenHunkHeader = false;

  for (const raw of lines) {
    // Match hunk header: @@ -10,5 +10,6 @@
    const hunkMatch = raw.match(HUNK_HEADER_PATTERN);
    if (hunkMatch) {
      currentHunkIndex++;
      hasSeenHunkHeader = true;
      stats.hunks++;

      const oldStart = parseInt(hunkMatch[1], 10);
      const newStart = parseInt(hunkMatch[3], 10);

      // Anchor cursors to hunk header line numbers
      oldLineCursor = oldStart;
      newLineCursor = newStart;
      lineNumberDelta = newLineCursor - oldLineCursor;

      entries.push({
        kind: "hunk",
        raw,
        hunkIndex: currentHunkIndex,
      });
      continue;
    }

    // Match file header: diff --git a/file b/file
    if (raw.startsWith("diff --git")) {
      stats.files++;
      oldLineCursor = null;
      newLineCursor = null;
      lineNumberDelta = 0;

      entries.push({
        kind: "file",
        raw,
        hunkIndex: 0,
      });
      continue;
    }

    // Match canonical line: + 123|content or - 123|content or   123|content
    const canonicalMatch = raw.match(CANONICAL_LINE_PATTERN);
    if (canonicalMatch) {
      const prefix = canonicalMatch[1];
      const lineNumStr = canonicalMatch[2].trim();
      const content = canonicalMatch[3];

      // Ensure implicit hunk if lines appear before first explicit hunk header
      if (!hasSeenHunkHeader) {
        ensureImplicitHunk(entries, stats);
        currentHunkIndex = 1;
        hasSeenHunkHeader = true;
        oldLineCursor = 1;
        newLineCursor = 1;
        lineNumberDelta = 0;
      }

      const lineEntry = createLineEntry(
        prefix,
        lineNumStr,
        content,
        raw,
        currentHunkIndex,
        oldLineCursor,
        newLineCursor,
        lineNumberDelta
      );

      entries.push(lineEntry);
      updateStats(stats, lineEntry.lineKind);
      updateCursors(lineEntry.lineKind, oldLineCursor, newLineCursor);

      // Update cursors for next iteration
      if (lineEntry.lineKind === "add") {
        if (newLineCursor !== null) newLineCursor++;
        lineNumberDelta++;
      } else if (lineEntry.lineKind === "remove") {
        if (oldLineCursor !== null) oldLineCursor++;
        lineNumberDelta--;
      } else {
        // context
        if (oldLineCursor !== null) oldLineCursor++;
        if (newLineCursor !== null) newLineCursor++;
      }

      continue;
    }

    // Match legacy line: + 123 content or - 123 content or   123 content
    const legacyMatch = raw.match(LEGACY_LINE_PATTERN);
    if (legacyMatch) {
      const prefix = legacyMatch[1];
      const lineNumStr = legacyMatch[2].trim();
      const content = legacyMatch[3];

      // Ensure implicit hunk if lines appear before first explicit hunk header
      if (!hasSeenHunkHeader) {
        ensureImplicitHunk(entries, stats);
        currentHunkIndex = 1;
        hasSeenHunkHeader = true;
        oldLineCursor = 1;
        newLineCursor = 1;
        lineNumberDelta = 0;
      }

      const lineEntry = createLineEntry(
        prefix,
        lineNumStr,
        content,
        raw,
        currentHunkIndex,
        oldLineCursor,
        newLineCursor,
        lineNumberDelta
      );

      entries.push(lineEntry);
      updateStats(stats, lineEntry.lineKind);

      // Update cursors for next iteration
      if (lineEntry.lineKind === "add") {
        if (newLineCursor !== null) newLineCursor++;
        lineNumberDelta++;
      } else if (lineEntry.lineKind === "remove") {
        if (oldLineCursor !== null) oldLineCursor++;
        lineNumberDelta--;
      } else {
        // context
        if (oldLineCursor !== null) oldLineCursor++;
        if (newLineCursor !== null) newLineCursor++;
      }

      continue;
    }

    // Unrecognized line: treat as meta
    entries.push({
      kind: "meta",
      raw,
      hunkIndex: currentHunkIndex,
    });
  }

  return { entries, stats };
}

/**
 * Create an implicit hunk header when lines appear before the first explicit hunk header.
 * This ensures all lines belong to a hunk.
 */
function ensureImplicitHunk(entries: ParsedDiffEntry[], stats: DiffStats): void {
  entries.push({
    kind: "hunk",
    raw: "@@ -1 +1 @@",
    hunkIndex: 1,
  });
  stats.hunks++;
}

/**
 * Create a DiffLineEntry from parsed line components.
 */
function createLineEntry(
  prefix: string,
  lineNumStr: string,
  content: string,
  raw: string,
  hunkIndex: number,
  oldLineCursor: number | null,
  newLineCursor: number | null,
  lineNumberDelta: number
): DiffLineEntry {
  let lineKind: DiffLineKind;
  let oldLineNumber: number | null;
  let newLineNumber: number | null;
  let fallbackLineNumber: string;

  if (prefix === "+") {
    lineKind = "add";
    oldLineNumber = null;
    newLineNumber = newLineCursor;
    fallbackLineNumber = lineNumStr;
  } else if (prefix === "-") {
    lineKind = "remove";
    oldLineNumber = oldLineCursor;
    newLineNumber = null;
    fallbackLineNumber = lineNumStr;
  } else {
    // context (prefix is " ")
    lineKind = "context";
    oldLineNumber = oldLineCursor;
    newLineNumber = newLineCursor;
    fallbackLineNumber = lineNumStr;
  }

  return {
    kind: "line",
    lineKind,
    oldLineNumber,
    newLineNumber,
    fallbackLineNumber,
    content,
    raw,
    hunkIndex,
  };
}

/**
 * Update statistics based on line kind.
 */
function updateStats(stats: DiffStats, lineKind: DiffLineKind): void {
  if (lineKind === "add") {
    stats.added++;
  } else if (lineKind === "remove") {
    stats.removed++;
  } else {
    stats.context++;
  }
}

/**
 * Update line number cursors based on line kind.
 * This function is called to mutate the cursor variables in place.
 */
function updateCursors(
  lineKind: DiffLineKind,
  oldLineCursor: number | null,
  newLineCursor: number | null
): void {
  // Note: This function is a placeholder for documentation purposes.
  // The actual cursor updates happen in the main loop after creating the line entry.
  // This function exists to document the cursor update logic.
}
