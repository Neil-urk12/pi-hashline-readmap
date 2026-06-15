/**
 * Command normalisation and classification.
 *
 * Pure: no I/O. Used by `resources.ts` to build command resources and by
 * `bash-command-state.ts` to decide state kind and retirement eligibility.
 */
import type { ContextHygieneCommandKind } from "./types.js";

export function normalizeCommandForContextHygiene(command: string): string {
	let normalized = "";
	let quote: "'" | '"' | null = null;
	let pendingWhitespace = false;

	for (const char of command.trim()) {
		if (quote) {
			normalized += char;
			if (char === quote) quote = null;
			continue;
		}

		if (char === "'" || char === '"') {
			if (pendingWhitespace && normalized.length > 0) {
				normalized += " ";
				pendingWhitespace = false;
			}
			quote = char;
			normalized += char;
			continue;
		}

		if (/\s/.test(char)) {
			pendingWhitespace = normalized.length > 0;
			continue;
		}

		if (pendingWhitespace) {
			normalized += " ";
			pendingWhitespace = false;
		}
		normalized += char;
	}

	return normalized;
}

export function classifyCommandForContextHygiene(command: string): ContextHygieneCommandKind {
	const normalized = normalizeCommandForContextHygiene(command);

	if (/^(git|gh)\b/.test(normalized)) return "vcs";
	if (/\b(install|ci|add)\b/.test(normalized) && /^(npm|pnpm|yarn|bun)\b/.test(normalized)) return "install";
	if (/\b(typecheck|tsc\b)/.test(normalized)) return "typecheck";
	if (/\b(test|vitest|jest|mocha|tap)\b/.test(normalized)) return "test";
	if (/\b(lint|eslint|biome|prettier)\b/.test(normalized)) return "lint";
	if (/\b(build|tsup|vite build|rollup|webpack|make)\b/.test(normalized)) return "build";

	return "other";
}
