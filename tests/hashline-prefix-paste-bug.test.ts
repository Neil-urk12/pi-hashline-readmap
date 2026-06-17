// tests/hashline-prefix-paste-bug.test.ts
//
// Pins behavior at the seam between stripNewLinePrefixes and the
// new detectPastedRealAnchors detector. BUG tests cover cases where
// the detector rejects the edit with PasteDetectedError; CONTROL
// tests cover cases that fall through to the existing noopEdits path
// (same-line / same-block self-paste) and continue to work.

import { describe, it, expect, beforeAll } from "vitest";
import { ensureHashInit, applyHashlineEdits, computeLineHash } from "../src/hashline.js";

describe("hashline prefix-strip — paste-from-read-output", () => {
	beforeAll(async () => {
		await ensureHashInit();
	});

	it("BUG: cross-line paste silently inserts content from a different line", () => {
		// File: alpha / beta / gamma
		// Model reads, sees anchors. Wants to set_line on line 1.
		// Mistake: pastes "2:<h2>|beta" (line 2's anchor + content).
		//
		// Current behavior: prefix stripped, line 1 overwritten with "beta".
		// Model gets success, no warning.
		//
		// Desired: detect the paste, reject the edit (throw or preserve
		// content + warning).
		const orig = ["alpha", "beta", "gamma"].join("\n");
		const anchor1 = `1:${computeLineHash(1, "alpha")}`;
		const anchor2 = `2:${computeLineHash(2, "beta")}`;

		expect(() => applyHashlineEdits(
			orig,
			[{ set_line: { anchor: anchor1, new_text: `${anchor2}|beta` } }],
			new AbortController().signal,
		)).toThrow(/paste/i);

		// After fix: function throws PasteDetectedError.
		// The file is not mutated (no write happens).
	});

	it("BUG: insert_after self-paste silently duplicates the anchor line", () => {
		// File: alpha / beta / gamma
		// Model reads, sees anchors. Wants to insert a new line after line 1.
		// Mistake: pastes "1:<h1>|alpha" (line 1's anchor + content) as new_text.
		//
		// Current behavior: prefix stripped by stripNewLinePrefixes (1/1 line
		// is a majority). stripInsertAnchorEcho doesn't fire (dst.length > 1
		// guard). "alpha" is inserted after line 1, duplicating it. The model
		// gets a successful edit response.
		//
		// Desired: detect the paste, reject the edit (throw or preserve
		// content + warning).
		const orig = ["alpha", "beta", "gamma"].join("\n");
		const anchor1 = `1:${computeLineHash(1, "alpha")}`;

		expect(() => applyHashlineEdits(
			orig,
			[{ insert_after: { anchor: anchor1, new_text: `${anchor1}|alpha` } }],
			new AbortController().signal,
		)).toThrow(/paste/i);

		// After fix: function throws PasteDetectedError.
		// The file is not mutated (no write happens).
	});

	it("CONTROL: same-line paste is caught by noop detection", () => {
		// Same mistake, same line: pasting "2:<h2>|beta" into set_line on
		// line 2. After strip, content equals original — noop detection
		// surfaces this via the noopEdits array. The model gets an error.
		const orig = ["alpha", "beta", "gamma"].join("\n");
		const anchor2 = `2:${computeLineHash(2, "beta")}`;

		const res = applyHashlineEdits(
			orig,
			[{ set_line: { anchor: anchor2, new_text: `${anchor2}|beta` } }],
			new AbortController().signal,
		);

		expect(res.content).toBe(orig);
		expect(res.noopEdits?.length).toBe(1);
		expect(res.noopEdits?.[0].loc).toBe(anchor2);
		// ↑ PASSES today. Pinning working behavior.
	});

	it("CONTROL: replace_lines same-block paste is caught by noop detection", () => {
		// The realistic case: model pastes a multi-line block including
		// its anchors. After strip, content equals original — noop detected.
		const orig = ["alpha", "beta", "gamma"].join("\n");
		const start = `1:${computeLineHash(1, "alpha")}`;
		const end = `2:${computeLineHash(2, "beta")}`;

		const res = applyHashlineEdits(
			orig,
			[
				{
					replace_lines: {
						start_anchor: start,
						end_anchor: end,
						new_text: `${start}|alpha\n${end}|beta`,
					},
				},
			],
			new AbortController().signal,
		);

		expect(res.content).toBe(orig);
		expect(res.noopEdits?.length).toBe(1);
		// ↑ PASSES today. Pinning working behavior.
	});

	it("CONTROL: legitimate pipe-prefixed content is not flagged (no false positive)", () => {
		// Model genuinely wants line 2 to be "1:zzz|alpha" — e.g. a regex
		// literal that happens to look like a hashline prefix. The prefix
		// does NOT match a real file anchor (line 1's hash isn't "zzz"),
		// so a smart detector should leave it alone.
		const orig = ["alpha", "beta", "gamma"].join("\n");
		const anchor2 = `2:${computeLineHash(2, "beta")}`;

		const res = applyHashlineEdits(
			orig,
			[{ set_line: { anchor: anchor2, new_text: "1:zzz|alpha" } }],
			new AbortController().signal,
		);

		// Strip fires (single line = majority of one), "alpha" is written.
		expect(res.content.split("\n")).toEqual(["alpha", "alpha", "gamma"]);
		// ↑ PASSES today. Pinning the no-false-positive property.
	});

	it("CONTROL: insert_after multi-line self-paste with extra content is correctly handled", () => {
		// The realistic case where the model pastes a block that includes the
		// anchor *and* new content. stripNewLinePrefixes strips the prefix on
		// the first line; stripInsertAnchorEcho then removes the leading line
		// because it matches the anchor line. The remaining content is
		// inserted as intended.
		const orig = ["alpha", "beta", "gamma"].join("\n");
		const anchor1 = `1:${computeLineHash(1, "alpha")}`;

		const res = applyHashlineEdits(
			orig,
			[
				{
					insert_after: {
						anchor: anchor1,
						new_text: `${anchor1}|alpha\nnew content`,
					},
				},
			],
			new AbortController().signal,
		);

		expect(res.content.split("\n")).toEqual(["alpha", "new content", "beta", "gamma"]);
		// ↑ PASSES today. Pinning stripInsertAnchorEcho's correct behavior
		//   on multi-line pastes with extra content.
	});
});
