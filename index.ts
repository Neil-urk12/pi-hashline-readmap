import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerReadTool } from "./src/read.js";
import { registerEditTool } from "./src/edit.js";
import { registerGrepTool } from "./src/grep.js";
import { registerSgTool, isSgAvailable } from "./src/sg.js";
import { registerNuTool } from "./src/nu.js";
import { registerWriteTool } from "./src/write.js";
import { registerLsTool } from "./src/ls.js";
import { registerFindTool } from "./src/find.js";
import { registerBashRendererTool } from "./src/bash-renderer.js";
import {
	AUTO_READ_MAX_LINES,
	formatAutoReadOutput,
	isAutoReadEnabled,
	toggleAutoRead,
} from "./src/auto-read.js";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { filterBashOutput } from "./src/rtk/bash-filter.js";
import { buildRtkCompaction } from "./src/rtk/rtk-compaction.js";
import { ensureBashOriginalOutputSnapshot, selectBashOriginalOutput } from "./src/rtk/bash-original-output.js";
import { applyBashContextGuard, resolveBashContextGuardConfig, type BashContextGuardConfig } from "./src/rtk/bash-context-guard.js";
import { processBashToolResult } from "./src/rtk/bash-result-pipeline.js";
import { applyContextHygieneStaleContext } from "./src/context-application.js";
import { buildBashCommandState } from "./src/bash-command-state.js";
import {
  buildCommandResource,
  buildContextHygieneMetadata,
  buildFileResource,
  getContextHygieneTracker,
  normalizePathForContextHygiene,
  registerContextHygieneDebugTool,
  resetContextHygieneTracker,
  type ContextHygieneAppliedEffects,
  type ContextHygieneEvent,
  type ContextHygieneMetadata,
  type ContextHygieneResource,
} from "./src/context-hygiene.js";
import {
  consumeDoomLoopWarning,
  createDoomLoopState,
  formatDoomLoopMessage,
  recordToolCall,
} from "./src/doom-loop.js";

function isWriteToolResult(event: unknown): event is {
	toolName: string;
	toolCallId: string;
	input?: unknown;
	content: Array<{ type: string; text?: string }>;
	isError?: boolean;
	details?: unknown;
} {
	return !!event && typeof event === "object" && (event as { toolName?: unknown }).toolName === "write";
}

/**
 * Append hashline-anchored anchors to a successful write result, when
 * auto-read is enabled. Best-effort: any I/O failure is swallowed.
 */
async function maybeAppendAutoRead(
	event: { toolName: string; input?: unknown; content: Array<{ type: string; text?: string }>; isError?: boolean; details?: unknown },
	ctx: { cwd?: string },
): Promise<{ content: Array<{ type: string; text?: string }>; details?: unknown } | undefined> {
	if (!isAutoReadEnabled()) return undefined;
	if (event.isError === true) return undefined;
	const input = (event.input ?? {}) as Record<string, unknown>;
	const filePath = input.path;
	if (typeof filePath !== "string" || filePath.length === 0) return undefined;

	try {
		const cwd = ctx.cwd ?? process.cwd();
		const absolutePath = isAbsolute(filePath) ? filePath : `${cwd}/${filePath}`;
		const content = await readFile(absolutePath, "utf-8");
		const formatted = formatAutoReadOutput(content, AUTO_READ_MAX_LINES);
		if (!formatted) return undefined;

		const newText = `\n\n--- Auto-read (hashline anchors) ---\n${formatted.output}${formatted.paginationHint}`;
		const nextContent = [...event.content];
		const lastTextIndex = (() => {
			for (let i = nextContent.length - 1; i >= 0; i -= 1) {
				const item = nextContent[i] as { type?: unknown; text?: unknown };
				if (item.type === "text" && typeof item.text === "string") return i;
			}
			return -1;
		})();
		if (lastTextIndex >= 0) {
			const item = nextContent[lastTextIndex] as { type: "text"; text: string };
			nextContent[lastTextIndex] = { ...item, text: `${item.text}${newText}` };
		} else {
			nextContent.push({ type: "text", text: newText.trimStart() });
		}
		return { content: nextContent, details: event.details };
	} catch (err) {
		// Best-effort: swallow expected I/O errors (ENOENT, EACCES, etc.) so a
		// failed auto-read never surfaces to the user. Let programmer errors
		// (TypeError, ReferenceError) propagate so we notice them in tests.
		if (!err || typeof err !== "object" || !("code" in err)) throw err;
		return undefined;
	}
}

