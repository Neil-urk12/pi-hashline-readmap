/**
 * Context-hygiene schema types and constants.
 *
 * Pure types — no logic. Owned by the schema; consumed by every sibling.
 */
import type { BashCommandState } from "../bash-command-state.js";

export const CONTEXT_HYGIENE_SCHEMA_VERSION = 1 as const;
export const DEFAULT_CONTEXT_HYGIENE_MAX_EVENTS = 1000;

export type ContextHygieneClassification =
	| "read-context"
	| "search-context"
	| "command-output"
	| "mutation";

export type ContextHygieneResourceKind = "file" | "symbol" | "command";

export type ContextHygieneCommandKind =
	| "test"
	| "typecheck"
	| "build"
	| "lint"
	| "vcs"
	| "install"
	| "other";

export interface ContextHygieneFileResource {
	kind: "file";
	key: string;
	path: string;
}

export interface ContextHygieneSymbolResource {
	kind: "symbol";
	key: string;
	path: string;
	symbolName: string;
	symbolKind?: string;
}

export interface ContextHygieneCommandResource {
	kind: "command";
	key: string;
	command: string;
	commandKind: ContextHygieneCommandKind;
}

export type ContextHygieneResource =
	| ContextHygieneFileResource
	| ContextHygieneSymbolResource
	| ContextHygieneCommandResource;

export interface ContextHygieneReadRehydrateInput {
	path: string;
	offset?: number | string;
	limit?: number | string;
	symbol?: string;
	map?: true;
	bundle?: "local";
}

export interface ContextHygieneGrepRehydrateInput {
	pattern: string;
	path?: string;
	glob?: string;
	literal?: true;
	ignoreCase?: true;
	context?: number | string;
	summary?: true;
	scope?: "symbol";
	scopeContext?: number | string;
}

export interface ContextHygieneAstSearchRehydrateInput {
	pattern: string;
	lang?: string;
	path?: string;
}

export interface ContextHygieneReadRehydrateDescriptor {
	tool: "read";
	input: ContextHygieneReadRehydrateInput;
}

export interface ContextHygieneGrepRehydrateDescriptor {
	tool: "grep";
	input: ContextHygieneGrepRehydrateInput;
}

export interface ContextHygieneAstSearchRehydrateDescriptor {
	tool: "ast_search";
	input: ContextHygieneAstSearchRehydrateInput;
}

export type ContextHygieneRehydrateDescriptor =
	| ContextHygieneReadRehydrateDescriptor
	| ContextHygieneGrepRehydrateDescriptor
	| ContextHygieneAstSearchRehydrateDescriptor;

export type ContextHygieneStaleInvalidationReason =
	| "mutation-after-read"
	| "bash-repo-state-after-mutation"
	| "bash-verification-success-rerun";

export type ContextHygieneRetirementReason = "command-rerun" | "same-command-success-rerun";

export interface ContextHygieneStaleRecord {
	status: "stale";
	originalTool: string;
	originalEventId?: number;
	originalResultId?: string;
	staleResourceKeys: string[];
	invalidatingMutationEventId: number;
	invalidatingMutationResultId?: string;
	reason: ContextHygieneStaleInvalidationReason;
	rehydrate?: ContextHygieneRehydrateDescriptor;
	command?: string;
}

export interface ContextHygieneRetiredRecord {
	status: "retired";
	originalTool: string;
	originalEventId?: number;
	originalResultId?: string;
	retiredResourceKeys: string[];
	supersededByEventId: number;
	supersededByResultId?: string;
	reason: ContextHygieneRetirementReason;
	command?: string;
}

export interface BuildStaleContextRecordInput {
	originalTool: string;
	originalEventId?: number;
	originalResultId?: string;
	staleResourceKeys: readonly string[];
	invalidatingMutationEventId: number;
	invalidatingMutationResultId?: string;
	reason?: ContextHygieneStaleInvalidationReason;
	rehydrate?: ContextHygieneRehydrateDescriptor;
	command?: string;
}

export interface BuildReadRehydrateDescriptorInput {
	path: string;
	offset?: number | string;
	limit?: number | string;
	symbol?: string;
	map?: boolean;
	bundle?: "local";
}

export interface BuildGrepRehydrateDescriptorInput {
	pattern: string;
	path?: string;
	glob?: string;
	literal?: boolean;
	ignoreCase?: boolean;
	context?: number | string;
	summary?: boolean;
	scope?: "symbol";
	scopeContext?: number | string;
}

export interface BuildAstSearchRehydrateDescriptorInput {
	pattern: string;
	lang?: string;
	path?: string;
}

export interface ContextHygieneAppliedEffectsBucket {
	count: number;
	resultIds: string[];
	reasons: string[];
}

export interface ContextHygieneAppliedEffects {
	retired: ContextHygieneAppliedEffectsBucket;
	stale: ContextHygieneAppliedEffectsBucket;
}

export interface ContextHygieneMetadata {
	schemaVersion: typeof CONTEXT_HYGIENE_SCHEMA_VERSION;
	tool: string;
	classification: ContextHygieneClassification;
	resources: ContextHygieneResource[];
	rehydrate?: ContextHygieneRehydrateDescriptor;
	commandState?: BashCommandState;
	appliedEffects?: ContextHygieneAppliedEffects;
}

export interface BuildContextHygieneMetadataInput {
	tool: string;
	classification: ContextHygieneClassification;
	resources?: readonly (ContextHygieneResource | null | undefined)[];
	rehydrate?: ContextHygieneRehydrateDescriptor | null;
	commandState?: BashCommandState | null;
}

export interface ContextHygieneRecordOptions {
	resultId?: string;
}

export interface ContextHygieneEvent {
	id: number;
	resultId?: string;
	tool: string;
	classification: ContextHygieneClassification;
	resources: ContextHygieneResource[];
	rehydrate?: ContextHygieneRehydrateDescriptor;
	commandState?: BashCommandState;
}

export interface ContextHygieneReuseReportEntry {
	resourceKey: string;
	count: number;
	eventIds: number[];
	resultIds: string[];
}

export interface ContextHygieneMutationAfterReadReportEntry {
	resourceKey: string;
	readEventIds: number[];
	mutationEventId: number;
}

export interface ContextHygieneStaleCandidateReportEntry {
	resourceKey: string;
	staleEventIds: number[];
	mutationEventId: number;
	reason: ContextHygieneStaleInvalidationReason;
	staleResults: ContextHygieneStaleRecord[];
}

export interface ContextHygieneRetirementCandidateReportEntry {
	resourceKey: string;
	eventIds: number[];
	supersededByEventId: number;
	reason: ContextHygieneRetirementReason;
	retiredResults?: ContextHygieneRetiredRecord[];
}

export interface ContextHygieneReport {
	eventCount: number;
	resourceCount: number;
	readReuse: ContextHygieneReuseReportEntry[];
	commandReruns: ContextHygieneReuseReportEntry[];
	mutationAfterRead: ContextHygieneMutationAfterReadReportEntry[];
	staleCandidates: ContextHygieneStaleCandidateReportEntry[];
	retirementCandidates: ContextHygieneRetirementCandidateReportEntry[];
	churn: {
		byClassification: Record<ContextHygieneClassification, number>;
		byTool: Record<string, number>;
		uniqueResourcesSeen: number;
	};
}
