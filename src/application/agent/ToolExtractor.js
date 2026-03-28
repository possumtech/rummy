/**
 * ToolExtractor: Extracts tool invocations from model output.
 *
 * Option D: All todo items are executed. The server processes them in order.
 * Items already checked (from a prior prefill) are skipped.
 *
 * Two categories:
 * - Todo-driven tools: read, drop, env, run, delete, prompt_user, summary
 *   The todo item IS the action.
 * - Tag-driven tools: edit only
 *   Requires <edit file="...">SEARCH/REPLACE</edit> tag after the core tags.
 */

export default class ToolExtractor {
	#parser;
	#actTools;

	constructor(parser, toolRegistry) {
		this.#parser = parser;
		this.#actTools =
			toolRegistry?.actTools ??
			new Set(["edit", "create", "delete", "run", "env", "prompt_user"]);
	}

	extract(tags, todoList) {
		const tools = [];
		const structural = [];

		// 1. Structural content from parsed tags
		for (const tag of tags) {
			if (["todo", "known", "unknown"].includes(tag.tagName)) {
				structural.push({
					name: tag.tagName,
					content: this.#parser.getNodeText(tag),
				});
			}
		}

		// 2. Todo-driven tools — skip already-checked (processed in prior prefill)
		for (const item of todoList) {
			if (item.completed || !item.tool) continue;

			const { tool, argument } = item;

			if (tool === "read" || tool === "drop") {
				tools.push({ tool, path: argument });
			} else if (tool === "delete") {
				tools.push({ tool: "delete", path: argument });
			} else if (tool === "env" || tool === "run") {
				tools.push({ tool, command: argument });
			} else if (tool === "prompt_user") {
				tools.push({
					tool: "prompt_user",
					text: argument,
					config: this.#parsePromptUser(argument),
				});
			} else if (tool === "summary") {
				structural.push({ name: "summary", content: argument });
			} else if (tool === "edit") {
				// Edit is tag-driven — handled below from <edit> tags
			}
		}

		// 3. Tag-driven tools: <edit> tags from content
		for (const tag of tags) {
			if (tag.tagName !== "edit") continue;
			const attrs = tag.attrs || [];
			const path = attrs.find((a) => a.name === "file")?.value;
			if (!path) continue;

			const content = this.#parser.getNodeText(tag);
			const { search, replace, hasMarkers } = this.#parseEditContent(content);
			if (hasMarkers) {
				tools.push({ tool: "edit", path, search, replace });
			} else {
				tools.push({ tool: "create", path, content });
			}
		}

		const hasAct = tools.some((t) => this.#actTools.has(t.tool));
		const hasReads = tools.some((t) => t.tool === "read");
		const hasSummary = todoList.some((t) => t.tool === "summary");

		return {
			tools,
			structural,
			flags: { hasAct, hasReads, hasSummary },
		};
	}

	#parseEditContent(content) {
		const searchMarker = "<<<<<<< SEARCH";
		const dividerMarker = "=======";
		const replaceMarker = ">>>>>>> REPLACE";

		const searchStart = content.indexOf(searchMarker);
		const dividerStart = content.indexOf(dividerMarker);
		const replaceEnd = content.indexOf(replaceMarker);

		if (searchStart === -1 || dividerStart === -1 || replaceEnd === -1) {
			return { search: null, replace: null };
		}

		const search = content
			.substring(searchStart + searchMarker.length, dividerStart)
			.trim();
		const replace = content
			.substring(dividerStart + dividerMarker.length, replaceEnd)
			.trim();

		return { search, replace, hasMarkers: true };
	}

	extractFromJson(parsed) {
		const tools = [];
		const todoItems = parsed.todo || [];

		// Todo-driven tools
		for (const item of todoItems) {
			const { tool, argument } = item;
			if (!tool) continue;

			if (tool === "read" || tool === "drop") {
				tools.push({ tool, path: argument });
			} else if (tool === "delete") {
				tools.push({ tool: "delete", path: argument });
			} else if (tool === "env" || tool === "run") {
				tools.push({ tool, command: argument });
			}
		}

		// Edits from the structured edits array
		for (const edit of parsed.edits || []) {
			if (!edit.file) continue;
			tools.push({
				tool: "edit",
				path: edit.file,
				search: edit.search ?? "",
				replace: edit.replace ?? "",
			});
		}

		// Prompt from the structured prompt object
		if (parsed.prompt?.question) {
			tools.push({
				tool: "prompt_user",
				text: parsed.prompt.question,
				config: {
					question: parsed.prompt.question,
					options: (parsed.prompt.options || []).map((o) => ({
						label: o,
						description: o,
					})),
				},
			});
		}

		const hasAct = tools.some((t) => this.#actTools.has(t.tool));
		const hasReads = tools.some((t) => t.tool === "read");
		const hasSummary = Boolean(parsed.summary);

		return { tools, flags: { hasAct, hasReads, hasSummary } };
	}

	#parsePromptUser(text) {
		const marker = "- [ ]";
		const firstIdx = text.indexOf(marker);
		if (firstIdx === -1) {
			return { question: text.trim(), options: [] };
		}
		const question = text.substring(0, firstIdx).trim();
		const options = text
			.substring(firstIdx)
			.split(marker)
			.filter(Boolean)
			.map((opt) => ({
				label: opt
					.trim()
					.split(/\r?\n|:/)[0]
					.trim(),
				description: opt.trim(),
			}));
		return { question, options };
	}
}
