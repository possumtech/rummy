import {
	extractSingleHeredoc,
	parseMarkerBody,
} from "../lib/hedberg/marker.js";

// Edit-marker body opacity inside `<set>`. Two opener shapes recognized:
// `<<IDENT` (edit syntax) and `<<:::IDENT` (packet-rendering shape).
function skipBareMarker(s, pos) {
	const m = s.slice(pos).match(/^<<([A-Z][A-Za-z0-9_]*)/);
	if (!m) return null;
	const ident = m[1];
	const openerEnd = pos + m[0].length;
	const escIdent = ident.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const closerRe = new RegExp(`(?<=^|\\s)${escIdent}(?=[\\s<>]|$)`);
	const cm = s.slice(openerEnd).match(closerRe);
	if (!cm) return null;
	return openerEnd + cm.index + cm[0].length;
}

function skipPacketMarker(s, pos) {
	const m = s.slice(pos).match(/^<<:::([A-Za-z_][A-Za-z0-9_./-]*)/);
	if (!m) return null;
	const ident = m[1];
	const openerEnd = pos + m[0].length;
	const escIdent = ident.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const closerRe = new RegExp(`:::${escIdent}(?![A-Za-z0-9_])`);
	const cm = s.slice(openerEnd).match(closerRe);
	if (!cm) return null;
	return openerEnd + cm.index + cm[0].length;
}

function skipEditMarker(s, pos) {
	if (s.startsWith("<<:::", pos)) return skipPacketMarker(s, pos);
	return skipBareMarker(s, pos);
}

const STORE_TOOLS = new Set(["get", "rm", "set", "mv", "cp", "search"]);
export const ALL_TOOLS = new Set([
	...STORE_TOOLS,
	"sh",
	"env",
	"ask_user",
	"update",
	"think",
]);

// Per-tool resolution: missing canonical attribute is filled from the body.
function resolveCommand(name, a, rawBody) {
	// Non-`<set>` plugins accept a single `<<IDENT...IDENT` heredoc wrapper
	// for opaque multi-line content; `<set>` does its own marker parsing.
	if (name !== "set") {
		const heredoc = extractSingleHeredoc(rawBody);
		if (heredoc) {
			rawBody = heredoc.content;
			a = { ...a, heredocIdent: heredoc.ident };
		}
	}
	const trimmed = rawBody.trim();

	if (name === "set") {
		const { search: _s, replace: _r, ...rest } = a;
		a = rest;

		if (!trimmed) return { name, ...a, body: a.body || "" };

		const { ops, error } = parseMarkerBody(rawBody);
		if (error) return { name, ...a, error };
		if (ops) return { name, ...a, operations: ops };

		return { name, ...a, body: trimmed };
	}

	if (name === "update") {
		const body = trimmed || a.body || "";
		const status = a.status ? Number(a.status) : 102;
		return { name, ...a, body, status };
	}

	// Distinguish unset attr (falls back to body) from empty-string attr.
	const fromBody = trimmed === "" ? null : trimmed;

	if (name === "get" || name === "rm") {
		return { name, ...a, path: a.path ?? fromBody };
	}

	if (name === "search") {
		const path = a.path ?? fromBody;
		const results = a.results ? Number(a.results) : null;
		return { name, ...a, path, results };
	}

	if (name === "mv" || name === "cp") {
		return { name, ...a, path: a.path, to: a.to ?? fromBody };
	}

	if (name === "sh" || name === "env") {
		const command = a.command ?? fromBody;
		return { name, ...a, command };
	}

	if (name === "ask_user") {
		const question = a.question ?? null;
		const options = a.options ?? fromBody;
		return { name, ...a, question, options };
	}

	return { name, ...a, body: trimmed === "" ? a.body : trimmed };
}

const NAME_CHAR = /[a-zA-Z0-9_]/;
const ATTR_KEY_CHAR = /[a-zA-Z0-9_:-]/;
const WS = /\s/;

