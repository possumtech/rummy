import { readFileSync } from "node:fs";
import Protocol from "./protocol.js";

// Base system-prompt content (header + Core XML Command Grammar). The
// `[%TOOLS%]` placeholder is substituted with the active-toolset tag list
// at render time. Tool-specific docs no longer live here; they're a
// separate `assembly.system` participant at priority 100.
const baseInstructions = readFileSync(
	new URL("./instructions-system.md", import.meta.url),
	"utf8",
);

// Tight, non-modal reminder rendered LATE in the user message
// (`assembly.user` priority 165, between unknowns at 150 and budget at
// 175) so the rules sit adjacent to the action site — recency keeps the
// per-turn discipline warm.
const userInstructions = readFileSync(
	new URL("./instructions-user.md", import.meta.url),
	"utf8",
).trim();

const TURN_FROM_PATH = /^log:\/\/turn_(\d+)\/update\//;

export default class Instructions {
	#core;

	constructor(core) {
		this.#core = core;
		core.hooks.instructions.findLatestSummary =
			this.findLatestSummary.bind(this);
		// System message: priority chain. Base header + grammar at 50,
		// joined per-tool docs at 100, persona at 150 (in persona.js).
		core.filter("assembly.system", this.assembleSystemBase.bind(this), 50);
		core.filter("assembly.system", this.assembleSystemToolDocs.bind(this), 100);
		// User message: per-turn reminder block.
		core.filter("assembly.user", this.assembleInstructions.bind(this), 165);
		new Protocol(core);
	}

	#activeToolSet(ctx) {
		return ctx.toolSet
			? new Set(ctx.toolSet)
			: new Set(this.#core.hooks.tools.names);
	}

	// assembly.system @ 50 — header + Core XML Command Grammar with the
	// advertised tool tag list substituted into the `[%TOOLS%]` slot.
	assembleSystemBase(content, ctx) {
		const activeTools = this.#activeToolSet(ctx);
		const advertised = this.#core.hooks.tools.advertisedNames.filter((n) =>
			activeTools.has(n),
		);
		const tools = advertised.map((n) => `<${n}/>`).join(", ");
		return `${content}${baseInstructions.replace("[%TOOLS%]", tools)}`;
	}

	// assembly.system @ 100 — per-tool docs joined in tool-registration
	// order. Each tool plugin contributes its block via the
	// `instructions.toolDocs` sub-filter (registry-style: filter
	// participants mutate a docsMap keyed by tool name).
	async assembleSystemToolDocs(content, ctx) {
		const activeTools = this.#activeToolSet(ctx);
		const toolDocs = await this.#core.hooks.instructions.toolDocs.filter(
			{},
			{ toolSet: activeTools },
		);
		const docsText = this.#core.hooks.tools.names
			.filter((n) => activeTools.has(n))
			.filter((key) => toolDocs[key])
			.map((key) => toolDocs[key])
			.join("\n\n");
		if (!docsText) return content;
		return `${content}\n\n${docsText}`;
	}

	// assembly.user @ 165 — per-turn reminder, same body every turn.
	assembleInstructions(content, _ctx) {
		return `${content}<instructions>\n${userInstructions}\n</instructions>\n`;
	}

	// Latest terminal update (status=200) — used by cli.js to print the
	// run's final answer. State-machine knowledge lives here, not AgentLoop.
	findLatestSummary(logEntries) {
		return logEntries
			.filter((e) => {
				if (!TURN_FROM_PATH.test(e.path)) return false;
				const attrs =
					typeof e.attributes === "string"
						? JSON.parse(e.attributes)
						: e.attributes;
				return attrs?.status === 200;
			})
			.at(-1);
	}
}
