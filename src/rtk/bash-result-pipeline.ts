/**
 * Bash tool-result pipeline — the deep module behind every `bash` tool_result.
 *
 * Eight stages, applied in order:
 *   1. extract visible text + non-text tail
 *   2. resolve the original-output snapshot for RTK input
 *   3. build a `BashCommandState` for the command
 *   4. build + record context-hygiene metadata
 *   5. expire readTurns on shell-file mutation (via the `onShellMutation` callback)
 *   6. run the RTK route compression
 *   7. apply the bash context guard (with `prependedText` prepended first)
 *   8. assemble the final return
 *
 * The function is a pure operation over a typed event plus injected deps.
 * Session-scoped state (readTurns, doomLoop) lives in `index.ts` and is reached
 * through callbacks / optional prepended text. See `docs/adr/0001-bash-result-pipeline.md`.
 */
import { buildBashCommandState, type BashCommandState } from "../bash-command-state.ts";
import {
  buildCommandResource,
  buildContextHygieneMetadata,
  buildFileResource,
  type ContextHygieneMetadata,
  type ContextHygieneResource,
  type ContextHygieneTracker,
} from "../context-hygiene.ts";
import {
  applyBashContextGuard,
  type BashContextGuardConfig,
  type BashContextGuardMetadata,
} from "./bash-context-guard.ts";
import {
  ensureBashOriginalOutputSnapshot,
  selectBashOriginalOutput,
  type BashOriginalOutputMetadata,
} from "./bash-original-output.ts";
import { filterBashOutput, type CompressionInfo, type FilterResult } from "./bash-filter.ts";
import { buildRtkCompaction, type RtkCompaction } from "./rtk-compaction.ts";

/** Format a byte count for the RTK notice ("512 B" or "8.2 KB"). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * Build the one-line RTK notice that sits above compressed output. Returns
 * `null` when the compression wasn't significant enough to deserve a notice
 * (output was empty, compression was bypassed, ratio was poor, or the input
 * was too small). When non-null, the result is a "preserved notice" line
 * (starts with `[RTK:`) so the bash context guard hoists it into its
 * "Preserved notices" section.
 */
function buildRtkNotice(
  info: CompressionInfo,
  command: string,
  outputIsEmpty: boolean,
): string | null {
  if (info.bypassedBy !== undefined) return null;
  if (outputIsEmpty) return null;
  if (info.originalBytes <= 2000) return null;
  if (info.compressionRatio >= 0.5) return null;
  const pct = Math.round((1 - info.compressionRatio) * 100);
  return `[RTK: compressed ${info.technique} output ${formatBytes(info.originalBytes)} → ${formatBytes(info.outputBytes)} (${pct}% saved). Use \`PI_RTK_BYPASS=1 ${command}\` to see full output.]`;
}

/** The bash tool_result event shape the pipeline consumes. */
export interface BashToolResultEvent {
  type: "tool_result";
  toolName: "bash";
  toolCallId: string;
  input?: { command?: unknown } | unknown;
  content: Array<{ type: string; text?: unknown; [key: string]: unknown }>;
  isError?: boolean;
  details?: { fullOutputPath?: unknown; [key: string]: unknown } | null;
}

/** The injected deps the pipeline needs to do its work without touching globals. */
export interface BashPipelineDeps {
  cwd: string;
  env: NodeJS.ProcessEnv;
  contextGuardConfig: BashContextGuardConfig;
  tracker: ContextHygieneTracker;
  /** Called when the bash command is classified as a shell-file mutation. */
  onShellMutation: (paths: string[]) => void;
  /**
   * Optional text prepended to the post-RTK body *before* the bash context guard
   * runs. Use for cross-cutting concerns that must survive the guard (the guard
   * protects them by name). Typically the doom-loop warning rendered by the host.
   */
  prependedText?: string;
}

/** The pipeline's return shape — fed back to the host as the tool_result. */
export interface BashPipelineResult {
  /** The id of the recorded context-hygiene event; the host uses it to summarize applied effects. */
  recordedEventId: number;
  /**
   * Character count saved by RTK compression (input.length - output.length).
   * Surfaced so the host can emit the PI_RTK_SAVINGS diagnostic log without
   * re-running the compressor.
   */
  savedChars: number;
  content: Array<{ type: "text"; text: string } | { type: string; [key: string]: unknown }>;
  details: {
    compressionInfo: CompressionInfo;
    contextHygiene: ContextHygieneMetadata;
    bashContextGuard: BashContextGuardMetadata;
    bashOriginalOutput?: BashOriginalOutputMetadata;
    rtkCompaction: RtkCompaction;
  };
  isError: boolean;
}

// ─── Stage 1: extract visible text + non-text tail ──────────────────────────

function extractContent(event: BashToolResultEvent): {
  text: string;
  nonText: Array<{ type: string; [key: string]: unknown }>;
} {
  const items = Array.isArray(event.content) ? event.content : [];
  const text = items
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("\n");
  const nonText = items.filter((c) => !(c.type === "text" && typeof c.text === "string"));
  return { text, nonText };
}

// ─── Stage 3: build a BashCommandState for the command ──────────────────────

