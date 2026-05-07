import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Text } from "@mariozechner/pi-tui";
import { registerWriteTool } from "../src/write.js";

function captureWriteTool() {
	let captured: any = null;
	registerWriteTool({
		registerTool(def: any) {
			captured = def;
		},
	} as any);
	if (!captured) throw new Error("write tool was not registered");
	return captured;
}

function theme() {
	return {
		fg: (_name: string, text: string) => text,
		bold: (text: string) => text,
	};
}

describe("write inline diff rendering", () => {
	it("attaches diff metadata for changed existing file while preserving hashlines", async () => {
		const dir = mkdtempSync(join(tmpdir(), "write-inline-diff-"));
		const fp = join(dir, "x.ts");
		writeFileSync(fp, "const value = 1;\n", "utf-8");
		const tool = captureWriteTool();

		const result = await tool.execute(
			"tc",
			{ path: fp, content: "const value = 2;\n" },
			new AbortController().signal,
			() => {},
			{ cwd: process.cwd() },
		);

		expect(result.isError).toBeFalsy();
		expect(result.content[0].text).toMatch(
			/^1:[0-9a-f]{3}\|const value = 2;$/m,
		);
		expect(result.details?.inlineDiff).toMatchObject({
			kind: "diff",
			path: fp,
			language: "typescript",
			oldContent: "const value = 1;\n",
			newContent: "const value = 2;\n",
		});
	});

	it("attaches new-file metadata for a new file", async () => {
		const dir = mkdtempSync(join(tmpdir(), "write-new-inline-diff-"));
		const fp = join(dir, "new.ts");
		const tool = captureWriteTool();

		const result = await tool.execute(
			"tc",
			{ path: fp, content: "const value = 1;\n" },
			new AbortController().signal,
			() => {},
			{ cwd: process.cwd() },
		);

		expect(result.isError).toBeFalsy();
		expect(result.details?.inlineDiff).toMatchObject({
			kind: "new-file",
			path: fp,
			language: "typescript",
			content: "const value = 1;\n",
			lines: 2,
		});
	});

	it("renderResult returns Text for inline diff metadata", () => {
		const tool = captureWriteTool();
		const component = tool.renderResult(
			{
				content: [{ type: "text", text: "1:abc|const value = 2;" }],
				details: {
					inlineDiff: {
						kind: "diff",
						path: "x.ts",
						summary: "+1 -1",
						language: "typescript",
						oldContent: "const value = 1;\n",
						newContent: "const value = 2;\n",
					},
				},
			},
			{},
			theme(),
			{ expanded: false, state: {}, invalidate() {} },
		);

		expect(component).toBeInstanceOf(Text);
	});
});
