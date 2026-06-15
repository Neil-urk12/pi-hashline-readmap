/**
 * Re-export shell for the context-hygiene module family.
 *
 * The implementation lives in src/context-hygiene/. This file preserves the
 * public import surface so consumers (`src/*.ts`, `tests/*.ts`) keep using
 * `import { ... } from "./context-hygiene.js"` unchanged.
 *
 * Sibling map:
 *   - types.ts          Schema types, constants
 *   - commands.ts       Command normalisation + classification
 *   - resources.ts      File/symbol/command resource builders + metadata
 *   - placeholders.ts   Stale/retired placeholder strings
 *   - rehydrate.ts      Rehydrate descriptor builders (read/grep/ast_search)
 *   - tracker.ts        DefaultContextHygieneTracker + global + debug tool
 */
export * from "./context-hygiene/types.js";
export * from "./context-hygiene/commands.js";
export * from "./context-hygiene/resources.js";
export * from "./context-hygiene/placeholders.js";
export * from "./context-hygiene/rehydrate.js";
export {
	buildRetiredContextRecord,
	buildStaleContextRecord,
	createContextHygieneTracker,
	resetContextHygieneTracker,
	getContextHygieneTracker,
	registerContextHygieneDebugTool,
	isContextHygieneDebugEnabled,
} from "./context-hygiene/tracker.js";
export type { ContextHygieneTracker, CreateContextHygieneTrackerOptions, RegisterContextHygieneDebugToolOptions } from "./context-hygiene/tracker.js";
