import { parseRetryAfter } from "./errors.js";

// SSE client for OpenAI-compatible /chat/completions. Streaming keeps
// long completions alive through CDN proxies (Cloudflare's 100s timeout).
// Returns non-streaming shape { choices, usage, model, chunkMetadata };
// throws on non-2xx with err.status / err.body / err.retryAfter.
export async function chatCompletionStream({ url, headers, body, signal }) {
	const requestBody = {
		...body,
		stream: true,
		stream_options: { include_usage: true },
	};

	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body: JSON.stringify(requestBody),
		signal,
	});

	if (!response.ok) {
		const errorBody = await response.text();
		const err = new Error(`${response.status} - ${errorBody}`);
		err.status = response.status;
		err.body = errorBody;
		err.retryAfter = parseRetryAfter(response.headers.get("retry-after"));
		throw err;
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();

	let buffer = "";
	let content = "";
	let reasoningContent = "";
	let usage = null;
	let model = null;
	let finishReason = null;
	// Last-seen wins for catch-all chunk fields (id, system_fingerprint, etc).
	const chunkMetadata = {};

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split("\n");
		buffer = lines.pop();

		for (const rawLine of lines) {
			const line = rawLine.trim();
			if (!line.startsWith("data:")) continue;
			const payload = line.slice(5).trimStart();
			if (payload === "[DONE]" || payload === "") continue;

			let chunk;
			try {
				chunk = JSON.parse(payload);
			} catch {
				continue;
			}

			if (chunk.model) model = chunk.model;
			if (chunk.usage) usage = chunk.usage;

			for (const [k, v] of Object.entries(chunk)) {
				if (k === "choices" || k === "usage") continue;
				chunkMetadata[k] = v;
			}

			const choice = chunk.choices?.[0];
			if (!choice) continue;
			if (choice.finish_reason) finishReason = choice.finish_reason;

			const delta = choice.delta;
			if (!delta) continue;
			if (typeof delta.content === "string") content += delta.content;
			// Reasoning surfaces under different field names per provider.
			if (typeof delta.reasoning_content === "string")
				reasoningContent += delta.reasoning_content;
			if (typeof delta.reasoning === "string")
				reasoningContent += delta.reasoning;
			if (typeof delta.thinking === "string")
				reasoningContent += delta.thinking;
		}
	}

	return {
		model,
		choices: [
			{
				message: {
					role: "assistant",
					content,
					reasoning_content: reasoningContent,
				},
				finish_reason: finishReason,
			},
		],
		usage,
		chunkMetadata,
	};
}
