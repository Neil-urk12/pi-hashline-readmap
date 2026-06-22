import { describe, expect, it, beforeAll } from "vitest";
import { ensureHashInit } from "../src/hashline.js";
import { detectBoundaryDuplications } from "../src/edit-boundary.js";
import type { BoundaryEditInfo } from "../src/edit-boundary.js";

describe("detectBoundaryDuplications", () => {
	beforeAll(async () => {
		await ensureHashInit();
	});

	it("warns when set_line replacement's first line duplicates the preceding line", () => {
		const original = ["A", "B", "C"];
		const edits: BoundaryEditInfo[] = [
			{ type: "set_line", originalLine: 2, newLines: ["A", "X"] },
		];

		const warnings = detectBoundaryDuplications(original, edits);

		expect(warnings).toHaveLength(1);
		expect(warnings[0].editIndex).toBe(0);
		expect(warnings[0].edge).toBe("leading");
		expect(warnings[0].duplicateContent).toBe("A");
		expect(warnings[0].survivingLine).toBe(1);
	});

	it("warns when set_line replacement's last line duplicates the following line", () => {
		const original = ["A", "B", "C"];
		const edits: BoundaryEditInfo[] = [
			{ type: "set_line", originalLine: 2, newLines: ["X", "C"] },
		];

		const warnings = detectBoundaryDuplications(original, edits);

		expect(warnings).toHaveLength(1);
		expect(warnings[0].editIndex).toBe(0);
		expect(warnings[0].edge).toBe("trailing");
		expect(warnings[0].duplicateContent).toBe("C");
		expect(warnings[0].survivingLine).toBe(3);
	});

	it("warns on both edges when the replacement duplicates both surrounding lines", () => {
		const original = ["A", "B", "C"];
		const edits: BoundaryEditInfo[] = [
			{ type: "set_line", originalLine: 2, newLines: ["A", "X", "C"] },
		];

		const warnings = detectBoundaryDuplications(original, edits);

		expect(warnings).toHaveLength(2);
		expect(warnings.map((w) => w.edge).sort()).toEqual(["leading", "trailing"]);
	});

	it("returns no warnings when the replacement does not duplicate surrounding lines", () => {
		const original = ["A", "B", "C"];
		const edits: BoundaryEditInfo[] = [
			{ type: "set_line", originalLine: 2, newLines: ["X", "Y"] },
		];

		expect(detectBoundaryDuplications(original, edits)).toEqual([]);
	});

	it("does not warn at the leading edge when there is no preceding line (edit at line 1)", () => {
		const original = ["A", "B"];
		const edits: BoundaryEditInfo[] = [
			{ type: "set_line", originalLine: 1, newLines: ["A", "X"] },
		];

		const warnings = detectBoundaryDuplications(original, edits);
		// No preceding line exists; we cannot produce a reference anchor for it.
		// (The duplication is real, but warning without a follow-up reference is
		// not actionable, so we skip it.)
		expect(warnings).toEqual([]);
	});

	it("does not warn at the trailing edge when there is no following line (edit at last line)", () => {
		const original = ["A", "B"];
		const edits: BoundaryEditInfo[] = [
			{ type: "set_line", originalLine: 2, newLines: ["X", "B"] },
		];

		expect(detectBoundaryDuplications(original, edits)).toEqual([]);
	});

	it("warns for replace_lines when the replacement duplicates adjacent lines", () => {
		const original = ["A", "B", "C", "D"];
		const edits: BoundaryEditInfo[] = [
			{
				type: "replace_lines",
				originalStart: 2,
				originalEnd: 3,
				newLines: ["A", "Y", "Z", "D"],
			},
		];

		const warnings = detectBoundaryDuplications(original, edits);

		expect(warnings).toHaveLength(2);
		expect(warnings.find((w) => w.edge === "leading")?.survivingLine).toBe(1);
		expect(warnings.find((w) => w.edge === "trailing")?.survivingLine).toBe(4);
	});

	it("warns for replace when old_text spans multiple lines and new_lines duplicate the boundaries", () => {
		const original = ["A", "B", "C", "D"];
		const edits: BoundaryEditInfo[] = [
			{
				type: "replace",
				originalStart: 2,
				originalLength: 2,
				newLines: ["A", "Y", "D"],
			},
		];

		const warnings = detectBoundaryDuplications(original, edits);

		expect(warnings).toHaveLength(2);
		expect(warnings.find((w) => w.edge === "leading")?.survivingLine).toBe(1);
		expect(warnings.find((w) => w.edge === "trailing")?.survivingLine).toBe(4);
	});

	it("compares lines exactly (raw comparison, not trimmed) — indentation matters", () => {
		const original = ["    if (x) {"];
		const edits: BoundaryEditInfo[] = [
			{
				type: "set_line",
				originalLine: 1,
				newLines: ["if (x) {"], // same content but no leading whitespace
			},
		];

		// The replacement starts the file (no preceding line) so no leading
		// warning. Add a following line so we can test the trailing edge.
		const original2 = ["    if (x) {", "}"];
		const edits2: BoundaryEditInfo[] = [
			{
				type: "set_line",
				originalLine: 1,
				newLines: ["if (x) {"],
			},
		];

		expect(detectBoundaryDuplications(original, edits)).toEqual([]);
		expect(detectBoundaryDuplications(original2, edits2)).toEqual([]);
	});

	it("includes a LINE:HASH reference anchor for the surviving line", () => {
		const original = ["A", "B", "C"];
		const edits: BoundaryEditInfo[] = [
			{ type: "set_line", originalLine: 2, newLines: ["A", "X"] },
		];

		const warnings = detectBoundaryDuplications(original, edits);

		expect(warnings[0].referenceAnchor).toMatch(/^1:[0-9a-f]{3}$/);
	});

	it("processes multiple edits independently", () => {
		const original = ["A", "B", "C", "D", "E"];
		const edits: BoundaryEditInfo[] = [
			{ type: "set_line", originalLine: 2, newLines: ["A", "X"] }, // leading dup with line 1
			{ type: "set_line", originalLine: 4, newLines: ["Y", "E"] }, // trailing dup with line 5
		];

		const warnings = detectBoundaryDuplications(original, edits);

		expect(warnings).toHaveLength(2);
		expect(warnings[0]).toMatchObject({ editIndex: 0, edge: "leading" });
		expect(warnings[1]).toMatchObject({ editIndex: 1, edge: "trailing" });
	});

	it("catches the classic LLM duplicate-brace pattern: replacing N with X;\\n}", () => {
		// Common bug: model intends to add a function but duplicates the
		// existing closing brace, so the file ends up with two closing braces
		// in a row.
		const original = [
			"function f() {",
			"  doWork();",
			"}",
		];
		// model replaces line 2 (the function body) with new code that ends in }
		const edits: BoundaryEditInfo[] = [
			{
				type: "set_line",
				originalLine: 2,
				newLines: ["  doOtherWork();", "}"],
			},
		];

		const warnings = detectBoundaryDuplications(original, edits);

		expect(warnings).toHaveLength(1);
		expect(warnings[0].edge).toBe("trailing");
		expect(warnings[0].duplicateContent).toBe("}");
		expect(warnings[0].survivingLine).toBe(3);
	});
});

