import * as Diff from "diff";
import type { InlineDiffLine, ParsedInlineDiff } from "./model.js";

export function parseInlineDiff(
	oldContent: string,
	newContent: string,
): ParsedInlineDiff {
	const parts = Diff.diffLines(oldContent, newContent);
	const lines: InlineDiffLine[] = [];
	let oldNum = 1;
	let newNum = 1;
	let added = 0;
	let removed = 0;
	let chars = 0;

	for (const part of parts) {
		const rawLines = part.value.split("\n");
		if (rawLines[rawLines.length - 1] === "") rawLines.pop();

		for (const content of rawLines) {
			chars += content.length;
			if (part.added) {
				lines.push({ type: "add", newNum, content });
				newNum += 1;
				added += 1;
			} else if (part.removed) {
				lines.push({ type: "del", oldNum, content });
				oldNum += 1;
				removed += 1;
			} else {
				lines.push({ type: "ctx", oldNum, newNum, content });
				oldNum += 1;
				newNum += 1;
			}
		}
	}

	return { lines, added, removed, chars };
}
