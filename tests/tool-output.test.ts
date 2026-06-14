import { describe, it, expect, beforeAll } from "vitest";
import { buildToolOutput } from "../src/tool-output.js";
import { buildPtcLine, type PtcLine } from "../src/ptc-value.js";
import { ensureHashInit } from "../src/hashline.js";
import {
  buildReadRehydrateDescriptor,
  type ContextHygieneMetadata,
} from "../src/context-hygiene.js";

describe("buildToolOutput", () => {
  beforeAll(async () => {
    await ensureHashInit();
  });
  it("returns the text unchanged when no budget is provided", () => {
    const text = "a\nb\nc";
    const result = buildToolOutput({
      tool: "read",
      classification: "read-context",
      text,
      ptcValue: { tool: "read" } as any,
    });
    expect(result.text).toBe(text);
    expect(result.ptcValue).toEqual({ tool: "read" });
  });

  it("returns the text unchanged when the budget is met", () => {
    const text = "a\nb\nc";
    const result = buildToolOutput({
      tool: "read",
      classification: "read-context",
      text,
      ptcValue: { tool: "read" } as any,
      budget: { maxLines: 100, maxBytes: 10_000 },
    });
    expect(result.text).toBe(text);
  });

  it("appends the standard truncation header when the budget is exceeded", () => {
    const text = Array.from({ length: 2000 }, (_, i) => `line ${i + 1}`).join("\n");
    const result = buildToolOutput({
      tool: "grep",
      classification: "search-context",
      text,
      ptcValue: { tool: "grep" } as any,
      budget: { maxLines: 5, maxBytes: 50 },
    });
    expect(result.text).toMatch(/\[Output truncated: showing \d+ of \d+ lines \([^)]+\)\. Refine pattern or increase limit\.\]$/);
    expect(result.text.split("\n").length).toBeLessThan(text.split("\n").length);
  });

  it("uses truncationHeader.totalLines in the formatted header when provided", () => {
    const text = Array.from({ length: 2000 }, (_, i) => `line ${i + 1}`).join("\n");
    const result = buildToolOutput({
      tool: "read",
      classification: "read-context",
      text,
      ptcValue: { tool: "read" } as any,
      budget: { maxLines: 5, maxBytes: 50 },
      truncationHeader: { totalLines: 9999, advice: "Use offset=11 to continue." },
    });
    expect(result.text).toMatch(/\[Output truncated: showing \d+ of 9999 lines \([^)]+\)\. Use offset=11 to continue\.\]$/);
  });

  it("uses truncationHeader.advice in the formatted header when provided", () => {
    const text = Array.from({ length: 2000 }, (_, i) => `line ${i + 1}`).join("\n");
    const result = buildToolOutput({
      tool: "grep",
      classification: "search-context",
      text,
      ptcValue: { tool: "grep" } as any,
      budget: { maxLines: 5, maxBytes: 50 },
      truncationHeader: { advice: "Custom tail." },
    });
    expect(result.text).toMatch(/Custom tail\.\]$/);
  });

  it("collects files and symbols into contextHygiene.resources, deduplicating by key", () => {
    const result = buildToolOutput({
      tool: "read",
      classification: "read-context",
      text: "x",
      ptcValue: { tool: "read" } as any,
      files: [{ path: "a.ts" }, { path: "a.ts" }, { path: "b.ts" }],
      symbols: [
        { path: "a.ts", name: "foo", kind: "function" },
        { path: "a.ts", name: "foo", kind: "function" },
        { path: "a.ts", name: "bar" },
      ],
    });
    const kinds = result.contextHygiene.resources.map((r: { kind: string }) => r.kind);
    expect(kinds.filter((k) => k === "file").length).toBe(2);
    expect(kinds.filter((k) => k === "symbol").length).toBe(2);
  });

  it("passes rehydrate through to contextHygiene", () => {
    const rehydrate = buildReadRehydrateDescriptor({ path: "a.ts" });
    const result = buildToolOutput({
      tool: "read",
      classification: "read-context",
      text: "x",
      ptcValue: { tool: "read" } as any,
      rehydrate,
    });
    expect(result.contextHygiene.rehydrate).toEqual(rehydrate);
  });

  it("omits rehydrate when null is passed", () => {
    const result = buildToolOutput({
      tool: "read",
      classification: "read-context",
      text: "x",
      ptcValue: { tool: "read" } as any,
      rehydrate: null,
    });
    expect(result.contextHygiene.rehydrate).toBeUndefined();
  });

  it("tags contextHygiene with the tool and classification", () => {
    const result = buildToolOutput({
      tool: "grep",
      classification: "search-context",
      text: "x",
      ptcValue: { tool: "grep" } as any,
    });
    expect(result.contextHygiene.tool).toBe("grep");
    expect(result.contextHygiene.classification).toBe("search-context");
  });

  it("returns the ptcValue unchanged regardless of other inputs", () => {
    const ptc = { tool: "read", path: "a.ts", range: { startLine: 1, endLine: 2, totalLines: 2 } };
    const result = buildToolOutput({
      tool: "read",
      classification: "read-context",
      text: "x",
      ptcValue: ptc,
      files: [{ path: "a.ts" }],
    });
    expect(result.ptcValue).toBe(ptc);
  });

  it("emits a contextHygiene object even with no files, symbols, or rehydrate", () => {
    const result = buildToolOutput({
      tool: "read",
      classification: "read-context",
      text: "x",
      ptcValue: { tool: "read" } as any,
    });
    const expected: Partial<ContextHygieneMetadata> = {
      tool: "read",
      classification: "read-context",
      resources: [],
    };
    expect(result.contextHygiene.tool).toBe(expected.tool);
    expect(result.contextHygiene.classification).toBe(expected.classification);
    expect(result.contextHygiene.resources).toEqual([]);
  });

  it("does not produce a contextHygiene entry for duplicate file paths from input", () => {
    const result = buildToolOutput({
      tool: "read",
      classification: "read-context",
      text: "x",
      ptcValue: { tool: "read" } as any,
      files: [{ path: "dup.ts" }, { path: "dup.ts" }, { path: "dup.ts" }],
    });
    expect(result.contextHygiene.resources.length).toBe(1);
  });

  it("uses buildPtcLine to ensure the rendered text reflects the PtcLine shape", () => {
    // Spot-check that text passed in is the exact text returned when no truncation.
    const line: PtcLine = buildPtcLine(1, "hello");
    const text = `${line.anchor}|${line.display}`;
    const result = buildToolOutput({
      tool: "read",
      classification: "read-context",
      text,
      ptcValue: { tool: "read" } as any,
    });
    expect(result.text).toBe(text);
  });
});
