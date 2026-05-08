/**
 * Type definitions for inline split diff rendering.
 * Referenced by: diff-renderer-core, diff-presentation, diff-output, edit-output, edit
 */

/** Kind of a parsed diff line. */
export type DiffLineKind = "context" | "addition" | "removal" | "meta";

/** Kind of a parsed diff header block. */
export type DiffEntryKind = "file-header" | "hunk-header" | "line";

/** Parsed file header (starts with --- / +++). */
export interface FileHeader {
  kind: "file-header";
  type: "file";
  raw: string;
  oldPath?: string;
  newPath?: string;
}

/** Parsed hunk header (starts with @@). */
export interface HunkHeader {
  kind: "hunk-header";
  type: "hunk";
  raw: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}

/** Parsed content line (non-header). */
export interface ParsedLine {
  kind: "line";
  type: DiffLineKind;
  oldLineNumber: number | null; // null for additions
  newLineNumber: number | null; // null for removals
  content: string;
  isMeta?: boolean; // e.g., "..." context-gap lines
}

/** Union type for all parsed diff entries. */
export type ParsedDiffEntry = FileHeader | HunkHeader | ParsedLine;

/** Statistics about a diff. */
export interface DiffStats {
  added: number;
  removed: number;
}

/** Parse result from parseDiff(). */
export interface ParsedDiff {
  entries: ParsedDiffEntry[];
  stats: DiffStats;
}

/** One side of a split diff row (left = old, right = new). */
export interface SplitDiffSide {
  entry: ParsedDiffEntry | null;
  tokens?: string[]; // tokenized content for inline diff
  highlights?: DiffSpan[]; // inline diff spans for this side
}

/** A split-diff row (one visual line in side-by-side output). */
export interface SplitDiffRow {
  left: SplitDiffSide | null; // null = absense (empty side)
  right: SplitDiffSide | null;
  hunkHeader?: string; // present on first row of a hunk
  rowKind: "context" | "addition" | "removal" | "meta"; // used for styling
  lineNumberLeft: number | null;
  lineNumberRight: number | null;
}

/** A highlight span within a line-pair for inline diff. */
export interface DiffSpan {
  start: number;           // character offset in the source string
  length: number;          // character count
  kind: "equal" | "insert" | "delete";
  leftText?: string;
  rightText?: string;
}

/** Rendered output for a single split line (fully styled). */
export interface RenderedRow {
  text: string; // ANSI-styled line ready for TUI rendering
  isMeta: boolean;
}

/** View mode in config or user override. */
export type DiffViewMode = "auto" | "split" | "unified";

/** Indicator/bar style for split diff separator. */
export type DiffIndicatorMode = "bars" | "classic" | "none";

/** Presentation mode used during rendering. */
export type DiffPresentationMode = "unified" | "split";

/** User-facing diff configuration, resolved from env + defaults. */
export interface DiffConfig {
  diffViewMode: DiffViewMode;           // "auto" | "split" | "unified"
  diffIndicatorMode: DiffIndicatorMode; // "bars" | "classic" | "none"
  diffSplitMinWidth: number;            // minimum terminal width for split (default 120)
  diffWordWrap: boolean;                // whether to wrap long lines (default true)
}

/** Structured diff output used downstream. */
export type DiffData =
  | { mode: "unified"; diff: string }
  | {
      mode: "split";
      splitRows: SplitDiffRow[];
      inlineHighlights: WeakMap<object, DiffSpan[]>; // key: ParsedLine entry reference
      stats: DiffStats;
    };

/** Rendering options passed to renderSplit(). */
export interface RenderSplitOptions {
  expanded: boolean;
  filePath: string;
  // future: wrap?: boolean; indent?: number;
}

/** Theme slots used by diff renderer. */
export const DIFF_THEME_SLOTS = {
  ADDED: "toolDiffAdded",
  REMOVED: "toolDiffRemoved",
  DIM: "dim",
  ACCENT: "accent",
} as const;

/** RNG-blended background mixing ratios (style-only, not used without theming). */
export const BACKGROUND_MIX_RATIOS = {
  REMOVE_ROW: 0.12,
  ADD_ROW: 0.12,
  REMOVE_INLINE: 0.26,
  ADD_INLINE: 0.26,
} as const;

/** Rendering constants. */
export const RENDERING_CONSTANTS = {
  MIN_SPLIT_COLUMN_WIDTH: 24,
  MIN_LINE_NUMBER_WIDTH: 2,
  MAX_INLINE_DIFF_LINE_LENGTH: 700,
  SPLIT_SEPARATOR_BARS: " │ ",
  SPLIT_SEPARATOR_CLASSIC: "│",
} as const;

/** Safe ANSI reset parameter sequence (same as pi-tool-display). */
export const STYLE_RESET_PARAMS = [39, 22, 23, 24, 25, 27, 28, 29, 59] as const;
