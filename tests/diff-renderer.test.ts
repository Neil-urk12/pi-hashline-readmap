import { describe, expect, it } from "vitest";
import { languageForPath } from "../src/diff-renderer/language.js";
import { parseInlineDiff } from "../src/diff-renderer/parse.js";
import { summarizeDiffCounts } from "../src/diff-renderer/summary.js";
import { renderInlineDiffMetadata } from "../src/diff-renderer/tui.js";
import {
	renderInlineDiff,
	renderNewFilePreview,
} from "../src/diff-renderer/render.js";

describe("diff renderer model helpers", () => {
	it("infers Shiki languages from common file extensions", () => {
		expect(languageForPath("src/tool.ts")).toBe("typescript");
		expect(languageForPath("src/view.tsx")).toBe("tsx");
		expect(languageForPath("README.md")).toBe("markdown");
		expect(languageForPath("unknown.nope")).toBe("text");
	});

	it("formats added and removed counts", () => {
		expect(summarizeDiffCounts(2, 1)).toBe("+2 -1");
		expect(summarizeDiffCounts(0, 3)).toBe("+0 -3");
	});

	it("parses old and new content into typed diff lines", () => {
		const parsed = parseInlineDiff("a\nb\nc\n", "a\nB\nc\nd\n");

		expect(parsed.added).toBe(2);
		expect(parsed.removed).toBe(1);
		expect(
			parsed.lines.some((line) => line.type === "del" && line.content === "b"),
		).toBe(true);
		expect(
			parsed.lines.some((line) => line.type === "add" && line.content === "B"),
		).toBe(true);
		expect(
			parsed.lines.some((line) => line.type === "add" && line.content === "d"),
		).toBe(true);
		expect(parsed.lines[0]).toMatchObject({
			type: "ctx",
			oldNum: 1,
			newNum: 1,
			content: "a",
		});
	});
});

describe("diff renderer output", () => {
	it("renders a bounded diff preview", async () => {
		const parsed = parseInlineDiff("const value = 1;\n", "const value = 2;\n");
		const rendered = await renderInlineDiff(parsed, {
			language: "typescript",
			maxLines: 8,
			width: 100,
		});

		expect(rendered).toContain("const value");
		expect(rendered.split("\n").length).toBeLessThanOrEqual(10);
	});

	it("pairs single-line replacement into one split row", async () => {
		const parsed = parseInlineDiff("value\n", "VALUE\n");
		const rendered = await renderInlineDiff(parsed, {
			language: "typescript",
			maxLines: 8,
			width: 160,
		});
		const plain = rendered.replace(/\u001b\[[0-9;]*m/g, "");

		expect(plain.split("\n").length).toBe(1);
		expect(plain).toContain("1 - value");
		expect(plain).toContain("1 + VALUE");
	});

	it("pairs multi-line replacement blocks row-by-row", async () => {
		const parsed = parseInlineDiff(
			"export const a = 1;\nexport const b = 2;\nexport const c = 3;\n",
			'export const a = "A";\nexport const b = "B";\nexport const c = "C";\n',
		);
		const rendered = await renderInlineDiff(parsed, {
			language: "typescript",
			maxLines: 8,
			width: 160,
		});
		const plain = rendered.replace(/\u001b\[[0-9;]*m/g, "");
		const lines = plain.split("\n");

		expect(lines.length).toBe(3);
		expect(lines[0]).toContain("1 - export const a");
		expect(lines[0]).toContain("1 + export const a");
		expect(lines[2]).toContain("3 - export const c");
		expect(lines[2]).toContain("3 + export const c");
	});

	it("renders metadata diff synchronously without loading placeholder", () => {
		const rendered = renderInlineDiffMetadata(
			{
				kind: "diff",
				path: "src/tool.ts",
				summary: "+1 -1",
				language: "typescript",
				oldContent: "const value = 1;\n",
				newContent: "const value = 2;\n",
			},
			{ fg: (_token: string, text: string) => text },
			{},
			false,
		);

		expect(rendered).toContain("const value");
		expect(rendered).not.toContain("rendering diff");
	});

	it("renders a bounded new-file preview", async () => {
		const rendered = await renderNewFilePreview(
			"const value = 1;\nconst other = 2;\n",
			{
				language: "typescript",
				maxLines: 1,
				width: 80,
			},
		);

		expect(rendered.replace(/\u001b\[[0-9;]*m/g, "")).toContain("const value");
		expect(rendered).toContain("more lines");
	});
});
