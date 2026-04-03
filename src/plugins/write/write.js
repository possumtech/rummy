import HeuristicMatcher from "../../agent/HeuristicMatcher.js";
import KnownStore from "../../agent/KnownStore.js";
import { storePatternResult } from "../helpers.js";

const BOTH = new Set(["ask", "act"]);

export default class WritePlugin {
	static register(hooks) {
		hooks.tools.register("write", {
			modes: BOTH,
			category: "act",
			handler: handleWrite,
			project: (entry) => entry.body,
		});
	}
}

async function handleWrite(entry, rummy) {
	const { entries: store, sequence: turn, runId } = rummy;
	const attrs = entry.attributes || {};

	if (attrs.blocks || attrs.search != null) {
		await processEdit(store, runId, turn, entry, attrs);
		return;
	}

	if (attrs.preview && attrs.path) {
		const matches = await store.getEntriesByPattern(
			runId,
			attrs.path,
			attrs.body,
		);
		await storePatternResult(
			store,
			runId,
			turn,
			"write",
			attrs.path,
			attrs.body,
			matches,
			true,
		);
		return;
	}

	const target = attrs.path;
	if (!target) return;

	const scheme = KnownStore.scheme(target);
	if (scheme === null) {
		const tokenEst = ((entry.body?.length || 0) / 4) | 0;
		await store.upsert(
			runId,
			turn,
			entry.resultPath,
			`${target} (new file, ${tokenEst} tokens)`,
			"proposed",
			{ attributes: { file: target, content: entry.body } },
		);
	} else if (attrs.filter || target.includes("*")) {
		const matches = await store.getEntriesByPattern(
			runId,
			target,
			attrs.filter,
		);
		await store.updateBodyByPattern(
			runId,
			target,
			attrs.filter || null,
			entry.body,
		);
		await storePatternResult(
			store,
			runId,
			turn,
			"write",
			target,
			attrs.filter,
			matches,
		);
	} else {
		await store.upsert(runId, turn, target, entry.body, "full");
	}
}

async function processEdit(store, runId, turn, entry, attrs) {
	const target = attrs.path;
	const matches = await store.getEntriesByPattern(runId, target, attrs.body);

	if (matches.length === 0) {
		await store.upsert(
			runId,
			turn,
			entry.resultPath,
			`${target} — not found in context. Use <read> to load it first.`,
			"error",
			{ attributes: { file: target, error: "not found" } },
		);
		return;
	}

	for (const match of matches) {
		const resultPath = `write://${match.path}`;
		let patch = null;
		let warning = null;
		let error = null;
		let searchText = null;
		let replaceText = null;

		if (attrs.search != null) {
			searchText = attrs.search;
			replaceText = attrs.replace ?? "";
			const isRegex = /[+(){}|\\$^*?[\]]/.test(attrs.search);
			if (isRegex) {
				const re = new RegExp(attrs.search, "g");
				if (re.test(match.body)) {
					patch = match.body.replace(re, replaceText);
				} else {
					error = `Search pattern not found in ${match.path}`;
				}
			} else if (match.body.includes(attrs.search)) {
				patch = match.body.replaceAll(attrs.search, replaceText);
			} else {
				error = `"${attrs.search}" not found in ${match.path}`;
			}
		} else if (attrs.blocks?.length > 0 && attrs.blocks[0].search === null) {
			patch = attrs.blocks[0].replace;
			replaceText = attrs.blocks[0].replace;
		} else if (match.body && attrs.blocks?.length > 0) {
			const block = attrs.blocks[0];
			searchText = block.search;
			replaceText = block.replace;
			const matched = HeuristicMatcher.matchAndPatch(
				match.path,
				match.body,
				block.search,
				block.replace,
			);
			patch = matched.patch;
			warning = matched.warning;
			error = matched.error;
		}

		const state = error ? "error" : match.scheme === null ? "proposed" : "pass";

		const beforeTokens = match.tokens_full || 0;
		const afterTokens = patch ? (patch.length / 4) | 0 : beforeTokens;
		let body;
		if (error) {
			const block = searchText
				? `\n<<<<<<< SEARCH\n${searchText}\n=======\n${replaceText}\n>>>>>>> REPLACE`
				: "";
			body = `${match.path} — ${error}${block}`;
		} else if (searchText) {
			body = `${match.path} (${beforeTokens} → ${afterTokens} tokens)\n<<<<<<< SEARCH\n${searchText}\n=======\n${replaceText}\n>>>>>>> REPLACE`;
		} else {
			body = `${match.path} (${beforeTokens} → ${afterTokens} tokens)`;
		}

		await store.upsert(runId, turn, resultPath, body, state, {
			attributes: {
				file: match.path,
				search: attrs.search,
				replace: attrs.replace,
				blocks: attrs.blocks,
				patch,
				warning,
				error,
			},
		});

		if (state === "pass" && patch) {
			await store.upsert(runId, turn, match.path, patch, match.state);
		}
	}
}
