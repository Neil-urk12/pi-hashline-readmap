import { describe, it, expect } from "vitest";
import type { ContextHygieneMetadata } from "../src/context-hygiene.js";
import { buildToolError } from "../src/ptc-value.js";

/**
 * Pin the deep module's envelope shape: every tool error returns the
 * { content, isError, details: { ptcValue: { tool, ok: false, ... } } } triple.
 * The factory owns the shape; the call site supplies intent (tool/code/
 * message + optional path, hint, details, ptcValue overlay, contextHygiene).
 */
describe("buildToolError", () => {
	it("returns the standard error envelope for a simple read error", () => {
		const r = buildToolError("read", "file-not-found", `File not found: /foo`, { path: "/foo" });

		expect(r).toEqual({
			content: [{ type: "text", text: "File not found: /foo" }],
			isError: true,
			details: {
				ptcValue: {
					tool: "read",
					ok: false,
					path: "/foo",
					error: { code: "file-not-found", message: "File not found: /foo" },
				},
			},
		});
	});

	it("forwards hint into the inner PtcError", () => {
		const r = buildToolError("read", "path-is-directory", `Path is a directory: /foo`, {
			path: "/foo",
			hint: "Use ls to inspect directories.",
		});

		expect(r.details.ptcValue.error).toEqual({
			code: "path-is-directory",
			message: "Path is a directory: /foo",
			hint: "Use ls to inspect directories.",
		});
	});

	it("forwards details into the inner PtcError", () => {
		const r = buildToolError("read", "fs-error", "Unexpected fs failure", {
			path: "/foo",
			details: { fsCode: "EIO", fsMessage: "device error" },
		});

		expect(r.details.ptcValue.error).toEqual({
			code: "fs-error",
			message: "Unexpected fs failure",
			details: { fsCode: "EIO", fsMessage: "device error" },
		});
	});

	it("overlays a partial ptcValue (write.ts style: spread result.ptcValue into the error)", () => {
		const overlay = {
			summary: false,
			totalMatches: 0,
			records: [] as Array<{ path: string; line: number; anchor: string; kind: "match" | "context" }>,
		};
		const r = buildToolError("grep", "binary-file-target", `'/foo' appears to be a binary file`, {
			path: "/foo",
			ptcValue: overlay,
		});

		// Factory-owned fields are typed on the return; overlay fields are
		// present at runtime but not on the inferred type — cast for the
		// runtime-only assertions below.
		expect(r.details.ptcValue.tool).toBe("grep");
		expect(r.details.ptcValue.ok).toBe(false);
		expect(r.details.ptcValue.path).toBe("/foo");
		expect(r.details.ptcValue.error).toEqual({
			code: "binary-file-target",
			message: "'/foo' appears to be a binary file",
		});

		// Overlay fields flow through to the runtime envelope.
		const overlayView = r.details.ptcValue as unknown as {
			summary: boolean;
			totalMatches: number;
			records: Array<{ path: string; line: number; anchor: string; kind: "match" | "context" }>;
		};
		expect(overlayView.summary).toBe(false);
		expect(overlayView.totalMatches).toBe(0);
		expect(overlayView.records).toEqual([]);
	});

	it("omits the path key when opts.path is not supplied", () => {
		const r = buildToolError("grep", "invalid-params-combo", "context requires a non-negative integer");

		expect(r.details.ptcValue).not.toHaveProperty("path");
		expect(r.details.ptcValue.tool).toBe("grep");
		expect(r.details.ptcValue.ok).toBe(false);
		expect(r.details.ptcValue.error).toEqual({
			code: "invalid-params-combo",
			message: "context requires a non-negative integer",
		});
	});

	it("overlays contextHygiene onto details when supplied", () => {
		const contextHygiene: ContextHygieneMetadata = {
			schemaVersion: 1,
			tool: "write",
			classification: "mutation",
			resources: [],
		};
		const r = buildToolError("write", "binary-content", "looks binary", {
			path: "/foo",
			contextHygiene,
		});

		expect(r.details.contextHygiene).toBe(contextHygiene);
	});

	it("omits the contextHygiene key when not supplied", () => {
		const r = buildToolError("read", "file-not-found", "missing", { path: "/foo" });

		expect(r.details).not.toHaveProperty("contextHygiene");
	});

	it("narrows ptcValue.tool to the literal string passed in (type-level + runtime)", () => {
		const r = buildToolError("read", "file-not-found", "missing", { path: "/foo" });

		// Type-level: this assignment must compile. If r.details.ptcValue.tool
		// were `string`, the widening would fail to assign to "read".
		const tool: "read" = r.details.ptcValue.tool;
		// Runtime: same fact, pinned as a value.
		expect(tool).toBe("read");
	});

	it("narrows ptcValue.ok to the literal false (ok: false is part of the error contract)", () => {
		const r = buildToolError("edit", "hash-mismatch", "anchors stale", { path: "/foo" });

		// Type-level: must compile. If `ok` were inferred as `boolean`, the
		// assignment to `false` would fail.
		const ok: false = r.details.ptcValue.ok;
		expect(ok).toBe(false);
	});
});
