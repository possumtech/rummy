// Per-block literal-then-fuzzy-then-indent-heal applier. udiff.applyModel
// delegates to Hedberg.replace (which uses this) for per-hunk rescue
// when strict apply fails. Edit-shape rendering lives in udiff.js;
// this module only matches and patches.

export default class HeuristicMatcher {
	static matchAndPatch(entryBody, searchBlock, replaceBlock) {
		// Unescape common regex escapes (models often escape brackets, parens, etc.)
		const unescaped = searchBlock.replace(/\\([[\](){}.*+?^$|\\])/g, "$1");
		if (unescaped !== searchBlock && entryBody.includes(unescaped)) {
			searchBlock = unescaped;
		}

		const searchLines = searchBlock.split(/\r?\n/);
		const fileLines = entryBody.split(/\r?\n/);

		// 1. Exact Match Attempt (line-boundary substring search).
		// Requires BOTH start and end of the match to land on line
		// boundaries — prefix-only matches (e.g. SEARCH `Foo` against
		// body line `Foo (extra)`) used to splice mid-line and corrupt
		// the surrounding content.
		let exactIdx = entryBody.indexOf(searchBlock);
		let lastExactIdx = -1;
		let exactCount = 0;
		while (exactIdx !== -1) {
			const startAtBoundary =
				exactIdx === 0 || entryBody[exactIdx - 1] === "\n";
			const endPos = exactIdx + searchBlock.length;
			const endAtBoundary =
				endPos === entryBody.length || entryBody[endPos] === "\n";
			if (startAtBoundary && endAtBoundary) {
				exactCount++;
				lastExactIdx = exactIdx;
			}
			exactIdx = entryBody.indexOf(searchBlock, exactIdx + 1);
		}

		if (exactCount > 0) {
			const useIdx = lastExactIdx;
			const newContent =
				entryBody.slice(0, useIdx) +
				replaceBlock +
				entryBody.slice(useIdx + searchBlock.length);
			const warning =
				exactCount > 1
					? `SEARCH block matched ${exactCount} locations. Edit was applied to the last occurrence. Use more surrounding context in future edits to avoid ambiguity.`
					: null;
			const matchStartLine = entryBody.slice(0, useIdx).split("\n").length;
			const replaceLineCount =
				replaceBlock === "" ? 0 : replaceBlock.split("\n").length;
			const searchLineCount =
				searchBlock === "" ? 0 : searchBlock.split("\n").length;
			return {
				newContent,
				warning,
				error: null,
				matchStartLine,
				replaceLineCount,
				searchLineCount,
			};
		}

		// 2. Fuzzy Tokenized Match (Ignore leading/trailing whitespace per line)
		const searchTokens = searchLines
			.map((l) => l.trim())
			.filter((l) => l !== "");
		const fileTokens = fileLines.map((l) => l.trim());

		if (searchTokens.length === 0) {
			// Empty SEARCH = append REPLACE to end of file
			const trailing = entryBody.endsWith("\n") ? "" : "\n";
			const newContent = `${entryBody + trailing + replaceBlock}\n`;
			const preLines =
				entryBody + trailing === ""
					? 0
					: (entryBody + trailing).split("\n").length - 1;
			return {
				newContent,
				warning: null,
				error: null,
				matchStartLine: preLines + 1,
				replaceLineCount:
					replaceBlock === "" ? 0 : replaceBlock.split("\n").length,
				searchLineCount: 0,
			};
		}

		let matchStartIndex = -1;
		let matchEndIndex = -1;
		let matchCount = 0;

		for (let i = 0; i < fileTokens.length; i++) {
			if (fileTokens[i] === "" && searchTokens[0] !== "") continue;

			let searchIdx = 0;
			let fileIdx = i;

			while (searchIdx < searchTokens.length && fileIdx < fileTokens.length) {
				if (fileTokens[fileIdx] === "" && searchTokens[searchIdx] !== "") {
					fileIdx++;
					continue;
				}

				if (fileTokens[fileIdx] === searchTokens[searchIdx]) {
					searchIdx++;
					fileIdx++;
				} else {
					break;
				}
			}

			if (searchIdx === searchTokens.length) {
				matchCount++;
				matchStartIndex = i;
				matchEndIndex = fileIdx - 1;
			}
		}

		if (matchCount === 0) {
			return {
				newContent: null,
				warning: null,
				error: "SEARCH text not found in current body.",
			};
		}

		const fuzzyAmbiguous = matchCount > 1;

		// 3. Indentation Healing
		const matchedFileLines = fileLines.slice(
			matchStartIndex,
			matchEndIndex + 1,
		);

		const firstFileIndentedLine = matchedFileLines.find((l) => l.trim() !== "");
		const fileIndentMatch = firstFileIndentedLine
			? firstFileIndentedLine.match(/^(\s*)/)
			: null;
		const fileIndent = fileIndentMatch ? fileIndentMatch[1] : "";

		const firstSearchIndentedLine = searchLines.find((l) => l.trim() !== "");
		const searchIndentMatch = firstSearchIndentedLine
			? firstSearchIndentedLine.match(/^(\s*)/)
			: null;
		const searchIndent = searchIndentMatch ? searchIndentMatch[1] : "";

		let healedReplaceBlock = replaceBlock;
		let warning = null;

		if (fileIndent !== searchIndent) {
			warning = `Indentation healing applied. The file has different indentation ('${fileIndent.replace(/\t/g, "\\t").replace(/ /g, "s")}') than your SEARCH block. Please try to match indentation exactly in future edits.`;

			const replaceLines = replaceBlock.split(/\r?\n/);
			const healedLines = replaceLines.map((line) => {
				if (line.trim() === "") return line;
				if (line.startsWith(searchIndent)) {
					return fileIndent + line.substring(searchIndent.length);
				}
				return fileIndent + line.trimStart();
			});
			healedReplaceBlock = healedLines.join("\n");
		}

		const newFileLines = [
			...fileLines.slice(0, matchStartIndex),
			healedReplaceBlock,
			...fileLines.slice(matchEndIndex + 1),
		];
		const newContent = newFileLines.join("\n");

		if (fuzzyAmbiguous) {
			warning =
				(warning ? `${warning} ` : "") +
				`SEARCH block matched ${matchCount} locations. Edit was applied to the last occurrence. Use more surrounding context in future edits to avoid ambiguity.`;
		}

		return {
			newContent,
			warning,
			error: null,
			matchStartLine: matchStartIndex + 1,
			replaceLineCount:
				healedReplaceBlock === "" ? 0 : healedReplaceBlock.split("\n").length,
			searchLineCount: matchEndIndex - matchStartIndex + 1,
		};
	}
}
