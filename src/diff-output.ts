/**
 * Build structured diff data for rendering.
 * Bridges from plain unified diff strings to split-row structures with inline highlights.
 */

import type { DiffData, DiffPresentationMode, DiffConfig, DiffSpan } from "./diff-types.js";
import { parseDiff, buildSplitRows, attachInlineSpans } from "./diff-renderer-core.js";
import { generateDiffString } from "./edit-diff.js";

/**
 * Compute full unified diff string (no compacting). Used for split rendering.
 */
function computeUnifiedDiff(oldContent: string, newContent: string): string {
  return generateDiffString(oldContent, newContent, 4).diff;
}

/**
 * Build structured diff data for the given contents and presentation mode.
 * Returns either unified diff string or split rows + highlights.
 */
export function buildStructuredDiff(
  oldContent: string,
  newContent: string,
  mode: DiffPresentationMode,
  config: DiffConfig,
  width?: number,
  unifiedDiff?: string,
): DiffData {
  if (mode === "unified") {
    const diffText = computeUnifiedDiff(oldContent, newContent);
    return { mode: "unified", diff: diffText };
  }

  // Split mode: parse full unified diff, transform into rows, attach inline spans
  const unified = unifiedDiff ?? computeUnifiedDiff(oldContent, newContent);
  const parsed = parseDiff(unified);
  const rows = buildSplitRows(parsed.entries, config.diffIndicatorMode);

  // Precompute inline highlights and attach to rows
  attachInlineSpans(rows);

  // Build WeakMap for external lookup (optional but part of spec)
  const highlightsMap = new WeakMap<object, DiffSpan[]>();
  for (const row of rows) {
    if (row.left?.entry) {
      highlightsMap.set(row.left.entry, row.left.highlights ?? []);
    }
    if (row.right?.entry) {
      highlightsMap.set(row.right.entry, row.right.highlights ?? []);
    }
  }

  return {
    mode: "split",
    splitRows: rows,
    inlineHighlights: highlightsMap,
    stats: parsed.stats,
  };
}

/** Convenience: unified mode only (single return string). */
export function buildUnifiedDiff(oldContent: string, newContent: string): string {
  return computeUnifiedDiff(oldContent, newContent);
}
