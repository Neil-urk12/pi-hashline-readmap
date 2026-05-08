/**
 * Terminal width detection
 *
 * This module provides terminal width detection with multiple fallback strategies:
 * 1. Read from process.stdout.columns (primary source)
 * 2. Fall back to process.env.COLUMNS environment variable
 * 3. Fall back to default of 120 columns
 *
 * The function is designed to be called at render time (not module load time)
 * to respect terminal resize events.
 */

/**
 * Default terminal width when no other source is available
 */
const DEFAULT_TERMINAL_WIDTH = 120;

/**
 * Get the current terminal width
 *
 * Returns the terminal width as a positive integer by checking:
 * 1. process.stdout.columns (primary source)
 * 2. process.env.COLUMNS (fallback when stdout unavailable)
 * 3. 120 (default fallback)
 *
 * @returns Terminal width in columns (positive integer)
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6
 */
export function getTerminalWidth(): number {
  // Primary source: process.stdout.columns
  if (
    process.stdout.columns !== undefined &&
    Number.isFinite(process.stdout.columns)
  ) {
    return process.stdout.columns;
  }

  // Secondary source: process.env.COLUMNS
  if (process.env.COLUMNS !== undefined) {
    const parsed = parseInt(process.env.COLUMNS, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  // Default fallback
  return DEFAULT_TERMINAL_WIDTH;
}
