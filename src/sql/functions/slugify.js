export const deterministic = true;

// Slice on decoded text, then encode — slicing the encoded string can cut
// mid-escape (%2C → %2) which throws decodeURIComponent later, triggering
// the normalizePath catch path that double-encodes the result.
export default function slugify(text) {
	if (!text) return "";
	return encodeURIComponent(text.slice(0, 80));
}
