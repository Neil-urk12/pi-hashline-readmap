import type { InlineDiffMetadata } from "./model.js";
import { parseInlineDiff } from "./parse.js";
import { renderInlineDiff, renderNewFilePreview } from "./render.js";

const DEFAULT_WIDTH = 120;
const COLLAPSED_DIFF_LINES = 24;
const EXPANDED_DIFF_LINES = 120;
const COLLAPSED_NEW_LINES = 12;
const EXPANDED_NEW_LINES = 80;

function terminalWidth(): number {
  return Math.max(40, process.stdout.columns || DEFAULT_WIDTH);
}

function themeKey(theme: any): string {
  if (!theme) return "no-theme";
  try {
    return JSON.stringify(Object.keys(theme).sort());
  } catch {
    return "theme";
  }
}

export function formatInlineDiffHeader(metadata: InlineDiffMetadata, theme: any): string {
  if (metadata.kind === "diff") return `  ${theme.fg("success", metadata.summary)} ${theme.fg("muted", metadata.path)}`;
  if (metadata.kind === "new-file") return `  ${theme.fg("success", `✓ new file (${metadata.lines} lines)`)} ${theme.fg("muted", metadata.path)}`;
  return `  ${theme.fg("muted", "✓ no changes")}`;
}

export function renderInlineDiffMetadata(metadata: InlineDiffMetadata, theme: any, ctx: any, expanded: boolean): string {
  if (metadata.kind === "no-change") return formatInlineDiffHeader(metadata, theme);

  const width = terminalWidth();
  const maxLines = expanded
    ? metadata.kind === "new-file" ? EXPANDED_NEW_LINES : EXPANDED_DIFF_LINES
    : metadata.kind === "new-file" ? COLLAPSED_NEW_LINES : COLLAPSED_DIFF_LINES;
  const key = JSON.stringify({ metadata, width, maxLines, theme: themeKey(theme) });
  const state = ctx.state ?? (ctx.state = {});

  if (state.inlineDiffKey !== key) {
    state.inlineDiffKey = key;
    state.inlineDiffText = `${formatInlineDiffHeader(metadata, theme)}\n${theme.fg("muted", "  rendering diff…")}`;

    const renderPromise = metadata.kind === "diff"
      ? renderInlineDiff(parseInlineDiff(metadata.oldContent, metadata.newContent), {
          language: metadata.language,
          maxLines,
          width,
          theme,
        })
      : renderNewFilePreview(metadata.content, {
          language: metadata.language,
          maxLines,
          width,
          theme,
        });

    renderPromise
      .then((rendered) => {
        if (state.inlineDiffKey !== key) return;
        state.inlineDiffText = `${formatInlineDiffHeader(metadata, theme)}\n${rendered}`;
        ctx.invalidate?.();
      })
      .catch(() => {
        if (state.inlineDiffKey !== key) return;
        state.inlineDiffText = formatInlineDiffHeader(metadata, theme);
        ctx.invalidate?.();
      });
  }

  return state.inlineDiffText ?? formatInlineDiffHeader(metadata, theme);
}