// Tokenizer for rummy's closed set of tool tags. See SPEC.md "XML Parser"
// for the full design contract; in short: opaque tool bodies, outer-text
// backtick suppression, edit-marker opacity inside `<set>`, depth-counted
// same-name nesting, tail recovery for unclosed openers.
export default class XmlParser {
	static MAX_COMMANDS = Number(process.env.RUMMY_MAX_COMMANDS);

	static parse(content) {
		if (!content) return { commands: [], warnings: [], unparsed: "" };

		const normalized = XmlParser.#normalizeToolCalls(content);
		return XmlParser.#tokenize(normalized, []);
	}

	static #tokenize(s, warnings) {
		const commands = [];
		const text = [];
		let i = 0;
		let inSingleBacktick = false;
		let inTripleFence = false;
		let capped = false;

		while (i < s.length) {
			if (commands.length >= XmlParser.MAX_COMMANDS) {
				capped = true;
				break;
			}

			// Triple takes precedence over single because ``` overlaps `.
			if (s[i] === "`" && s[i + 1] === "`" && s[i + 2] === "`") {
				inTripleFence = !inTripleFence;
				text.push("```");
				i += 3;
				continue;
			}
			if (s[i] === "`" && !inTripleFence) {
				inSingleBacktick = !inSingleBacktick;
				text.push("`");
				i++;
				continue;
			}

			if (inSingleBacktick || inTripleFence || s[i] !== "<") {
				text.push(s[i]);
				i++;
				continue;
			}

			const opener = XmlParser.#matchOpener(s, i);
			if (!opener) {
				text.push(s[i]);
				i++;
				continue;
			}

			const { name, attrs, selfClose, end: openerEnd } = opener;
			const openerStart = i;

			if (selfClose) {
				const source = s.slice(openerStart, openerEnd);
				commands.push({
					...resolveCommand(name, attrs, ""),
					source,
					inner: "",
				});
				i = openerEnd;
				continue;
			}

			const result = XmlParser.#findBodyEnd(s, name, openerEnd);
			const body = s.slice(openerEnd, result.bodyEnd);
			if (result.unclosed) {
				if (result.recoveredTailCount) {
					warnings.push(
						`Unclosed <${name}> tag — recovered ${result.recoveredTailCount} trailing tool call(s)`,
					);
				} else {
					warnings.push(`Unclosed <${name}> tag — content captured anyway`);
				}
			}
			const source = s.slice(openerStart, result.afterClose);
			const inner = body.replace(/^\n+/, "").replace(/\n+$/, "");
			commands.push({
				...resolveCommand(name, attrs, body),
				source,
				inner,
			});
			i = result.afterClose;
			inSingleBacktick = false;
			inTripleFence = false;
		}

		if (capped) {
			warnings.push(
				`Tool call limit (${XmlParser.MAX_COMMANDS}) reached — remaining commands dropped`,
			);
		}

