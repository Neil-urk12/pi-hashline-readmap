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
	workDir = await mkdtemp(join(tmpdir(), "post-edit-success-"));
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

describe("edit postEditVerify success", () => {
	it("reads back after a successful opt-in write and preserves the normal success details", async () => {
		const tool = captureEditTool();
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
			{ cwd: process.cwd() },
		);

		expect(result.isError).toBeUndefined();
		// Behavioral verification: post-verify enabled and content matches
		// what was just written => success envelope + on-disk content updated.
		expect(result.content[0].text).toContain(`Edited ${filePath}`);
		expect(result.details.diff).toContain("alpha");
		expect(result.details.diffData).toEqual(result.details.ptcValue.diffData);
		expect(result.details.ptcValue.ok).toBe(true);
		expect(result.details.ptcValue.warnings).toEqual([]);
		expect(result.details.ptcValue.semanticSummary).toBeTruthy();
		expect(result.details.firstChangedLine).toBe(1);
		expect(result.details.contextHygiene.classification).toBe("mutation");
		const persisted = await readFile(filePath, "utf-8");
		expect(persisted).toBe("ALPHA\nbeta");
	});
});