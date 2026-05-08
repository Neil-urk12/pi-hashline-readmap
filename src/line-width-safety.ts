/**
 * Width management utilities for diff rendering.
 * 
 * Provides functions to normalize, clamp, and truncate rendered lines to fit
 * within terminal width constraints while accounting for ANSI sequences and
 * wide Unicode characters.
 */

import { visibleWidth, truncateToWidth } from "@mariozechner/pi-tui";

/**
 * Minimum terminal width required for unified diff rendering.
 * Below this threshold, fallback to compact mode.
 */
export const MIN_UNIFIED_DIFF_WIDTH = 18;

/**
 * Minimum terminal width required for compact diff rendering.
 * Below this threshold, fallback to summary mode.
 */
export const MIN_COMPACT_DIFF_WIDTH = 8;

/**
 * Normalizes a diff render width to a safe positive integer.
 * 
 * Clamps the width to floor(max(0, width)) to ensure:
 * - No negative widths
 * - Integer values only (no fractional columns)
 * 
 * @param width - The raw width value to normalize
 * @returns A non-negative integer width
 */
export function normalizeDiffRenderWidth(width: number): number {
  return Math.floor(Math.max(0, width));
}

/**
 * Clamps a rendered line to a maximum visible width using iterative truncation.
 * 
 * This function measures the visible width of the line (accounting for ANSI
 * sequences and wide Unicode characters) and truncates it if it exceeds the
 * maximum width. Uses an empty ellipsis (no "..." suffix) for clean truncation.
 * 
 * The iterative approach handles edge cases where ANSI sequences or wide
 * characters cause the truncated line to still exceed the target width.
 * 
 * @param line - The rendered line with ANSI codes
 * @param maxWidth - The maximum visible width allowed
 * @returns The clamped line, or the original if it fits
 */
export function clampRenderedLineToWidth(line: string, maxWidth: number): string {
  // Normalize the max width
  const normalizedWidth = normalizeDiffRenderWidth(maxWidth);
  
  // If max width is 0, return empty string
  if (normalizedWidth === 0) {
    return "";
  }
  
  // Measure current visible width
  let currentWidth = visibleWidth(line);
  
  // If line already fits, return as-is
  if (currentWidth <= normalizedWidth) {
    return line;
  }
  
  // Iteratively truncate until line fits
  let truncated = line;
  let iterations = 0;
  const MAX_ITERATIONS = 10; // Safety limit to prevent infinite loops
  
  while (currentWidth > normalizedWidth && iterations < MAX_ITERATIONS) {
    // Truncate with empty ellipsis (no "..." suffix)
    truncated = truncateToWidth(truncated, normalizedWidth, "");
    currentWidth = visibleWidth(truncated);
    iterations++;
  }
  
  return truncated;
}

/**
 * Clamps an array of rendered lines to a maximum visible width.
 * 
 * Applies `clampRenderedLineToWidth()` to each line in the array.
 * 
 * @param lines - Array of rendered lines with ANSI codes
 * @param maxWidth - The maximum visible width allowed
 * @returns Array of clamped lines
 */
export function clampRenderedLinesToWidth(lines: string[], maxWidth: number): string[] {
  return lines.map(line => clampRenderedLineToWidth(line, maxWidth));
}
