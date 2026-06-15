/**
 * Placeholder strings for masked stale/retired tool results.
 *
 * Pure: no state. The dispatch (`renderStaleContextPlaceholder`) lives here
 * alongside the per-tool renderers because the dispatch is a 4-line switch
 * over them.
 */
import type { ContextHygieneRetiredRecord, ContextHygieneStaleRecord } from "./types.js";

export function renderStaleReadPlaceholder(): string {
	return "[Stale read result — this earlier read was superseded by a later file change; nothing is wrong with read. Run read again for current content.]";
}

export function renderStaleGrepPlaceholder(): string {
	return "[Stale grep result — this earlier grep was superseded by a later file change; nothing is wrong with grep. Run grep again for current matches.]";
}

export function renderStaleAstSearchPlaceholder(): string {
	return "[Stale ast_search result — this earlier ast_search was superseded by a later file change; nothing is wrong with ast_search. Run ast_search again for current matches.]";
}

export function renderStaleBashPlaceholder(record: ContextHygieneStaleRecord): string {
	const command = record.command ? ` Command: ${record.command}` : "";
	return `[Stale bash context: ${record.reason}. Re-run the Bash command to refresh.${command}]`;
}

export function renderRetiredContextPlaceholder(record: ContextHygieneRetiredRecord): string {
	const command = record.command ? ` Command: ${record.command}` : "";
	return `[Retired bash context: ${record.reason}. Superseded by a later successful Bash command.${command}]`;
}

export function renderStaleContextPlaceholder(record: ContextHygieneStaleRecord): string {
	switch (record.originalTool) {
		case "read":
			return renderStaleReadPlaceholder();
		case "grep":
			return renderStaleGrepPlaceholder();
		case "ast_search":
			return renderStaleAstSearchPlaceholder();
		case "bash":
			return renderStaleBashPlaceholder(record);
		default:
			return "[Stale tool context: resource content changed after this result. Re-run the original tool to refresh.]";
	}
}
