import { afterEach, describe, expect, it, vi } from "vitest";

function tick(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("edit postEditVerify mismatch (mocked fs)", () => {
	afterEach(() => {
		vi.doUnmock("fs/promises");
		vi.resetModules();
	});

	it("returns a structured error when persisted content differs after the write completed", async () => {
		vi.resetModules();

		const filePath = "/virtual/post-edit-mismatch.txt";
		const originalContent = "alpha\nbeta";
		const writtenContent = "ALPHA\nbeta";
		// Simulate a concurrent write between our write and our readback:
		// the file's on-disk content is now different from what we just wrote.
		const tamperedContent = "tampered\nbeta";

		const virtualFs: Record<string, string> = { [filePath]: originalContent };
		let readCount = 0;

		vi.doMock("fs/promises", () => ({
			readFile: vi.fn(async (p: string) => {
				await tick();
				if (!(p in virtualFs)) {
					const e: any = new Error(`ENOENT: ${p}`);
					e.code = "ENOENT";
					throw e;
				}
				readCount += 1;
				// First read (pre-edit) returns original; second read (post-write
				// readback) returns tampered content simulating a concurrent write.
				if (readCount === 2) return Buffer.from(tamperedContent, "utf-8");
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
		const { computeLineHash, ensureHashInit } = await import("../src/hashline.js");
		await ensureHashInit();

		let tool: any;
		registerEditTool(
			{ registerTool(def: any) { tool = def; } } as any,
			{ wasReadInSession: () => true, syntaxValidate: "off" },
		);
		if (!tool) throw new Error("edit tool was not registered");

		const anchor = `1:${computeLineHash(1, "alpha")}`;

		const result = await tool.execute(
			"tc",
			{
				path: filePath,
				postEditVerify: true,
				edits: [{ set_line: { anchor, new_text: "ALPHA" } }],
			},
			new AbortController().signal,
			() => {},
			{ cwd: "/" },
		);

		expect(result.isError).toBe(true);
		expect(result.details.ptcValue.ok).toBe(false);
		expect(result.details.ptcValue.error.code).toBe("post-edit-verification-mismatch");
		expect(result.details.ptcValue.error.details).toEqual({
			expectedLength: writtenContent.length,
			actualLength: tamperedContent.length,
		});
		expect(result.details.contextHygiene.classification).toBe("mutation");
		expect(result.details.contextHygiene.resources).toEqual([
			{ kind: "file", path: filePath, key: `file:${filePath}` },
		]);
	});
});
