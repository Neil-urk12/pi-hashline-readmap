/**
 * The context-hygiene tracker — the deep module in the family.
 *
 * Owns the in-memory event log, the report generator, the global singleton,
 * the record builders used to produce stale/retired records, and the debug
 * tool registration. The siblings (types, commands, resources, placeholders,
 * rehydrate) are the schema + per-concern helpers; this is the only module
 * that mutates state.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
	CONTEXT_HYGIENE_SCHEMA_VERSION,
	DEFAULT_CONTEXT_HYGIENE_MAX_EVENTS,
	type BuildStaleContextRecordInput,
	type ContextHygieneEvent,
	type ContextHygieneMetadata,
	type ContextHygieneMutationAfterReadReportEntry,
	type ContextHygieneRecordOptions,
	type ContextHygieneReport,
	type ContextHygieneResource,
	type ContextHygieneRetiredRecord,
	type ContextHygieneRetirementCandidateReportEntry,
	type ContextHygieneStaleCandidateReportEntry,
	type ContextHygieneStaleRecord,
} from "./types.js";
import { buildContextHygieneMetadata } from "./resources.js";
import { cloneContextHygieneRehydrateDescriptor } from "./rehydrate.js";

export interface ContextHygieneTracker {
	record(metadata: ContextHygieneMetadata, options?: ContextHygieneRecordOptions): ContextHygieneEvent;
	generateReport(): ContextHygieneReport;
}

export interface CreateContextHygieneTrackerOptions {
	maxEvents?: number;
}

export interface RegisterContextHygieneDebugToolOptions {
	tracker?: ContextHygieneTracker;
	enabled?: boolean;
}

const CONTEXT_HYGIENE_DEBUG_TOOL_PTC = {
	callable: true,
	enabled: true,
	policy: "read-only" as const,
	readOnly: true,
	pythonName: "context_hygiene_report",
	defaultExposure: "safe-by-default" as const,
};

export function isContextHygieneDebugEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return env.PI_CONTEXT_HYGIENE_DEBUG === "1";
}

export function registerContextHygieneDebugTool(
	pi: ExtensionAPI,
	options: RegisterContextHygieneDebugToolOptions = {},
) {
	const enabled = options.enabled ?? isContextHygieneDebugEnabled();
	if (!enabled) return undefined;

	const tracker = options.tracker ?? getContextHygieneTracker();
	const tool = {
		name: "context_hygiene_report",
		label: "Context Hygiene Report",
		description:
			"Debug-only read-only tool. Returns Phase 0 context-hygiene telemetry, stale candidates, and retirement candidates without mutating tracker state.",
		parameters: Type.Object({}),
		ptc: CONTEXT_HYGIENE_DEBUG_TOOL_PTC,
		async execute() {
			const report = tracker.generateReport();
			return {
				content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }],
				details: { ptcValue: report },
			};
		},
	} satisfies Parameters<ExtensionAPI["registerTool"]>[0] & { ptc: typeof CONTEXT_HYGIENE_DEBUG_TOOL_PTC };

	pi.registerTool(tool);
	return tool;
}

function resultIdsForEvents(events: ContextHygieneEvent[]): string[] {
	return events.map((event) => event.resultId).filter((resultId): resultId is string => Boolean(resultId));
}

function cloneContextHygieneEvent(event: ContextHygieneEvent): ContextHygieneEvent {
	const cloned: ContextHygieneEvent = {
		...event,
		resources: event.resources.map((resource) => ({ ...resource } as ContextHygieneResource)),
	};
	if (event.rehydrate) cloned.rehydrate = cloneContextHygieneRehydrateDescriptor(event.rehydrate);
	if (event.commandState) cloned.commandState = { ...event.commandState };
	return cloned;
}

function compareStable(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function sortResourceKeys(keys: Iterable<string>): string[] {
	return [...keys].sort(compareStable);
}

function createEmptyClassificationCounts(): Record<"read-context" | "search-context" | "command-output" | "mutation", number> {
	return {
		"command-output": 0,
		mutation: 0,
		"read-context": 0,
		"search-context": 0,
	};
}

export function buildRetiredContextRecord(input: {
	originalTool: string;
	originalEventId?: number;
	originalResultId?: string;
	retiredResourceKeys: readonly string[];
	supersededByEventId: number;
	supersededByResultId?: string;
	reason: "command-rerun" | "same-command-success-rerun";
	command?: string;
}): ContextHygieneRetiredRecord {
	const record: ContextHygieneRetiredRecord = {
		status: "retired",
		originalTool: input.originalTool,
		retiredResourceKeys: sortResourceKeys(new Set(input.retiredResourceKeys)),
		supersededByEventId: input.supersededByEventId,
		reason: input.reason,
	};
	if (input.originalEventId !== undefined) record.originalEventId = input.originalEventId;
	if (input.originalResultId) record.originalResultId = input.originalResultId;
	if (input.supersededByResultId) record.supersededByResultId = input.supersededByResultId;
	if (input.command) record.command = input.command;
	return record;
}

export function buildStaleContextRecord(input: BuildStaleContextRecordInput): ContextHygieneStaleRecord {
	const record: ContextHygieneStaleRecord = {
		status: "stale",
		originalTool: input.originalTool,
		staleResourceKeys: sortResourceKeys(new Set(input.staleResourceKeys)),
		invalidatingMutationEventId: input.invalidatingMutationEventId,
		reason: input.reason ?? "mutation-after-read",
	};
	if (input.originalEventId !== undefined) record.originalEventId = input.originalEventId;
	if (input.originalResultId) record.originalResultId = input.originalResultId;
	if (input.invalidatingMutationResultId) record.invalidatingMutationResultId = input.invalidatingMutationResultId;
	if (input.rehydrate) record.rehydrate = cloneContextHygieneRehydrateDescriptor(input.rehydrate);
	if (input.command) record.command = input.command;
	return record;
}

class DefaultContextHygieneTracker implements ContextHygieneTracker {
	private readonly events: ContextHygieneEvent[] = [];
	private readonly maxEvents: number;
	private nextEventId = 1;

	constructor(options: CreateContextHygieneTrackerOptions = {}) {
		this.maxEvents = Math.max(1, Math.floor(options.maxEvents ?? DEFAULT_CONTEXT_HYGIENE_MAX_EVENTS));
	}

	record(metadata: ContextHygieneMetadata, options: ContextHygieneRecordOptions = {}): ContextHygieneEvent {
		const event: ContextHygieneEvent = {
			id: this.nextEventId++,
			tool: metadata.tool,
			classification: metadata.classification,
			resources: metadata.resources.map((resource) => ({ ...resource } as ContextHygieneResource)),
		};
		if (options.resultId) event.resultId = options.resultId;
		if (metadata.rehydrate) event.rehydrate = cloneContextHygieneRehydrateDescriptor(metadata.rehydrate);
		if (metadata.commandState) event.commandState = { ...metadata.commandState };
		this.events.push(event);
		if (this.events.length > this.maxEvents) this.events.splice(0, this.events.length - this.maxEvents);
		return cloneContextHygieneEvent(event);
	}

	generateReport(): ContextHygieneReport {
		const eventsByResource = new Map<string, ContextHygieneEvent[]>();
		const readEventsByResource = new Map<string, ContextHygieneEvent[]>();
		const commandEventsByResource = new Map<string, ContextHygieneEvent[]>();
		const mutationEventsByResource = new Map<string, ContextHygieneEvent[]>();
		const byClassification = createEmptyClassificationCounts();
		const byTool: Record<string, number> = {};

		for (const event of this.events) {
			byClassification[event.classification] += 1;
			byTool[event.tool] = (byTool[event.tool] ?? 0) + 1;

			for (const resource of event.resources) {
				const bucket = eventsByResource.get(resource.key) ?? [];
				bucket.push(event);
				eventsByResource.set(resource.key, bucket);

				if (event.classification === "read-context" || event.classification === "search-context") {
					const readBucket = readEventsByResource.get(resource.key) ?? [];
					readBucket.push(event);
					readEventsByResource.set(resource.key, readBucket);
				}
				if (event.classification === "command-output" && resource.kind === "command") {
					const commandBucket = commandEventsByResource.get(resource.key) ?? [];
					commandBucket.push(event);
					commandEventsByResource.set(resource.key, commandBucket);
				}
				if (event.classification === "mutation") {
					const mutationBucket = mutationEventsByResource.get(resource.key) ?? [];
					mutationBucket.push(event);
					mutationEventsByResource.set(resource.key, mutationBucket);
				}
			}
		}

		const readReuse = sortResourceKeys(readEventsByResource.keys()).flatMap((resourceKey) => {
			const events = readEventsByResource.get(resourceKey) ?? [];
			if (events.length < 2) return [];
			return [{ resourceKey, count: events.length, eventIds: events.map((event) => event.id), resultIds: resultIdsForEvents(events) }];
		});

		const commandReruns = sortResourceKeys(commandEventsByResource.keys()).flatMap((resourceKey) => {
			const events = commandEventsByResource.get(resourceKey) ?? [];
			if (events.length < 2) return [];
			return [{ resourceKey, count: events.length, eventIds: events.map((event) => event.id), resultIds: resultIdsForEvents(events) }];
		});

		const mutationAfterRead: ContextHygieneMutationAfterReadReportEntry[] = [];
		const staleCandidates: ContextHygieneStaleCandidateReportEntry[] = [];
		const retirementCandidates: ContextHygieneRetirementCandidateReportEntry[] = [];

		for (const resourceKey of sortResourceKeys(mutationEventsByResource.keys())) {
			const reads = readEventsByResource.get(resourceKey) ?? [];
			const mutations = mutationEventsByResource.get(resourceKey) ?? [];
			for (const mutation of mutations) {
				const priorReads = reads.filter((read) => read.id < mutation.id);
				const priorReadIds = priorReads.map((read) => read.id);
				if (priorReadIds.length === 0) continue;
				mutationAfterRead.push({ resourceKey, readEventIds: priorReadIds, mutationEventId: mutation.id });
				staleCandidates.push({
					resourceKey,
					staleEventIds: priorReadIds,
					mutationEventId: mutation.id,
					reason: "mutation-after-read",
					staleResults: priorReads.map((read) => buildStaleContextRecord({
						originalTool: read.tool,
						originalEventId: read.id,
						originalResultId: read.resultId,
						staleResourceKeys: [resourceKey],
						invalidatingMutationEventId: mutation.id,
						invalidatingMutationResultId: mutation.resultId,
						reason: "mutation-after-read",
						rehydrate: read.rehydrate,
					})),
				});
			}
		}

		const bashCommandEvents = this.events.filter(
			(event) => event.tool === "bash" && event.classification === "command-output" && event.commandState,
		);
		const invalidatingRepoEvents = this.events.filter(
			(event) => event.classification === "mutation" || event.commandState?.stateKind === "git-worktree-mutation",
		);
		const commandKeyForEvent = (event: ContextHygieneEvent): string | undefined =>
			event.resources.find((resource) => resource.kind === "command")?.key;

		for (const event of bashCommandEvents) {
			const state = event.commandState;
			if (!state || (state.stateKind !== "repo-status" && state.stateKind !== "repo-diff")) continue;
			const invalidator = invalidatingRepoEvents.find((candidate) => candidate.id > event.id);
			const commandKey = commandKeyForEvent(event);
			if (!invalidator || !commandKey) continue;
			staleCandidates.push({
				resourceKey: commandKey,
				staleEventIds: [event.id],
				mutationEventId: invalidator.id,
				reason: "bash-repo-state-after-mutation",
				staleResults: [buildStaleContextRecord({
					originalTool: event.tool,
					originalEventId: event.id,
					originalResultId: event.resultId,
					staleResourceKeys: [commandKey],
					invalidatingMutationEventId: invalidator.id,
					invalidatingMutationResultId: invalidator.resultId,
					reason: "bash-repo-state-after-mutation",
					command: state.normalizedCommand,
				})],
			});
		}

		for (const event of bashCommandEvents) {
			const state = event.commandState;
			const commandKey = commandKeyForEvent(event);
			if (!state || state.stateKind !== "verification" || state.outcome !== "failure" || !commandKey) continue;
			const success = bashCommandEvents.find((candidate) => {
				const candidateState = candidate.commandState;
				return candidate.id > event.id && commandKeyForEvent(candidate) === commandKey && candidateState?.outcome === "success";
			});
			if (!success) continue;
			staleCandidates.push({
				resourceKey: commandKey,
				staleEventIds: [event.id],
				mutationEventId: success.id,
				reason: "bash-verification-success-rerun",
				staleResults: [buildStaleContextRecord({
					originalTool: event.tool,
					originalEventId: event.id,
					originalResultId: event.resultId,
					staleResourceKeys: [commandKey],
					invalidatingMutationEventId: success.id,
					invalidatingMutationResultId: success.resultId,
					reason: "bash-verification-success-rerun",
					command: state.normalizedCommand,
				})],
			});
		}

		for (const resourceKey of sortResourceKeys(commandEventsByResource.keys())) {
			const eligible = (commandEventsByResource.get(resourceKey) ?? []).filter((event) =>
				event.commandState?.routineRetirementEligible === true && event.commandState.outcome === "success",
			);
			if (eligible.length < 2) continue;
			const latest = eligible[eligible.length - 1];
			const retired = eligible.slice(0, -1);
			retirementCandidates.push({
				resourceKey,
				eventIds: retired.map((event) => event.id),
				supersededByEventId: latest.id,
				reason: "same-command-success-rerun",
				retiredResults: retired.map((event) => buildRetiredContextRecord({
					originalTool: event.tool,
					originalEventId: event.id,
					originalResultId: event.resultId,
					retiredResourceKeys: [resourceKey],
					supersededByEventId: latest.id,
					supersededByResultId: latest.resultId,
					reason: "same-command-success-rerun",
					command: event.commandState?.normalizedCommand,
				})),
			});
		}

		for (const resourceKey of sortResourceKeys(commandEventsByResource.keys())) {
			const commands = (commandEventsByResource.get(resourceKey) ?? []).filter(
				(event) => !(event.tool === "bash" && event.commandState),
			);
			if (commands.length < 2) continue;
			for (let index = 1; index < commands.length; index += 1) {
				retirementCandidates.push({
					resourceKey,
					eventIds: commands.slice(0, index).map((event) => event.id),
					supersededByEventId: commands[index].id,
					reason: "command-rerun",
				});
			}
		}

		return {
			eventCount: this.events.length,
			resourceCount: eventsByResource.size,
			readReuse,
			commandReruns,
			mutationAfterRead,
			staleCandidates,
			retirementCandidates,
			churn: {
				byClassification,
				byTool: Object.fromEntries(Object.entries(byTool).sort(([left], [right]) => compareStable(left, right))),
				uniqueResourcesSeen: eventsByResource.size,
			},
		};
	}
}

export function createContextHygieneTracker(options: CreateContextHygieneTrackerOptions = {}): ContextHygieneTracker {
	return new DefaultContextHygieneTracker(options);
}

let globalContextHygieneTracker = createContextHygieneTracker();

export function resetContextHygieneTracker(options: CreateContextHygieneTrackerOptions = {}): ContextHygieneTracker {
	globalContextHygieneTracker = createContextHygieneTracker(options);
	return globalContextHygieneTracker;
}

export function getContextHygieneTracker(): ContextHygieneTracker {
	return globalContextHygieneTracker;
}
