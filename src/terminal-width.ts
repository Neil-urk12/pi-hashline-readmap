/**
 * Terminal width detection across environments.
 * Checks process.stdout.columns, then COLUMNS env var, falls back to 120.
 * Exports setTerminalWidth for test overrides.
 */

let overrideWidth: number | null = null;

/** Get the effective terminal width in columns. */
export function getTerminalWidth(): number {
  if (overrideWidth !== null) return overrideWidth;
  const fromProcess = typeof process !== "undefined" && process.stdout?.columns
    ? process.stdout.columns
    : undefined;
  if (typeof fromProcess === "number" && fromProcess > 0) return fromProcess;
  const fromEnv = Number(process.env.COLUMNS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return 120;
}

/** Set an override width (for tests or programmatic control). Clears with null. */
export function setTerminalWidth(width: number | null): void {
  overrideWidth = width;
}

/** Reset to default detection (clear any override). */
export function resetTerminalWidth(): void {
  overrideWidth = null;
}
