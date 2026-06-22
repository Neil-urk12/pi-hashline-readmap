import { afterEach, describe, expect, it, vi } from "vitest";

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("repro 160 — Pi file mutation queue integration", () => {
  afterEach(() => {
    vi.doUnmock("fs/promises");
    vi.resetModules();
  });

  it("serializes edit's full read-modify-write window for same-file parallel calls", async () => {
    vi.resetModules();

    const filePath = "/virtual/race.txt";
    let fileContent = "alpha\nbeta\n";
    // Virtual in-memory filesystem keyed by the actual path. Each atomic
    // write creates a sibling temp file that rename(2) commits to the target.
    const virtualFs: Record<string, string> = { [filePath]: fileContent };

    vi.doMock("fs/promises", () => ({
      readFile: vi.fn(async (p: string) => {
        await tick();
        if (!(p in virtualFs)) {
          const e: any = new Error(`ENOENT: ${p}`);
          e.code = "ENOENT";
          throw e;
        }
        return Buffer.from(virtualFs[p], "utf-8");
      }),
      writeFile: vi.fn(async (p: string, content: string | Buffer) => {
        await tick();
        virtualFs[p] = content.toString();
      }),
      rename: vi.fn(async (src: string, dst: string) => {
        await tick();
        if (!(src in virtualFs)) {
          const e: any = new Error(`ENOENT: ${src}`);
          e.code = "ENOENT";
          throw e;
        }
        virtualFs[dst] = virtualFs[src];
        delete virtualFs[src];
      }),
      unlink: vi.fn(async (p: string) => {
        await tick();
        delete virtualFs[p];
      }),
      lstat: vi.fn(async (p: string) => {
        if (!(p in virtualFs)) {
          const e: any = new Error(`ENOENT: ${p}`);
          e.code = "ENOENT";
          throw e;
        }
        return { isSymbolicLink: () => false } as any;
      }),
      stat: vi.fn(async (p: string) => {
        if (!(p in virtualFs)) {
          const e: any = new Error(`ENOENT: ${p}`);
          e.code = "ENOENT";
          throw e;
        }
        return { mode: 0o644, nlink: 1, ino: 1 } as any;
      }),
      realpath: vi.fn(async (p: string) => p),
      access: vi.fn(async () => undefined),
      constants: { W_OK: 2 },
      open: vi.fn(async () => {
        throw new Error("open should not be called when nlink===1");
      }),
    }));

    const { registerEditTool } = await import("../src/edit.js");
    let tool: any;
    registerEditTool(
      { registerTool(def: any) { tool = def; } } as any,
      { wasReadInSession: () => true, syntaxValidate: "off" },
    );

    const resultPromiseA = tool.execute(
      "edit-alpha",
      { path: filePath, edits: [{ replace: { old_text: "alpha", new_text: "ALPHA" } }] },
      new AbortController().signal,
      () => {},
      { cwd: "/" },
    );
    const resultPromiseB = tool.execute(
      "edit-beta",
      { path: filePath, edits: [{ replace: { old_text: "beta", new_text: "BETA" } }] },
      new AbortController().signal,
      () => {},
      { cwd: "/" },
    );

    const results = await Promise.all([resultPromiseA, resultPromiseB]);

    expect(results.map((result: any) => result.isError ?? false)).toEqual([false, false]);
    expect(virtualFs[filePath]).toBe("ALPHA\nBETA\n");
  });
});
