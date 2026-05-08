/**
 * Unit tests for terminal width detection
 *
 * Tests Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getTerminalWidth } from "../src/terminal-width";

describe("getTerminalWidth", () => {
  let originalColumns: number | undefined;
  let originalEnvColumns: string | undefined;

  beforeEach(() => {
    // Save original values
    originalColumns = process.stdout.columns;
    originalEnvColumns = process.env.COLUMNS;
  });

  afterEach(() => {
    // Restore original values
    if (originalColumns !== undefined) {
      process.stdout.columns = originalColumns;
    } else {
      delete (process.stdout as any).columns;
    }

    if (originalEnvColumns !== undefined) {
      process.env.COLUMNS = originalEnvColumns;
    } else {
      delete process.env.COLUMNS;
    }
  });

  it("should read from process.stdout.columns when available", () => {
    // Requirement 9.1: Read process.stdout.columns as primary source
    process.stdout.columns = 80;
    delete process.env.COLUMNS;

    expect(getTerminalWidth()).toBe(80);
  });

  it("should fall back to process.env.COLUMNS when stdout unavailable", () => {
    // Requirement 9.3: Fall back to process.env.COLUMNS when stdout unavailable
    delete (process.stdout as any).columns;
    process.env.COLUMNS = "100";

    expect(getTerminalWidth()).toBe(100);
  });

  it("should fall back to 120 when both sources unavailable", () => {
    // Requirement 9.2: Fall back to 120 when both unavailable
    delete (process.stdout as any).columns;
    delete process.env.COLUMNS;

    expect(getTerminalWidth()).toBe(120);
  });

  it("should handle undefined process.stdout.columns", () => {
    // Requirement 9.4: Handle undefined values
    delete (process.stdout as any).columns;
    process.env.COLUMNS = "90";

    expect(getTerminalWidth()).toBe(90);
  });

  it("should handle non-finite process.stdout.columns", () => {
    // Requirement 9.4: Handle non-finite values
    (process.stdout as any).columns = NaN;
    process.env.COLUMNS = "110";

    expect(getTerminalWidth()).toBe(110);
  });

  it("should handle invalid process.env.COLUMNS", () => {
    // Requirement 9.4: Handle invalid values
    delete (process.stdout as any).columns;
    process.env.COLUMNS = "invalid";

    expect(getTerminalWidth()).toBe(120);
  });

  it("should handle negative process.env.COLUMNS", () => {
    // Requirement 9.4: Handle invalid values
    delete (process.stdout as any).columns;
    process.env.COLUMNS = "-50";

    expect(getTerminalWidth()).toBe(120);
  });

  it("should return positive integer", () => {
    // Requirement 9.5: Return positive integer
    process.stdout.columns = 150;

    const width = getTerminalWidth();
    expect(width).toBeGreaterThan(0);
    expect(Number.isInteger(width)).toBe(true);
  });

  it("should prefer stdout.columns over env.COLUMNS", () => {
    // Requirement 9.1: stdout.columns is primary source
    process.stdout.columns = 80;
    process.env.COLUMNS = "100";

    expect(getTerminalWidth()).toBe(80);
  });

  it("should handle zero in process.env.COLUMNS", () => {
    // Requirement 9.4: Handle invalid values (zero is not positive)
    delete (process.stdout as any).columns;
    process.env.COLUMNS = "0";

    expect(getTerminalWidth()).toBe(120);
  });
});
