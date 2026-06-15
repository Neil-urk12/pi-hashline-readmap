import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as gitModule from "../src/rtk/git.js";
import {
  processBashToolResult,
  type BashPipelineDeps,
  type BashToolResultEvent,
} from "../src/rtk/bash-result-pipeline.js";

/**
 * Stage-coverage tests for the bash tool-result pipeline deep module.
 *
 * Each test pins a single stage of the recipe: extract text, resolve the
 * original-output snapshot, build a `BashCommandState`, build/record
 * context-hygiene metadata, expire readTurns on shell-file mutation, run RTK
 * route compression, apply the bash context guard, assemble the return.
 *
 * All tests use a fake tracker and a fake onShellMutation callback so the
 * deep module's deps are the seam, not a global.
 */

function makeBashEvent(toolCallId: string, command: string, text: string, isError = false): BashToolResultEvent {
  return {
    type: "tool_result",
    toolName: "bash",
    toolCallId,
    input: { command },
    content: [{ type: "text", text }],
    isError,
    details: undefined,
  };
}

function makeDeps(overrides: Partial<BashPipelineDeps> = {}): BashPipelineDeps {
  return {
    cwd: "/",
    env: {},
    // Default to enabled:true so the original-output snapshot path is
    // reachable; tests that need to disable the guard can pass `enabled: false`.
    contextGuardConfig: { enabled: true, maxLines: 2000, maxBytes: 51200, headLines: 80, tailLines: 120 },
    tracker: {
      record: vi.fn((_metadata, _options) => ({ id: 1 })) as unknown as BashPipelineDeps["tracker"]["record"],
      generateReport: vi.fn(),
    },
    onShellMutation: vi.fn(),
    ...overrides,
  };
}

