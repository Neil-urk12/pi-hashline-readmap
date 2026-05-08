/**
 * Configuration system for diff rendering
 *
 * This module manages diff rendering settings by:
 * - Defining default configuration values
 * - Reading environment variable overrides
 * - Validating environment variable values
 * - Providing validated configuration to renderers
 *
 * Environment Variables:
 * - PI_HASHLINE_DIFF_INLINE_HIGHLIGHTS: "true" or "false" (case-insensitive)
 * - PI_HASHLINE_DIFF_WORD_WRAP: "true" or "false" (case-insensitive)
 * - PI_HASHLINE_DIFF_INDICATOR_MODE: "bars", "classic", or "none"
 * - PI_HASHLINE_DIFF_VIEW_MODE: "auto", "split", or "unified"
 * - PI_HASHLINE_DIFF_SPLIT_MIN_WIDTH: positive integer (default: 120)
 */

import type { DiffConfig } from "./diff-types.js";

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: DiffConfig = {
  diffInlineHighlights: true,
  diffWordWrap: true,
  diffIndicatorMode: "bars",
  diffViewMode: "auto",
  diffSplitMinWidth: 120,
};

/**
 * Validates a boolean environment variable
 *
 * @param name - Environment variable name (for logging)
 * @param value - Environment variable value (undefined if not set)
 * @param defaultValue - Default value to use if validation fails
 * @returns Validated boolean value
 */
export function validateBooleanEnvVar(
  name: string,
  value: string | undefined,
  defaultValue: boolean
): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  const normalized = value.toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }

  console.warn(
    `[diff-config] Invalid value for ${name}: "${value}". Expected "true" or "false". Using default: ${defaultValue}`
  );
  return defaultValue;
}

/**
 * Validates the diffIndicatorMode environment variable
 *
 * @param value - Environment variable value (undefined if not set)
 * @returns Validated indicator mode
 */
function validateIndicatorMode(
  value: string | undefined
): "bars" | "classic" | "none" {
  if (value === undefined) {
    return DEFAULT_CONFIG.diffIndicatorMode;
  }

  if (value === "bars" || value === "classic" || value === "none") {
    return value;
  }

  console.warn(
    `[diff-config] Invalid value for PI_HASHLINE_DIFF_INDICATOR_MODE: "${value}". Expected "bars", "classic", or "none". Using default: "${DEFAULT_CONFIG.diffIndicatorMode}"`
  );
  return DEFAULT_CONFIG.diffIndicatorMode;
}

/**
 * Validates the diffViewMode environment variable
 *
 * @param value - Environment variable value (undefined if not set)
 * @returns Validated view mode
 */
function validateViewMode(
  value: string | undefined
): "auto" | "split" | "unified" {
  if (value === undefined) {
    return DEFAULT_CONFIG.diffViewMode;
  }

  if (value === "auto" || value === "split" || value === "unified") {
    return value;
  }

  console.warn(
    `[diff-config] Invalid value for PI_HASHLINE_DIFF_VIEW_MODE: "${value}". Expected "auto", "split", or "unified". Using default: "${DEFAULT_CONFIG.diffViewMode}"`
  );
  return DEFAULT_CONFIG.diffViewMode;
}

/**
 * Validates the diffSplitMinWidth environment variable
 *
 * @param value - Environment variable value (undefined if not set)
 * @returns Validated split min width (positive integer)
 */
function validateSplitMinWidth(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_CONFIG.diffSplitMinWidth;
  }

  const parsed = parseInt(value, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  console.warn(
    `[diff-config] Invalid value for PI_HASHLINE_DIFF_SPLIT_MIN_WIDTH: "${value}". Expected positive integer. Using default: ${DEFAULT_CONFIG.diffSplitMinWidth}`
  );
  return DEFAULT_CONFIG.diffSplitMinWidth;
}

/**
 * Loads diff configuration from environment variables
 *
 * Reads configuration from environment variables with validation.
 * Invalid values are logged as warnings and fall back to defaults.
 *
 * @returns Validated diff configuration
 */
export function loadDiffConfig(): DiffConfig {
  return {
    diffInlineHighlights: validateBooleanEnvVar(
      "PI_HASHLINE_DIFF_INLINE_HIGHLIGHTS",
      process.env.PI_HASHLINE_DIFF_INLINE_HIGHLIGHTS,
      DEFAULT_CONFIG.diffInlineHighlights
    ),
    diffWordWrap: validateBooleanEnvVar(
      "PI_HASHLINE_DIFF_WORD_WRAP",
      process.env.PI_HASHLINE_DIFF_WORD_WRAP,
      DEFAULT_CONFIG.diffWordWrap
    ),
    diffIndicatorMode: validateIndicatorMode(
      process.env.PI_HASHLINE_DIFF_INDICATOR_MODE
    ),
    diffViewMode: validateViewMode(process.env.PI_HASHLINE_DIFF_VIEW_MODE),
    diffSplitMinWidth: validateSplitMinWidth(
      process.env.PI_HASHLINE_DIFF_SPLIT_MIN_WIDTH
    ),
  };
}
