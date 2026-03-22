/**
 * TaskParser: Static utility for parsing markdown task lists.
 */
export default class TaskParser {
	static parse(text) {
		if (!text) return { list: [], next: null };

		const lines = text.split(/\r?\n/);
		const list = [];
		let next = null;

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;

			// Match markdown checkbox patterns: - [x] or - [ ]
			const match = trimmed.match(/^[-*]\s*\[([ xX])] (.*)$/);
			if (match) {
				const completed = match[1].toLowerCase() === "x";
				const taskText = match[2].trim();
				const taskObj = { text: taskText, completed };
				list.push(taskObj);

				if (!completed && !next) {
					next = taskObj;
				}
			} else {
				// Fallback for non-checkbox lines within the tasks tag
				const taskObj = {
					text: trimmed.replace(/^[-*]\s*/, ""),
					completed: false,
				};
				list.push(taskObj);
				if (!next) next = taskObj;
			}
		}

		return { list, next };
	}
}
