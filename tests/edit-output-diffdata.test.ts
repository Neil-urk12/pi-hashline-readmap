import { describe, it, expect, beforeAll } from "vitest";
import { ensureHashInit } from "../src/hashline.js";
import { buildEditOutput } from "../src/edit-output.js";
import type { DiffData } from "../src/diff-types.js";

describe("buildEditOutput diffData", () => {
  beforeAll(async () => {
    await ensureHashInit();
  });

  it("should pass through diffData when provided", () => {
    const mockDiffData: DiffData = {
      parsed: {
        entries: [],
        stats: {
          added: 1,
          removed: 1,
          context: 0,
          hunks: 1,
          files: 1,
          lines: 2,
        },
      },
      inlineHighlights: new WeakMap(),
    };

    const result = buildEditOutput({
      path: "/test/file.ts",
      displayPath: "test/file.ts",
      diff: "+ 1|new line\n- 2|old line",
      firstChangedLine: 1,
      warnings: [],
      noopEdits: [],
      diffData: mockDiffData,
    });

    expect(result.diffData).toBeDefined();
    expect(result.diffData).toBe(mockDiffData);
    expect(result.diffData?.parsed.stats.added).toBe(1);
    expect(result.diffData?.parsed.stats.removed).toBe(1);
  });

  it("should not include diffData when not provided", () => {
    const result = buildEditOutput({
      path: "/test/file.ts",
      displayPath: "test/file.ts",
      diff: "+ 1|new line\n- 2|old line",
      firstChangedLine: 1,
      warnings: [],
      noopEdits: [],
    });

    expect(result.diffData).toBeUndefined();
  });

  it("should maintain backward compatibility with existing fields", () => {
    const mockDiffData: DiffData = {
      parsed: {
        entries: [],
        stats: {
          added: 2,
          removed: 1,
          context: 3,
          hunks: 1,
          files: 1,
          lines: 6,
        },
      },
      inlineHighlights: new WeakMap(),
    };

    const result = buildEditOutput({
      path: "/test/file.ts",
      displayPath: "test/file.ts",
      diff: "+ 1|line1\n+ 2|line2\n- 3|line3\n  4|line4\n  5|line5\n  6|line6",
      firstChangedLine: 1,
      warnings: ["test warning"],
      noopEdits: [],
      diffData: mockDiffData,
    });

    // Verify all existing fields are present
    expect(result.text).toBeDefined();
    expect(result.text).toContain("Edited test/file.ts");
    expect(result.ptcValue).toBeDefined();
    expect(result.ptcValue.path).toBe("/test/file.ts");
    expect(result.contextHygiene).toBeDefined();
    expect(result.contextHygiene.tool).toBe("edit");

    // Verify new field is also present
    expect(result.diffData).toBeDefined();
    expect(result.diffData).toBe(mockDiffData);
  });
});
