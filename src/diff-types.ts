/**
 * Type definitions for inline diff rendering
 *
 * This module defines the core data structures used throughout the diff rendering pipeline:
 * - ParsedDiff: Structured representation of unified diff text
 * - DiffLineEntry/DiffMetaEntry: Individual diff entries (lines, hunks, files, meta)
 * - DiffSpan: Character-level highlight ranges for inline emphasis
 * - DiffData: Complete diff payload with parsed structure and inline highlights
 * - DiffConfig: Configuration schema for diff rendering behavior
 * - DiffTheme: Theme interface for styling
 * - Token: Token representation for inline diff computation
 */

/**
 * Line kind discriminator for diff lines
 */
export type DiffLineKind = "add" | "remove" | "context";

/**
 * Presentation mode for diff rendering
 * - summary: Minimal summary line only
 * - compact: Compact diff without inline highlights
 * - unified: Single-column unified diff with inline highlights
 * - split: Side-by-side split diff (future phase)
 */
export type PresentationMode = "summary" | "compact" | "unified" | "split";

/**
 * RGB color representation
 */
export interface RgbColor {
  r: number; // 0-255
  g: number; // 0-255
  b: number; // 0-255
}

/**
 * Token representation for inline diff computation
 * Captures a token's value and its character position in the original line
 */
export interface Token {
  value: string; // Token text content
  start: number; // Zero-based character offset (inclusive)
  end: number; // Zero-based character offset (exclusive)
}

/**
 * Character-level highlight span for inline emphasis
 * Represents a contiguous range of characters that should be highlighted
 */
export interface DiffSpan {
  start: number; // Zero-based character offset (inclusive)
  end: number; // Zero-based character offset (exclusive)
}

/**
 * Line-level diff entry
 * Represents a single line in the diff (add, remove, or context)
 */
export interface DiffLineEntry {
  kind: "line";
  lineKind: DiffLineKind; // "add" | "remove" | "context"
  oldLineNumber: number | null; // Line number in old file (null for adds)
  newLineNumber: number | null; // Line number in new file (null for removes)
  fallbackLineNumber: string; // Textual line number when actual is null
  content: string; // Line content without prefix
  raw: string; // Original raw line (including prefix)
  hunkIndex: number; // 1-based index of the hunk this line belongs to
}

/**
 * Meta-level diff entry
 * Represents hunk headers, file headers, or other metadata lines
 */
export interface DiffMetaEntry {
  kind: "hunk" | "file" | "meta";
  raw: string; // Original raw line
  hunkIndex: number; // Associated hunk index (0 for file headers)
}

/**
 * Discriminated union of all diff entry types
 */
export type ParsedDiffEntry = DiffLineEntry | DiffMetaEntry;

/**
 * Aggregate statistics for a parsed diff
 */
export interface DiffStats {
  added: number; // Number of added lines
  removed: number; // Number of removed lines
  context: number; // Number of unchanged lines
  hunks: number; // Number of hunks
  files: number; // Number of files affected
  lines: number; // Total number of lines in the diff
}

/**
 * Parsed unified diff structure
 * Contains ordered entries and aggregate statistics
 */
export interface ParsedDiff {
  entries: ParsedDiffEntry[]; // Ordered list of all parsed entries
  stats: DiffStats; // Aggregate statistics
}

/**
 * Complete diff data payload
 * Combines parsed structure with computed inline highlights
 */
export interface DiffData {
  parsed: ParsedDiff; // Structured diff representation
  inlineHighlights: WeakMap<DiffLineEntry, DiffSpan[]>; // Character-level highlight spans
}

/**
 * Configuration schema for diff rendering
 */
export interface DiffConfig {
  diffInlineHighlights: boolean; // Enable token-level highlights (default: true)
  diffWordWrap: boolean; // Enable line wrapping (default: true)
  diffIndicatorMode: "bars" | "classic" | "none"; // Change indicator style (default: "bars")
  diffViewMode: "auto" | "split" | "unified"; // View mode selection (default: "auto")
  diffSplitMinWidth: number; // Minimum width for split mode (default: 120)
}

/**
 * Theme interface for diff styling
 * Provides methods for applying foreground/background colors and text styles
 */
export interface DiffTheme {
  fg(color: string, text: string): string; // Apply foreground color
  bg?(color: string, text: string): string; // Apply background color (optional)
  bold?(text: string): string; // Apply bold style (optional)
  getFgAnsi?(color: string): string; // Get foreground ANSI code (optional)
  getBgAnsi?(color: string): string; // Get background ANSI code (optional)
}
