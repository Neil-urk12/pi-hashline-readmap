/**
 * Diff presentation mode resolution: choose between unified and split view based on
 * configuration, terminal width, and layout feasibility.
 */

import type { DiffConfig, DiffPresentationMode } from "./diff-types.js";
import { RENDERING_CONSTANTS, DIFF_THEME_SLOTS } from "./diff-types.js";
import { getTerminalWidth } from "./terminal-width.js";

const { MIN_SPLIT_COLUMN_WIDTH, SPLIT_SEPARATOR_BARS, MIN_LINE_NUMBER_WIDTH } = RENDERING_CONSTANTS;

/**
 * Determine if the terminal width is sufficient to render a split-diff layout.
 * Estimates a minimal width assuming the longest line numbers are at least MIN_LINE_NUMBER_WIDTH.
 */
export function canRenderSplitLayout(width: number, config: DiffConfig): boolean {
  const separatorWidth = config.diffIndicatorMode === "classic" ? 1 : SPLIT_SEPARATOR_BARS.length;
  const overhead = 1 /* indent */ + MIN_LINE_NUMBER_WIDTH + 1 /* space */ + separatorWidth + MIN_LINE_NUMBER_WIDTH + 1 /* space */;
  const minContentWidth = MIN_SPLIT_COLUMN_WIDTH;
  const required = overhead + 2 * minContentWidth;
  return width >= required && width >= config.diffSplitMinWidth;
}

/**
 * Resolve which diff presentation mode to use.
 */
export function resolveDiffPresentationMode(
  config: DiffConfig,
  width?: number,
  canRenderSplit?: boolean,
): DiffPresentationMode {
  // Explicit user preference wins
  if (config.diffViewMode === "split") {
    return canRenderSplit !== false ? "split" : "unified";
  }
  if (config.diffViewMode === "unified") {
    return "unified";
  }

  // Auto mode: decide based on width and feasibility
  const termWidth = width ?? getTerminalWidth();
  const canSplit = canRenderSplit ?? canRenderSplitLayout(termWidth, config);
  return canSplit ? "split" : "unified";
}

/** Export DIFF_THEME_SLOTS for renderers (re-export) */
export { DIFF_THEME_SLOTS };
