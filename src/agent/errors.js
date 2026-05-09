// Recoverable outcomes — recorded but no strike.
export const SOFT_FAILURE_OUTCOMES = new Set([
	"not_found",
	"conflict",
	"unparsed",
]);

// SPEC writer_tiers.
export class PermissionError extends Error {
	constructor(scheme, writer, allowed) {
		const schemeLabel = scheme === null ? "(none)" : scheme;
		super(
			`403: writer "${writer}" not permitted for scheme "${schemeLabel}" (allowed: ${allowed.join(", ")})`,
		);
		this.name = "PermissionError";
		this.scheme = scheme;
		this.writer = writer;
		this.allowed = [...allowed];
	}
}

// 413 strike: body exceeded entries.body CHECK (RUMMY_ENTRY_SIZE_MAX).
export class EntryOverflowError extends Error {
	constructor(path, size) {
		super(
			`413: entry "${path}" body ${size} bytes exceeds RUMMY_ENTRY_SIZE_MAX`,
		);
		this.name = "EntryOverflowError";
		this.path = path;
		this.size = size;
	}
}