		return {
			commands,
			warnings,
			unparsed: text.join("").trim(),
		};
	}

	// Returns { name, attrs, selfClose, end } or null. `end` is post-`>`/`/>`.
	static #matchOpener(s, pos) {
		if (s[pos] !== "<") return null;
		let i = pos + 1;

		const nameStart = i;
		while (i < s.length && NAME_CHAR.test(s[i])) i++;
		const name = s.slice(nameStart, i).toLowerCase();
		if (!ALL_TOOLS.has(name)) return null;

		if (i < s.length && !WS.test(s[i]) && s[i] !== "/" && s[i] !== ">") {
			return null;
		}

		const attrsStart = i;
		let inQuote = null;

		while (i < s.length) {
			const c = s[i];
			if (inQuote) {
				if (c === inQuote) inQuote = null;
				i++;
				continue;
			}
			if (c === '"' || c === "'") {
				inQuote = c;
				i++;
				continue;
			}
			if (c === "/") {
				let k = i + 1;
				while (k < s.length && WS.test(s[k])) k++;
				if (s[k] === ">") {
					return {
						name,
						attrs: XmlParser.#parseAttrs(s.slice(attrsStart, i)),
						selfClose: true,
						end: k + 1,
					};
				}
				i++;
				continue;
			}
			if (c === ">") {
				return {
					name,
					attrs: XmlParser.#parseAttrs(s.slice(attrsStart, i)),
					selfClose: false,
					end: i + 1,
				};
			}
			i++;
		}

		return null;
	}

	static #parseAttrs(raw) {
		const attrs = {};
		let i = 0;
		while (i < raw.length) {
			while (i < raw.length && WS.test(raw[i])) i++;
			if (i >= raw.length) break;

			const keyStart = i;
			while (i < raw.length && ATTR_KEY_CHAR.test(raw[i])) i++;
			if (i === keyStart) {
				i++;
				continue;
			}
			const key = raw.slice(keyStart, i).toLowerCase();

			while (i < raw.length && WS.test(raw[i])) i++;

			if (raw[i] !== "=") {
				attrs[key] = "";
				continue;
			}
			i++;

			while (i < raw.length && WS.test(raw[i])) i++;

			if (raw[i] === '"' || raw[i] === "'") {
				const quote = raw[i];
				i++;
				const valStart = i;
				while (i < raw.length && raw[i] !== quote) i++;
				attrs[key] = raw.slice(valStart, i);
				if (raw[i] === quote) i++;
			} else {
				const valStart = i;
				while (i < raw.length && !WS.test(raw[i])) i++;
				attrs[key] = raw.slice(valStart, i);
			}
		}
		return attrs;
	}

	// Returns { bodyEnd, afterClose, unclosed }. Same-name nesting is depth-counted.
	static #findBodyEnd(s, name, fromPos) {
		let depth = 1;
		let sameNameNested = false;
		let i = fromPos;
		while (i < s.length) {
			if (
				name === "set" &&
				(s.startsWith("<<:::", i) ||
					(s.startsWith("<<", i) && /^[A-Z]/.test(s[i + 2] ?? "")))
			) {
				const skipTo = skipEditMarker(s, i);
				if (skipTo != null) {
					i = skipTo;
					continue;
				}
			}
			if (s[i] !== "<") {
				i++;
				continue;
			}
			if (s[i + 1] === "/") {
				const nameStart = i + 2;
				let nameEnd = nameStart;
				while (nameEnd < s.length && NAME_CHAR.test(s[nameEnd])) nameEnd++;
				const closeName = s.slice(nameStart, nameEnd).toLowerCase();
				let k = nameEnd;
				while (k < s.length && WS.test(s[k])) k++;
				const isCloseTag = s[k] === ">";

				if (isCloseTag && closeName === name) {
					depth--;
					if (depth === 0) {
						return { bodyEnd: i, afterClose: k + 1, unclosed: false };
					}
					i = k + 1;
					continue;
				}
			}
			const opener = XmlParser.#matchOpener(s, i);
			if (opener && opener.name === name && !opener.selfClose) {
				depth++;
				sameNameNested = true;
				i = opener.end;
				continue;
			}
			i++;
		}
		// Unclosed → tail recovery, unless same-name nesting (treated as
		// authored opaque body content with intentional tag examples).
		if (sameNameNested) {
			return { bodyEnd: s.length, afterClose: s.length, unclosed: true };
		}
		const recovery = XmlParser.#findTailRecovery(s, fromPos);
		if (recovery) {
			return {
				bodyEnd: recovery.tailStart,
				afterClose: recovery.tailStart,
				unclosed: true,
				recoveredTailCount: recovery.commandCount,
			};
		}
		return { bodyEnd: s.length, afterClose: s.length, unclosed: true };
	}

	// Find leftmost suffix that tokenizes cleanly to ≥1 commands; null if none.
	static #findTailRecovery(s, fromPos) {
		let best = null;
		let i = fromPos;
		while (i < s.length) {
			if (s[i] === "<" && XmlParser.#matchOpener(s, i)) {
				const suffix = s.slice(i);
				const result = XmlParser.#tokenize(suffix, []);
				if (result.commands.length > 0 && result.unparsed === "") {
					best = { tailStart: i, commandCount: result.commands.length };
					break;
				}
			}
			i++;
		}
		return best;
	}

	// Translate native training-format tool calls into rummy XML silently.
	static #normalizeToolCalls(content) {
		// Gemma code-fenced XML.
		let result = content.replace(
			/```(?:tool_code|tool_command|xml)\n([\s\S]*?)```/g,
			(_, inner) => inner.trim(),
		);

		// Qwen/gemma <|tool_call>call:NAME{...}<tool_call|>; NAME may be namespaced.
		result = result.replace(
			/<\|tool_call>call:([\w.:/-]+)\{([^}]*)\}<(?:tool_call\||\|tool_call)>/g,
			(match, qualifiedName, params) => {
				const name = qualifiedName.match(/\w+$/)?.[0] ?? qualifiedName;
				if (!ALL_TOOLS.has(name)) {
					return `<error>Unknown command '${qualifiedName}' in <|tool_call> format. Use XML commands listed above.</error>`;
				}
				const valueMatch = params.match(
					/[=:]\s*(?:<\|"\|>([^<]*?)<\|"\|>|"([^"]*)"|'([^']*)'|([^,}]+))/,
				);
				const body = (
					valueMatch?.[1] ??
					valueMatch?.[2] ??
					valueMatch?.[3] ??
					valueMatch?.[4] ??
					""
				).trim();
				if (!body) {
					return `<error>Could not extract argument from <|tool_call> ${match}. Use XML format like <${name}>value</${name}>.</error>`;
				}
				return `<${name}>${body}</${name}>`;
			},
		);

		// OpenAI function_call JSON: {"name":"search","arguments":{"query":"..."}}
		result = result.replace(
			/\{"name"\s*:\s*"(\w+)"\s*,\s*"arguments"\s*:\s*\{([^}]*)\}\}/g,
			(_, name, args) => {
				if (!ALL_TOOLS.has(name)) return _;
				const pairs = [...args.matchAll(/"(\w+)"\s*:\s*"([^"]*)"/g)];
				const body = pairs[0]?.[2] || "";
				return `<${name}>${body}</${name}>`;
			},
		);

		// Anthropic: <tool_use><name>search</name><input>{"query":"..."}</input></tool_use>
		result = result.replace(
			/<tool_use>\s*<name>(\w+)<\/name>\s*<input>\{([^}]*)\}<\/input>\s*<\/tool_use>/g,
			(_, name, args) => {
				if (!ALL_TOOLS.has(name)) return _;
				const pairs = [...args.matchAll(/"(\w+)"\s*:\s*"([^"]*)"/g)];
				const body = pairs[0]?.[2] || "";
				return `<${name}>${body}</${name}>`;
			},
		);

		// Mistral: [TOOL_CALLS] [{"name":"search","arguments":{"query":"..."}}]
		result = result.replace(
			/\[TOOL_CALLS\]\s*\[\{"name"\s*:\s*"(\w+)"\s*,\s*"arguments"\s*:\s*\{([^}]*)\}\}\]/g,
			(_, name, args) => {
				if (!ALL_TOOLS.has(name)) return _;
				const pairs = [...args.matchAll(/"(\w+)"\s*:\s*"([^"]*)"/g)];
				const body = pairs[0]?.[2] || "";
				return `<${name}>${body}</${name}>`;
			},
		);

		// Catch-all malformed <|tool_call> → <error> in prose (no literal tags or they'd re-parse).
		result = result.replace(
			/<\|tool_call>[\s\S]*?(?:<\|?tool_call\|?>|<\/\w+>|$)/g,
			() =>
				"<error>Native tool call format not supported. Use the XML commands listed above (e.g. a get tag with a path attribute, or a set tag with path and body).</error>",
		);

		result = result.replace(/<\|"\|>/g, '"');

		// Strip OpenAI-harmony role/channel pseudo-tags (gemma leaks these).
		result = result.replace(/<\|[\w:/-]+>/g, "");
		result = result.replace(/<[\w:/-]+\|>/g, "");

		return result;
	}
}
