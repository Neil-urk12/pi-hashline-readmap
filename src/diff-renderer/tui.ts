import type { InlineDiffMetadata } from "./model.js";
import { createHash } from "node:crypto";
import { parseInlineDiff } from "./parse.js";
import { renderInlineDiff, renderNewFilePreview } from "./render.js";

const DEFAULT_WIDTH = 120;
const COLLAPSED_DIFF_LINES = 24;
const EXPANDED_DIFF_LINES = 120;
const COLLAPSED_NEW_LINES = 12;
const EXPANDED_NEW_LINES = 80;
const MAX_DIFF_INPUT_CHARS = 200_000;

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

function hashContent(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

function metadataFingerprint(metadata: InlineDiffMetadata): string {
	if (metadata.kind === "no-change") return metadata.kind;
	if (metadata.kind === "new-file")
		return `${metadata.kind}:${hashContent(metadata.content)}`;
	return `${metadata.kind}:${metadata.summary}:${hashContent(metadata.oldContent)}:${hashContent(metadata.newContent)}`;
}

export function formatInlineDiffHeader(
	metadata: InlineDiffMetadata,
	theme: any,
): string {
	if (metadata.kind === "diff")
		return `  ${theme.fg("success", metadata.summary)}`;
	if (metadata.kind === "new-file")
		return `  ${theme.fg("success", `✓ new file (${metadata.lines} lines)`)}`;
	return `  ${theme.fg("muted", "✓ no changes")}`;
}

export function renderInlineDiffMetadata(
	metadata: InlineDiffMetadata,
	theme: any,
	ctx: any,
	expanded: boolean,
): string {
	if (metadata.kind === "no-change")
		return formatInlineDiffHeader(metadata, theme);

	if (
		metadata.kind === "diff" &&
		metadata.oldContent.length + metadata.newContent.length >
			MAX_DIFF_INPUT_CHARS
	) {
		return `${formatInlineDiffHeader(metadata, theme)}\n${theme.fg("muted", "  diff too large for inline rendering")}`;
	}
	if (
		metadata.kind === "new-file" &&
		metadata.content.length > MAX_DIFF_INPUT_CHARS
	) {
		return `${formatInlineDiffHeader(metadata, theme)}\n${theme.fg("muted", "  file too large for inline preview")}`;
	}

	const width = Math.max(60, terminalWidth() - 4);
	const maxLines = expanded
		? metadata.kind === "new-file"
			? EXPANDED_NEW_LINES
			: EXPANDED_DIFF_LINES
		: metadata.kind === "new-file"
			? COLLAPSED_NEW_LINES
			: COLLAPSED_DIFF_LINES;
	const key = JSON.stringify({
		fingerprint: metadataFingerprint(metadata),
		path: metadata.path,
		width,
		maxLines,
		theme: themeKey(theme),
	});
	const state = ctx.state ?? (ctx.state = {});

	if (state.inlineDiffKey !== key) {
		state.inlineDiffKey = key;
		state.inlineDiffText = `${formatInlineDiffHeader(metadata, theme)}\n${theme.fg("muted", "  rendering diff…")}`;
		state.inlineDiffFailed = false;

		try {
			const rendered =
				metadata.kind === "diff"
					? renderInlineDiff(
							parseInlineDiff(metadata.oldContent, metadata.newContent),
							{
								language: metadata.language,
								maxLines,
								width,
								theme,
							},
						)
					: renderNewFilePreview(metadata.content, {
							language: metadata.language,
							maxLines,
							width,
							theme,
						});
			state.inlineDiffText = `${formatInlineDiffHeader(metadata, theme)}\n${rendered}`;
			state.inlineDiffFailed = false;
		} catch {
			state.inlineDiffFailed = true;
			state.inlineDiffText = `${formatInlineDiffHeader(metadata, theme)}\n${theme.fg("muted", "  inline diff unavailable")}`;
		}
	}

	return state.inlineDiffText ?? formatInlineDiffHeader(metadata, theme);
}
