export class ContextExceededError extends Error {
	constructor(message, { cause } = {}) {
		super(message);
		this.name = "ContextExceededError";
		if (cause) this.cause = cause;
	}
}

const CONTEXT_EXCEEDED_PATTERN =
	/\b(context.*(size|length|limit)|token.*(limit|exceed)|too.*(long|large))\b/i;

export function isContextExceededMessage(message) {
	return CONTEXT_EXCEEDED_PATTERN.test(String(message));
}

const ABORT_PATTERN = /\b(aborted|AbortError|TimeoutError)\b/;
// `terminated` = undici socket close mid-fetch (same lane as ECONNRESET).
const GATEWAY_PATTERN =
	/\b(502|504|ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|EPIPE|ECONNABORTED|fetch failed|terminated)\b/i;
const RATE_LIMIT_PATTERN = /\b429\b/;
const STATUS_503_PATTERN = /\b503\b/;
const STATUS_500_PATTERN = /\b500\b/;
const MODEL_WARMUP_PATTERN = /\bLoading model\b/i;

// Returns "gateway" | "warmup" | "rate_limit" | "server" | null (don't retry).
export function classifyTransient(err) {
	if (!err || typeof err.message !== "string") return null;
	const { message } = err;

	if (ABORT_PATTERN.test(message)) return null;
	if (GATEWAY_PATTERN.test(message)) return "gateway";
	if (RATE_LIMIT_PATTERN.test(message)) return "rate_limit";
	if (STATUS_503_PATTERN.test(message)) {
		if (MODEL_WARMUP_PATTERN.test(message)) return "warmup";
		if (typeof err.body === "string" && MODEL_WARMUP_PATTERN.test(err.body)) {
			return "warmup";
		}
		return "server";
	}
	if (STATUS_500_PATTERN.test(message)) return "server";
	return null;
}

// HTTP Retry-After in seconds; undefined for missing/malformed/HTTP-date.
export function parseRetryAfter(value) {
	if (!value) return undefined;
	const seconds = Number(value);
	if (Number.isFinite(seconds) && seconds >= 0) return seconds;
	return undefined;
}
