/**
 * Unit tests for line width safety utilities.
 * 
 * Tests width normalization, clamping, and truncation behavior with:
 * - ANSI sequences
 * - Wide Unicode characters
 * - Edge cases (empty strings, zero width, negative width)
 */

import { describe, it, expect } from "vitest";
import { visibleWidth } from "@mariozechner/pi-tui";
import {
  normalizeDiffRenderWidth,
  clampRenderedLineToWidth,
  clampRenderedLinesToWidth,
  MIN_UNIFIED_DIFF_WIDTH,
  MIN_COMPACT_DIFF_WIDTH,
} from "../src/line-width-safety.js";

describe("normalizeDiffRenderWidth", () => {
  it("should return positive integers unchanged", () => {
    expect(normalizeDiffRenderWidth(80)).toBe(80);
    expect(normalizeDiffRenderWidth(120)).toBe(120);
    expect(normalizeDiffRenderWidth(1)).toBe(1);
  });

  it("should floor fractional widths", () => {
    expect(normalizeDiffRenderWidth(80.9)).toBe(80);
    expect(normalizeDiffRenderWidth(120.1)).toBe(120);
    expect(normalizeDiffRenderWidth(1.5)).toBe(1);
  });

  it("should clamp negative widths to 0", () => {
    expect(normalizeDiffRenderWidth(-1)).toBe(0);
    expect(normalizeDiffRenderWidth(-100)).toBe(0);
  });

  it("should handle zero width", () => {
    expect(normalizeDiffRenderWidth(0)).toBe(0);
  });

  it("should handle very large widths", () => {
    expect(normalizeDiffRenderWidth(10000)).toBe(10000);
  });
});

describe("clampRenderedLineToWidth", () => {
  it("should return line unchanged if it fits within width", () => {
    const line = "Hello, world!";
    expect(clampRenderedLineToWidth(line, 20)).toBe(line);
    expect(clampRenderedLineToWidth(line, 13)).toBe(line);
  });

  it("should truncate line if it exceeds width", () => {
    const line = "Hello, world! This is a long line.";
    const result = clampRenderedLineToWidth(line, 10);
    // Check visible width, not string length
    expect(visibleWidth(result)).toBeLessThanOrEqual(10);
  });

  it("should handle ANSI sequences correctly", () => {
    // ANSI codes don't count toward visible width
    const line = "\x1b[32mGreen text\x1b[0m";
    const result = clampRenderedLineToWidth(line, 10);
    // "Green text" is exactly 10 characters, should fit
    expect(result).toContain("Green text");
  });

  it("should handle ANSI sequences when truncating", () => {
    const line = "\x1b[32mThis is a very long green text line\x1b[0m";
    const result = clampRenderedLineToWidth(line, 10);
    // Should truncate to ~10 visible characters
    expect(result).toContain("\x1b[32m"); // Should preserve ANSI codes
  });

  it("should handle wide Unicode characters (emoji)", () => {
    // Emoji typically take 2 columns in terminal
    const line = "Hello 👋 World";
    const result = clampRenderedLineToWidth(line, 10);
    // The emoji counts as 2 columns, so result should fit in 10 columns
    expect(visibleWidth(result)).toBeLessThanOrEqual(10);
  });

  it("should handle wide Unicode characters (CJK)", () => {
    // CJK characters typically take 2 columns
    const line = "Hello 世界";
    const result = clampRenderedLineToWidth(line, 8);
    // Result should fit in 8 columns
    expect(visibleWidth(result)).toBeLessThanOrEqual(8);
  });

  it("should handle zero width by returning empty string", () => {
    const line = "Hello, world!";
    expect(clampRenderedLineToWidth(line, 0)).toBe("");
  });

  it("should handle negative width by returning empty string", () => {
    const line = "Hello, world!";
    expect(clampRenderedLineToWidth(line, -5)).toBe("");
  });

  it("should handle empty string", () => {
    expect(clampRenderedLineToWidth("", 10)).toBe("");
  });

  it("should handle complex ANSI with backgrounds", () => {
    // Line with foreground and background colors
    const line = "\x1b[32m\x1b[48;2;50;50;50mColored text with background\x1b[0m";
    const result = clampRenderedLineToWidth(line, 15);
    expect(result).toContain("\x1b["); // Should preserve some ANSI codes
  });

  it("should handle mixed ANSI and wide characters", () => {
    const line = "\x1b[32m世界\x1b[0m Hello";
    const result = clampRenderedLineToWidth(line, 8);
    // Result should fit in 8 columns
    expect(visibleWidth(result)).toBeLessThanOrEqual(8);
  });

  it("should use empty ellipsis (no ... suffix)", () => {
    const line = "This is a very long line that needs truncation";
    const result = clampRenderedLineToWidth(line, 10);
    // Should not end with "..."
    expect(result).not.toMatch(/\.\.\.$/);
  });
});

describe("clampRenderedLinesToWidth", () => {
  it("should clamp all lines in array", () => {
    const lines = [
      "Short",
      "This is a longer line",
      "Another long line here",
    ];
    const result = clampRenderedLinesToWidth(lines, 10);
    expect(result).toHaveLength(3);
    result.forEach(line => {
      expect(visibleWidth(line)).toBeLessThanOrEqual(10);
    });
  });

  it("should handle empty array", () => {
    expect(clampRenderedLinesToWidth([], 10)).toEqual([]);
  });

  it("should handle array with ANSI sequences", () => {
    const lines = [
      "\x1b[32mGreen line\x1b[0m",
      "\x1b[31mRed line that is very long\x1b[0m",
    ];
    const result = clampRenderedLinesToWidth(lines, 10);
    expect(result).toHaveLength(2);
  });

  it("should handle array with wide characters", () => {
    const lines = [
      "Hello 世界",
      "Another 世界 line",
    ];
    const result = clampRenderedLinesToWidth(lines, 10);
    expect(result).toHaveLength(2);
  });

  it("should preserve lines that already fit", () => {
    const lines = [
      "Short",
      "OK",
      "Fine",
    ];
    const result = clampRenderedLinesToWidth(lines, 20);
    expect(result).toEqual(lines);
  });
});

describe("minimum width constants", () => {
  it("should define MIN_UNIFIED_DIFF_WIDTH as 18", () => {
    expect(MIN_UNIFIED_DIFF_WIDTH).toBe(18);
  });

  it("should define MIN_COMPACT_DIFF_WIDTH as 8", () => {
    expect(MIN_COMPACT_DIFF_WIDTH).toBe(8);
  });

  it("should have MIN_UNIFIED_DIFF_WIDTH > MIN_COMPACT_DIFF_WIDTH", () => {
    expect(MIN_UNIFIED_DIFF_WIDTH).toBeGreaterThan(MIN_COMPACT_DIFF_WIDTH);
  });
});
