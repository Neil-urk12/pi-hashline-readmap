import { describe, it, expect } from "vitest";
import {
	toSgrParams,
	readSgrColorSequence,
	sequenceResetsBackground,
	stripBackgroundResetParams,
	keepBackgroundAcrossResets,
	stabilizeBackgroundResets,
	STYLE_RESET_PARAMS,
} from "../src/ansi-utils.js";

describe("toSgrParams", () => {
	it("parses semicolon-separated parameters", () => {
		expect(toSgrParams("1;32")).toEqual([1, 32]);
		expect(toSgrParams("38;5;196")).toEqual([38, 5, 196]);
		expect(toSgrParams("48;2;255;0;0")).toEqual([48, 2, 255, 0, 0]);
	});

	it("returns [0] for empty string (full reset)", () => {
		expect(toSgrParams("")).toEqual([0]);
		expect(toSgrParams("   ")).toEqual([0]);
	});

	it("handles single parameter", () => {
		expect(toSgrParams("1")).toEqual([1]);
		expect(toSgrParams("0")).toEqual([0]);
	});

	it("treats invalid numbers as 0", () => {
		expect(toSgrParams("1;abc;32")).toEqual([1, 0, 32]);
	});
});

describe("readSgrColorSequence", () => {
	it("reads 256-color foreground sequence (38;5;N)", () => {
		const params = [38, 5, 196];
		expect(readSgrColorSequence(params, 0)).toEqual([38, 5, 196]);
	});

	it("reads 256-color background sequence (48;5;N)", () => {
		const params = [48, 5, 21];
		expect(readSgrColorSequence(params, 0)).toEqual([48, 5, 21]);
	});

	it("reads RGB foreground sequence (38;2;R;G;B)", () => {
		const params = [38, 2, 255, 128, 0];
		expect(readSgrColorSequence(params, 0)).toEqual([38, 2, 255, 128, 0]);
	});

	it("reads RGB background sequence (48;2;R;G;B)", () => {
		const params = [48, 2, 0, 255, 0];
		expect(readSgrColorSequence(params, 0)).toEqual([48, 2, 0, 255, 0]);
	});

	it("returns undefined for invalid mode", () => {
		const params = [38, 99]; // Invalid mode
		expect(readSgrColorSequence(params, 0)).toBeUndefined();
	});

	it("returns undefined for incomplete 256-color sequence", () => {
		const params = [38, 5]; // Missing color value
		expect(readSgrColorSequence(params, 0)).toBeUndefined();
	});

	it("returns undefined for incomplete RGB sequence", () => {
		const params = [48, 2, 255, 0]; // Missing blue value
		expect(readSgrColorSequence(params, 0)).toBeUndefined();
	});

	it("reads color sequence from middle of parameter array", () => {
		const params = [1, 38, 5, 196, 4];
		expect(readSgrColorSequence(params, 1)).toEqual([38, 5, 196]);
	});
});

describe("sequenceResetsBackground", () => {
	it("detects full reset (code 0)", () => {
		expect(sequenceResetsBackground([0])).toBe(true);
		expect(sequenceResetsBackground([1, 0, 32])).toBe(true);
	});

	it("detects background reset (code 49)", () => {
		expect(sequenceResetsBackground([49])).toBe(true);
		expect(sequenceResetsBackground([1, 49])).toBe(true);
	});

	it("detects basic background colors (40-47)", () => {
		expect(sequenceResetsBackground([40])).toBe(true); // Black bg
		expect(sequenceResetsBackground([42])).toBe(true); // Green bg
		expect(sequenceResetsBackground([47])).toBe(true); // White bg
		expect(sequenceResetsBackground([1, 42, 32])).toBe(true);
	});

	it("detects bright background colors (100-107)", () => {
		expect(sequenceResetsBackground([100])).toBe(true); // Bright black bg
		expect(sequenceResetsBackground([102])).toBe(true); // Bright green bg
		expect(sequenceResetsBackground([107])).toBe(true); // Bright white bg
	});

	it("detects extended background color (code 48)", () => {
		expect(sequenceResetsBackground([48, 5, 21])).toBe(true);
		expect(sequenceResetsBackground([48, 2, 255, 0, 0])).toBe(true);
	});

	it("returns false for foreground-only sequences", () => {
		expect(sequenceResetsBackground([1])).toBe(false); // Bold
		expect(sequenceResetsBackground([32])).toBe(false); // Green fg
		expect(sequenceResetsBackground([1, 32])).toBe(false); // Bold green fg
		expect(sequenceResetsBackground([38, 5, 196])).toBe(false); // 256-color fg
		expect(sequenceResetsBackground([38, 2, 255, 0, 0])).toBe(false); // RGB fg
	});

	it("returns false for empty array", () => {
		expect(sequenceResetsBackground([])).toBe(false);
	});
});

