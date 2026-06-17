import { describe, it, expect } from "vitest";
import { buildMutationContextHygiene } from "../src/tool-output.js";
import { buildEditOutput } from "../src/edit-output.js";
import { ensureHashInit, computeLineHash } from "../src/hashline.js";

describe("buildMutationContextHygiene (edit tool)", () => {
	it("returns metadata with edit tool name and mutation classification", () => {
		const result = buildMutationContextHygiene("edit", "/abs/path.ts");
		expect(result.tool).toBe("edit");
		expect(result.classification).toBe("mutation");
	});

	it("returns a single file resource for the path", () => {
		const result = buildMutationContextHygiene("edit", "/abs/path.ts");
		expect(result.resources).toHaveLength(1);
		expect(result.resources[0]).toMatchObject({ kind: "file", path: "/abs/path.ts" });
	});
});

describe("buildEditOutput success path", () => {
	it("uses buildMutationContextHygiene for the success result", async () => {
		await ensureHashInit();
		const result = buildEditOutput({
			path: "/abs/path.ts",
			displayPath: "path.ts",
			diff: "@@ -1 +1 @@\n-old\n+new",
			firstChangedLine: 1,
			warnings: [],
			noopEdits: [],
			edits: [{ set_line: { anchor: "1:abc", new_text: "new" } }],
		});
		expect(result.contextHygiene.tool).toBe("edit");
		expect(result.contextHygiene.classification).toBe("mutation");
		expect(result.contextHygiene.resources).toHaveLength(1);
		expect(result.contextHygiene.resources[0]).toMatchObject({
			kind: "file",
			path: "/abs/path.ts",
		});
	});
});

describe("buildMutationContextHygiene error-envelope shape", () => {
	it("is the property shape consumed by buildToolError", () => {
		// The error path in edit.ts passes the helper's return value as
		// `contextHygiene` to buildToolError. The shape must be a
		// ContextHygieneMetadata with mutation classification.
		const result = buildMutationContextHygiene("edit", "/abs/path.ts");
		expect(result).toMatchObject({
			tool: "edit",
			classification: "mutation",
			resources: expect.any(Array),
		});
	});
});
