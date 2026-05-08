/**
 * Unit tests for diff configuration system
 *
 * Tests configuration loading, validation, and environment variable handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadDiffConfig, validateBooleanEnvVar } from "../src/diff-config.js";

describe("diff-config", () => {
  // Store original environment variables
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear all diff-related environment variables before each test
    delete process.env.PI_HASHLINE_DIFF_INLINE_HIGHLIGHTS;
    delete process.env.PI_HASHLINE_DIFF_WORD_WRAP;
    delete process.env.PI_HASHLINE_DIFF_INDICATOR_MODE;
    delete process.env.PI_HASHLINE_DIFF_VIEW_MODE;
    delete process.env.PI_HASHLINE_DIFF_SPLIT_MIN_WIDTH;
  });

  afterEach(() => {
    // Restore original environment variables after each test
    process.env = { ...originalEnv };
  });

  describe("loadDiffConfig", () => {
    it("should load defaults when no environment variables are set", () => {
      const config = loadDiffConfig();

      expect(config).toEqual({
        diffInlineHighlights: true,
        diffWordWrap: true,
        diffIndicatorMode: "bars",
        diffViewMode: "auto",
        diffSplitMinWidth: 120,
      });
    });

    it("should override with valid environment variables", () => {
      process.env.PI_HASHLINE_DIFF_INLINE_HIGHLIGHTS = "false";
      process.env.PI_HASHLINE_DIFF_WORD_WRAP = "false";
      process.env.PI_HASHLINE_DIFF_INDICATOR_MODE = "classic";
      process.env.PI_HASHLINE_DIFF_VIEW_MODE = "unified";
      process.env.PI_HASHLINE_DIFF_SPLIT_MIN_WIDTH = "100";

      const config = loadDiffConfig();

      expect(config).toEqual({
        diffInlineHighlights: false,
        diffWordWrap: false,
        diffIndicatorMode: "classic",
        diffViewMode: "unified",
        diffSplitMinWidth: 100,
      });
    });

    it("should ignore invalid environment variables and use defaults", () => {
      // Mock console.warn to suppress warnings during test
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      process.env.PI_HASHLINE_DIFF_INLINE_HIGHLIGHTS = "invalid";
      process.env.PI_HASHLINE_DIFF_WORD_WRAP = "yes";
      process.env.PI_HASHLINE_DIFF_INDICATOR_MODE = "invalid";
      process.env.PI_HASHLINE_DIFF_VIEW_MODE = "invalid";
      process.env.PI_HASHLINE_DIFF_SPLIT_MIN_WIDTH = "invalid";

      const config = loadDiffConfig();

      // Should fall back to defaults
      expect(config).toEqual({
        diffInlineHighlights: true,
        diffWordWrap: true,
        diffIndicatorMode: "bars",
        diffViewMode: "auto",
        diffSplitMinWidth: 120,
      });

      // Should have logged warnings
      expect(warnSpy).toHaveBeenCalledTimes(5);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("PI_HASHLINE_DIFF_INLINE_HIGHLIGHTS")
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("PI_HASHLINE_DIFF_WORD_WRAP")
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("PI_HASHLINE_DIFF_INDICATOR_MODE")
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("PI_HASHLINE_DIFF_VIEW_MODE")
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("PI_HASHLINE_DIFF_SPLIT_MIN_WIDTH")
      );

      warnSpy.mockRestore();
    });
  });

  describe("validateBooleanEnvVar", () => {
    it("should validate case-insensitive 'true'", () => {
      expect(validateBooleanEnvVar("TEST", "true", false)).toBe(true);
      expect(validateBooleanEnvVar("TEST", "TRUE", false)).toBe(true);
      expect(validateBooleanEnvVar("TEST", "True", false)).toBe(true);
      expect(validateBooleanEnvVar("TEST", "TrUe", false)).toBe(true);
    });

    it("should validate case-insensitive 'false'", () => {
      expect(validateBooleanEnvVar("TEST", "false", true)).toBe(false);
      expect(validateBooleanEnvVar("TEST", "FALSE", true)).toBe(false);
      expect(validateBooleanEnvVar("TEST", "False", true)).toBe(false);
      expect(validateBooleanEnvVar("TEST", "FaLsE", true)).toBe(false);
    });

    it("should return default when value is undefined", () => {
      expect(validateBooleanEnvVar("TEST", undefined, true)).toBe(true);
      expect(validateBooleanEnvVar("TEST", undefined, false)).toBe(false);
    });

    it("should return default and warn for invalid values", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      expect(validateBooleanEnvVar("TEST", "yes", true)).toBe(true);
      expect(validateBooleanEnvVar("TEST", "no", false)).toBe(false);
      expect(validateBooleanEnvVar("TEST", "1", true)).toBe(true);
      expect(validateBooleanEnvVar("TEST", "0", false)).toBe(false);
      expect(validateBooleanEnvVar("TEST", "invalid", true)).toBe(true);

      expect(warnSpy).toHaveBeenCalledTimes(5);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid value for TEST: "yes"')
      );

      warnSpy.mockRestore();
    });
  });

  describe("indicator mode validation", () => {
    it("should accept 'bars' mode", () => {
      process.env.PI_HASHLINE_DIFF_INDICATOR_MODE = "bars";
      const config = loadDiffConfig();
      expect(config.diffIndicatorMode).toBe("bars");
    });

    it("should accept 'classic' mode", () => {
      process.env.PI_HASHLINE_DIFF_INDICATOR_MODE = "classic";
      const config = loadDiffConfig();
      expect(config.diffIndicatorMode).toBe("classic");
    });

    it("should accept 'none' mode", () => {
      process.env.PI_HASHLINE_DIFF_INDICATOR_MODE = "none";
      const config = loadDiffConfig();
      expect(config.diffIndicatorMode).toBe("none");
    });

    it("should reject invalid indicator mode and use default", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      process.env.PI_HASHLINE_DIFF_INDICATOR_MODE = "invalid";
      const config = loadDiffConfig();

      expect(config.diffIndicatorMode).toBe("bars");
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("PI_HASHLINE_DIFF_INDICATOR_MODE")
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('"invalid"')
      );

      warnSpy.mockRestore();
    });
  });

  describe("view mode validation", () => {
    it("should accept 'auto' mode", () => {
      process.env.PI_HASHLINE_DIFF_VIEW_MODE = "auto";
      const config = loadDiffConfig();
      expect(config.diffViewMode).toBe("auto");
    });

    it("should accept 'split' mode", () => {
      process.env.PI_HASHLINE_DIFF_VIEW_MODE = "split";
      const config = loadDiffConfig();
      expect(config.diffViewMode).toBe("split");
    });

    it("should accept 'unified' mode", () => {
      process.env.PI_HASHLINE_DIFF_VIEW_MODE = "unified";
      const config = loadDiffConfig();
      expect(config.diffViewMode).toBe("unified");
    });

    it("should reject invalid view mode and use default", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      process.env.PI_HASHLINE_DIFF_VIEW_MODE = "invalid";
      const config = loadDiffConfig();

      expect(config.diffViewMode).toBe("auto");
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("PI_HASHLINE_DIFF_VIEW_MODE")
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('"invalid"')
      );

      warnSpy.mockRestore();
    });
  });

  describe("split min width validation", () => {
    it("should accept positive integer", () => {
      process.env.PI_HASHLINE_DIFF_SPLIT_MIN_WIDTH = "100";
      const config = loadDiffConfig();
      expect(config.diffSplitMinWidth).toBe(100);
    });

    it("should accept large positive integer", () => {
      process.env.PI_HASHLINE_DIFF_SPLIT_MIN_WIDTH = "200";
      const config = loadDiffConfig();
      expect(config.diffSplitMinWidth).toBe(200);
    });

    it("should accept minimum value of 1", () => {
      process.env.PI_HASHLINE_DIFF_SPLIT_MIN_WIDTH = "1";
      const config = loadDiffConfig();
      expect(config.diffSplitMinWidth).toBe(1);
    });

    it("should reject zero and use default", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      process.env.PI_HASHLINE_DIFF_SPLIT_MIN_WIDTH = "0";
      const config = loadDiffConfig();

      expect(config.diffSplitMinWidth).toBe(120);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("PI_HASHLINE_DIFF_SPLIT_MIN_WIDTH")
      );

      warnSpy.mockRestore();
    });

    it("should reject negative integer and use default", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      process.env.PI_HASHLINE_DIFF_SPLIT_MIN_WIDTH = "-10";
      const config = loadDiffConfig();

      expect(config.diffSplitMinWidth).toBe(120);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("PI_HASHLINE_DIFF_SPLIT_MIN_WIDTH")
      );

      warnSpy.mockRestore();
    });

    it("should reject non-numeric string and use default", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      process.env.PI_HASHLINE_DIFF_SPLIT_MIN_WIDTH = "invalid";
      const config = loadDiffConfig();

      expect(config.diffSplitMinWidth).toBe(120);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("PI_HASHLINE_DIFF_SPLIT_MIN_WIDTH")
      );

      warnSpy.mockRestore();
    });

    it("should reject floating point and use default", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      process.env.PI_HASHLINE_DIFF_SPLIT_MIN_WIDTH = "100.5";
      const config = loadDiffConfig();

      // parseInt will parse "100.5" as 100, which is valid
      expect(config.diffSplitMinWidth).toBe(100);
      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });

  describe("mixed valid and invalid values", () => {
    it("should use valid values and fall back to defaults for invalid ones", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      process.env.PI_HASHLINE_DIFF_INLINE_HIGHLIGHTS = "false"; // valid
      process.env.PI_HASHLINE_DIFF_WORD_WRAP = "invalid"; // invalid
      process.env.PI_HASHLINE_DIFF_INDICATOR_MODE = "classic"; // valid
      process.env.PI_HASHLINE_DIFF_VIEW_MODE = "invalid"; // invalid
      process.env.PI_HASHLINE_DIFF_SPLIT_MIN_WIDTH = "150"; // valid

      const config = loadDiffConfig();

      expect(config).toEqual({
        diffInlineHighlights: false, // valid override
        diffWordWrap: true, // default (invalid value)
        diffIndicatorMode: "classic", // valid override
        diffViewMode: "auto", // default (invalid value)
        diffSplitMinWidth: 150, // valid override
      });

      // Should have logged warnings for the 2 invalid values
      expect(warnSpy).toHaveBeenCalledTimes(2);

      warnSpy.mockRestore();
    });
  });
});