describe("stripBackgroundResetParams", () => {
	it("replaces full reset (0) with safe subset", () => {
		const result = stripBackgroundResetParams([0]);
		expect(result).toEqual(STYLE_RESET_PARAMS);
	});

	it("removes background reset (49)", () => {
		expect(stripBackgroundResetParams([49])).toEqual([]);
		expect(stripBackgroundResetParams([1, 49, 32])).toEqual([1, 32]);
	});

	it("removes basic background colors (40-47)", () => {
		expect(stripBackgroundResetParams([42])).toEqual([]); // Green bg
		expect(stripBackgroundResetParams([1, 42, 32])).toEqual([1, 32]);
		expect(stripBackgroundResetParams([40, 41, 42])).toEqual([]);
	});

	it("removes bright background colors (100-107)", () => {
		expect(stripBackgroundResetParams([102])).toEqual([]); // Bright green bg
		expect(stripBackgroundResetParams([1, 102, 32])).toEqual([1, 32]);
	});

	it("removes extended background color (48) but keeps foreground (38)", () => {
		// Remove background 256-color
		expect(stripBackgroundResetParams([48, 5, 21])).toEqual([]);

		// Remove background RGB
		expect(stripBackgroundResetParams([48, 2, 255, 0, 0])).toEqual([]);

		// Keep foreground 256-color
		expect(stripBackgroundResetParams([38, 5, 196])).toEqual([38, 5, 196]);

		// Keep foreground RGB
		expect(stripBackgroundResetParams([38, 2, 255, 128, 0])).toEqual([38, 2, 255, 128, 0]);

		// Mixed: keep fg, remove bg
		expect(stripBackgroundResetParams([38, 5, 196, 48, 5, 21])).toEqual([38, 5, 196]);
	});

	it("preserves foreground colors and styles", () => {
		expect(stripBackgroundResetParams([1])).toEqual([1]); // Bold
		expect(stripBackgroundResetParams([3])).toEqual([3]); // Italic
		expect(stripBackgroundResetParams([4])).toEqual([4]); // Underline
		expect(stripBackgroundResetParams([32])).toEqual([32]); // Green fg
		expect(stripBackgroundResetParams([1, 32])).toEqual([1, 32]); // Bold green fg
	});

	it("handles complex mixed sequences", () => {
		// Bold, green bg, green fg, reset
		const input = [1, 42, 32, 0];
		const result = stripBackgroundResetParams(input);
		expect(result).toEqual([1, 32, ...STYLE_RESET_PARAMS]);
	});

	it("returns empty array when all params are background-related", () => {
		expect(stripBackgroundResetParams([49])).toEqual([]);
		expect(stripBackgroundResetParams([42, 49])).toEqual([]);
	});
});