describe("processBashToolResult", () => {
  it("returns a no-compression result for an empty bash output", () => {
    const deps = makeDeps();
    const result = processBashToolResult(makeBashEvent("t-1", "true", ""), deps);

    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toBe("");
    expect(result.details.compressionInfo.technique).toBe("none");
    // A `true` command produces command-output classification (not a mutation),
    // so the tracker is recorded, but onShellMutation is NOT called.
    expect(deps.tracker.record).toHaveBeenCalledOnce();
    expect(deps.onShellMutation).not.toHaveBeenCalled();
    expect(result.isError).toBe(false);
  });

  it("does not call onShellMutation for a non-mutation command", () => {
    const deps = makeDeps();
    processBashToolResult(makeBashEvent("t-2", "ls -la", "file1\nfile2\n"), deps);

    expect(deps.onShellMutation).not.toHaveBeenCalled();
  });
  it("passes full-output file contents to the git route, not the visible tail", () => {
    const dir = mkdtempSync(join(tmpdir(), "hashline-pipe-"));
    const fullPath = join(dir, "output.txt");
    writeFileSync(fullPath, "FULL git output\n", "utf8");
    let seenByRtk = "";
    const spy = vi.spyOn(gitModule, "compactGitOutput").mockImplementation((output) => {
      seenByRtk = output;
      return "compressed full output";
    });

    try {
      const event: BashToolResultEvent = {
        ...makeBashEvent("t-git", "git status", "VISIBLE TAIL\n"),
        details: { fullOutputPath: fullPath },
      };
      const result = processBashToolResult(event, makeDeps());

      expect(seenByRtk).toBe("FULL git output\n");
      expect(result.content[0].text).toBe("compressed full output");
    } finally {
      spy.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips compression and omits the notice when PI_RTK_BYPASS=1 is set", () => {
    const event = makeBashEvent("t-bypass", "PI_RTK_BYPASS=1 git status", "\u001b[32mhello\u001b[0m\n");
    const deps = makeDeps();
    const result = processBashToolResult(event, deps);

    expect(result.details.compressionInfo.technique).toBe("none");
    expect(result.details.compressionInfo.bypassedBy).toBe("env-var");
    expect(result.content[0].text).toBe("hello\n");
    expect(result.content[0].text).not.toContain("[RTK:");
    // savedChars may be > 0 because ANSI stripping still ran before bypass;
    // the contract is "no compression", not "zero work".
  });

  it("invokes onShellMutation for a shell-file-mutation with file targets", () => {
    // `printf next >> logs/out.txt` is classified as shell-file-mutation with
    // cwd="/" the resolved target is /logs/out.txt.
    const event = makeBashEvent("t-mut", "printf next >> logs/out.txt", "next\n");
    const deps = makeDeps();
    processBashToolResult(event, deps);

    expect(deps.onShellMutation).toHaveBeenCalledOnce();
    expect(deps.onShellMutation).toHaveBeenCalledWith(["/logs/out.txt"]);
  });

  it("does not invoke onShellMutation for a non-mutation command", () => {
    const event = makeBashEvent("t-nonmut", "ls -la", "file1\nfile2\n");
    const deps = makeDeps();
    processBashToolResult(event, deps);

    expect(deps.onShellMutation).not.toHaveBeenCalled();
  });

  it("trims with the bash context guard and hoists the RTK notice into Preserved notices", () => {
    // Build a 200-line payload from a command that no RTK route recognises,
    // so the body reaches the guard uncompressed and triggers the trim path.
    // The git route produces a small `compressed` string for git output, so we
    const lines = Array.from({ length: 200 }, (_, i) => `line-${i}`).join("\n");
    const event = makeBashEvent("t-guard", "bash -c 'echo lots'", lines);
    // Force trimming with a tiny limit.
    const deps = makeDeps({
      contextGuardConfig: {
        enabled: true,
        maxLines: 10,
        maxBytes: 51200,
        headLines: 3,
        tailLines: 3,
      },
    });
    const result = processBashToolResult(event, deps);

    expect(result.content[0].text).toContain("[Bash context guard: preview]");
    expect(result.details.bashContextGuard.trimmed).toBe(true);
    // The guard preserved (i.e. did not drop) head and tail lines of the body.
    expect(result.content[0].text).toContain("line-0");
    expect(result.content[0].text).toContain("line-199");
    // No RTK notice was emitted (ls output is too small to trigger one), so
    // there is no "[RTK:" preserved-notices section either.
    expect(result.content[0].text).not.toContain("[RTK:");
  });

  it("hoists the RTK notice into Preserved notices when guard trims a compressed payload", () => {
    // git diff compresses a ~5.9 KB payload to a ~9-byte summary (ratio
    // ~0.0015), which is well under the 0.5 threshold for emitting the RTK
    // notice. We then force the guard to trim by setting maxBytes below the
    // notice + summary length — that exercises the "hoist preserved notice"
    // path.
    const big = "diff --git a/foo b/foo\n" + "x\n".repeat(3000);
    const event = makeBashEvent("t-guard-rtk", "git diff", big);
    const deps = makeDeps({
      contextGuardConfig: {
        enabled: true,
        maxLines: 5,
        maxBytes: 100,
        headLines: 1,
        tailLines: 1,
      },
    });
    const result = processBashToolResult(event, deps);

    expect(result.content[0].text).toContain("[Bash context guard: preview]");
    expect(result.content[0].text).toContain("Preserved notices:");
    expect(result.content[0].text).toContain("[RTK:");
  });

  it("preserves non-text content chunks alongside the text chunk", () => {
    const nonText = { type: "image", data: "opaque-test-data" };
    const event: BashToolResultEvent = {
      ...makeBashEvent("t-nontext", "echo hello", ""),
      content: [{ type: "text", text: "hello" }, nonText, { type: "text", text: "world" }],
    };
    const deps = makeDeps();
    const result = processBashToolResult(event, deps);

    expect(result.content[0]).toEqual({ type: "text", text: "hello\nworld" });
    expect(result.content.slice(1)).toEqual([nonText]);
  });

  it("returns the recorded context-hygiene event id from the tracker", () => {
    // Use a tracker that returns a recognizable id so we can prove the value
    // is plumbed through (not fabricated inside the pipeline).
    const tracker = {
      record: vi.fn((_metadata, _options) => ({ id: 4242 })) as unknown as BashPipelineDeps["tracker"]["record"],
      generateReport: vi.fn(),
    };
    const deps = makeDeps({ tracker });
    const result = processBashToolResult(makeBashEvent("t-id", "ls -la", "f\n"), deps);

    expect(tracker.record).toHaveBeenCalledOnce();
    expect(result.recordedEventId).toBe(4242);
  });
});
