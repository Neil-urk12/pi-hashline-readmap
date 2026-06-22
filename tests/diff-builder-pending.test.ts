import { describe, expect, it, beforeAll } from "vitest";
import { buildPendingDiffSnapshot } from "../src/diff-builder.js";
import { ensureHashInit } from "../src/hashline.js";

describe("DiffBuilder.buildPendingDiffSnapshot", () => {
	beforeAll(async () => {
		await ensureHashInit();
	});

	it("returns diff + entries + firstChangedLine only (no InlineDiffMetadata, no summary, no language)", () => {
		const snap = buildPendingDiffSnapshot("a\nb\nc\n", "a\nB\nc\nd\n");
		expect(Object.keys(snap).sort()).toEqual(["diff", "entries", "firstChangedLine"]);
		expect(snap.firstChangedLine).toBeDefined();
	});

	it("emits compact short-circuit for single-line edits", () => {
		const oldContent = "line one\nline two\nline three";
		const newContent = "line one\nline TWO\nline three";
		const snap = buildPendingDiffSnapshot(oldContent, newContent);
		expect(snap.diff).toMatch(/^2:[0-9a-f]{3}\|line two → 2:[0-9a-f]{3}\|line TWO$/);
		expect(snap.firstChangedLine).toBe(2);
		expect(snap.entries).toEqual([
			{ kind: "remove", oldLine: 2, text: "line two" },
			{ kind: "add", newLine: 2, text: "line TWO" },
		]);
	});

	it("emits compact deletion short-circuit for single-line deletion", () => {
		const oldContent = "line one\nline two\nline three";
		const newContent = "line one\nline three";
		const snap = buildPendingDiffSnapshot(oldContent, newContent);
		expect(snap.diff).toMatch(/^2:[0-9a-f]{3}\|line two → \[deleted\]$/);
		expect(snap.firstChangedLine).toBe(2);
		expect(snap.entries).toEqual([{ kind: "remove", oldLine: 2, text: "line two" }]);
	});

	it("falls back to full unified diff for multi-line edits", () => {
		const oldContent = "line one\nline two\nline three\nline four";
		const newContent = "line one\nLINE TWO\nLINE THREE\nline four";
		const snap = buildPendingDiffSnapshot(oldContent, newContent);
		expect(snap.diff).toContain("+");
		expect(snap.diff).toContain("-");
		expect(snap.entries.length).toBeGreaterThan(0);
	});

	it("returns empty diff + undefined firstChangedLine when old === new", () => {
		const snap = buildPendingDiffSnapshot("a\nb\nc\n", "a\nb\nc\n");
		expect(snap.diff).toBe("");
		expect(snap.firstChangedLine).toBeUndefined();
		expect(snap.entries).toEqual([]);
	});
});
