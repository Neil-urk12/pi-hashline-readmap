import { describe, expect, it, beforeAll } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Text } from "@earendil-works/pi-tui";
import { registerEditTool } from "../src/edit.js";
import { computeLineHash, ensureHashInit } from "../src/hashline.js";

function captureEditTool() {
	let captured: any = null;
	registerEditTool(
		{
			registerTool(def: any) {
				captured = def;
			},
		} as any,
		{ wasReadInSession: () => true },
	);
	if (!captured) throw new Error("edit tool was not registered");
	return captured;
}

function theme() {
	return {
		fg: (_name: string, text: string) => text,
		bold: (text: string) => text,
	};
}

describe("edit inline diff rendering", () => {
	beforeAll(async () => {
		await ensureHashInit();
	});

	it("attaches inline diff metadata without changing ptc diff", async () => {
		const dir = mkdtempSync(join(tmpdir(), "edit-inline-diff-"));
		const fp = join(dir, "x.ts");
		writeFileSync(fp, "const value = 1;\n", "utf-8");
		const anchor = `1:${computeLineHash(1, "const value = 1;")}`;
		const tool = captureEditTool();

		const result = await tool.execute(
			"tc",
			{
				path: fp,
				edits: [{ set_line: { anchor, new_text: "const value = 2;" } }],
			},
			new AbortController().signal,
			() => {},
			{ cwd: process.cwd() },
		);

		expect(result.isError).toBeFalsy();
		expect(result.details?.ptcValue?.diff).toBe(result.details?.diff);
		expect(result.details?.inlineDiff).toMatchObject({
			kind: "diff",
			path: fp,
			language: "typescript",
			oldContent: "const value = 1;\n",
			newContent: "const value = 2;\n",
		});
		expect(result.details?.inlineDiff?.summary).toMatch(/^\+\d+ -\d+$/);
	});

	it("renderResult returns a Text component for inline diff metadata", () => {
		const tool = captureEditTool();
		const component = tool.renderResult(
			{
				content: [{ type: "text", text: "Edited x.ts" }],
				details: {
					inlineDiff: {
						kind: "diff",
						path: "x.ts",
						summary: "+1 -1",
						language: "typescript",
						oldContent: "const value = 1;\n",
						newContent: "const value = 2;\n",
					},
					diff: "-1 const value = 1;\n+1 const value = 2;",
					ptcValue: { warnings: [], noopEdits: [] },
				},
			},
			{},
			theme(),
			{ expanded: false, isError: false, state: {}, invalidate() {} },
		);

		expect(component).toBeInstanceOf(Text);
	});
});
