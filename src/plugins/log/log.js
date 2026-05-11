import { stateToStatus } from "../../agent/httpStatus.js";
import { renderEntry } from "../helpers.js";

export default class Log {
	#core;

	constructor(core) {
		this.#core = core;
		// `<log>` lives in the user message (not system). Cache discipline:
		// system stays stable; volatile activity tape lives in user.
		// Priority 50 = between persona (10) and <turn> (90).
		core.filter("assembly.user", this.assembleLog.bind(this), 50);
	}

	async assembleLog(content, ctx) {
		// Time-indexed activity: action recaps, errors, updates,
		// retrievals, prompt log entries. Archived rows skip rendering.
		const entries = ctx.rows.filter(
			(r) => r.category === "logging" && r.visibility === "indexed",
		);
		if (entries.length === 0) return content;
		const rowsByPath = new Map();
		for (const r of ctx.rows) rowsByPath.set(r.path, r);
		const lines = entries.map((e) => renderLogTag(e, rowsByPath));
		return `${content}<log>\n${lines.join("\n")}\n</log>\n`;
	}
}

// Action label for the entry's <log> rendering. log://<L>/<T>/<S>/<action>
// — terminal segment is the action verb. env://turn_N/* and sh://turn_N/*
// are streaming channels, so the scheme itself is the action.
function actionFromPath(path) {
	if (path?.startsWith("prompt://")) return "prompt";
	if (path?.startsWith("env://")) return "env";
	if (path?.startsWith("sh://")) return "sh";
	const match = path?.match(/^log:\/\/\d+\/\d+\/\d+\/(\w+)$/);
	return match ? match[1] : "log";
}

function projectedBody(entry) {
	if (entry.vBody != null) return entry.vBody;
	return entry.body;
}

function renderLogTag(entry, _rowsByPath) {
	const attrs =
		typeof entry.attributes === "string"
			? JSON.parse(entry.attributes)
			: entry.attributes;

	const action = actionFromPath(entry.path);
	const statusValue =
		attrs?.status != null
			? attrs.status
			: entry.state
				? stateToStatus(entry.state, entry.outcome)
				: null;
	const isSlice = attrs?.lineFirst != null && attrs?.lineFinal != null;

	// Tokens/lines come from the entry itself — its body is what costs
	// budget in <log>. Slim recaps (sh/mv/cp/rm/ask_user) have empty body
	// → aTokens=0 → tokens omitted. Linked data entries (attrs.path) have
	// their own tile in <index> with their own meta.
	const tokenSource = entry.aTokens > 0 ? entry.aTokens : null;
	const lineSource = entry.vLines > 0 ? entry.vLines : null;

	const meta = { action };
	if (attrs?.path) meta.target = attrs.path;
	if (statusValue != null && action !== "prompt") meta.status = statusValue;
	if (typeof attrs?.op === "string") meta.op = attrs.op;
	if (entry.outcome) meta.outcome = entry.outcome;
	if (typeof attrs?.query === "string") meta.query = attrs.query;
	if (typeof attrs?.command === "string") meta.command = attrs.command;
	if (typeof attrs?.from === "string") meta.from = attrs.from;
	if (typeof attrs?.to === "string") meta.to = attrs.to;
	if (typeof attrs?.question === "string") meta.question = attrs.question;
	if (typeof attrs?.answer === "string") meta.answer = attrs.answer;
	if (attrs?.manifest !== undefined) meta.manifest = true;
	if (attrs?.channel === 1) meta.channel = "stdout";
	else if (attrs?.channel === 2) meta.channel = "stderr";
	if (typeof attrs?.tags === "string") meta.tags = attrs.tags.slice(0, 80);
	if (isSlice) {
		// Slice envelope carries resolved bounds + source total as
		// discrete fields. Same vocabulary the model wrote in its
		// emission (lineFirst/lineFinal/lineTotal).
		meta.lineFirst = attrs.lineFirst;
		meta.lineFinal = attrs.lineFinal;
		if (attrs?.lineTotal != null) meta.lineTotal = attrs.lineTotal;
	} else if (lineSource != null) {
		meta.lines = lineSource;
	}
	if (tokenSource != null) meta.tokens = tokenSource;
	if (attrs?.beforeActionTokens != null) {
		meta.beforeActionTokens = attrs.beforeActionTokens;
	}
	if (attrs?.afterActionTokens != null) {
		meta.afterActionTokens = attrs.afterActionTokens;
	}

	return renderEntry(entry.path, meta, projectedBody(entry));
}