import {
	editsToBoundaryInfo,
	detectBoundaryWarningsAsStrings,
} from "../src/edit-boundary.js";
import { computeLineHash } from "../src/hashline.js";

describe("editsToBoundaryInfo", () => {
	beforeAll(async () => {
		await ensureHashInit();
	});

	it("converts a set_line edit into BoundaryEditInfo", () => {
		const original = ["A", "B", "C"];
		const edits = [
			{
				set_line: {
					anchor: `2:${computeLineHash(2, "B")}`,
					new_text: "X",
				},
			},
		];

		const result = editsToBoundaryInfo(edits, original);

		expect(result).toEqual([{ type: "set_line", originalLine: 2, newLines: ["X"] }]);
	});

	it("converts a replace_lines edit with anchor pair into BoundaryEditInfo", () => {
		const original = ["A", "B", "C", "D"];
		const edits = [
			{
				replace_lines: {
					start_anchor: `2:${computeLineHash(2, "B")}`,
					end_anchor: `3:${computeLineHash(3, "C")}`,
					new_text: "Y\nZ",
				},
			},
		];

		const result = editsToBoundaryInfo(edits, original);

		expect(result).toEqual([
			{ type: "replace_lines", originalStart: 2, originalEnd: 3, newLines: ["Y", "Z"] },
		]);
	});

	it("converts a replace edit by locating old_text in originalLines", () => {
		const original = ["alpha", "beta", "gamma"];
		const edits = [
			{ replace: { old_text: "beta", new_text: "BETA" } },
		];

		const result = editsToBoundaryInfo(edits, original);

		expect(result).toEqual([
			{ type: "replace", originalStart: 2, originalLength: 1, newLines: ["BETA"] },
		]);
	});

	it("handles multi-line replace.old_text by matching the full prefix", () => {
		const original = ["alpha", "beta", "gamma", "delta"];
		const edits = [
			{ replace: { old_text: "beta\ngamma", new_text: "B\nG" } },
		];

		const result = editsToBoundaryInfo(edits, original);

		expect(result).toEqual([
			{ type: "replace", originalStart: 2, originalLength: 2, newLines: ["B", "G"] },
		]);
	});

	it("drops replace edits whose old_text cannot be located", () => {
		const original = ["alpha", "beta"];
		const edits = [
			{ replace: { old_text: "missing", new_text: "X" } },
		];

		expect(editsToBoundaryInfo(edits, original)).toEqual([]);
	});

	it("drops insert_after edits (no replacement region)", () => {
		const original = ["alpha", "beta"];
		const edits = [
			{
				insert_after: {
					anchor: `1:${computeLineHash(1, "alpha")}`,
					new_text: "INSERTED",
				},
			},
		];

		expect(editsToBoundaryInfo(edits, original)).toEqual([]);
	});
});

describe("detectBoundaryWarningsAsStrings", () => {
	beforeAll(async () => {
		await ensureHashInit();
	});

	it("returns a human-readable warning string per boundary duplication", () => {
		const original = ["function f() {", "  doWork();", "}"];
		const edits = [
			{
				set_line: {
					anchor: `2:${computeLineHash(2, "  doWork();")}`,
					new_text: "  doOtherWork();\n}",
				},
			},
		];

		const warnings = detectBoundaryWarningsAsStrings(original.join("\n"), edits);

		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatch(/^boundary-duplication: following line 3 \(3:[0-9a-f]{3}\) is duplicated/);
		expect(warnings[0]).toContain('"}"');
	});

	it("returns an empty array when no boundary duplication is detected", () => {
		const original = ["A", "B", "C"];
		const edits = [
			{
				set_line: {
					anchor: `2:${computeLineHash(2, "B")}`,
					new_text: "X",
				},
			},
		];

		expect(detectBoundaryWarningsAsStrings(original.join("\n"), edits)).toEqual([]);
	});
});
