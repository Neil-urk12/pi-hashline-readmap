/**
 * Unit tests for presentation mode resolution
 *
 * Tests Requirements: 3.10, 7.5
 */

import { describe, it, expect } from "vitest";
import {
  resolvePresentationMode,
  canRenderSplitLayout,
} from "../src/diff-presentation";
import type { DiffConfig } from "../src/diff-types";

describe("canRenderSplitLayout", () => {
  it("should return true when width >= diffSplitMinWidth", () => {
    // Requirement 7.5: Check if width >= diffSplitMinWidth
    const config: DiffConfig = {
      diffInlineHighlights: true,
      diffWordWrap: true,
      diffIndicatorMode: "bars",
      diffViewMode: "auto",
      diffSplitMinWidth: 120,
    };

    expect(canRenderSplitLayout(120, config)).toBe(true);
    expect(canRenderSplitLayout(150, config)).toBe(true);
  });

  it("should return false when width < diffSplitMinWidth", () => {
    // Requirement 7.5: Check if width >= diffSplitMinWidth
    const config: DiffConfig = {
      diffInlineHighlights: true,
      diffWordWrap: true,
      diffIndicatorMode: "bars",
      diffViewMode: "auto",
      diffSplitMinWidth: 120,
    };

    expect(canRenderSplitLayout(119, config)).toBe(false);
    expect(canRenderSplitLayout(80, config)).toBe(false);
  });

  it("should respect custom diffSplitMinWidth", () => {
    // Requirement 7.5: Check if width >= diffSplitMinWidth
    const config: DiffConfig = {
      diffInlineHighlights: true,
      diffWordWrap: true,
      diffIndicatorMode: "bars",
      diffViewMode: "auto",
      diffSplitMinWidth: 100,
    };

    expect(canRenderSplitLayout(100, config)).toBe(true);
    expect(canRenderSplitLayout(99, config)).toBe(false);
  });
});

