/**
 * XmlParser: extracts tool commands from model response content.
 * Regex-based, not a DOM parser. Handles the XML format defined in prompt.*.md.
 */

const SELF_CLOSING = /^<(read|drop|delete|run|env|ask_user)\s+([^>]*?)\/>/gm;
const CONTENT_TAG = /^<(summary|unknown|known|edit)(\s+[^>]*)?>([^]*?)<\/\1>/gm;

function parseAttrs(attrStr) {
	const attrs = {};
	const re = /(\w+)="([^"]*)"/g;
	let m;
	while ((m = re.exec(attrStr)) !== null) {
		attrs[m[1]] = m[2];
	}
	return attrs;
}

function parseEditContent(content) {
	const blocks = [];
	const re = /<<<<<<< SEARCH\n([^]*?)\n=======\n([^]*?)\n>>>>>>> REPLACE/g;
	const replaceOnly = /^=======\n([^]*?)\n>>>>>>> REPLACE/gm;
	let m;

	while ((m = re.exec(content)) !== null) {
		blocks.push({ search: m[1], replace: m[2] });
	}

	// Check for replace-only blocks (new file)
	if (blocks.length === 0) {
		while ((m = replaceOnly.exec(content)) !== null) {
			blocks.push({ search: null, replace: m[1] });
		}
	}

	return blocks;
}

export default class XmlParser {
	/**
	 * Parse tool commands from model content.
	 * @param {string} content - Raw model response text
	 * @returns {{ commands: Array, unparsed: string }}
	 */
	static parse(content) {
		if (!content) return { commands: [], unparsed: "" };

		const commands = [];
		let remaining = content;

		// Self-closing tags: <read key="..."/>, <drop key="..."/>, etc.
		remaining = remaining.replace(SELF_CLOSING, (_match, name, attrStr) => {
			commands.push({ name, ...parseAttrs(attrStr) });
			return "";
		});

		// Content tags: <summary>...</summary>, <known key="...">...</known>, etc.
		remaining = remaining.replace(
			CONTENT_TAG,
			(_match, name, attrStr, body) => {
				const attrs = attrStr ? parseAttrs(attrStr) : {};

				if (name === "edit") {
					const blocks = parseEditContent(body);
					commands.push({ name, file: attrs.file, blocks });
				} else if (name === "known") {
					commands.push({ name, key: attrs.key, value: body.trim() });
				} else {
					commands.push({ name, value: body.trim(), ...attrs });
				}

				return "";
			},
		);

		const unparsed = remaining.trim();
		return { commands, unparsed };
	}
}
