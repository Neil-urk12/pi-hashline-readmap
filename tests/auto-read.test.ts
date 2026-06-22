import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
	AUTO_READ_MAX_LINES,
	__resetAutoReadForTest,
	formatAutoReadOutput,
	isAutoReadEnabled,
	setAutoReadEnabled,
	toggleAutoRead,
} from "../src/auto-read.js";
import { ensureHashInit } from "../src/hashline.js";

describe("isAutoReadEnabled / state", () => {
	beforeEach(() => {
		__resetAutoReadForTest(false);
	});
	afterEach(() => {
		__resetAutoReadForTest(false);
	});

	it("defaults to disabled after reset", () => {
		expect(isAutoReadEnabled()).toBe(false);
	});

	it("toggleAutoRead flips state", () => {
		expect(isAutoReadEnabled()).toBe(false);
		toggleAutoRead();
		expect(isAutoReadEnabled()).toBe(true);
		toggleAutoRead();
		expect(isAutoReadEnabled()).toBe(false);
	});

	it("toggleAutoRead returns the new state", () => {
		const first = toggleAutoRead();
		expect(first).toBe(true);
		const second = toggleAutoRead();
		expect(second).toBe(false);
	});

	it("setAutoReadEnabled forces state", () => {
		setAutoReadEnabled(true);
		expect(isAutoReadEnabled()).toBe(true);
		setAutoReadEnabled(false);
		expect(isAutoReadEnabled()).toBe(false);
	});
});

describe("formatAutoReadOutput", () => {
	it("emits each line with its hashline anchor", async () => {
		await ensureHashInit();
		const result = formatAutoReadOutput("alpha\nbeta\ngamma", AUTO_READ_MAX_LINES);

		expect(result).not.toBeNull();
		// 3 lines, each formatted as `LINE:HASH|content`.
		const lines = result!.output.split("\n");
		expect(lines.length).toBe(3);
		expect(lines[0]).toMatch(/^1:[0-9a-f]{3}\|alpha$/);
		expect(lines[1]).toMatch(/^2:[0-9a-f]{3}\|beta$/);
		expect(lines[2]).toMatch(/^3:[0-9a-f]{3}\|gamma$/);
		expect(result!.paginationHint).toBe("");
	});

	it("truncates output at AUTO_READ_MAX_LINES with a pagination hint", async () => {
		await ensureHashInit();
		const totalLines = AUTO_READ_MAX_LINES + 50;
		const content = Array.from({ length: totalLines }, (_, i) => `line-${i + 1}`).join("\n");

		const result = formatAutoReadOutput(content, AUTO_READ_MAX_LINES);

		expect(result).not.toBeNull();
		const lines = result!.output.split("\n");
		expect(lines.length).toBe(AUTO_READ_MAX_LINES);
		expect(result!.paginationHint).toContain(`[Showing lines 1-${AUTO_READ_MAX_LINES} of ${totalLines}.`);
		expect(result!.paginationHint).toContain(`Use offset=${AUTO_READ_MAX_LINES + 1}`);
	});

	it("returns null when content is empty (nothing to anchor)", async () => {
		await ensureHashInit();
		expect(formatAutoReadOutput("", AUTO_READ_MAX_LINES)).toBeNull();
		expect(formatAutoReadOutput("\n\n\n", AUTO_READ_MAX_LINES)).toBeNull();
	});

	it("uses CRLF normalization before line splitting (no double-hash for \\r\\n)", async () => {
		await ensureHashInit();
		const result = formatAutoReadOutput("alpha\r\nbeta", AUTO_READ_MAX_LINES);

		expect(result).not.toBeNull();
		const lines = result!.output.split("\n");
		expect(lines.length).toBe(2);
		// Hashes are computed on content without trailing \r.
		expect(lines[0]).toMatch(/^1:[0-9a-f]{3}\|alpha$/);
		expect(lines[1]).toMatch(/^2:[0-9a-f]{3}\|beta$/);
	});
});