describe("resolvePresentationMode", () => {
  const defaultConfig: DiffConfig = {
    diffInlineHighlights: true,
    diffWordWrap: true,
    diffIndicatorMode: "bars",
    diffViewMode: "auto",
    diffSplitMinWidth: 120,
  };

  describe("width thresholds", () => {
    it("should resolve to summary when width < 8", () => {
      // Requirement 3.10: Width < 8 → summary
      expect(resolvePresentationMode(0, defaultConfig)).toBe("summary");
      expect(resolvePresentationMode(7, defaultConfig)).toBe("summary");
    });

    it("should resolve to compact when width < 18", () => {
      // Requirement 3.10: Width < 18 → compact
      expect(resolvePresentationMode(8, defaultConfig)).toBe("compact");
      expect(resolvePresentationMode(17, defaultConfig)).toBe("compact");
    });

    it("should resolve to unified or split when width >= 18", () => {
      // Requirement 3.10: Width >= 18 → unified/split
      const result = resolvePresentationMode(18, defaultConfig);
      expect(["unified", "split"]).toContain(result);
    });
  });

  describe("auto mode", () => {
    it("should resolve to unified when width >= 18 but < diffSplitMinWidth", () => {
      // Requirement 3.10: Auto mode with insufficient width for split
      const config: DiffConfig = {
        ...defaultConfig,
        diffViewMode: "auto",
      };

      expect(resolvePresentationMode(18, config)).toBe("unified");
      expect(resolvePresentationMode(80, config)).toBe("unified");
      expect(resolvePresentationMode(119, config)).toBe("unified");
    });

    it("should resolve to split when width >= diffSplitMinWidth", () => {
      // Requirement 3.10: Auto mode with sufficient width for split
      const config: DiffConfig = {
        ...defaultConfig,
        diffViewMode: "auto",
      };

      expect(resolvePresentationMode(120, config)).toBe("split");
      expect(resolvePresentationMode(150, config)).toBe("split");
    });
  });

  describe("explicit unified mode", () => {
    it("should resolve to unified when width >= 18", () => {
      // Requirement 3.10: Explicit unified mode selection
      const config: DiffConfig = {
        ...defaultConfig,
        diffViewMode: "unified",
      };

      expect(resolvePresentationMode(18, config)).toBe("unified");
      expect(resolvePresentationMode(80, config)).toBe("unified");
      expect(resolvePresentationMode(120, config)).toBe("unified");
      expect(resolvePresentationMode(150, config)).toBe("unified");
    });

    it("should fall back to compact when width < 18", () => {
      // Requirement 3.10: Fall back when width insufficient
      const config: DiffConfig = {
        ...defaultConfig,
        diffViewMode: "unified",
      };

      expect(resolvePresentationMode(17, config)).toBe("compact");
      expect(resolvePresentationMode(10, config)).toBe("compact");
    });

    it("should fall back to summary when width < 8", () => {
      // Requirement 3.10: Fall back when width insufficient
      const config: DiffConfig = {
        ...defaultConfig,
        diffViewMode: "unified",
      };

      expect(resolvePresentationMode(7, config)).toBe("summary");
      expect(resolvePresentationMode(0, config)).toBe("summary");
    });
  });

  describe("explicit split mode", () => {
    it("should resolve to split when width >= diffSplitMinWidth", () => {
      // Requirement 3.10: Explicit split mode selection
      const config: DiffConfig = {
        ...defaultConfig,
        diffViewMode: "split",
      };

      expect(resolvePresentationMode(120, config)).toBe("split");
      expect(resolvePresentationMode(150, config)).toBe("split");
    });

    it("should fall back to unified when width >= 18 but < diffSplitMinWidth", () => {
      // Requirement 3.10: Fall back to unified when split not possible
      const config: DiffConfig = {
        ...defaultConfig,
        diffViewMode: "split",
      };

      expect(resolvePresentationMode(18, config)).toBe("unified");
      expect(resolvePresentationMode(80, config)).toBe("unified");
      expect(resolvePresentationMode(119, config)).toBe("unified");
    });

    it("should fall back to compact when width < 18", () => {
      // Requirement 3.10: Fall back when width insufficient
      const config: DiffConfig = {
        ...defaultConfig,
        diffViewMode: "split",
      };

      expect(resolvePresentationMode(17, config)).toBe("compact");
      expect(resolvePresentationMode(10, config)).toBe("compact");
    });

    it("should fall back to summary when width < 8", () => {
      // Requirement 3.10: Fall back when width insufficient
      const config: DiffConfig = {
        ...defaultConfig,
        diffViewMode: "split",
      };

      expect(resolvePresentationMode(7, config)).toBe("summary");
      expect(resolvePresentationMode(0, config)).toBe("summary");
    });
  });

  describe("custom diffSplitMinWidth", () => {
    it("should respect custom split min width in auto mode", () => {
      // Requirement 7.5: Custom diffSplitMinWidth
      const config: DiffConfig = {
        ...defaultConfig,
        diffViewMode: "auto",
        diffSplitMinWidth: 100,
      };

      expect(resolvePresentationMode(99, config)).toBe("unified");
      expect(resolvePresentationMode(100, config)).toBe("split");
    });

    it("should respect custom split min width in split mode", () => {
      // Requirement 7.5: Custom diffSplitMinWidth
      const config: DiffConfig = {
        ...defaultConfig,
        diffViewMode: "split",
        diffSplitMinWidth: 100,
      };

      expect(resolvePresentationMode(99, config)).toBe("unified");
      expect(resolvePresentationMode(100, config)).toBe("split");
    });
  });

  describe("edge cases", () => {
    it("should handle exact threshold boundaries", () => {
      // Test exact boundary values
      expect(resolvePresentationMode(8, defaultConfig)).toBe("compact");
      expect(resolvePresentationMode(18, defaultConfig)).toBe("unified");
      expect(resolvePresentationMode(120, defaultConfig)).toBe("split");
    });

    it("should handle very large widths", () => {
      // Test large terminal widths
      expect(resolvePresentationMode(500, defaultConfig)).toBe("split");
    });

    it("should handle very small widths", () => {
      // Test very small terminal widths
      expect(resolvePresentationMode(1, defaultConfig)).toBe("summary");
    });
  });
});
