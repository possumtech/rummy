import * as parse5 from "parse5";

/**
 * ResponseParser: Focused logic for parsing LLM output and managing DOM nodes.
 */
export default class ResponseParser {
	getNodeText(node) {
		const html = parse5.serialize(node);
		return html
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&amp;/g, "&")
			.replace(/&quot;/g, '"');
	}

	mergePrefill(prefill, content) {
		if (content.startsWith(prefill)) {
			return content;
		}
		if (
			content.startsWith("] ") ||
			content.startsWith("x] ") ||
			content.startsWith(" ] ")
		) {
			return prefill + content;
		}
		if (!content.includes("<tasks>")) {
			return prefill + content;
		}
		return content;
	}

	appendAssistantContent(turnObj, tagName, content) {
		const doc = turnObj.doc;
		const assistantEl = doc.getElementsByTagName("assistant")[0];
		let targetEl = assistantEl.getElementsByTagName(tagName)[0];
		if (!targetEl) {
			targetEl = doc.createElement(tagName);
			assistantEl.appendChild(targetEl);
		}

		const frag = parse5.parseFragment(content);
		this.convertToXmlDom(doc, targetEl, frag);
	}

	convertToXmlDom(doc, target, p5Node) {
		if (p5Node.nodeName === "#text") {
			target.appendChild(doc.createTextNode(p5Node.value));
		} else if (p5Node.tagName) {
			const el = doc.createElement(p5Node.tagName);
			if (p5Node.attrs) {
				for (const attr of p5Node.attrs) {
					el.setAttribute(attr.name, attr.value);
				}
			}
			target.appendChild(el);
			if (p5Node.childNodes) {
				for (const child of p5Node.childNodes) {
					this.convertToXmlDom(doc, el, child);
				}
			}
		} else if (p5Node.childNodes) {
			for (const child of p5Node.childNodes) {
				this.convertToXmlDom(doc, target, child);
			}
		}
	}

	parseActionTags(content) {
		const frag = parse5.parseFragment(content);
		const tags = [];
		const traverse = (node) => {
			if (
				node.tagName &&
				[
					"read",
					"env",
					"run",
					"create",
					"delete",
					"edit",
					"prompt_user",
					"summary",
					"tasks",
					"analysis",
					"info",
				].includes(node.tagName)
			) {
				tags.push(node);
			}
			if (node.childNodes) {
				for (const child of node.childNodes) {
					traverse(child);
				}
			}
		};
		traverse(frag);
		return tags;
	}
}
