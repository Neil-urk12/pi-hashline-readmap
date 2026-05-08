/**
 * Unified diff renderer with inline highlights
 *
 * This module implements the main unified diff rendering logic with token-level
 * inline highlights. It brings together all the previously implemented utilities:
 * - Diff parser for structured diff representation
 * - Inline diff computation for token-level highlights
 * - ANSI stabilization to prevent background disruption
 * - Terminal width detection and line clamping
 * - Configuration system for rendering options
 * - Presentation mode resolution
 *
 * Key features:
 * - Line number rendering with minimum 2-character width
 * - Multiple indicator modes: bars (▌ glyph), classic (+/- prefix), none
 * - Color mixing for line backgrounds and inline emphasis
 * - ANSI stabilization for embedded codes
 * - Width clamping with iterative truncation
 * - Context line styling with dim foreground
 * - Hunk header rendering spanning full width
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10
 */

import type {
  DiffData,
  DiffConfig,
  DiffTheme,
  RgbColor,
  DiffLineEntry,
  DiffSpan,
  ParsedDiffEntry,
} from "./diff-types.js";
import {
  keepBackgroundAcrossResets,
  stabilizeBackgroundResets,
} from "./ansi-utils.js";
import { clampRenderedLineToWidth } from "./line-width-safety.js";
import { getLanguageFromPath, highlightCode } from "@mariozechner/pi-coding-agent";
import { detectLanguage } from "./readmap/language-detect.js";
import { visibleWidth } from "@mariozechner/pi-tui";

/**
 * Color mixing ratios for backgrounds and inline emphasis
 */
const ADD_ROW_BACKGROUND_MIX_RATIO = 0.12;
const REMOVE_ROW_BACKGROUND_MIX_RATIO = 0.12;
const ADD_INLINE_EMPHASIS_MIX_RATIO = 0.26;
const REMOVE_INLINE_EMPHASIS_MIX_RATIO = 0.26;

/**
 * Tint target colors for additions and deletions
 */
const ADDITION_TINT_TARGET: RgbColor = { r: 84, g: 190, b: 118 };
const DELETION_TINT_TARGET: RgbColor = { r: 232, g: 95, b: 122 };

/**
 * Minimum line number width (in characters)
 */
const MIN_LINE_NUMBER_WIDTH = 2;

/**
 * Get language identifier from file path for syntax highlighting
 * 
 * Uses the existing detectLanguage function from readmap to determine
 * the language, then returns the language ID suitable for highlightCode.
 * 
 * @param filePath - File path to detect language from
 * @returns Language identifier string or undefined if not detected
 */
function getLanguageFromFilePath(filePath: string): string | undefined {
  const langInfo = detectLanguage(filePath);
  return langInfo?.id;
}

/**
 * Sanitize ANSI codes for themed output
 * 
 * Removes background-affecting ANSI codes from syntax-highlighted text
 * to prevent conflicts with diff renderer's own background colors.
 * Preserves foreground colors and text styles.
 * 
 * @param text - Text with ANSI codes from syntax highlighter
 * @returns Text with sanitized ANSI codes (backgrounds removed)
 */
function sanitizeAnsiForThemedOutput(text: string): string {
  // Use stabilizeBackgroundResets to strip all background-affecting parameters
  // This preserves foreground colors and styles while removing backgrounds
  return stabilizeBackgroundResets(text);
}

/**
 * Mix two RGB colors at a given ratio
 *
 * @param base - Base color
 * @param target - Target color to blend toward
 * @param ratio - Mix ratio (0.0 = all base, 1.0 = all target)
 * @returns Mixed RGB color
 */
export function mixRgb(base: RgbColor, target: RgbColor, ratio: number): RgbColor {
  return {
    r: Math.round(base.r * (1 - ratio) + target.r * ratio),
    g: Math.round(base.g * (1 - ratio) + target.g * ratio),
    b: Math.round(base.b * (1 - ratio) + target.b * ratio),
  };
}

/**
 * Convert RGB color to ANSI background code
 *
 * @param color - RGB color
 * @returns ANSI background escape sequence
 */
function rgbToBgAnsi(color: RgbColor): string {
  return `\x1b[48;2;${color.r};${color.g};${color.b}m`;
}

/**
 * Parse ANSI background code to extract RGB color
 * Supports formats: \x1b[48;2;R;G;Bm
 *
 * @param ansiCode - ANSI background escape sequence
 * @returns RGB color or null if parsing fails
 */
