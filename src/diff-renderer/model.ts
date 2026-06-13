export type InlineDiffLineType = "ctx" | "add" | "del" | "sep";

export interface InlineDiffLine {
	type: InlineDiffLineType;
	oldNum?: number;
	newNum?: number;
	content: string;
}

export interface ParsedInlineDiff {
	lines: InlineDiffLine[];
	added: number;
	removed: number;
	chars: number;
}

export type InlineDiffMetadata =
	| {
			kind: "diff";
			path: string;
			summary: string;
			language: string;
			oldContent: string;
			newContent: string;
	  }
	| {
			kind: "new-file";
			path: string;
			language: string;
			content: string;
			lines: number;
	  }
	| {
			kind: "no-change";
			path: string;
	  };

export interface RenderInlineDiffOptions {
	language: string;
	maxLines: number;
	width: number;
	theme?: unknown;
}
