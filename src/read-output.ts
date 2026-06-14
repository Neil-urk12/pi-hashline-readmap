/**
 * Read tool output shim — assembles the truncatable body, hands off to
 * `buildToolOutput` for truncation + envelope + metadata, then wraps the
 * result with the read-specific trailers (continuation, bundle, map) and
 * prepends (symbol, warnings).
 */
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
} from "@earendil-works/pi-coding-agent";
import { buildPtcLines, renderPtcLines, type PtcLine, type PtcWarning } from "./ptc-value.js";
import { type ContextHygieneMetadata, type ContextHygieneRehydrateDescriptor } from "./context-hygiene.js";
import { buildToolOutput, type ToolOutputBudget } from "./tool-output.js";

export interface ReadSymbolMetadata {
  query: string;
  name: string;
  kind: string;
  parentName?: string;
  startLine: number;
  endLine: number;
}

export interface ReadTruncationMetadata {
  outputLines: number;
  totalLines: number;
  outputBytes: number;
  totalBytes: number;
}

export interface ReadMapMetadata {
  requested: boolean;
  appended: boolean;
  text?: string | null;
}

export interface ReadContinuationMetadata {
  nextOffset: number;
}

export interface ReadBundleSupportItem {
  symbol: ReadSymbolMetadata;
  lines: string[];
}

export interface ReadBundleMetadata {
  mode: "local";
  applied: boolean;
  localSupport: ReadBundleSupportItem[];
  warnings?: PtcWarning[];
}

export interface ReadOutputInput {
  path: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  selectedLines: string[];
  warnings?: PtcWarning[];
  truncation?: ReadTruncationMetadata | null;
  continuation?: ReadContinuationMetadata | null;
  symbol?: ReadSymbolMetadata | null;
  map?: ReadMapMetadata;
  bundle?: ReadBundleMetadata | null;
  rehydrate?: ContextHygieneRehydrateDescriptor | null;
}

export interface ReadOutputResult {
  text: string;
  lines: PtcLine[];
  ptcValue: {
    tool: "read";
    path: string;
    range: { startLine: number; endLine: number; totalLines: number };
    warnings: PtcWarning[];
    truncation: ReadTruncationMetadata | null;
    symbol: ReadSymbolMetadata | null;
    map: { requested: boolean; appended: boolean };
    lines: PtcLine[];
    bundle?: {
      mode: "local";
      applied: boolean;
      localSupport: Array<{
        name: string;
        kind: string;
        parentName?: string;
        startLine: number;
        endLine: number;
        lineAnchors: string[];
      }>;
      warnings: PtcWarning[];
    };
  };
  contextHygiene: ContextHygieneMetadata;
}

export function buildReadOutput(input: ReadOutputInput): ReadOutputResult {
  const lines = buildPtcLines(input.startLine, input.selectedLines);
  const warnings = input.warnings ?? [];
  const renderedLines = renderPtcLines(lines);

  // The deep module truncates the bare renderedLines and (if truncation
  // happened) appends the standard header with the read-specific advice.
  // Trailers (continuation, bundle, map) and prepends (symbol, warnings)
  // wrap the result below.
  const budget: ToolOutputBudget | undefined = input.truncation
    ? { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES }
    : undefined;
  const truncationHeader = input.truncation
    ? {
        totalLines: input.totalLines,
        advice: `Use offset=${input.startLine + input.truncation.outputLines} to continue.`,
      }
    : undefined;

  const symbolRefs: { path: string; name: string; kind?: string }[] = [];
  if (input.symbol) {
    symbolRefs.push({ path: input.path, name: input.symbol.name, kind: input.symbol.kind });
  }
  if (input.bundle?.applied) {
    for (const support of input.bundle.localSupport) {
      symbolRefs.push({ path: input.path, name: support.symbol.name, kind: support.symbol.kind });
    }
  }

  // ptcValue is built before the deep module call so the shim can pass the
  // real envelope through and use the deep module's identity passthrough
  // (matching the grep shim's pattern).
  const ptcValue: ReadOutputResult["ptcValue"] = {
    tool: "read",
    path: input.path,
    range: { startLine: input.startLine, endLine: input.endLine, totalLines: input.totalLines },
    warnings,
    truncation: input.truncation ?? null,
    symbol: input.symbol ?? null,
    map: {
      requested: input.map?.requested ?? false,
      appended: input.map?.appended ?? false,
    },
    lines,
  };

  if (input.bundle) {
    ptcValue.bundle = {
      mode: input.bundle.mode,
      applied: input.bundle.applied,
      localSupport: input.bundle.localSupport.map((item) => {
        const supportLines = buildPtcLines(item.symbol.startLine, item.lines);
        return {
          name: item.symbol.name,
          kind: item.symbol.kind,
          parentName: item.symbol.parentName,
          startLine: item.symbol.startLine,
          endLine: item.symbol.endLine,
          lineAnchors: supportLines.map((line) => line.anchor),
        };
      }),
      warnings: input.bundle.warnings ?? [],
    };
  }

  const { text: truncated, contextHygiene } = buildToolOutput({
    tool: "read",
    classification: "read-context",
    text: renderedLines,
    ptcValue,
    files: [{ path: input.path }],
    symbols: symbolRefs,
    rehydrate: input.rehydrate,
    budget,
    truncationHeader,
  });

  let text = truncated;
  if (!input.truncation && input.continuation) {
    text += `\n\n[Showing lines ${input.startLine}-${input.endLine} of ${input.totalLines}. Use offset=${input.continuation.nextOffset} to continue.]`;
  }

  if (input.bundle?.applied) {
    const supportBlocks = input.bundle.localSupport.map((item) => {
      const supportLines = buildPtcLines(item.symbol.startLine, item.lines);
      return renderPtcLines(supportLines);
    });
    text = ["## Requested symbol", text, "", "## Local support", ...supportBlocks].join("\n");
  }

  if (input.map?.appended && input.map.text) {
    text += `\n\n${input.map.text}`;
  }

  if (input.symbol) {
    const parentInfo = input.symbol.parentName ? ` in ${input.symbol.parentName}` : "";
    text = `[Symbol: ${input.symbol.name} (${input.symbol.kind})${parentInfo}, lines ${input.symbol.startLine}-${input.symbol.endLine} of ${input.totalLines}]\n\n${text}`;
  }

  if (warnings.length) {
    text = `${warnings.map((w) => w.message).join("\n\n")}\n\n${text}`;
  }

  return { text, lines, ptcValue, contextHygiene };
}
