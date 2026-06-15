/**
 * Rehydrate descriptor builders.
 *
 * The `ContextHygieneRehydrateDescriptor` union tells the agent how to
 * refresh a stale result. Per-tool builders live here, behind one seam.
 */
import type {
	BuildAstSearchRehydrateDescriptorInput,
	BuildGrepRehydrateDescriptorInput,
	BuildReadRehydrateDescriptorInput,
	ContextHygieneAstSearchRehydrateDescriptor,
	ContextHygieneGrepRehydrateDescriptor,
	ContextHygieneReadRehydrateDescriptor,
	ContextHygieneRehydrateDescriptor,
} from "./types.js";

export function cloneContextHygieneRehydrateDescriptor(
	descriptor: ContextHygieneRehydrateDescriptor,
): ContextHygieneRehydrateDescriptor {
	switch (descriptor.tool) {
		case "read":
			return { tool: "read", input: { ...descriptor.input } };
		case "grep":
			return { tool: "grep", input: { ...descriptor.input } };
		case "ast_search":
			return { tool: "ast_search", input: { ...descriptor.input } };
	}
}

export function buildReadRehydrateDescriptor(
	input: BuildReadRehydrateDescriptorInput,
): ContextHygieneReadRehydrateDescriptor {
	const descriptorInput: ContextHygieneReadRehydrateDescriptor["input"] = { path: input.path };
	if (input.offset !== undefined) descriptorInput.offset = input.offset;
	if (input.limit !== undefined) descriptorInput.limit = input.limit;
	if (input.symbol !== undefined) descriptorInput.symbol = input.symbol;
	if (input.map === true) descriptorInput.map = true;
	if (input.bundle !== undefined) descriptorInput.bundle = input.bundle;
	return { tool: "read", input: descriptorInput };
}

export function buildGrepRehydrateDescriptor(
	input: BuildGrepRehydrateDescriptorInput,
): ContextHygieneGrepRehydrateDescriptor {
	const descriptorInput: ContextHygieneGrepRehydrateDescriptor["input"] = { pattern: input.pattern };
	if (input.path !== undefined) descriptorInput.path = input.path;
	if (input.glob !== undefined) descriptorInput.glob = input.glob;
	if (input.literal === true) descriptorInput.literal = true;
	if (input.ignoreCase === true) descriptorInput.ignoreCase = true;
	if (input.context !== undefined) descriptorInput.context = input.context;
	if (input.summary === true) descriptorInput.summary = true;
	if (input.scope !== undefined) descriptorInput.scope = input.scope;
	if (input.scopeContext !== undefined) descriptorInput.scopeContext = input.scopeContext;
	return { tool: "grep", input: descriptorInput };
}

export function buildAstSearchRehydrateDescriptor(
	input: BuildAstSearchRehydrateDescriptorInput,
): ContextHygieneAstSearchRehydrateDescriptor {
	const descriptorInput: ContextHygieneAstSearchRehydrateDescriptor["input"] = { pattern: input.pattern };
	if (input.lang !== undefined) descriptorInput.lang = input.lang;
	if (input.path !== undefined) descriptorInput.path = input.path;
	return { tool: "ast_search", input: descriptorInput };
}