function resolveCommand(event: BashToolResultEvent): string {
  const input = event.input;
  if (input && typeof input === "object" && typeof (input as { command?: unknown }).command === "string") {
    return (input as { command: string }).command;
  }
  return "";
}

function buildState(command: string, cwd: string, isError: boolean, text: string): BashCommandState | undefined {
  if (!command) return undefined;
  return buildBashCommandState({ command, cwd, isError, text });
}

// ─── Stage 4: build + record context-hygiene metadata ───────────────────────

interface HygieneResult {
  metadata: ContextHygieneMetadata;
  recordedEventId: number;
}

function buildAndRecordHygiene(
  deps: BashPipelineDeps,
  event: BashToolResultEvent,
  command: string,
  commandState: BashCommandState | undefined,
): HygieneResult {
  const resources: ContextHygieneResource[] = command ? [buildCommandResource(command)] : [];
  for (const fileTarget of commandState?.fileTargets ?? []) {
    resources.push(buildFileResource(fileTarget));
  }
  const metadata = buildContextHygieneMetadata({
    tool: "bash",
    classification: commandState?.stateKind === "shell-file-mutation" ? "mutation" : "command-output",
    resources,
    commandState,
  });
  const recorded = deps.tracker.record(metadata, { resultId: event.toolCallId });
  return { metadata, recordedEventId: recorded.id };
}

// ─── Stage 5: expire readTurns on shell-file mutation ──────────────────────

function maybeExpireReadTurns(
  deps: BashPipelineDeps,
  event: BashToolResultEvent,
  commandState: BashCommandState | undefined,
): void {
  if (event.isError === true) return;
  if (commandState?.stateKind !== "shell-file-mutation") return;
  const paths = commandState.fileTargets ?? [];
  if (paths.length === 0) return;
  deps.onShellMutation(paths);
}

function emptyCompressionInfo(): CompressionInfo {
  return { originalBytes: 0, outputBytes: 0, compressionRatio: 1, technique: "none" };
}

// ─── The pipeline ───────────────────────────────────────────────────────────

export function processBashToolResult(
  event: BashToolResultEvent,
  deps: BashPipelineDeps,
): BashPipelineResult {
  // 1. extract text + non-text tail
  const { text, nonText } = extractContent(event);
  // 2. resolve the original-output snapshot for RTK input. When the bash
  //    tool recorded a readable full-output file, this swaps the visible
  //    tail for the actual payload so RTK sees the full content.

  const originalSelection = selectBashOriginalOutput({
    visibleText: text,
    fullOutputPath: event.details?.fullOutputPath,
    enabled: deps.contextGuardConfig.enabled,
  });
  const inputForRtk = originalSelection.inputForRtk;

  const command = resolveCommand(event);
  const commandState = buildState(command, deps.cwd, event.isError === true, inputForRtk);

  // 4. build + record context-hygiene metadata
  const { metadata: contextHygiene, recordedEventId } = buildAndRecordHygiene(
    deps,
    event,
    command,
    commandState,
  );

  // 5. expire readTurns on shell-file mutation
  maybeExpireReadTurns(deps, event, commandState);

  // 6. run RTK route compression (skipped for empty text). The input is
  //    the original-output snapshot (full file contents) when available, so
  //    compression sees the full payload rather than the visible tail.
  const compression: FilterResult = text === ""
    ? { output: "", savedChars: 0, info: emptyCompressionInfo() }
    : filterBashOutput(command, inputForRtk);

  // 7. assemble the body that the context guard will see. The RTK notice
  //    (if any) sits between the doom-loop warning and the compressed
  //    output, so the guard can hoist it into "Preserved notices".
  const notice = buildRtkNotice(compression.info, command, compression.output === "");
  const bodyWithNotice = notice ? `${notice}\n${compression.output}` : compression.output;
  const preGuardText = deps.prependedText
    ? `${deps.prependedText}${bodyWithNotice}`
    : bodyWithNotice;
  const originalMetadataForGuard = deps.contextGuardConfig.enabled && text !== "" && (
    preGuardText.split("\n").length > deps.contextGuardConfig.maxLines ||
    Buffer.byteLength(preGuardText, "utf8") > deps.contextGuardConfig.maxBytes
  )
    ? ensureBashOriginalOutputSnapshot({
        visibleText: text,
        metadata: originalSelection.metadata,
        enabled: deps.contextGuardConfig.enabled,
      })
    : originalSelection.metadata;
  const guarded = applyBashContextGuard({
    text: preGuardText,
    command,
    originalMetadata: originalMetadataForGuard,
    config: deps.contextGuardConfig,
  });

  // 8. assemble
  const compressionInfo: CompressionInfo = text === ""
    ? emptyCompressionInfo()
    : compression.info;
  const rtkCompaction = buildRtkCompaction({
    rawInput: inputForRtk,
    output: compression.output,
    info: compressionInfo,
  });

  return {
    recordedEventId,
    savedChars: compression.savedChars,
    content: [{ type: "text" as const, text: guarded.text }, ...nonText],
    details: {
      compressionInfo,
      contextHygiene,
      bashContextGuard: guarded.metadata,
      ...(originalMetadataForGuard ? { bashOriginalOutput: originalMetadataForGuard } : {}),
      rtkCompaction,
    },
    isError: event.isError === true,
  };
}
