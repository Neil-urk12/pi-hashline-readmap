/**
 * Presentation mode resolution
 *
 * This module determines the appropriate presentation mode for diff rendering
 * based on terminal width and configuration settings.
 *
 * Width thresholds:
 * - < 8 columns: summary mode (minimal summary line only)
 * - < 18 columns: compact mode (compact diff without inline highlights)
 * - >= 18 columns: unified or split mode (based on config and width)
 *
 * Split mode requires width >= diffSplitMinWidth (default 120)
 */

import type { PresentationMode, DiffConfig } from "./diff-types";

/**
 * Minimum width thresholds for each presentation mode
 */
const MIN_SUMMARY_WIDTH = 0;
const MIN_COMPACT_WIDTH = 8;
const MIN_UNIFIED_WIDTH = 18;

/**
 * Check if split layout can be rendered given the current width and config
 *
 * @param width - Terminal width in columns
 * @param config - Diff configuration
 * @returns True if width >= diffSplitMinWidth
 *
 * Requirements: 3.10, 7.5
 */
export function canRenderSplitLayout(
  width: number,
  config: DiffConfig
): boolean {
  return width >= config.diffSplitMinWidth;
}

/**
 * Resolve presentation mode based on terminal width and configuration
 *
 * Applies width thresholds:
 * - width < 8: summary mode
 * - width < 18: compact mode
 * - width >= 18: unified or split based on config and canRenderSplitLayout()
 *
 * For "auto" mode:
 * - If width >= diffSplitMinWidth: split mode
 * - Otherwise: unified mode
 *
 * For explicit "split" or "unified" modes:
 * - If width < 18: fall back to compact or summary
 * - Otherwise: use the requested mode (if split, check canRenderSplitLayout)
 *
 * @param width - Terminal width in columns
 * @param config - Diff configuration
 * @returns Resolved presentation mode
 *
 * Requirements: 3.10, 7.5
 */
export function resolvePresentationMode(
  width: number,
  config: DiffConfig
): PresentationMode {
  // Apply width thresholds
  if (width < MIN_COMPACT_WIDTH) {
    return "summary";
  }

  if (width < MIN_UNIFIED_WIDTH) {
    return "compact";
  }

  // Width >= 18: resolve based on config.diffViewMode
  const viewMode = config.diffViewMode;

  if (viewMode === "auto") {
    // Auto mode: choose split if width allows, otherwise unified
    if (canRenderSplitLayout(width, config)) {
      return "split";
    }
    return "unified";
  }

  if (viewMode === "split") {
    // Explicit split mode: check if width allows
    if (canRenderSplitLayout(width, config)) {
      return "split";
    }
    // Fall back to unified if split not possible
    return "unified";
  }

  // Explicit unified mode
  return "unified";
}