function isBashToolResult(event: unknown): event is {
  toolName: string;
  toolCallId: string;
  input?: unknown;
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
  details?: unknown;
} {
  return !!event && typeof event === "object" && (event as { toolName?: unknown }).toolName === "bash";
}

function isContextHygieneResource(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const resource = value as { kind?: unknown; key?: unknown };
  return (
    (resource.kind === "file" || resource.kind === "symbol" || resource.kind === "command") &&
    typeof resource.key === "string"
  );
}

function isContextHygieneMetadata(value: unknown): value is ContextHygieneMetadata {
  if (!value || typeof value !== "object") return false;
  const metadata = value as Partial<ContextHygieneMetadata>;
  return (
    metadata.schemaVersion === 1 &&
    typeof metadata.tool === "string" &&
    (metadata.classification === "read-context" ||
      metadata.classification === "search-context" ||
      metadata.classification === "command-output" ||
      metadata.classification === "mutation") &&
    Array.isArray(metadata.resources) &&
    metadata.resources.every(isContextHygieneResource)
  );
}

function contextHygieneFromDetails(details: unknown): ContextHygieneMetadata | undefined {
  if (!details || typeof details !== "object") return undefined;
  const metadata = (details as { contextHygiene?: unknown }).contextHygiene;
  return isContextHygieneMetadata(metadata) ? metadata : undefined;
}

function recordContextHygiene(metadata: ContextHygieneMetadata, toolCallId: unknown): ContextHygieneEvent {
  return getContextHygieneTracker().record(metadata, {
    resultId: typeof toolCallId === "string" ? toolCallId : undefined,
  });
}

function buildAppliedEffectsBucket(resultIds: Set<string>, reasons: Set<string>) {
  return {
    count: resultIds.size,
    resultIds: [...resultIds].sort(),
    reasons: [...reasons].sort(),
  };
}

const BASH_CURRENT_TURN_STALE_REASONS = new Set([
  "bash-repo-state-after-mutation",
  "bash-verification-success-rerun",
]);
function summarizeBashAppliedEffects(eventId: number): ContextHygieneAppliedEffects {
  const report = getContextHygieneTracker().generateReport();
  const retiredResultIds = new Set<string>();
  const retiredReasons = new Set<string>();
  const staleResultIds = new Set<string>();
  const staleReasons = new Set<string>();

  for (const candidate of report.retirementCandidates) {
    if (candidate.supersededByEventId !== eventId) continue;
    for (const record of candidate.retiredResults ?? []) {
      if (record.originalTool !== "bash" || !record.originalResultId) continue;
      retiredResultIds.add(record.originalResultId);
      retiredReasons.add(record.reason);
    }
  }

  for (const candidate of report.staleCandidates) {
    if (candidate.mutationEventId !== eventId || !BASH_CURRENT_TURN_STALE_REASONS.has(candidate.reason)) continue;
    for (const record of candidate.staleResults) {
      if (record.originalTool !== "bash" || !record.originalResultId) continue;
      staleResultIds.add(record.originalResultId);
      staleReasons.add(record.reason);
    }
  }

  return {
    retired: buildAppliedEffectsBucket(retiredResultIds, retiredReasons),
    stale: buildAppliedEffectsBucket(staleResultIds, staleReasons),
  };
}

function hasAppliedEffects(effects: ContextHygieneAppliedEffects): boolean {
  return effects.retired.count > 0 || effects.stale.count > 0;
}

