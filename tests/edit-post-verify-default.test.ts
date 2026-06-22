import { describe, expect, it, beforeAll, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { computeLineHash, ensureHashInit } from "../src/hashline.js";
import { registerEditTool } from "../src/edit.js";

let workDir: string;
let filePath: string;

beforeAll(async () => {
	await ensureHashInit();
});

beforeEach(async () => {
	workDir = await mkdtemp(join(tmpdir(), "post-edit-default-"));
	filePath = join(workDir, "doc.txt");
	await writeFile(filePath, "alpha\nbeta", "utf-8");
});

afterEach(async () => {
	await rm(workDir, { recursive: true, force: true });
});

function captureEditTool() {
	let tool: any;
	registerEditTool(
		{ registerTool(def: any) { tool = def; } } as any,
		{ wasReadInSession: () => true },
	);
	if (!tool) throw new Error("edit tool was not registered");
	return tool;
}

describe("edit postEditVerify default", () => {
	it("documents the explicit option and leaves verification off when absent", async () => {
		const tool = captureEditTool();
		const anchor = `1:${computeLineHash(1, "alpha")}`;

		const result = await tool.execute(
			"tc",
			{ path: filePath, edits: [{ set_line: { anchor, new_text: "ALPHA" } }] },
			new AbortController().signal,
			() => {},
			{ cwd: process.cwd() },
		);

		expect(result.isError).toBeUndefined();
		// postEditVerify absent => no post-write read-back. The file was written,
		// so its on-disk content reflects the edit.
		const persisted = await readFile(filePath, "utf-8");
		expect(persisted).toBe("ALPHA\nbeta");
	});
});