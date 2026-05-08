/**
 * Diff configuration: view mode, indicator style, split width threshold, word wrap.
 * Resolved from environment variables and defaults.
 */

import type { DiffConfig, DiffViewMode, DiffIndicatorMode } from "./diff-types.js";

const DEFAULT_DIFF_CONFIG: DiffConfig = {
  diffViewMode: "auto",
  diffIndicatorMode: "bars",
  diffSplitMinWidth: 120,
  diffWordWrap: true,
};

function coerceViewMode(value: unknown): DiffViewMode | undefined {
  if (typeof value !== "string") return undefined;
  if (["auto", "split", "unified"].includes(value)) return value as DiffViewMode;
  return undefined;
}

function coerceIndicatorMode(value: unknown): DiffIndicatorMode | undefined {
  if (typeof value !== "string") return undefined;
  if (["bars", "classic", "none"].includes(value)) return value as DiffIndicatorMode;
  return undefined;
}

function coerceNumber(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

function coerceBoolean(value: unknown): boolean | undefined {
  if (typeof value !== "string") return undefined;
  const lowered = value.toLowerCase();
  if (lowered === "true" || lowered === "1") return true;
  if (lowered === "false" || lowered === "0") return false;
  return undefined;
}

/**
 * Resolve the effective diff configuration by merging env vars over defaults.
 * Called once at startup (edit tool registration) or on demand.
 */
export function resolveDiffConfig(): DiffConfig {
  const env = process.env;

  const viewMode = coerceViewMode(env.PI_HASHLINE_DIFF_VIEW_MODE);
  const indicatorMode = coerceIndicatorMode(env.PI_HASHLINE_DIFF_INDICATOR);
  const splitMinWidth = coerceNumber(env.PI_HASHLINE_DIFF_SPLIT_MIN_WIDTH);
  const wordWrap = coerceBoolean(env.PI_HASHLINE_DIFF_WORD_WRAP);

  const config: DiffConfig = { ...DEFAULT_DIFF_CONFIG };

  if (viewMode !== undefined) config.diffViewMode = viewMode;
  if (indicatorMode !== undefined) config.diffIndicatorMode = indicatorMode;
  if (splitMinWidth !== undefined) config.diffSplitMinWidth = splitMinWidth;
  if (wordWrap !== undefined) config.diffWordWrap = wordWrap;

  return config;
}

/** Export default for reference */
export { DEFAULT_DIFF_CONFIG };
