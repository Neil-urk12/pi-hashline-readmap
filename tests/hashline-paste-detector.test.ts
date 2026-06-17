// tests/hashline-paste-detector.test.ts
//
// Direct unit tests for detectPastedRealAnchors. The integration test
// (paste from read output → applyHashlineEdits throws) lives in
// tests/hashline-prefix-paste-bug.test.ts. This file pins the helper's
// input/output contract in isolation, including the no-false-positive
// guarantees that let stripNewLinePrefixes keep handling benign
// prefixes silently.

import { describe, it, expect, beforeAll } from "vitest";
import { ensureHashInit, detectPastedRealAnchors, computeLineHash } from "../src/hashline.js";

describe("detectPastedRealAnchors", () => {
	beforeAll(async () => {
		await ensureHashInit();
	});

	const fileLines = ["alpha", "beta", "gamma"];

	it("returns empty for an empty input", () => {
		expect(detectPastedRealAnchors([], fileLines)).toEqual([]);
	});

	it("returns empty when no line carries a hashline prefix", () => {
		expect(
			detectPastedRealAnchors(["plain content", "more content"], fileLines),
		).toEqual([]);
	});

	it("flags a single real-anchor match", () => {
		const anchor2 = `2:${computeLineHash(2, "beta")}`;
		const dst = [`${anchor2}|beta`];
		expect(detectPastedRealAnchors(dst, fileLines)).toEqual([
			{ line: 2, hash: anchor2.split(":")[1] },
		]);
	});

	it("flags every real-anchor match in a multi-line block", () => {
		const anchor1 = `1:${computeLineHash(1, "alpha")}`;
		const anchor3 = `3:${computeLineHash(3, "gamma")}`;
		const dst = [
			`${anchor1}|alpha`,
			"benign line",
			`${anchor3}|gamma`,
		];
		const result = detectPastedRealAnchors(dst, fileLines);
		expect(result).toEqual([
			{ line: 1, hash: anchor1.split(":")[1] },
			{ line: 3, hash: anchor3.split(":")[1] },
		]);
	});

	it("does not flag a benign prefix whose hash does not match the file", () => {
		// "1:zzz|" — zzz is not a real hash for line 1
		expect(
			detectPastedRealAnchors(["1:zzz|alpha"], fileLines),
		).toEqual([]);
	});

	it("does not flag a benign prefix whose line number is out of range", () => {
		// "999:abc|" — line 999 does not exist
		expect(
			detectPastedRealAnchors(["999:abc|content"], fileLines),
		).toEqual([]);
	});

	it("does not flag a hashline-shaped prefix that is not 3 hex chars", () => {
		// "1:longer|" — "longer" is 6 chars, not a real hash format
		expect(
			detectPastedRealAnchors(["1:longer|content"], fileLines),
		).toEqual([]);
	});

	it("returns only the offending lines from a mixed block", () => {
		const anchor2 = `2:${computeLineHash(2, "beta")}`;
		const dst = [
			"new line 1",
			`${anchor2}|beta`, // real paste
			"new line 3",
			"1:zzz|alpha", // benign (wrong hash)
		];
		expect(detectPastedRealAnchors(dst, fileLines)).toEqual([
			{ line: 2, hash: anchor2.split(":")[1] },
		]);
	});

	it("handles a single-line input array", () => {
		const anchor1 = `1:${computeLineHash(1, "alpha")}`;
		expect(
			detectPastedRealAnchors([`${anchor1}|alpha`], fileLines),
		).toEqual([{ line: 1, hash: anchor1.split(":")[1] }]);
	});
});
