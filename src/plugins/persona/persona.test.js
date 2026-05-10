import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Persona from "./persona.js";

function makeCore() {
	const schemes = [];
	const filters = [];
	return {
		registerScheme: (opts) => schemes.push(opts),
		filter: (name, fn, priority) => filters.push({ name, fn, priority }),
		_schemes: schemes,
		_filters: filters,
	};
}

describe("Persona plugin", () => {
	it("registers persona scheme (default projection — no view registration)", () => {
		const core = makeCore();
		new Persona(core);
		assert.deepEqual(core._schemes, [{ name: "persona", category: "data" }]);
	});

	it("registers an assembly.user filter at priority 10 (top of user)", () => {
		const core = makeCore();
		new Persona(core);
		const f = core._filters.find((x) => x.name === "assembly.user");
		assert.ok(f, "registers an assembly.user filter");
		assert.equal(f.priority, 10);
	});

	it("wraps persona body in <system_instructions> when ctx.persona is set", () => {
		const core = makeCore();
		new Persona(core);
		const f = core._filters.find((x) => x.name === "assembly.user");
		const out = f.fn("seed", { persona: "You are a careful auditor." });
		assert.ok(out.startsWith("seed"), "preserves prior chain content");
		assert.ok(out.includes("<system_instructions>"), "renders the open tag");
		assert.ok(out.includes("</system_instructions>"), "renders the close tag");
		assert.ok(
			out.includes("You are a careful auditor."),
			"renders the persona body",
		);
	});

	it("passes content through unchanged when ctx.persona is empty", () => {
		const core = makeCore();
		new Persona(core);
		const f = core._filters.find((x) => x.name === "assembly.user");
		assert.equal(f.fn("seed", {}), "seed");
		assert.equal(f.fn("seed", { persona: "" }), "seed");
	});
});
