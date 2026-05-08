/**
 * ANSI stabilization utilities for diff rendering
 *
 * This module provides functions to prevent embedded ANSI reset sequences from
 * disrupting line background colors in diff output. It parses ANSI SGR sequences,
 * identifies background-affecting parameters, and sanitizes them while preserving
 * foreground styles.
 *
 * Key functions:
 * - keepBackgroundAcrossResets(): Re-applies line background after reset sequences
 * - stabilizeBackgroundResets(): Strips background-affecting parameters from sequences
 * - sequenceResetsBackground(): Detects if a sequence resets background
 * - stripBackgroundResetParams(): Removes background parameters from parameter list
 * - toSgrParams(): Parses semicolon-separated parameter string to number array
 * - readSgrColorSequence(): Handles extended color sequences (codes 38, 48)
 */

/**
 * Safe reset parameters that reset foreground and styles but not background
 * These are used to replace full reset (code 0) with a safe subset
 *
 * 39: reset foreground color
 * 22: normal intensity (not bold)
 * 23: not italic
 * 24: not underlined
 * 25: not blinking
 * 27: not reversed
 * 28: not concealed
 * 29: not crossed-out
 * 59: default underline color
 */
export const STYLE_RESET_PARAMS = [39, 22, 23, 24, 25, 27, 28, 29, 59];

/**
 * Pattern for matching ANSI SGR (Select Graphic Rendition) sequences
 * Format: ESC [ <params> m
 * Where <params> is a semicolon-separated list of numbers (can be empty)
 */
