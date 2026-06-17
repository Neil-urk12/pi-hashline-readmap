import { describe, it, expect } from "vitest";
import { buildSgOutput } from "../src/sg-output.js";

describe("buildSgOutput", () => {
	it("returns the no-matches text and ast_search classification for empty input", () => {
		const result = buildSgOutput({ pattern: "foo", files: [] });
		expect(result.text).toBe("No matches found for pattern: foo");
		expect(result.ptcValue.tool).toBe("ast_search");
		expect(result.ptcValue.files).toEqual([]);
		expect(result.contextHygiene.tool).toBe("ast_search");
		expect(result.contextHygiene.classification).toBe("search-context");
		expect(result.contextHygiene.resources).toEqual([]);
	});

	it("routes the empty branch through buildToolOutput with search-context", () => {
		const result = buildSgOutput({ pattern: "bar", files: [] });
		// The deep module's contract: empty files + empty symbols → empty resources,
		// search-context classification, ast_search tool.
		expect(result.contextHygiene).toMatchObject({
			tool: "ast_search",
			classification: "search-context",
			resources: [],
		});
	});

	it("routes the populated branch through buildToolOutput with search-context", () => {
		const result = buildSgOutput({
			pattern: "foo",
			files: [
				{
					displayPath: "a.ts",
					path: "/abs/a.ts",
					ranges: [{ startLine: 1, endLine: 1 }],
					lines: [{ line: 1, hash: "abc", anchor: "1:abc", raw: "const x = 1;", display: "const x = 1;" }],
				},
			],
		});
		expect(result.contextHygiene.tool).toBe("ast_search");
		expect(result.contextHygiene.classification).toBe("search-context");
		expect(result.contextHygiene.resources).toHaveLength(1);
		expect(result.contextHygiene.resources[0]).toMatchObject({
			kind: "file",
			path: "/abs/a.ts",
		});
	});

	it("includes symbol resources in the populated branch", () => {
		const result = buildSgOutput({
			pattern: "foo",
			files: [
				{
					displayPath: "a.ts",
					path: "/abs/a.ts",
					ranges: [{ startLine: 1, endLine: 1 }],
					lines: [{ line: 1, hash: "abc", anchor: "1:abc", raw: "function foo() {}", display: "function foo() {}" }],
					symbols: [{ name: "foo", kind: "function" }],
				},
			],
		});
		expect(result.contextHygiene.resources).toHaveLength(2);
		expect(result.contextHygiene.resources).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: "file", path: "/abs/a.ts" }),
				expect.objectContaining({ kind: "symbol", path: "/abs/a.ts", symbolName: "foo" }),
			]),
		);
	});

	it("dedupes file resources when the same path appears twice", () => {
		const result = buildSgOutput({
			pattern: "foo",
			files: [
				{
					displayPath: "a.ts",
					path: "/abs/a.ts",
					ranges: [{ startLine: 1, endLine: 1 }],
					lines: [{ line: 1, hash: "abc", anchor: "1:abc", raw: "line 1", display: "line 1" }],
				},
				{
					displayPath: "a.ts",
					path: "/abs/a.ts",
					ranges: [{ startLine: 2, endLine: 2 }],
					lines: [{ line: 2, hash: "def", anchor: "2:def", raw: "line 2", display: "line 2" }],
				},
			],
		});
		const fileResources = result.contextHygiene.resources.filter((r) => r.kind === "file");
		expect(fileResources).toHaveLength(1);
	});

	it("passes the ptcValue through unchanged", () => {
		const result = buildSgOutput({
			pattern: "foo",
			files: [
				{
					displayPath: "a.ts",
					path: "/abs/a.ts",
					ranges: [{ startLine: 1, endLine: 1 }],
				lines: [{ line: 1, hash: "abc", anchor: "1:abc", raw: "const x = 1;", display: "const x = 1;" }],
				},
			],
		});
		expect(result.ptcValue).toEqual({
			tool: "ast_search",
			files: [
				{
					path: "/abs/a.ts",
					ranges: [{ startLine: 1, endLine: 1 }],
					lines: [{ line: 1, hash: "abc", anchor: "1:abc", raw: "const x = 1;", display: "const x = 1;" }],
				},
			],
		});
	});
});
