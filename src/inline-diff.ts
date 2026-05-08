/**
 * Inline diff computation module
 *
 * This module implements token-level diff computation using the Longest Common Subsequence (LCS)
 * algorithm. It tokenizes line pairs, identifies common token subsequences, and converts
 * token-level changes to character-level DiffSpan ranges for inline emphasis rendering.
 *
 * Key features:
 * - Tokenization using regex pattern to capture whitespace, words, and punctuation
 * - LCS DP table construction and backtrace to identify changed tokens
 * - Conversion of token indexes to character ranges (DiffSpan)
 * - Merging of adjacent/overlapping spans
 * - Trimming of leading/trailing whitespace from span boundaries
 * - 700-character safety gate to prevent performance issues
 * - Early exit for identical lines
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7
 */

import type { DiffSpan, Token } from "./diff-types.js";

/**
 * Maximum line length for inline diff computation
 * Lines exceeding this length skip token-level analysis for performance
 */
const MAX_INLINE_DIFF_LINE_LENGTH = 700;

/**
 * Tokenization pattern for inline diff computation
 * Captures:
 * - Whitespace sequences (\s+)
 * - Word tokens ([A-Za-z0-9_]+)
 * - Punctuation and other characters ([^A-Za-z0-9_\s])
 */
const TOKENIZE_PATTERN = /(\s+|[A-Za-z0-9_]+|[^A-Za-z0-9_\s])/g;

/**
 * Normalize whitespace in code by converting tabs to 4 spaces
 * This ensures consistent tokenization and span computation
 *
 * @param text - Input text with potential tabs
 * @returns Text with tabs converted to 4 spaces
 */
export function normalizeCodeWhitespace(text: string): string {
  return text.replace(/\t/g, "    ");
}

/**
 * Tokenize a line into whitespace, word, and punctuation tokens
 * Each token captures its value and character position in the original line
 *
 * @param input - Line to tokenize
 * @returns Array of tokens with value, start, and end positions
 */
