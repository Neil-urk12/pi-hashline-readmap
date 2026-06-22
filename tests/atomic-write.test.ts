import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, symlink, link, readFile, stat, lstat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicWriteFile } from "../src/atomic-write.js";

let workDir: string;

beforeEach(async () => {
	workDir = await mkdtemp(join(tmpdir(), "atomic-write-test-"));
});

afterEach(async () => {
	await rm(workDir, { recursive: true, force: true });
});

describe("atomicWriteFile", () => {
	it("writes content to a regular file", async () => {
		const path = join(workDir, "regular.txt");
		await atomicWriteFile(path, "hello\nworld\n");
		const read = await readFile(path, "utf-8");
		expect(read).toBe("hello\nworld\n");
	});

	it("overwrites existing content atomically (no partial state on success)", async () => {
		const path = join(workDir, "overwrite.txt");
		await writeFile(path, "original content", "utf-8");
		await atomicWriteFile(path, "replaced content");
		const read = await readFile(path, "utf-8");
		expect(read).toBe("replaced content");
	});

	it("resolves symlinks: writes to the target, leaves the symlink intact", async () => {
		const target = join(workDir, "real.txt");
		const linkPath = join(workDir, "alias.txt");
		await writeFile(target, "initial\n", "utf-8");
		await symlink(target, linkPath);

		// Sanity: the symlink resolves to the target before the write.
		const before = await lstat(linkPath);
		expect(before.isSymbolicLink()).toBe(true);

		await atomicWriteFile(linkPath, "updated via symlink\n");

		// The symlink itself still exists and still points at the same target.
		const after = await lstat(linkPath);
		expect(after.isSymbolicLink()).toBe(true);
		// The target's content was updated.
		const targetContent = await readFile(target, "utf-8");
		expect(targetContent).toBe("updated via symlink\n");
		// Reading through the symlink returns the new content.
		const linkContent = await readFile(linkPath, "utf-8");
		expect(linkContent).toBe("updated via symlink\n");
	});

	it("preserves hardlink inode: both links see the same updated content", async () => {
		const original = join(workDir, "original.txt");
		const hardlinkCopy = join(workDir, "hardlink.txt");
		await writeFile(original, "shared initial\n", "utf-8");
		await link(original, hardlinkCopy);

		const inodeBefore = (await stat(original)).ino;
		const hardlinkInodeBefore = (await stat(hardlinkCopy)).ino;
		expect(hardlinkInodeBefore).toBe(inodeBefore);

		await atomicWriteFile(original, "shared updated\n");

		const originalAfter = await readFile(original, "utf-8");
		const hardlinkAfter = await readFile(hardlinkCopy, "utf-8");
		expect(originalAfter).toBe("shared updated\n");
		expect(hardlinkAfter).toBe("shared updated\n");

		// The hardlink still points to the same inode — we updated in place
		// rather than unlinking + creating a new file.
		const hardlinkInodeAfter = (await stat(hardlinkCopy)).ino;
		expect(hardlinkInodeAfter).toBe(inodeBefore);
	});

	it("preserves file permissions when overwriting an existing file", async () => {
		const path = join(workDir, "perms.txt");
		await writeFile(path, "x", { mode: 0o600 });
		await atomicWriteFile(path, "y\n");
		const s = await stat(path);
		// Mask to permission bits only — some platforms add file-type bits.
		expect(s.mode & 0o777).toBe(0o600);
	});

	it("writes a new file when the target does not exist", async () => {
		const path = join(workDir, "fresh.txt");
		await atomicWriteFile(path, "new\n");
		const read = await readFile(path, "utf-8");
		expect(read).toBe("new\n");
	});

	it("throws when the parent directory does not exist", async () => {
		const path = join(workDir, "missing", "child.txt");
		await expect(atomicWriteFile(path, "x")).rejects.toThrow();
	});

	it("accepts Buffer content and preserves bytes exactly", async () => {
		const path = join(workDir, "binary.bin");
		const bytes = Buffer.from([0x00, 0x01, 0xff, 0xfe]);
		await atomicWriteFile(path, bytes);
		const read = await readFile(path);
		expect(Buffer.compare(read, bytes)).toBe(0);
	});

	it("does not leave a temp file behind on success", async () => {
		const path = join(workDir, "no-temp.txt");
		await atomicWriteFile(path, "clean\n");
		const entries = (await import("node:fs/promises")).readdir(workDir);
		const list = await entries;
		expect(list.filter((n) => n.includes(".tmp") || n.includes(".swap"))).toEqual([]);
	});

	it("does not leave a temp file behind when the write fails (parent dir missing)", async () => {
		const path = join(workDir, "no-parent", "child.txt");
		await expect(atomicWriteFile(path, "x")).rejects.toThrow();
		const entries = (await import("node:fs/promises")).readdir(workDir);
		const list = await entries;
		// No stray temp files at the workDir root.
		expect(list.filter((n) => n.includes(".tmp") || n.includes(".swap"))).toEqual([]);
	});

	it("creates intermediate directories only when target is inside an existing root (no implicit mkdir for parent)", async () => {
		// We intentionally do NOT create parent dirs (caller's responsibility),
		// matching standard fs.writeFile behavior on missing parents.
		const path = join(workDir, "deep", "nested", "child.txt");
		await expect(atomicWriteFile(path, "x")).rejects.toThrow();
	});

	it("is safe under symlink chains (writes to the final target, leaves all links intact)", async () => {
		const real = join(workDir, "real.txt");
		const linkA = join(workDir, "a.txt");
		const linkB = join(workDir, "b.txt");
		await writeFile(real, "v0\n", "utf-8");
		await symlink(real, linkA);
		await symlink(linkA, linkB);

		await atomicWriteFile(linkB, "v1\n");

		expect((await lstat(linkA)).isSymbolicLink()).toBe(true);
		expect((await lstat(linkB)).isSymbolicLink()).toBe(true);
		expect(await readFile(real, "utf-8")).toBe("v1\n");
	});

	it("treats mkdir as caller's responsibility (does not silently create parent dirs)", async () => {
		const path = join(workDir, "subdir-created-by-test", "child.txt");
		await mkdir(join(workDir, "subdir-created-by-test"));
		await atomicWriteFile(path, "ok\n");
		const read = await readFile(path, "utf-8");
		expect(read).toBe("ok\n");
	});
});