describe("keepBackgroundAcrossResets", () => {
	const rowBg = "\x1b[48;2;20;30;20m";

	it("re-applies background after full reset (code 0)", () => {
		const text = "hello\x1b[0mworld";
		const result = keepBackgroundAcrossResets(text, rowBg);
		expect(result).toBe(`hello\x1b[0m${rowBg}world`);
	});

	it("re-applies background after background reset (code 49)", () => {
		const text = "hello\x1b[49mworld";
		const result = keepBackgroundAcrossResets(text, rowBg);
		expect(result).toBe(`hello\x1b[49m${rowBg}world`);
	});

	it("re-applies background after basic background color", () => {
		const text = "hello\x1b[42mworld";
		const result = keepBackgroundAcrossResets(text, rowBg);
		expect(result).toBe(`hello\x1b[42m${rowBg}world`);
	});

	it("re-applies background after extended background color", () => {
		const text = "hello\x1b[48;5;21mworld";
		const result = keepBackgroundAcrossResets(text, rowBg);
		expect(result).toBe(`hello\x1b[48;5;21m${rowBg}world`);
	});

	it("does not modify foreground-only sequences", () => {
		const text = "hello\x1b[32mworld";
		const result = keepBackgroundAcrossResets(text, rowBg);
		expect(result).toBe("hello\x1b[32mworld");
	});

	it("handles multiple reset sequences", () => {
		const text = "a\x1b[0mb\x1b[49mc\x1b[42md";
		const result = keepBackgroundAcrossResets(text, rowBg);
		expect(result).toBe(`a\x1b[0m${rowBg}b\x1b[49m${rowBg}c\x1b[42m${rowBg}d`);
	});

	it("handles text without ANSI sequences", () => {
		const text = "hello world";
		const result = keepBackgroundAcrossResets(text, rowBg);
		expect(result).toBe("hello world");
	});

	it("handles empty text", () => {
		const result = keepBackgroundAcrossResets("", rowBg);
		expect(result).toBe("");
	});
});

describe("stabilizeBackgroundResets", () => {
	it("replaces full reset (0) with safe subset", () => {
		const text = "\x1b[0m";
		const result = stabilizeBackgroundResets(text);
		expect(result).toBe(`\x1b[${STYLE_RESET_PARAMS.join(";")}m`);
	});

	it("removes background reset (49)", () => {
		const text = "\x1b[49m";
		const result = stabilizeBackgroundResets(text);
		expect(result).toBe(""); // Empty sequence removed
	});

	it("removes basic background colors", () => {
		const text = "\x1b[42m"; // Green bg
		const result = stabilizeBackgroundResets(text);
		expect(result).toBe("");
	});

	it("removes extended background colors but keeps foreground", () => {
		// Remove background 256-color
		expect(stabilizeBackgroundResets("\x1b[48;5;21m")).toBe("");

		// Keep foreground 256-color
		expect(stabilizeBackgroundResets("\x1b[38;5;196m")).toBe("\x1b[38;5;196m");

		// Mixed: keep fg, remove bg
		const text = "\x1b[38;5;196;48;5;21m";
		const result = stabilizeBackgroundResets(text);
		expect(result).toBe("\x1b[38;5;196m");
	});

	it("preserves foreground colors and styles", () => {
		expect(stabilizeBackgroundResets("\x1b[1m")).toBe("\x1b[1m"); // Bold
		expect(stabilizeBackgroundResets("\x1b[32m")).toBe("\x1b[32m"); // Green fg
		expect(stabilizeBackgroundResets("\x1b[1;32m")).toBe("\x1b[1;32m"); // Bold green fg
	});

	it("handles complex sequences with mixed fg/bg", () => {
		// Bold, green bg, green fg
		const text = "\x1b[1;42;32m";
		const result = stabilizeBackgroundResets(text);
		expect(result).toBe("\x1b[1;32m"); // Removes 42 (green bg)
	});

	it("handles multiple sequences in text", () => {
		const text = "hello\x1b[1;42mworld\x1b[0mend";
		const result = stabilizeBackgroundResets(text);
		expect(result).toBe(`hello\x1b[1mworld\x1b[${STYLE_RESET_PARAMS.join(";")}mend`);
	});

	it("handles text without ANSI sequences", () => {
		const text = "hello world";
		const result = stabilizeBackgroundResets(text);
		expect(result).toBe("hello world");
	});

	it("handles empty text", () => {
		const result = stabilizeBackgroundResets("");
		expect(result).toBe("");
	});

	it("removes sequences that become empty after stripping", () => {
		// Sequence with only background params
		const text = "\x1b[42;49m";
		const result = stabilizeBackgroundResets(text);
		expect(result).toBe(""); // Both params removed, sequence removed
	});
});