export function tokenizeInlineDiff(input: string): Token[] {
  const tokens: Token[] = [];
  const normalized = normalizeCodeWhitespace(input);
  let match: RegExpExecArray | null;

  while ((match = TOKENIZE_PATTERN.exec(normalized)) !== null) {
    tokens.push({
      value: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  return tokens;
}

/**
 * Build LCS DP table for two token arrays
 * table[i][j] represents the length of the longest common subsequence
 * of leftTokens[0..i-1] and rightTokens[0..j-1]
 *
 * Algorithm:
 * - If tokens match: table[i][j] = table[i-1][j-1] + 1
 * - Else: table[i][j] = max(table[i-1][j], table[i][j-1])
 *
 * @param leftTokens - Tokens from left line
 * @param rightTokens - Tokens from right line
 * @returns 2D DP table
 */
function buildLcsTable(leftTokens: Token[], rightTokens: Token[]): number[][] {
  const leftCount = leftTokens.length;
  const rightCount = rightTokens.length;

  // Initialize table with dimensions [leftCount+1][rightCount+1]
  const table: number[][] = Array.from({ length: leftCount + 1 }, () =>
    Array(rightCount + 1).fill(0)
  );

  // Fill DP table
  for (let i = 1; i <= leftCount; i++) {
    for (let j = 1; j <= rightCount; j++) {
      if (leftTokens[i - 1].value === rightTokens[j - 1].value) {
        // Tokens match: extend LCS by 1
        table[i][j] = table[i - 1][j - 1] + 1;
      } else {
        // Tokens differ: take max of excluding left or right token
        table[i][j] = Math.max(table[i - 1][j], table[i][j - 1]);
      }
    }
  }

  return table;
}

/**
 * Backtrace through LCS DP table to identify changed token indexes
 * Walks backwards from table[leftCount][rightCount] to identify tokens
 * not in the LCS (i.e., changed tokens)
 *
 * @param table - LCS DP table
 * @param leftTokens - Tokens from left line
 * @param rightTokens - Tokens from right line
 * @returns Object with sets of changed token indexes for left and right
 */
function backtraceChangedTokens(
  table: number[][],
  leftTokens: Token[],
  rightTokens: Token[]
): { leftChanged: Set<number>; rightChanged: Set<number> } {
  const leftChanged = new Set<number>();
  const rightChanged = new Set<number>();

  let i = leftTokens.length;
  let j = rightTokens.length;

  // Backtrace from bottom-right to top-left
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && leftTokens[i - 1].value === rightTokens[j - 1].value) {
      // Tokens match: part of LCS, move diagonally
      i--;
      j--;
    } else if (j > 0 && (i === 0 || table[i][j - 1] >= table[i - 1][j])) {
      // Right token not in LCS: mark as changed, move left
      j--;
      rightChanged.add(j);
    } else if (i > 0) {
      // Left token not in LCS: mark as changed, move up
      i--;
      leftChanged.add(i);
    }
  }

  return { leftChanged, rightChanged };
}

/**
 * Convert changed token indexes to character-level DiffSpan ranges
 * Merges adjacent/overlapping spans and trims whitespace boundaries
 *
 * @param text - Original line text
 * @param tokens - Token array
 * @param changedIndexes - Set of changed token indexes
 * @returns Array of DiffSpan ranges
 */
export function tokensToDiffSpans(
  text: string,
  tokens: Token[],
  changedIndexes: Set<number>
): DiffSpan[] {
  if (changedIndexes.size === 0) {
    return [];
  }

  // Convert token indexes to character spans
  const spans: DiffSpan[] = [];
  for (const idx of changedIndexes) {
    const token = tokens[idx];
    spans.push({ start: token.start, end: token.end });
  }

  // Sort spans by start position
  spans.sort((a, b) => a.start - b.start);

  // Merge adjacent/overlapping spans
  const merged = mergeSpans(spans);

  // Trim leading/trailing whitespace from each span
  const trimmed = merged.map((span) => trimSpanWhitespace(text, span));

  // Filter out empty spans (can occur after trimming)
  return trimmed.filter((span) => span.start < span.end);
}

/**
 * Merge adjacent or overlapping DiffSpan ranges
 * Assumes spans are sorted by start position
 *
 * @param spans - Sorted array of DiffSpan ranges
 * @returns Array of merged DiffSpan ranges
 */
export function mergeSpans(spans: DiffSpan[]): DiffSpan[] {
  if (spans.length === 0) {
    return [];
  }

  const merged: DiffSpan[] = [];
  let current = { ...spans[0] };

  for (let i = 1; i < spans.length; i++) {
    const next = spans[i];

    if (next.start <= current.end) {
      // Overlapping or adjacent: merge by extending current span
      current.end = Math.max(current.end, next.end);
    } else {
      // Non-overlapping: push current and start new span
      merged.push(current);
      current = { ...next };
    }
  }

  // Push final span
  merged.push(current);

  return merged;
}

/**
 * Trim leading and trailing whitespace from a DiffSpan boundary
 * Adjusts start and end positions to exclude whitespace characters
 *
 * @param text - Original line text
 * @param span - DiffSpan to trim
 * @returns Trimmed DiffSpan
 */
function trimSpanWhitespace(text: string, span: DiffSpan): DiffSpan {
  let start = span.start;
  let end = span.end;

  // Trim leading whitespace
  while (start < end && /\s/.test(text[start])) {
    start++;
  }

  // Trim trailing whitespace
  while (end > start && /\s/.test(text[end - 1])) {
    end--;
  }

  return { start, end };
}

/**
 * Compute character-level inline diff spans for a pair of changed lines
 * Uses LCS algorithm to identify common token subsequences and converts
 * token-level changes to character-level DiffSpan ranges
 *
 * Early exits:
 * - If lines are identical, returns empty spans
 * - If either line exceeds 700 characters, returns empty spans (performance gate)
 *
 * Algorithm:
 * 1. Tokenize both lines using regex pattern
 * 2. Build LCS DP table
 * 3. Backtrace to identify changed tokens
 * 4. Convert token indexes to character ranges
 * 5. Merge adjacent spans
 * 6. Trim whitespace boundaries
 *
 * @param leftLine - Old line content
 * @param rightLine - New line content
 * @returns Object with left and right DiffSpan arrays
 */
export function computeInlineDiffSpans(
  leftLine: string,
  rightLine: string
): { left: DiffSpan[]; right: DiffSpan[] } {
  // Early exit: identical lines
  if (leftLine === rightLine) {
    return { left: [], right: [] };
  }

  // Early exit: line length safety gate
  if (
    leftLine.length > MAX_INLINE_DIFF_LINE_LENGTH ||
    rightLine.length > MAX_INLINE_DIFF_LINE_LENGTH
  ) {
    return { left: [], right: [] };
  }

  // Tokenize both lines
  const leftTokens = tokenizeInlineDiff(leftLine);
  const rightTokens = tokenizeInlineDiff(rightLine);

  // Handle empty token arrays (shouldn't happen with valid input, but be defensive)
  if (leftTokens.length === 0 && rightTokens.length === 0) {
    return { left: [], right: [] };
  }

  // Build LCS DP table
  const table = buildLcsTable(leftTokens, rightTokens);

  // Backtrace to identify changed tokens
  const { leftChanged, rightChanged } = backtraceChangedTokens(
    table,
    leftTokens,
    rightTokens
  );

  // Convert token indexes to character spans
  const leftSpans = tokensToDiffSpans(leftLine, leftTokens, leftChanged);
  const rightSpans = tokensToDiffSpans(rightLine, rightTokens, rightChanged);

  return { left: leftSpans, right: rightSpans };
}

/**
 * Compute inline highlights for all line pairs in a parsed diff
 * Creates a WeakMap cache of computed spans keyed by DiffLineEntry
 *
 * Algorithm:
 * 1. Create WeakMap to cache computed spans
 * 2. Iterate over parsed diff entries
 * 3. For each add/remove pair, call computeInlineDiffSpans()
 * 4. Store results in WeakMap keyed by DiffLineEntry
 *
 * The function pairs consecutive remove/add lines and computes inline
 * highlights for each pair. Unpaired lines (standalone adds or removes)
 * get empty span arrays.
 *
 * @param parsed - Parsed diff structure with entries
 * @returns WeakMap mapping DiffLineEntry to DiffSpan arrays
 *
 * Requirements: 2.8
 */
export function computeInlineHighlights(
  parsed: import("./diff-types.js").ParsedDiff
): WeakMap<import("./diff-types.js").DiffLineEntry, DiffSpan[]> {
  const inlineHighlights = new WeakMap<
    import("./diff-types.js").DiffLineEntry,
    DiffSpan[]
  >();

  const entries = parsed.entries;
  let i = 0;

  while (i < entries.length) {
    const entry = entries[i];

    // Only process line entries
    if (entry.kind !== "line") {
      i++;
      continue;
    }

    // Check if this is a remove line followed by an add line (a pair)
    if (entry.lineKind === "remove" && i + 1 < entries.length) {
      const nextEntry = entries[i + 1];

      if (nextEntry.kind === "line" && nextEntry.lineKind === "add") {
        // We have a remove/add pair - compute inline diff spans
        const { left, right } = computeInlineDiffSpans(
          entry.content,
          nextEntry.content
        );

        // Store spans for both entries
        inlineHighlights.set(entry, left);
        inlineHighlights.set(nextEntry, right);

        // Skip the next entry since we processed it as part of the pair
        i += 2;
        continue;
      }
    }

    // For unpaired add/remove lines, store empty spans
    if (entry.lineKind === "add" || entry.lineKind === "remove") {
      inlineHighlights.set(entry, []);
    }

    i++;
  }

  return inlineHighlights;
}
