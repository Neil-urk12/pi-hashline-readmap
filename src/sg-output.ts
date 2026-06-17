import type { PtcLine, PtcRange } from "./ptc-value.js";
import { type ContextHygieneMetadata, type ContextHygieneRehydrateDescriptor } from "./context-hygiene.js";
import { buildToolOutput, type ToolOutputFileRef, type ToolOutputSymbolRef } from "./tool-output.js";

export interface SgOutputFile {
  displayPath: string;
  path: string;
  ranges: PtcRange[];
  lines: PtcLine[];
  symbols?: Array<{ name: string; kind?: string }>;
}

export interface BuildSgOutputInput {
  pattern: string;
  files: SgOutputFile[];
  rehydrate?: ContextHygieneRehydrateDescriptor | null;
}

export interface SgOutputResult {
  text: string;
  ptcValue: {
    tool: "ast_search";
    files: Array<{
      path: string;
      ranges: PtcRange[];
      lines: PtcLine[];
    }>;
  };
  contextHygiene: ContextHygieneMetadata;
}

export function buildSgOutput(input: BuildSgOutputInput): SgOutputResult {
  if (input.files.length === 0) {
    const emptyPtcValue: SgOutputResult["ptcValue"] = {
      tool: "ast_search",
      files: [],
    };
    const { text, ptcValue, contextHygiene } = buildToolOutput({
      tool: "ast_search",
      classification: "search-context",
      text: `No matches found for pattern: ${input.pattern}`,
      ptcValue: emptyPtcValue,
      files: [],
      symbols: [],
      rehydrate: input.rehydrate,
    });
    return { text, ptcValue, contextHygiene };
  }

  const blocks: string[] = [];
  for (const file of input.files) {
    blocks.push(`--- ${file.displayPath} ---`);
    for (const line of file.lines) {
      blocks.push(`>>${line.anchor}|${line.display}`);
    }
  }

  const ptcValue: SgOutputResult["ptcValue"] = {
    tool: "ast_search",
    files: input.files.map((file) => ({
      path: file.path,
      ranges: file.ranges.map((range) => ({ ...range })),
      lines: file.lines.map((line) => ({ ...line })),
    })),
  };

  const { text, contextHygiene } = buildToolOutput({
    tool: "ast_search",
    classification: "search-context",
    text: blocks.join("\n"),
    ptcValue,
    files: input.files.map<ToolOutputFileRef>((file) => ({ path: file.path })),
    symbols: input.files.flatMap<ToolOutputSymbolRef>((file) =>
      (file.symbols ?? []).map((symbol) => ({ path: file.path, name: symbol.name, kind: symbol.kind })),
    ),
    rehydrate: input.rehydrate,
  });

  return { text, ptcValue, contextHygiene };
}