const ANSI_SGR_PATTERN = /\x1b\[([0-9;]*)m/g;

/**
 * Parse semicolon-separated parameter string into array of numbers
 * Empty string or missing parameters default to [0] (full reset)
 *
 * @param rawParams - Raw parameter string from SGR sequence (e.g., "1;32" or "")
 * @returns Array of parameter numbers
 *
 * @example
 * toSgrParams("1;32") // [1, 32]
 * toSgrParams("") // [0]
 * toSgrParams("38;5;196") // [38, 5, 196]
 */
export function toSgrParams(rawParams: string): number[] {
	if (!rawParams || rawParams.trim() === "") {
		return [0]; // Empty sequence means reset
	}
	return rawParams.split(";").map((p) => parseInt(p, 10) || 0);
}

/**
 * Read extended color sequence starting at given index
 * Extended color sequences use codes 38 (foreground) or 48 (background)
 * followed by mode and color values:
 * - Mode 5: 256-color (38;5;N or 48;5;N)
 * - Mode 2: RGB (38;2;R;G;B or 48;2;R;G;B)
 *
 * @param params - Full parameter array
 * @param index - Index of the 38 or 48 code
 * @returns Array of parameters consumed by this color sequence, or undefined if invalid
 *
 * @example
 * readSgrColorSequence([38, 5, 196], 0) // [38, 5, 196]
 * readSgrColorSequence([48, 2, 255, 0, 0], 0) // [48, 2, 255, 0, 0]
 * readSgrColorSequence([38, 99], 0) // undefined (invalid mode)
 */
export function readSgrColorSequence(
	params: number[],
	index: number
): number[] | undefined {
	const code = params[index]; // 38 or 48
	const mode = params[index + 1];

	if (mode === 5) {
		// 256-color: code;5;N (3 parameters)
		if (index + 2 < params.length) {
			return [code, mode, params[index + 2]];
		}
	} else if (mode === 2) {
		// RGB: code;2;R;G;B (5 parameters)
		if (index + 4 < params.length) {
			return [code, mode, params[index + 2], params[index + 3], params[index + 4]];
		}
	}

	return undefined; // Invalid or incomplete sequence
}

/**
 * Check if a parameter array contains background-affecting codes
 * Background-affecting codes include:
 * - 0: Full reset (resets everything including background)
 * - 49: Reset background color
 * - 40-47: Basic background colors
 * - 100-107: Bright background colors
 * - 48: Extended background color (followed by mode and values)
 *
 * @param params - Array of SGR parameters
 * @returns True if any parameter affects background
 *
 * @example
 * sequenceResetsBackground([0]) // true (full reset)
 * sequenceResetsBackground([49]) // true (background reset)
 * sequenceResetsBackground([42]) // true (green background)
 * sequenceResetsBackground([1, 32]) // false (bold green foreground)
 */
export function sequenceResetsBackground(params: number[]): boolean {
	for (let i = 0; i < params.length; i++) {
		const p = params[i];

		// Full reset
		if (p === 0) {
			return true;
		}

		// Background reset
		if (p === 49) {
			return true;
		}

		// Basic background colors (40-47)
		if (p >= 40 && p <= 47) {
			return true;
		}

		// Bright background colors (100-107)
		if (p >= 100 && p <= 107) {
			return true;
		}

		// Extended color sequences (38 foreground, 48 background)
		// Need to skip ahead to avoid interpreting color values as codes
		if (p === 38 || p === 48) {
			const colorSeq = readSgrColorSequence(params, i);
			if (colorSeq) {
				// If it's background (48), return true
				if (p === 48) {
					return true;
				}
				// Skip ahead past the color sequence
				i += colorSeq.length - 1;
			}
		}
	}

	return false;
}

/**
 * Remove background-affecting parameters from parameter array
 * Replaces full reset (0) with safe subset that resets foreground and styles only
 * Removes all background color codes while preserving foreground styles
 *
 * @param params - Array of SGR parameters
 * @returns New array with background parameters removed
 *
 * @example
 * stripBackgroundResetParams([0]) // [39, 22, 23, 24, 25, 27, 28, 29, 59]
 * stripBackgroundResetParams([1, 42, 32]) // [1, 32] (removes 42 green bg)
 * stripBackgroundResetParams([38, 5, 196, 48, 5, 21]) // [38, 5, 196] (removes bg)
 */
export function stripBackgroundResetParams(params: number[]): number[] {
	const result: number[] = [];

	for (let i = 0; i < params.length; i++) {
		const p = params[i];

		// Replace full reset with safe subset
		if (p === 0) {
			result.push(...STYLE_RESET_PARAMS);
			continue;
		}

		// Skip background reset
		if (p === 49) {
			continue;
		}

		// Skip basic background colors (40-47)
		if (p >= 40 && p <= 47) {
			continue;
		}

		// Skip bright background colors (100-107)
		if (p >= 100 && p <= 107) {
			continue;
		}

		// Handle extended color sequences (38 foreground, 48 background)
		if (p === 38 || p === 48) {
			const colorSeq = readSgrColorSequence(params, i);
			if (colorSeq) {
				// If it's foreground (38), keep it; if background (48), skip it
				if (p === 38) {
					result.push(...colorSeq);
				}
				// Skip ahead past the color sequence
				i += colorSeq.length - 1;
				continue;
			}
		}

		// Keep all other parameters (foreground colors, styles, etc.)
		result.push(p);
	}

	return result;
}

/**
 * Re-apply line background after embedded reset sequences
 * Scans text for ANSI SGR sequences that reset background and injects
 * the line background ANSI code immediately after each one
 *
 * This ensures that embedded ANSI codes in content (e.g., from syntax highlighting)
 * don't clear the line background color applied by the diff renderer
 *
 * @param text - Text content with potential embedded ANSI sequences
 * @param rowBg - Line background ANSI code to re-apply (e.g., "\x1b[48;2;20;30;20m")
 * @returns Text with background re-applied after reset sequences
 *
 * @example
 * const text = "hello\x1b[0mworld";
 * const rowBg = "\x1b[48;2;20;30;20m";
 * keepBackgroundAcrossResets(text, rowBg);
 * // "hello\x1b[0m\x1b[48;2;20;30;20mworld"
 */
export function keepBackgroundAcrossResets(text: string, rowBg: string): string {
	return text.replace(ANSI_SGR_PATTERN, (match, rawParams) => {
		const params = toSgrParams(rawParams);

		// If this sequence resets background, re-apply it immediately after
		if (sequenceResetsBackground(params)) {
			return match + rowBg;
		}

		return match;
	});
}

/**
 * Sanitize all ANSI sequences to remove background-affecting parameters
 * Strips background colors and resets while preserving foreground styles
 *
 * This is the final sanitization step applied to rendered lines to ensure
 * no embedded ANSI codes can disrupt the line background envelope
 *
 * @param text - Text content with ANSI sequences
 * @returns Text with background parameters removed from all sequences
 *
 * @example
 * stabilizeBackgroundResets("\x1b[1;42;32mtext\x1b[0m");
 * // "\x1b[1;32mtext\x1b[39;22;23;24;25;27;28;29;59m"
 * // (removes 42 green bg, replaces 0 with safe reset)
 */
export function stabilizeBackgroundResets(text: string): string {
	return text.replace(ANSI_SGR_PATTERN, (match, rawParams) => {
		const params = toSgrParams(rawParams);
		const stripped = stripBackgroundResetParams(params);

		// If all parameters were stripped, remove the sequence entirely
		if (stripped.length === 0) {
			return "";
		}

		// Reconstruct the sequence with sanitized parameters
		return `\x1b[${stripped.join(";")}m`;
	});
}
