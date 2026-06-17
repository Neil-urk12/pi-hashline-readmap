import { describe, it, expect } from "vitest";
import { buildMutationContextHygiene } from "../src/tool-output.js";

describe("buildMutationContextHygiene", () => {
	it("returns metadata with mutation classification", () => {
		const result = buildMutationContextHygiene("edit", "/abs/path.ts");
		expect(result.classification).toBe("mutation");
	});

	it("returns the supplied tool name for the edit tool", () => {
		const result = buildMutationContextHygiene("edit", "/abs/path.ts");
		expect(result.tool).toBe("edit");
	});

	it("returns the supplied tool name for the write tool", () => {
		const result = buildMutationContextHygiene("write", "/abs/path.ts");
		expect(result.tool).toBe("write");
	});

	it("returns a single file resource for the supplied path", () => {
		const result = buildMutationContextHygiene("edit", "/abs/path.ts");
		expect(result.resources).toHaveLength(1);
		expect(result.resources[0]).toMatchObject({
			kind: "file",
			path: "/abs/path.ts",
		});
	});

	it("normalizes the file path through buildFileResource", () => {
		const result = buildMutationContextHygiene("edit", "/abs/dir/../path.ts");
		// normalizePathForContextHygiene collapses the `..`
		expect(result.resources[0]).toMatchObject({
			kind: "file",
			path: "/abs/path.ts",
		});
	});

	it("includes the context-hygiene schema version", () => {
		const result = buildMutationContextHygiene("edit", "/abs/path.ts");
		expect(typeof result.schemaVersion).toBe("number");
		expect(result.schemaVersion).toBeGreaterThan(0);
	});

	it("rejects tool values other than the mutation union at compile time", () => {
		// @ts-expect-error — `"grep"` is not in the mutation tool union
		buildMutationContextHygiene("grep", "/abs/path.ts");
		// @ts-expect-error — `"bash"` is not in the mutation tool union
		buildMutationContextHygiene("bash", "/abs/path.ts");
	});
});
