/**
 * Token estimation using tiktoken (o200k_base) with a conservative
 * multiplier to account for less efficient tokenizers (gemma, qwen).
 *
 * o200k gives proportionally correct counts — code is denser than
 * prose, CJK denser than ASCII. The 3x multiplier covers the worst
 * case (digit sequences: o200k groups digits, other tokenizers
 * tokenize each digit individually).
 */

const TOKENIZER_MULTIPLIER = 2;

let encoder = null;

try {
	const tiktoken = await import("tiktoken");
	encoder = tiktoken.get_encoding("o200k_base");
} catch {
	// tiktoken unavailable — use character-based estimate
}

export function countTokens(text) {
	if (!text) return 0;
	if (encoder) {
		try {
			return encoder.encode(text).length * TOKENIZER_MULTIPLIER;
		} catch {
			// Fallback on encoding error
		}
	}
	return Math.ceil(text.length / 1.5);
}
