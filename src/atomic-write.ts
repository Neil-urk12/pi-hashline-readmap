/**
 * Atomic file writes for the edit tool.
 *
 * Goals:
 * - Resolve symlinks: writing through a symlink updates the target, not the link.
 * - Preserve hardlink inodes: when the file has nlink > 1, write in place so
 *   all hardlinked paths continue to share the same inode. (Files with nlink 1
 *   use temp-file + rename for true atomicity on crash.)
 * - Preserve file permissions across overwrites by carrying the existing mode
 *   onto the temp file (or onto the in-place truncation target).
 * - Clean up the temp file on any failure so the user's directory is never
 *   left with `.foo.tmp` residue.
 *
 * Parent directory creation is intentionally the caller's responsibility —
 * this matches standard `fs.writeFile` semantics on missing parents.
 */
import {
	writeFile,
	rename,
	realpath,
	stat,
	lstat,
	open,
	unlink,
	access,
	constants,
} from "fs/promises";
import type { Stats } from "node:fs";
import { dirname, basename, join } from "node:path";
import { randomBytes } from "node:crypto";

export interface AtomicWriteResult {
	/** Path actually written to, after symlink resolution. */
	resolvedPath: string;
	/** True when the write was performed in place to preserve a hardlink inode. */
	preservedInode: boolean;
}

export interface AtomicWriteOptions {
	encoding?: BufferEncoding;
	/** Mode applied only when the target file does not already exist. */
	mode?: number;
}

const DEFAULT_NEW_FILE_MODE = 0o644;

async function statTarget(targetPath: string): Promise<{
	resolvedPath: string;
	stats: Stats | null;
}> {
	// lstat so we can detect a symlink at the top level without following it.
	let lst;
	try {
		lst = await lstat(targetPath);
	} catch (err: any) {
		if (err?.code === "ENOENT") return { resolvedPath: targetPath, stats: null };
		throw err;
	}

	if (lst.isSymbolicLink()) {
		// Resolve the full chain so we write to the canonical target and leave
		// every link in the chain intact.
		const resolvedPath = await realpath(targetPath);
		const stats = await stat(resolvedPath);
		return { resolvedPath, stats };
	}

	return { resolvedPath: targetPath, stats: lst };
}

export async function atomicWriteFile(
	targetPath: string,
	content: string | Buffer,
	options?: AtomicWriteOptions,
): Promise<AtomicWriteResult> {
	const { resolvedPath, stats } = await statTarget(targetPath);

	// POSIX rename(2) does not check the destination's mode bits, so a
	// temp-file + rename strategy would silently bypass a chmod 0o444 file.
	// Restore the conventional "readonly means you can't overwrite it" check
	// explicitly so callers can rely on W_OK semantics.
	if (stats) {
		await access(resolvedPath, constants.W_OK);
	}

	const data =
		typeof content === "string"
			? Buffer.from(content, options?.encoding ?? "utf-8")
			: content;

	const existingMode = stats ? stats.mode & 0o777 : undefined;
	const linkCount = stats?.nlink ?? 1;

	// Hardlinked: write in place. rename(2) over an existing file would unlink
	// the destination inode and replace it with a new one, breaking the
	// shared-inode guarantee for any sibling hardlinks.
	// Trade-off: in-place write is not atomic. If `write` fails after
	// `truncate(0)` succeeds, the file is left empty — and that corruption
	// is visible through every hardlinked path, not just the one we wrote
	// to. Temp-file + rename would be safer but loses the inode. Callers
	// that need durability over inode preservation should rename the file
	// once before editing, or refuse to edit hardlinked files.
	if (linkCount > 1) {
		const fh = await open(resolvedPath, "r+");
		try {
			await fh.truncate(0);
			await fh.write(data, 0, data.length, 0);
		} finally {
			await fh.close();
		}
		return { resolvedPath, preservedInode: true };
	}

	// Single-link (or new file): temp-file + rename for atomicity.
	const dir = dirname(resolvedPath);
	const tmpName = `.${basename(resolvedPath)}.${randomBytes(6).toString("hex")}.tmp`;
	const tmpPath = join(dir, tmpName);

	try {
		await writeFile(tmpPath, data, {
			mode: existingMode ?? options?.mode ?? DEFAULT_NEW_FILE_MODE,
			flag: "wx", // refuse to overwrite a stray temp from a previous crash
		});
		await rename(tmpPath, resolvedPath);
		return { resolvedPath, preservedInode: false };
	} catch (err) {
		try {
			await unlink(tmpPath);
		} catch {
			// best-effort cleanup; never mask the original error
		}
		throw err;
	}
}
