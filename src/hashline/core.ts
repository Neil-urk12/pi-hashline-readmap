/**
 * Hash core — xxhash-backed 3-char line hash + display format.
 *
 * Vendored & adapted from oh-my-pi (MIT, github.com/can1357/oh-my-pi).
 *
 * Owns the global hash WASM singleton (`ensureHashInit`) so the same
 * instance is reused across the module graph, including under dual-module
 * loading on Windows.
 */
import xxhashWasm from "xxhash-wasm";

/** Canonical line-hash length (3 hex chars). Exported for siblings that build hash-aware regexes. */
export const HASHLINE_HASH_LEN = 3;
const RADIX = 16;
const HASH_MOD = RADIX ** HASHLINE_HASH_LEN;
const DICT = Array.from({ length: HASH_MOD }, (_, i) =>
	i.toString(RADIX).padStart(HASHLINE_HASH_LEN, "0"),
);

/** `LINE:HASH|` prefix; consumed by refs and paste-detect. */
export const HASHLINE_PREFIX_RE = /^\d+:[0-9a-zA-Z]{1,16}\|/;

interface HashlineGlobalState {
	h32Fn: ((input: string, seed: number) => number) | null;
	initPromise: Promise<void> | null;
}

const HASHLINE_STATE_KEY = Symbol.for("pi-hashline-readmap.hashlineState.v1");

function getHashlineState(): HashlineGlobalState {
	const g = globalThis as unknown as Record<symbol, HashlineGlobalState | undefined>;
	let state = g[HASHLINE_STATE_KEY];
	if (!state) {
		state = { h32Fn: null, initPromise: null };
		g[HASHLINE_STATE_KEY] = state;
	}
	return state;
}

export async function ensureHashInit(): Promise<void> {
	const state = getHashlineState();
	if (state.h32Fn) return;
	if (!state.initPromise) {
		state.initPromise = xxhashWasm().then((hasher) => {
			state.h32Fn = hasher.h32;
		});
	}
	await state.initPromise;
}

function xxh32(input: string): number {
	const state = getHashlineState();
	if (!state.h32Fn) throw new Error("Hash not initialized — call ensureHashInit() first");
	return state.h32Fn(input, 0) >>> 0;
}

export function computeLineHash(_idx: number, line: string): string {
	if (line.endsWith("\r")) line = line.slice(0, -1);
	line = line.replace(/\s+/g, "");
	return DICT[xxh32(line) % HASH_MOD];
}

const DISPLAY_CONTROL_CHAR_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g;

export function escapeControlCharsForDisplay(text: string): string {
	return text.replace(DISPLAY_CONTROL_CHAR_RE, (ch) => {
		return `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`;
	});
}

export function formatHashlineDisplay(lineNumber: number, content: string): string {
	return `${lineNumber}:${computeLineHash(lineNumber, content)}|${escapeControlCharsForDisplay(content)}`;
}

export function hashLine(lineNumber: number, content: string): string {
	return formatHashlineDisplay(lineNumber, content);
}

export function hashLines(content: string): string {
	return content
		.split("\n")
		.map((line, i) => formatHashlineDisplay(i + 1, line))
		.join("\n");
}
