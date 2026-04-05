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
	return out;
}
