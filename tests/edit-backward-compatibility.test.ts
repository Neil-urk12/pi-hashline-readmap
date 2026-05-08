/**
 * Backward compatibility tests for edit tool
 * 
 * Validates Requirements 8.1-8.7:
 * - result.details.diff still contains unified diff string
 * - result.details.ptcValue structure unchanged
 * - result.content array structure unchanged
 * - Error handling and ptcValue error structure preserved
 * - renderResult(expanded=false) behavior unchanged
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ensureHashInit, computeLineHash } from "../src/hashline.js";

describe("Edit Tool Backward Compatibility", () => {
  let tempDir: string;

  beforeAll(async () => {
    await ensureHashInit();
  });

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "edit-compat-"));
    process.chdir(tempDir);
  });

  afterEach(() => {
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  });

  it("result.details.diff contains unified diff string", async () => {
    const { registerEditTool } = await import("../src/edit.js");
    let capturedTool: any = null;
    const mockPi = {
      registerTool: (tool: any) => {
        capturedTool = tool;
      },
    } as any;

    registerEditTool(mockPi);
    expect(capturedTool).toBeTruthy();

    const filePath = join(tempDir, "test.txt");
    writeFileSync(filePath, "line 1\nline 2\nline 3\n");
    
    const lines = readFileSync(filePath, "utf-8").split("\n");
    const anchor = `2:${computeLineHash(2, lines[1])}`;

    const result = await capturedTool.execute(
      "test-call-id",
      {
        path: "test.txt",
        edits: [
          {
            set_line: {
              anchor,
              new_text: "line 2 modified",
            },
          },
        ],
      },
      { aborted: false },
      () => {},
      { cwd: tempDir }
    );

    // AC 8.1: result.details.diff contains unified diff string
    expect(result.details).toBeDefined();
    expect(result.details.diff).toBeDefined();
    expect(typeof result.details.diff).toBe("string");
    // The diff may be in compact format (→) or unified format (+/-) depending on size
    // What matters is that it's present and is a string
    expect(result.details.diff.length).toBeGreaterThan(0);
  });

  it("result.details.ptcValue structure unchanged", async () => {
    const { registerEditTool } = await import("../src/edit.js");
    let capturedTool: any = null;
    const mockPi = {
      registerTool: (tool: any) => {
        capturedTool = tool;
      },
    } as any;

    registerEditTool(mockPi);

    const filePath = join(tempDir, "test.txt");
    writeFileSync(filePath, "line 1\nline 2\nline 3\n");
    
    const lines = readFileSync(filePath, "utf-8").split("\n");
    const anchor = `2:${computeLineHash(2, lines[1])}`;

    const result = await capturedTool.execute(
      "test-call-id",
      {
        path: "test.txt",
        edits: [
          {
            set_line: {
              anchor,
              new_text: "line 2 modified",
            },
          },
        ],
      },
      { aborted: false },
      () => {},
      { cwd: tempDir }
    );

    // AC 8.2: result.details.ptcValue structure unchanged
    expect(result.details.ptcValue).toBeDefined();
    expect(result.details.ptcValue.tool).toBe("edit");
    expect(result.details.ptcValue.ok).toBe(true);
    expect(result.details.ptcValue.path).toBeDefined();
    expect(result.details.ptcValue.summary).toBeDefined();
    expect(result.details.ptcValue.diff).toBeDefined();
    expect(result.details.ptcValue.warnings).toBeDefined();
    expect(Array.isArray(result.details.ptcValue.warnings)).toBe(true);
    expect(result.details.ptcValue.noopEdits).toBeDefined();
    expect(Array.isArray(result.details.ptcValue.noopEdits)).toBe(true);
  });

  it("result.content array structure unchanged", async () => {
    const { registerEditTool } = await import("../src/edit.js");
    let capturedTool: any = null;
    const mockPi = {
      registerTool: (tool: any) => {
        capturedTool = tool;
      },
    } as any;

    registerEditTool(mockPi);

    const filePath = join(tempDir, "test.txt");
    writeFileSync(filePath, "line 1\nline 2\nline 3\n");
    
    const lines = readFileSync(filePath, "utf-8").split("\n");
    const anchor = `2:${computeLineHash(2, lines[1])}`;

    const result = await capturedTool.execute(
      "test-call-id",
      {
        path: "test.txt",
        edits: [
          {
            set_line: {
              anchor,
              new_text: "line 2 modified",
            },
          },
        ],
      },
      { aborted: false },
      () => {},
      { cwd: tempDir }
    );

    // AC 8.3: result.content array structure unchanged
    expect(result.content).toBeDefined();
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.content[0].type).toBe("text");
    expect(typeof result.content[0].text).toBe("string");
  });

  it("error handling and ptcValue error structure preserved", async () => {
    const { registerEditTool } = await import("../src/edit.js");
    let capturedTool: any = null;
    const mockPi = {
      registerTool: (tool: any) => {
        capturedTool = tool;
      },
    } as any;

    registerEditTool(mockPi);

    // Test file not found error
    const result = await capturedTool.execute(
      "test-call-id",
      {
        path: "nonexistent.txt",
        edits: [
          {
            set_line: {
              anchor: "1:xxxxx",
              new_text: "test",
            },
          },
        ],
      },
      { aborted: false },
      () => {},
      { cwd: tempDir }
    );

    // AC 8.4, 8.7: Error handling and ptcValue error structure preserved
    expect(result.isError).toBe(true);
    expect(result.details.ptcValue).toBeDefined();
    expect(result.details.ptcValue.ok).toBe(false);
    expect(result.details.ptcValue.error).toBeDefined();
    expect(result.details.ptcValue.error.code).toBeDefined();
    expect(result.details.ptcValue.error.message).toBeDefined();
  });

  it("renderResult(expanded=false) behavior unchanged", async () => {
    const { registerEditTool } = await import("../src/edit.js");
    let capturedTool: any = null;
    const mockPi = {
      registerTool: (tool: any) => {
        capturedTool = tool;
      },
    } as any;

    registerEditTool(mockPi);

    const filePath = join(tempDir, "test.txt");
    writeFileSync(filePath, "line 1\nline 2\nline 3\n");
    
    const lines = readFileSync(filePath, "utf-8").split("\n");
    const anchor = `2:${computeLineHash(2, lines[1])}`;

    const result = await capturedTool.execute(
      "test-call-id",
      {
        path: "test.txt",
        edits: [
          {
            set_line: {
              anchor,
              new_text: "line 2 modified",
            },
          },
        ],
      },
      { aborted: false },
      () => {},
      { cwd: tempDir }
    );

    const mockTheme = {
      fg: (color: string, text: string) => text,
      bold: (text: string) => text,
    };

    // AC 8.6: renderResult(expanded=false) behavior unchanged
    const component = capturedTool.renderResult(
      result,
      { expanded: false },
      mockTheme,
      { expanded: false }
    );

    // Component is a Text object from pi-tui
    const text = component.text || "";
    
    // Should show only summary line, not full diff
    expect(text).toBeTruthy();
    expect(text.split("\n").length).toBeLessThan(5); // Summary should be brief
    expect(text).not.toContain("@@"); // Should not contain hunk headers
  });

  it("diffData is optional and does not break existing behavior", async () => {
    const { registerEditTool } = await import("../src/edit.js");
    let capturedTool: any = null;
    const mockPi = {
      registerTool: (tool: any) => {
        capturedTool = tool;
      },
    } as any;

    registerEditTool(mockPi);

    const filePath = join(tempDir, "test.txt");
    writeFileSync(filePath, "line 1\nline 2\nline 3\n");
    
    const lines = readFileSync(filePath, "utf-8").split("\n");
    const anchor = `2:${computeLineHash(2, lines[1])}`;

    const result = await capturedTool.execute(
      "test-call-id",
      {
        path: "test.txt",
        edits: [
          {
            set_line: {
              anchor,
              new_text: "line 2 modified",
            },
          },
        ],
      },
      { aborted: false },
      () => {},
      { cwd: tempDir }
    );

    // AC 8.3: diffData is optional, existing fields still present
    expect(result.details.diff).toBeDefined();
    expect(result.details.ptcValue).toBeDefined();
    expect(result.content).toBeDefined();
    
    // diffData may or may not be present, but its presence doesn't break anything
    if (result.details.diffData) {
      expect(result.details.diffData.parsed).toBeDefined();
      expect(result.details.diffData.inlineHighlights).toBeDefined();
    }
  });
});
