import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Persona from "./persona.js";

function makeCore() {
	const views = new Map();
	const schemes = [];
	const filters = [];
	return {
		registerScheme: (opts) => schemes.push(opts),
		filter: (name, fn, priority) => filters.push({ name, fn, priority }),
		hooks: {
			tools: {
				onView: (scheme, fn, vis) => {
					if (!views.has(scheme)) views.set(scheme, new Map());
					views.get(scheme).set(vis, fn);
				},
			},
		},
		_view: (scheme, vis) => views.get(scheme)?.get(vis),
		_schemes: schemes,
		_filters: filters,
	};
}

describe("Persona plugin", () => {
	it("registers persona scheme + visible/summarized views", () => {
		const core = makeCore();
		new Persona(core);
		assert.deepEqual(core._schemes, [{ name: "persona", category: "data" }]);
		assert.equal(core._view("persona", "visible")({ body: "hi" }), "hi");
		assert.equal(core._view("persona", "summarized")(), "");
	});

	it("registers an assembly.user filter at priority 10 (top of user)", () => {
		const core = makeCore();
		new Persona(core);
		const f = core._filters.find((x) => x.name === "assembly.user");
		assert.ok(f, "registers an assembly.user filter");
		assert.equal(f.priority, 10);
	});

	it("appends the Operational Persona block when ctx.persona is set", () => {
		const core = makeCore();
		new Persona(core);
		const f = core._filters.find((x) => x.name === "assembly.user");
		const out = f.fn("seed", { persona: "You are a careful auditor." });
		assert.ok(out.startsWith("seed"), "preserves prior chain content");
		assert.ok(
			out.includes("## Operational Persona"),
			"renders the persona heading",
		);
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