export {
  HASHLINE_TOOL_PTC_POLICY,
  getHashlineToolPtcPolicy,
} from "./src/ptc-tool-policy.js";
export type {
  HashlineToolDefaultExposure,
  HashlineToolMutability,
  HashlineToolName,
  HashlineToolPtcPolicy,
  HashlineToolPtcPolicyEntry,
} from "./src/ptc-tool-policy.js";
export default function piHashlineReadmapExtension(pi: ExtensionAPI): void {
  // readTurns maps an absolute path to the tracker event id of the most recent
  // live-anchor tool result for that path (read / grep / ast_search / write).
  // When the provider-context handler masks a prior live-anchor read into a
  // stale placeholder, we expire the corresponding entry so wasReadInSession
  // stops returning true until the agent re-reads the file.
  const readTurns = new Map<string, number>();
  const doomLoopState = createDoomLoopState();
  resetContextHygieneTracker();
  const readTurnKey = (absolutePath: string) => normalizePathForContextHygiene(absolutePath);
  const noteRead = (absolutePath: string) => {
    // noteRead is invoked synchronously from inside read/grep/ast_search/write
    // BEFORE the tool result is dispatched to the tool_result handler that
    // calls tracker.record(). So the just-finishing tool's event will receive
    // id = report.eventCount + 1 once tool_result fires. We anchor readTurns
    // to that anticipated id so the entry is strictly newer than every
    // mutation event id <= the current eventCount, which is exactly what
    // expireStaleReadTurns compares against.
    const tracker = getContextHygieneTracker();
    const report = tracker.generateReport();
    const eventId = report.eventCount + 1;
    readTurns.set(readTurnKey(absolutePath), eventId);
  };
  const wasReadInSession = (absolutePath: string) => readTurns.has(readTurnKey(absolutePath));

  const readTool = registerReadTool(pi, { onSuccessfulRead: noteRead });
  const editTool = registerEditTool(pi, { wasReadInSession });
  const sgAvailable = isSgAvailable();
  const astSearchGuideline = sgAvailable
    ? "Use grep summary for counts; use ast_search for structural code patterns."
    : "Use grep summary for counts; install ast-grep to enable ast_search.";

  const grepTool = registerGrepTool(pi, { astSearchGuideline, onFileAnchored: noteRead });
  const sgTool = registerSgTool(pi, { onFileAnchored: noteRead });
  const nuTool = registerNuTool(pi);
  const writeTool = registerWriteTool(pi, { onFileAnchored: noteRead });
  const lsTool = registerLsTool(pi);
  const findTool = registerFindTool(pi);
  registerBashRendererTool(pi, { cwd: process.cwd() });
  const contextHygieneDebugTool = registerContextHygieneDebugTool(pi);
  const toolExecutors = {
    read: readTool,
    edit: editTool,
    grep: grepTool,
    ast_search: sgTool,
    write: writeTool,
    ls: lsTool,
    find: findTool,
    ...(nuTool ? { nu: nuTool } : {}),
    ...(contextHygieneDebugTool ? { context_hygiene_report: contextHygieneDebugTool } : {}),
  };

  (globalThis as any).__hashlineToolExecutors = toolExecutors;
  pi.events.emit("hashline:tool-executors", toolExecutors);

  pi.on("tool_call", (event: any) => {
    recordToolCall(
      doomLoopState,
      event.toolName,
      event.toolCallId,
      (event.input ?? {}) as Record<string, unknown>,
    );
    return undefined;
  });

  // Expire readTurns entries whose tracked live-anchor event id has been
  // superseded by a later same-file mutation (i.e. the prior read has been
  // masked into a stale placeholder by applyContextHygieneStaleContext).
  // After expiry, edit's read-before-edit guard correctly forces a re-read.
  const expireStaleReadTurns = (
    report: ReturnType<ReturnType<typeof getContextHygieneTracker>["generateReport"]>,
  ) => {
    if (readTurns.size === 0) return;
    for (const candidate of report.staleCandidates) {
      if (!candidate.resourceKey.startsWith("file:")) continue;
      const absolutePath = readTurnKey(candidate.resourceKey.slice("file:".length));
      const recordedEventId = readTurns.get(absolutePath);
      if (recordedEventId === undefined) continue;
      if (recordedEventId <= candidate.mutationEventId) {
        readTurns.delete(absolutePath);
      }
    }
  };

  pi.on("context", (event: any): any => {
    if (!Array.isArray(event.messages)) return undefined;
    const report = getContextHygieneTracker().generateReport();
    const messages = applyContextHygieneStaleContext(event.messages, report);
    expireStaleReadTurns(report);
    if (messages === event.messages) return undefined;
    return { messages };
  });

  (pi as any).on("tool_result", async (event: any) => {
    // Auto-read after write: append hashline anchors to the result so the
    // model can chain edits without a separate read call. Off by default;
    // toggled via PI_HASHLINE_AUTO_READ or /toggle-auto-read.
    if (isWriteToolResult(event)) {
      const augmented = await maybeAppendAutoRead(event, { cwd: process.cwd() });
      if (augmented) {
        event.content = augmented.content;
        if (augmented.details !== undefined) event.details = augmented.details;
      }
    }
    const doomLoop = consumeDoomLoopWarning(doomLoopState, event.toolCallId);
    if (!isBashToolResult(event)) {
      const contextHygiene = contextHygieneFromDetails(event.details);
      if (contextHygiene) recordContextHygiene(contextHygiene, event.toolCallId);
      if (!doomLoop || !Array.isArray(event.content)) {
        return undefined;
      }
      const content = [...event.content];
      const prefix = `${formatDoomLoopMessage(doomLoop)}\n\n---\n`;
      let textIndex = -1;
      for (let i = 0; i < content.length; i++) {
        const item = content[i] as { type?: unknown; text?: unknown };
        if (item.type === "text" && typeof item.text === "string") {
          textIndex = i;
          break;
        }
      }
      if (textIndex >= 0) {
        const item = content[textIndex] as { type: "text"; text: string };
        content[textIndex] = { ...item, text: `${prefix}${item.text}` };
      } else {
        content.unshift({ type: "text" as const, text: prefix });
      }
      return {
        content,
        details: event.details,
        isError: event.isError,
      };
    }
    const existingDetails =
      event.details && typeof event.details === "object" ? (event.details as Record<string, unknown>) : {};
    const command =
      event.input && typeof event.input === "object" && typeof (event.input as { command?: unknown }).command === "string"
        ? (event.input as { command: string }).command
        : "";

    const prependedText = doomLoop
      ? `${formatDoomLoopMessage(doomLoop)}\n\n---\n`
      : undefined;

    const tracker = getContextHygieneTracker();
    const pipelineResult = processBashToolResult(event as Parameters<typeof processBashToolResult>[0], {
      cwd: process.cwd(),
      env: process.env,
      contextGuardConfig: resolveBashContextGuardConfig(),
      tracker,
      onShellMutation: () => {
        if (event.isError === true) return;
        // The deep module only calls onShellMutation when the command was
        // classified as a shell-file mutation with file targets; we still
        // re-derive the report at expire-time so a same-turn mutation can
        // immediately invalidate the current turn's reads.
        expireStaleReadTurns(tracker.generateReport());
      },
      prependedText,
    });

    if (process.env.PI_RTK_SAVINGS === "1" && pipelineResult.savedChars > 0) {
      process.stderr.write(`[RTK] Saved ${pipelineResult.savedChars} chars (${command})\n`);
    }

    const appliedEffects = summarizeBashAppliedEffects(pipelineResult.recordedEventId);
    const contextHygieneForDetails: ContextHygieneMetadata = hasAppliedEffects(appliedEffects)
      ? { ...pipelineResult.details.contextHygiene, appliedEffects }
      : pipelineResult.details.contextHygiene;

    const existingPtcValue =
      existingDetails.ptcValue && typeof existingDetails.ptcValue === "object"
        ? (existingDetails.ptcValue as Record<string, unknown>)
        : {};
    return {
      content: pipelineResult.content,
      details: {
        ...existingDetails,
        compressionInfo: pipelineResult.details.compressionInfo,
        contextHygiene: contextHygieneForDetails,
        bashContextGuard: pipelineResult.details.bashContextGuard,
        ...(pipelineResult.details.bashOriginalOutput
          ? { bashOriginalOutput: pipelineResult.details.bashOriginalOutput }
          : {}),
        rtkCompaction: pipelineResult.details.rtkCompaction,
        ptcValue: { ...existingPtcValue, rtkCompaction: pipelineResult.details.rtkCompaction },
      },
    };
});

  // Slash command to toggle auto-read after write at runtime.
  (pi as any).registerCommand?.("toggle-auto-read", {
    description: "Toggle automatic hashline anchors after write operations",
    handler: async (_args: unknown, ctx: { ui?: { notify?: (msg: string, level?: string) => void } }) => {
      const enabled = toggleAutoRead();
      ctx.ui?.notify?.(`Auto-read after write: ${enabled ? "enabled" : "disabled"}`, "info");
    },
  });

  // Session_start debug notification — opt in via PI_HASHLINE_DEBUG=1 (or
  // "true") to surface a "Hashline Readmap active" notification at session
  // start. Useful when verifying that an extension session actually picked
  // up our wiring.
  (pi as any).on("session_start", async (_event: unknown, ctx: { ui?: { notify?: (msg: string, level?: string) => void } }) => {
    const flag = process.env.PI_HASHLINE_DEBUG;
    if (flag !== "1" && flag !== "true") return;
    ctx.ui?.notify?.("Hashline Readmap active", "info");
  });
}
