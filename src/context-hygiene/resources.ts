/**
 * Resource builders for the context-hygiene metadata contract.
 *
 * Owns: path normalisation, file/symbol/command resource construction, and
 * the metadata envelope builder. Imports from `./commands` and `./types`.
 */
import type { BashCommandState } from "../bash-command-state.js";
import {
	CONTEXT_HYGIENE_SCHEMA_VERSION,
	type BuildContextHygieneMetadataInput,
	type ContextHygieneCommandResource,
	type ContextHygieneFileResource,
	type ContextHygieneMetadata,
	type ContextHygieneResource,
	type ContextHygieneSymbolResource,
} from "./types.js";
import { classifyCommandForContextHygiene, normalizeCommandForContextHygiene } from "./commands.js";
import { cloneContextHygieneRehydrateDescriptor } from "./rehydrate.js";

function cloneBashCommandState(commandState: BashCommandState): BashCommandState {
	return { ...commandState };
}

export function normalizePathForContextHygiene(path: string): string {
	if (path === "") return "";

	const slashPath = path.replace(/\\+/g, "/");
	const isAbsolute = slashPath.startsWith("/");
	const parts: string[] = [];

	for (const part of slashPath.split("/")) {
		if (!part || part === ".") continue;
		if (part === "..") {
			if (parts.length > 0 && parts[parts.length - 1] !== "..") {
				parts.pop();
			} else if (!isAbsolute) {
				parts.push(part);
			}
			continue;
		}
		parts.push(part);
	}

	const normalized = `${isAbsolute ? "/" : ""}${parts.join("/")}`;
	return normalized || (isAbsolute ? "/" : ".");
}

export function buildFileResource(path: string): ContextHygieneFileResource {
	const normalizedPath = normalizePathForContextHygiene(path);
	return {
		kind: "file",
		key: `file:${normalizedPath}`,
		path: normalizedPath,
	};
}

export function buildSymbolResource(
	path: string,
	symbolName: string,
	symbolKind?: string,
): ContextHygieneSymbolResource {
	const normalizedPath = normalizePathForContextHygiene(path);
	const normalizedKind = symbolKind?.trim();
	const keyPayload = JSON.stringify([normalizedPath, normalizedKind ?? "", symbolName]);
	const resource: ContextHygieneSymbolResource = {
		kind: "symbol",
		key: `symbol:${keyPayload}`,
		path: normalizedPath,
		symbolName,
	};
	if (normalizedKind) resource.symbolKind = normalizedKind;
	return resource;
}

export function buildCommandResource(command: string): ContextHygieneCommandResource {
	const normalizedCommand = normalizeCommandForContextHygiene(command);
	const commandKind = classifyCommandForContextHygiene(normalizedCommand);
	return {
		kind: "command",
		key: `command:${commandKind}:${normalizedCommand}`,
		command: normalizedCommand,
		commandKind,
	};
}

export function buildContextHygieneMetadata(
	input: BuildContextHygieneMetadataInput,
): ContextHygieneMetadata {
	const resources: ContextHygieneResource[] = [];
	const seenResourceKeys = new Set<string>();

	for (const resource of input.resources ?? []) {
		if (!resource || seenResourceKeys.has(resource.key)) continue;
		seenResourceKeys.add(resource.key);
		resources.push({ ...resource } as ContextHygieneResource);
	}

	const metadata: ContextHygieneMetadata = {
		schemaVersion: CONTEXT_HYGIENE_SCHEMA_VERSION,
		tool: input.tool,
		classification: input.classification,
		resources,
	};
	if (input.rehydrate) metadata.rehydrate = cloneContextHygieneRehydrateDescriptor(input.rehydrate);
	if (input.commandState) metadata.commandState = cloneBashCommandState(input.commandState);
	return metadata;
}