function parseAnsiBackground(ansiCode: string): RgbColor | null {
  // Match pattern: \x1b[48;2;R;G;Bm
  const match = ansiCode.match(/\x1b\[48;2;(\d+);(\d+);(\d+)m/);
  if (!match) {
    return null;
  }

  return {
    r: parseInt(match[1], 10),
    g: parseInt(match[2], 10),
    b: parseInt(match[3], 10),
  };
}

/**
 * Compute line number width based on maximum line number in diff
 *
 * @param entries - Parsed diff entries
 * @returns Line number width (minimum 2 characters)
 */
function computeLineNumberWidth(entries: ParsedDiffEntry[]): number {
  let maxLineNum = 0;

  for (const entry of entries) {
    if (entry.kind === "line") {
      const oldNum = entry.oldLineNumber ?? 0;
      const newNum = entry.newLineNumber ?? 0;
      maxLineNum = Math.max(maxLineNum, oldNum, newNum);
    }
  }

  const width = String(maxLineNum).length;
  return Math.max(MIN_LINE_NUMBER_WIDTH, width);
}

/**
 * Apply inline span highlights to content by wrapping spans with emphasis background
 *
 * @param content - Line content
 * @param spans - Array of character-level highlight spans
 * @param emphasisBgAnsi - ANSI background code for emphasis
 * @returns Content with emphasis backgrounds applied to spans
 */
export function applyInlineSpanHighlight(
  content: string,
  spans: DiffSpan[],
  emphasisBgAnsi: string
): string {
  if (spans.length === 0) {
    return content;
  }

  // Sort spans by start position (should already be sorted, but be defensive)
  const sortedSpans = [...spans].sort((a, b) => a.start - b.start);

  // Build result by interleaving non-highlighted and highlighted segments
  let result = "";
  let cursor = 0;

  for (const span of sortedSpans) {
    // Add non-highlighted segment before this span
    if (cursor < span.start) {
      result += content.slice(cursor, span.start);
    }

    // Add highlighted segment
    result += emphasisBgAnsi + content.slice(span.start, span.end) + "\x1b[49m";

    cursor = span.end;
  }

  // Add remaining non-highlighted segment after last span
  if (cursor < content.length) {
    result += content.slice(cursor);
  }

  return result;
}

/**
 * Render line number prefix with padding
 *
 * @param lineNumber - Line number to render (null for blank)
 * @param width - Total width for line number field
 * @returns Padded line number string
 */
function renderLineNumber(lineNumber: number | null, width: number): string {
  if (lineNumber === null) {
    return " ".repeat(width);
  }

  const numStr = String(lineNumber);
  const padding = width - numStr.length;
  return " ".repeat(padding) + numStr;
}

/**
 * Render change indicator based on indicator mode
 *
 * @param lineKind - Line kind (add, remove, context)
 * @param indicatorMode - Indicator mode (bars, classic, none)
 * @returns Indicator string
 */
function renderIndicator(
  lineKind: "add" | "remove" | "context",
  indicatorMode: "bars" | "classic" | "none"
): string {
  if (indicatorMode === "none") {
    return " ";
  }

  if (indicatorMode === "bars") {
    // Bars mode: ▌ glyph for changes, space for context
    if (lineKind === "add" || lineKind === "remove") {
      return "▌";
    }
    return " ";
  }

  // Classic mode: +/- prefix
  if (lineKind === "add") {
    return "+";
  }
  if (lineKind === "remove") {
    return "-";
  }
  return " ";
}

/**
 * Render a diff line entry with inline highlights and backgrounds
 *
 * @param entry - Diff line entry to render
 * @param lineNumberWidth - Width for line number field
 * @param config - Diff configuration
 * @param theme - Diff theme
 * @param inlineHighlights - WeakMap of inline highlight spans
 * @param terminalWidth - Terminal width for clamping
 * @param language - Optional language identifier for syntax highlighting
 * @param highlightCache - Cache for highlighted lines
 * @returns Rendered line with ANSI styling
 */
function renderDiffLine(
  entry: DiffLineEntry,
  lineNumberWidth: number,
  config: DiffConfig,
  theme: DiffTheme,
  inlineHighlights: WeakMap<DiffLineEntry, DiffSpan[]>,
  terminalWidth: number,
  language?: string,
  highlightCache?: Map<string, string>
): string {
  const { lineKind, content } = entry;

  // Determine line number to display
  const displayLineNumber =
    lineKind === "add"
      ? entry.newLineNumber
      : lineKind === "remove"
      ? entry.oldLineNumber
      : entry.oldLineNumber ?? entry.newLineNumber;

  // Render line number prefix
  const lineNumStr = renderLineNumber(displayLineNumber, lineNumberWidth);

  // Render indicator
  const indicator = renderIndicator(lineKind, config.diffIndicatorMode);

  // Build line prefix: line number + space + indicator + space
  const prefix = lineNumStr + " " + indicator + " ";

  // Apply syntax highlighting if language is detected and cache is available
  let processedContent = content;
  if (language && highlightCache) {
    // Check cache first
    if (highlightCache.has(content)) {
      processedContent = highlightCache.get(content)!;
    } else {
      // Apply syntax highlighting
      try {
        const highlightedLines = highlightCode(content, language);
        // highlightCode returns an array of lines, we expect one line
        const highlighted = highlightedLines.length > 0 ? highlightedLines[0] : content;
        // Sanitize ANSI codes to remove backgrounds
        processedContent = sanitizeAnsiForThemedOutput(highlighted);
        // Cache the result
        highlightCache.set(content, processedContent);
      } catch (error) {
        // If highlighting fails, use original content
        processedContent = content;
      }
    }
  }

  // Apply foreground color based on line kind
  let styledContent: string;
  if (lineKind === "add") {
    styledContent = theme.fg("green", processedContent);
  } else if (lineKind === "remove") {
    styledContent = theme.fg("red", processedContent);
  } else {
    // Context: dim styling
    styledContent = "\x1b[2m" + processedContent + "\x1b[22m";
  }

  // Apply inline highlights if enabled and available
  if (config.diffInlineHighlights && lineKind !== "context") {
    const spans = inlineHighlights.get(entry);
    if (spans && spans.length > 0) {
      // Compute emphasis background color
      const tintTarget =
        lineKind === "add" ? ADDITION_TINT_TARGET : DELETION_TINT_TARGET;
      const mixRatio =
        lineKind === "add"
          ? ADD_INLINE_EMPHASIS_MIX_RATIO
          : REMOVE_INLINE_EMPHASIS_MIX_RATIO;

      // Get base background color from theme or use default
      const baseBg = theme.getBgAnsi?.("background") ?? "\x1b[48;2;0;0;0m";
      const baseBgColor = parseAnsiBackground(baseBg) ?? { r: 0, g: 0, b: 0 };

      const emphasisColor = mixRgb(baseBgColor, tintTarget, mixRatio);
      const emphasisBgAnsi = rgbToBgAnsi(emphasisColor);

      // Apply inline span highlights
      styledContent = applyInlineSpanHighlight(processedContent, spans, emphasisBgAnsi);
    }
  }

  // Combine prefix and content
  let line = prefix + styledContent;

  // Apply line background for add/remove lines
  if (lineKind !== "context") {
    const tintTarget =
      lineKind === "add" ? ADDITION_TINT_TARGET : DELETION_TINT_TARGET;
    const mixRatio =
      lineKind === "add"
        ? ADD_ROW_BACKGROUND_MIX_RATIO
        : REMOVE_ROW_BACKGROUND_MIX_RATIO;

    // Get base background color from theme or use default
    const baseBg = theme.getBgAnsi?.("background") ?? "\x1b[48;2;0;0;0m";
    const baseBgColor = parseAnsiBackground(baseBg) ?? { r: 0, g: 0, b: 0 };

    const rowBgColor = mixRgb(baseBgColor, tintTarget, mixRatio);
    const rowBgAnsi = rgbToBgAnsi(rowBgColor);

    // Wrap line with background
    line = rowBgAnsi + line + "\x1b[49m";

    // Stabilize ANSI backgrounds
    line = keepBackgroundAcrossResets(line, rowBgAnsi);
    line = stabilizeBackgroundResets(line);
  }

  // Clamp to terminal width
  line = clampRenderedLineToWidth(line, terminalWidth);

  return line;
}

/**
 * Render a hunk header spanning full width with accent color
 *
 * @param entry - Hunk header entry
 * @param theme - Diff theme
 * @param terminalWidth - Terminal width for clamping
 * @returns Rendered hunk header
 */
function renderHunkHeader(
  entry: ParsedDiffEntry,
  theme: DiffTheme,
  terminalWidth: number
): string {
  const { raw } = entry;

  // Apply accent color (cyan)
  let line = theme.fg("cyan", raw);

  // Clamp to terminal width
  line = clampRenderedLineToWidth(line, terminalWidth);

  return line;
}

/**
 * Render a file header spanning full width with accent color
 *
 * @param entry - File header entry
 * @param theme - Diff theme
 * @param terminalWidth - Terminal width for clamping
 * @returns Rendered file header
 */
function renderFileHeader(
  entry: ParsedDiffEntry,
  theme: DiffTheme,
  terminalWidth: number
): string {
  const { raw } = entry;

  // Apply accent color (cyan)
  let line = theme.fg("cyan", raw);

  // Clamp to terminal width
  line = clampRenderedLineToWidth(line, terminalWidth);

  return line;
}

/**
 * Render a meta entry with dim styling
 *
 * @param entry - Meta entry
 * @param terminalWidth - Terminal width for clamping
 * @returns Rendered meta line
 */
function renderMeta(entry: ParsedDiffEntry, terminalWidth: number): string {
  const { raw } = entry;

  // Apply dim styling
  let line = "\x1b[2m" + raw + "\x1b[22m";

  // Clamp to terminal width
  line = clampRenderedLineToWidth(line, terminalWidth);

  return line;
}

/**
 * Build collapsed diff hint text with progressive shortening
 *
 * Generates hint text for collapsed diffs that shows how much content is hidden
 * and how to expand it. The function progressively shortens the text to fit
 * within the available width.
 *
 * Progressive shortening levels:
 * 1. Full text: "X more lines (Y hunks) • Ctrl+O to expand"
 * 2. Short text: "X lines (Y hunks) • Ctrl+O"
 * 3. Numeric: "X lines (Y hunks)"
 * 4. Ellipsis: "..."
 *
 * The function selects the longest candidate that fits within the available width.
 *
 * @param remainingLines - Number of lines hidden in the collapsed section
 * @param hiddenHunks - Number of hunks hidden in the collapsed section
 * @param availableWidth - Available width in characters for the hint text
 * @returns Hint text string that fits within the available width
 *
 * Requirements: 3.1
 */
export function buildCollapsedDiffHintText(
  remainingLines: number,
  hiddenHunks: number,
  availableWidth: number
): string {
  // Build all candidate texts from longest to shortest
  const candidates: string[] = [
    // Full text: "X more lines (Y hunks) • Ctrl+O to expand"
    `${remainingLines} more lines (${hiddenHunks} hunks) • Ctrl+O to expand`,
    // Short text: "X lines (Y hunks) • Ctrl+O"
    `${remainingLines} lines (${hiddenHunks} hunks) • Ctrl+O`,
    // Numeric: "X lines (Y hunks)"
    `${remainingLines} lines (${hiddenHunks} hunks)`,
    // Ellipsis: "..."
    "...",
  ];

  // Select the longest candidate that fits within available width
  for (const candidate of candidates) {
    const width = visibleWidth(candidate);
    if (width <= availableWidth) {
      return candidate;
    }
  }

  // If even "..." doesn't fit, return empty string
  return "";
}

/**
 * Render unified diff with inline highlights
 *
 * Main rendering function that processes parsed diff entries and generates
 * ANSI-styled output lines for terminal display.
 *
 * Algorithm:
 * 1. Detect language from file path and set up syntax highlighting
 * 2. Compute line number width based on maximum line number
 * 3. For each entry:
 *    - Hunk header: Render full-width with accent color
 *    - File header: Render full-width with accent color
 *    - Meta: Render with dim styling
 *    - Line: Apply syntax highlighting, render with line number, indicator, content, backgrounds, and inline highlights
 * 4. Apply ANSI stabilization to prevent embedded codes from disrupting backgrounds
 * 5. Clamp each line to terminal width
 *
 * @param diffData - Structured diff data with parsed entries and inline highlights
 * @param theme - Theme for styling (foreground/background colors)
 * @param config - Configuration for rendering behavior
 * @param terminalWidth - Terminal width for line clamping
 * @param filePath - Optional file path for syntax highlighting language detection
 * @returns Array of rendered lines with ANSI styling
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10
 */
export function renderUnifiedDiff(
  diffData: DiffData,
  theme: DiffTheme,
  config: DiffConfig,
  terminalWidth: number,
  filePath?: string
): string[] {
  const { parsed, inlineHighlights } = diffData;
  const { entries } = parsed;

  // Detect language for syntax highlighting
  const language = filePath ? getLanguageFromFilePath(filePath) : undefined;
  
  // Cache for highlighted lines (Map<content, highlightedContent>)
  const highlightCache = new Map<string, string>();

  // Compute line number width
  const lineNumberWidth = computeLineNumberWidth(entries);

  // Render each entry
  const lines: string[] = [];

  for (const entry of entries) {
    if (entry.kind === "line") {
      const line = renderDiffLine(
        entry,
        lineNumberWidth,
        config,
        theme,
        inlineHighlights,
        terminalWidth,
        language,
        highlightCache
      );
      lines.push(line);
    } else if (entry.kind === "hunk") {
      const line = renderHunkHeader(entry, theme, terminalWidth);
      lines.push(line);
    } else if (entry.kind === "file") {
      const line = renderFileHeader(entry, theme, terminalWidth);
      lines.push(line);
    } else {
      // meta
      const line = renderMeta(entry, terminalWidth);
      lines.push(line);
    }
  }

  return lines;
}
