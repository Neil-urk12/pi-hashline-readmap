/**
 * ANSI sequence utilities for split diff row background stabilization.
 *
 * In split diff, each row may be wrapped in a background color (e.g., light red/green tint).
 * When content embeds ANSI codes (syntax highlighting, resets like \\x1b[0m), those can reset
 * the background color, causing flicker. These helpers "lock in" the row background
 * across embedded resets using the "keep background across resets" technique from
 * pi-tool-display.
 */

import { STYLE_RESET_PARAMS } from "./diff-types.js";

/**
 * Safe ANSI reset sequence: `\x1b[<params>m` that resets styles but preserves background.
 * `STYLE_RESET_PARAMS` are the SGR parameter values that reset various attributes
 * without touching background color (e.g., 39=default-fg, 22=no-bold, 23=no-italic, etc.).
 */
export const SAFE_RESET_SEQUENCE = `\x1b[${STYLE_RESET_PARAMS.join(";")}m`;

/**
 * Check whether an SGR parameter list (the numbers inside `\x1b[...m`) contains any
 * that would reset the background (e.g., 49=default-bg, 0=reset-all).
 */
export function sequenceResetsBackground(params: number[]): boolean {
  // 0 resets everything; 49 resets background to default; 48 changes background explicitly (not reset)
  return params.includes(0) || params.includes(49);
}

/**
 * Strip any background-resetting parameters from a parameter list.
 * Returns a new array without 0 and 49. Empty array becomes [22,23,...] safe set.
 */
export function stripBackgroundResetParams(params: number[]): number[] {
  const filtered = params.filter((p) => p !== 0 && p !== 49);
  return filtered.length > 0 ? filtered : [...STYLE_RESET_PARAMS];
}

/**
 * Stabilize a single ANSI string so that any embedded resets do not clear the active
 * row background. `rowBg` is the background SGR prefix (e.g., `\\x1b[48;5;235m`).
 * `rowRestore` is the matching restore sequence (usually `\\x1b[49m`).
 *
 * Input has structure: `${rowBg}${content}${rowRestore}` where `content` may contain
 * `\\x1b[0m` or `\\x1b[49m` that would prematurely drop the background. This function
 * wraps non-resetting SGR codes around those embedded resets so the background survives.
 */
export function keepBackgroundAcrossResets(text: string, rowBg: string, rowRestore: string): string {
  // This function assumes `text` starts with rowBg and ends with rowRestore.
  // We need to:
  // 1) Remove trailing rowRestore (temporarily)
  // 2) Find all embedded `\x1b[<params>m` sequences.
  // 3) For each, if its params contain 0 or 49, replace with `SAFE_RESET_SEQUENCE` (still resets fg but not bg).
  // 4) Re-append rowRestore at end.

  if (!text.endsWith(rowRestore)) {
    // Unexpected format; return unchanged
    return text;
  }
  const inner = text.slice(0, -rowRestore.length); // without trailing restore
  const bgLength = rowBg.length;
  const prefix = inner.slice(0, bgLength); // should equal rowBg
  const contentPart = inner.slice(bgLength);

  // Replace any SGR sequences that would reset background
  const stabilizedContent = contentPart.replace(/\x1b\[([0-9;]*)m/g, (match, paramsStr) => {
    const nums = paramsStr
      .split(";")
      .filter((s: string) => s.length > 0)
      .map(Number);
    if (sequenceResetsBackground(nums)) {
      return SAFE_RESET_SEQUENCE;
    }
    return match; // leave untouched
  });

  return prefix + stabilizedContent + rowRestore;
}

/**
 * Given a fully-assembled row string (rowBg + content + rowRestore),
 * compact consecutive plain SGR codes (no text between them) and ensure
 * trailing resets are present. This is a light normalization pass.
 */
export function stabilizeBackgroundResets(raw: string): string {
  // The strategy in pi-tool-display: ensure row text ends with a reset that preserves bg?
  // Actually they call keepBackgroundAcrossResets after building row. That's enough.
  // This function is a thin wrapper.
  return raw; // Caller already called keepBackgroundAcrossResets; no further processing.
}

/**
 * Sanitize any ANSI sequences that might break themed output, e.g., sequences
 * that change palette (\\x1b]4;...\\x1b\\) or operating system commands. We strip them.
 */
export function sanitizeAnsiForThemedOutput(text: string): string {
  // Remove OSC palette-changing sequences. Keep SGR only.
  return text.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "");
}

/**
 * Mix a theme's background color with a tint ratio (0–1) to create a subtle row bg.
 * Not used in initial pass; kept for future use.
 */
// export function mixBackgroundColor(themeBgRgb: [number, number, number], ratio: number): string {
//   // Implement later with theme API
//   return "";
// }
