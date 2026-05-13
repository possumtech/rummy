// Mimetype contract. Engine floor: textual mimetypes get line-numbered
// <get> output; binary mimetypes get soft 405 "{mimetype} fetch
// unsupported". SPEC #mimetype defines the rule.

export const DEFAULT_MIMETYPE = "text/markdown";

const TEXTUAL_APPLICATION_SUBTYPES = new Set([
	"json",
	"xml",
	"yaml",
	"x-yaml",
	"javascript",
	"typescript",
	"ecmascript",
	"sql",
	"toml",
	"x-sh",
	"x-shellscript",
]);

const STRUCTURED_SYNTAX_SUFFIXES = ["+json", "+xml", "+yaml"];

export function isTextual(mimetype) {
	if (!mimetype) return true;
	const slash = mimetype.indexOf("/");
	if (slash < 0) return false;
	const type = mimetype.slice(0, slash);
	const subtype = mimetype.slice(slash + 1);
	if (type === "text") return true;
	if (type !== "application") return false;
	if (TEXTUAL_APPLICATION_SUBTYPES.has(subtype)) return true;
	return STRUCTURED_SYNTAX_SUFFIXES.some((s) => subtype.endsWith(s));
}

export function isBinary(mimetype) {
	return !isTextual(mimetype);
}
