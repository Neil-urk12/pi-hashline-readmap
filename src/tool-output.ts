/**
 * Tool output assembler — the deep module behind the { text, ptcValue,
 * contextHygiene } triple that every tool result returns.
 *
 * Shims (read-output.ts, grep-output.ts, …) own their rendering policy and
 * pass the pre-rendered body plus a typed ptcValue envelope. This module
 * owns:
 *   - the truncation header format (was duplicated in 2 places)
 *   - the resource-collection pass (was duplicated in 5 places — 2
 *     migrated in this PR, the remaining shims will follow in a follow-up)
 *   - the context-hygiene metadata construction (was per-shim)
 */
import { formatSize, truncateHead } from "@earendil-works/pi-coding-agent";
import {
  buildContextHygieneMetadata,
  buildFileResource,
  buildSymbolResource,
  type ContextHygieneMetadata,
  type ContextHygieneRehydrateDescriptor,
  type ContextHygieneResource,
} from "./context-hygiene.js";
import type { BashCommandState } from "./bash-command-state.js";

export type ToolOutputClassification =
  | "read-context"
  | "search-context"
  | "command-output"
  | "mutation";

export interface ToolOutputBudget {
  maxLines: number;
  maxBytes: number;
}

/** Values that substitute into the standard truncation header. */
export interface ToolOutputTruncationHeader {
  /** Shown as "of N lines". Defaults to `truncateHead.totalLines`. */
  totalLines?: number;
  /** Tail of the header. Defaults to "Refine pattern or increase limit." */
  advice?: string;
}

export interface ToolOutputSymbolRef {
  path: string;
  name: string;
  kind?: string;
}

export interface ToolOutputFileRef {
  path: string;
}

export interface BuildToolOutputInput<TPtc extends { tool: string }> {
  /** The tool producing the result. Narrows ptcValue's `tool` field. */
  tool: TPtc["tool"];
  /** Classification used for context-hygiene tracking. */
  classification: ToolOutputClassification;
  /**
   * Pre-rendered body — the shim owns the rendering policy. If `budget` is
   * provided, this text is truncated as a whole (no per-section exemption).
   */
  text: string;
  /** Tool's typed PTC envelope, passed through unchanged. */
  ptcValue: TPtc;
  /** Files this result references (collected into contextHygiene). */
  files?: readonly ToolOutputFileRef[];
  /** Symbols this result references (collected into contextHygiene). */
  symbols?: readonly ToolOutputSymbolRef[];
  /** Rehydrate descriptor for stale-context invalidation. */
  rehydrate?: ContextHygieneRehydrateDescriptor | null;
  /** Bash command state (only meaningful for `command-output`). */
  commandState?: BashCommandState;
  /**
   * Optional truncation budget. If omitted, no truncation is applied.
   */
  budget?: ToolOutputBudget;
  /**
   * Optional overrides for the truncation header. The header format
   * `[Output truncated: showing N of M lines (X of Y). ADVICE]` is owned
   * by this module; the shim supplies M (totalLines) and ADVICE when
   * tool-specific values are needed.
   */
  truncationHeader?: ToolOutputTruncationHeader;
}

export interface BuildToolOutputResult<TPtc> {
  text: string;
  ptcValue: TPtc;
  contextHygiene: ContextHygieneMetadata;
}

export function buildToolOutput<TPtc extends { tool: string }>(
  input: BuildToolOutputInput<TPtc>,
): BuildToolOutputResult<TPtc> {
  const text = applyBudget(input.text, input.budget, input.truncationHeader);

  const seen = new Set<string>();
  const resources: ContextHygieneResource[] = [];
  for (const file of input.files ?? []) {
    const resource = buildFileResource(file.path);
    if (seen.has(resource.key)) continue;
    seen.add(resource.key);
    resources.push(resource);
  }
  for (const symbol of input.symbols ?? []) {
    const resource = buildSymbolResource(symbol.path, symbol.name, symbol.kind);
    if (seen.has(resource.key)) continue;
    seen.add(resource.key);
    resources.push(resource);
  }

  const contextHygiene = buildContextHygieneMetadata({
    tool: input.tool,
    classification: input.classification,
    resources,
    ...(input.rehydrate ? { rehydrate: input.rehydrate } : {}),
    ...(input.commandState ? { commandState: input.commandState } : {}),
  });

  return { text, ptcValue: input.ptcValue, contextHygiene };
}

const DEFAULT_TRUNCATION_ADVICE = "Refine pattern or increase limit.";

function applyBudget(
  text: string,
  budget: ToolOutputBudget | undefined,
  header: ToolOutputTruncationHeader | undefined,
): string {
  if (!budget) return text;
  const truncated = truncateHead(text, {
    maxLines: budget.maxLines,
    maxBytes: budget.maxBytes,
  });
  if (!truncated.truncated) return text;
  const totalLines = header?.totalLines ?? truncated.totalLines;
  const advice = header?.advice ?? DEFAULT_TRUNCATION_ADVICE;
  return (
    `${truncated.content}\n\n` +
    `[Output truncated: showing ${truncated.outputLines} of ${totalLines} lines ` +
    `(${formatSize(truncated.outputBytes)} of ${formatSize(truncated.totalBytes)}). ${advice}]`
  );
}
