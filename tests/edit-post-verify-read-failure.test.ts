import { afterEach, describe, expect, it, vi } from "vitest";

function tick(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("edit postEditVerify read failure (mocked fs)", () => {
	afterEach(() => {
		vi.doUnmock("fs/promises");
		vi.resetModules();
	});

	it("returns a structured error when read-back fails after the write completed", async () => {
		vi.resetModules();

		const filePath = "/virtual/post-edit-read-fail.txt";
		const originalContent = "alpha\nbeta";

		const virtualFs: Record<string, string> = { [filePath]: originalContent };
		let readCount = 0;
		const readError = Object.assign(new Error("simulated read-back failure"), { code: "EIO" });

		vi.doMock("fs/promises", () => ({
			readFile: vi.fn(async (p: string) => {
				await tick();
				if (!(p in virtualFs)) {
					const e: any = new Error(`ENOENT: ${p}`);
					e.code = "ENOENT";
					throw e;
				}
				readCount += 1;
				// Pre-edit read succeeds; the post-write readback is forced to
				// fail (simulates a transient I/O error / disk error).
				if (readCount === 2) throw readError;
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
		expect(result.content[0].text).toContain("write completed but post-edit verification failed");
		expect(result.details.ptcValue.ok).toBe(false);
		expect(result.details.ptcValue.error.code).toBe("post-edit-verification-read-failed");
		expect(result.details.ptcValue.error.message).toContain("write completed");
		expect(result.details.ptcValue.error.details).toEqual({
			fsCode: "EIO",
			fsMessage: "simulated read-back failure",
		});
		expect(result.details.contextHygiene.classification).toBe("mutation");
		expect(result.details.contextHygiene.resources).toEqual([
			{ kind: "file", path: filePath, key: `file:${filePath}` },
		]);
	});
});
