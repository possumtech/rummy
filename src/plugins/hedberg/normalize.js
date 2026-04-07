/**
 * Attribute normalization. Heals legacy and alternative attribute names
 * from model output into canonical form.
 *
 * - value="" → body=""
 * - file="" or key="" → path="" (first unrecognized attr becomes path)
 * - preview="" → preview=true
 */

const KNOWN_ATTRS = new Set([
	"path",
	"body",
	"preview",
	"question",
	"options",
	"search",
	"replace",
	"to",
	"results",
	"command",
	"warn",
	"stored",
	"summary",
	"full",
	"index",
]);

export function normalizeAttrs(attrs) {
	const out = { ...attrs };
	if ("value" in out && !("body" in out)) {
		out.body = out.value;
		delete out.value;
	}
	if (!out.path) {
		for (const [k, v] of Object.entries(out)) {
			if (!KNOWN_ATTRS.has(k) && v) {
				out.path = v;
				delete out[k];
				break;
			}
		}
	}
	if ("preview" in out) out.preview = true;
	if ("stored" in out) out.stored = true;
	if ("summary" in out) out.summary = out.summary || true;
	if ("full" in out) out.full = true;
	if ("index" in out) out.index = true;
	return out;
}

/**
 * Parse JSON-style edit from body content.
 * Accepts: {"search":"old","replace":"new"} and {search="old",replace="new"}
 * Returns { search, replace } or null.
 */
export function parseJsonEdit(text) {
	const trimmed = text.trim();
	if (!trimmed.startsWith("{") || !/search/.test(trimmed)) return null;
	try {
		const json = JSON.parse(trimmed);
		if (json.search != null)
			return { search: json.search, replace: json.replace ?? "" };
	} catch {
		const searchMatch = trimmed.match(/search\s*=\s*"([^"]*)"/);
		const replaceMatch = trimmed.match(/replace\s*=\s*"([^"]*)"/);
		if (searchMatch) {
			return { search: searchMatch[1], replace: replaceMatch?.[1] ?? "" };
		}
	}
	return null;
}
