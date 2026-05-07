import { describe, expect, it } from "vitest";
import { languageForPath } from "../src/diff-renderer/language.js";
import { parseInlineDiff } from "../src/diff-renderer/parse.js";
import { summarizeDiffCounts } from "../src/diff-renderer/summary.js";
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