describe("ANSI stabilization integration", () => {
	it("combined usage: keepBackgroundAcrossResets + stabilizeBackgroundResets", () => {
		const rowBg = "\x1b[48;2;20;30;20m";
		const text = "hello\x1b[1;42;32mworld\x1b[0mend";

		// First, re-apply background after resets
		const withBg = keepBackgroundAcrossResets(text, rowBg);
		expect(withBg).toBe(`hello\x1b[1;42;32m${rowBg}world\x1b[0m${rowBg}end`);

		// Then, sanitize to remove background params
		// Note: stabilizeBackgroundResets will remove the rowBg codes we just added
		// because they are background codes. This is correct - the final envelope
		// should be applied AFTER stabilization in the actual rendering pipeline.
		const stabilized = stabilizeBackgroundResets(withBg);
		// Should have: bold+green fg (no bg), safe reset (no bg)
		expect(stabilized).toContain("\x1b[1;32m");
		expect(stabilized).toContain(`\x1b[${STYLE_RESET_PARAMS.join(";")}m`);
		// Background codes should be stripped
		expect(stabilized).not.toContain("\x1b[48;");
		expect(stabilized).not.toContain("\x1b[42m");
	});

	it("handles syntax highlighting with embedded ANSI codes", () => {
		const rowBg = "\x1b[48;2;20;30;20m";
		// Simulated syntax highlighting: keyword in bold blue, then reset
		const text = "function \x1b[1;34mhello\x1b[0m() {}";

		const withBg = keepBackgroundAcrossResets(text, rowBg);
		const stabilized = stabilizeBackgroundResets(withBg);

		// Should preserve bold blue foreground, safe reset replaces full reset
		expect(stabilized).toContain("\x1b[1;34m");
		expect(stabilized).toContain(`\x1b[${STYLE_RESET_PARAMS.join(";")}m`);
		// Background codes should be stripped
		expect(stabilized).not.toContain("\x1b[48;");
	});

	it("correct usage pattern: stabilize first, then apply background envelope", () => {
		const rowBg = "\x1b[48;2;20;30;20m";
		const restoreBg = "\x1b[49m";
		const text = "hello\x1b[1;42;32mworld\x1b[0mend";

		// Step 1: Stabilize to remove embedded background codes
		const stabilized = stabilizeBackgroundResets(text);
		expect(stabilized).toBe(`hello\x1b[1;32mworld\x1b[${STYLE_RESET_PARAMS.join(";")}mend`);

		// Step 2: Apply background envelope
		const withEnvelope = `${rowBg}${stabilized}${restoreBg}`;

		// Step 3: Re-apply background after any remaining resets
		const final = keepBackgroundAcrossResets(withEnvelope, rowBg);

		// Final output should have:
		// - rowBg at start (with duplicate from keepBackgroundAcrossResets detecting it)
		// - Safe reset in middle (no rowBg re-applied because it doesn't reset background)
		// - restoreBg at end (with rowBg re-applied after it)
		expect(final).toContain(rowBg);
		expect(final).toContain(restoreBg);
		expect(final).toContain(`\x1b[${STYLE_RESET_PARAMS.join(";")}m`);
		// The safe reset should NOT have rowBg after it (it doesn't reset background)
		expect(final).not.toContain(`\x1b[${STYLE_RESET_PARAMS.join(";")}m${rowBg}`);
		// But restoreBg (49) should have rowBg after it
		expect(final).toContain(`${restoreBg}${rowBg}`);
	});
});

describe("STYLE_RESET_PARAMS constant", () => {
	it("contains expected safe reset parameters", () => {
		expect(STYLE_RESET_PARAMS).toEqual([39, 22, 23, 24, 25, 27, 28, 29, 59]);
	});

	it("does not include background-affecting codes", () => {
		// Ensure no background codes in safe reset
		for (const param of STYLE_RESET_PARAMS) {
			expect(param).not.toBe(0); // Full reset
			expect(param).not.toBe(49); // Background reset
			expect(param < 40 || param > 47).toBe(true); // Basic bg colors
			expect(param < 100 || param > 107).toBe(true); // Bright bg colors
			expect(param).not.toBe(48); // Extended bg color
		}
	});
});
