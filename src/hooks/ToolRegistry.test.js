import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ToolRegistry from "./ToolRegistry.js";

describe("ToolRegistry", () => {
	it("ensureTool registers a tool exactly once", () => {
		const reg = new ToolRegistry();
		reg.ensureTool("set");
		const first = reg.get("set");
		reg.ensureTool("set");
		assert.strictEqual(reg.get("set"), first);
		assert.equal(reg.has("set"), true);
		assert.equal(reg.has("nope"), false);
	});

	it("get returns undefined for unregistered scheme", () => {
		const reg = new ToolRegistry();
		assert.equal(reg.get("missing"), undefined);
	});

	it("dispatch invokes handlers in priority order; returns false short-circuits", async () => {
		const reg = new ToolRegistry();
		reg.ensureTool("set");
		const order = [];
		reg.onHandle(
			"set",
			async () => {
				order.push("a");
				return false;
			},
			10,
		);
		reg.onHandle(
			"set",
			async () => {
				order.push("b");
			},
			20,
		);
		await reg.dispatch("set", { path: "x" }, {});
		assert.deepEqual(order, ["a"]);
	});

	it("dispatch with no handlers is a no-op", async () => {
		const reg = new ToolRegistry();
		await reg.dispatch("absent", { path: "x" }, {});
	});

	it("dispatch passes both entry and rummy to handlers", async () => {
		const reg = new ToolRegistry();
		reg.ensureTool("set");
		let captured;
		reg.onHandle("set", async (entry, rummy) => {
			captured = { entry, rummy };
		});
		await reg.dispatch("set", { path: "x" }, { run: 1 });
		assert.deepEqual(captured.entry, { path: "x" });
		assert.deepEqual(captured.rummy, { run: 1 });
	});

	it("onView + view returns the registered projection", async () => {
		const reg = new ToolRegistry();
		reg.onView("set", async () => "body");
		const out = await reg.view("set", { path: "x" });
		assert.equal(out, "body");
	});

	it("view normalizes nullish view returns to empty string", async () => {
		const reg = new ToolRegistry();
		reg.onView("set", async () => null);
		assert.equal(await reg.view("set", {}), "");
	});

	it("view returns empty when no view is registered for the scheme", async () => {
		const reg = new ToolRegistry();
		const out = await reg.view("nope", { body: "hello" });
		assert.equal(out, "");
	});

	it("hasView reflects whether a view is registered", () => {
		const reg = new ToolRegistry();
		assert.equal(reg.hasView("set"), false);
		reg.onView("set", async () => "v");
		assert.equal(reg.hasView("set"), true);
	});

	it("mimetype-keyed view preempts scheme view when entry carries that mimetype", async () => {
		const reg = new ToolRegistry();
		reg.onView("known", async () => "scheme-rendered");
		reg.onViewByMimetype("text/markdown", async () => "mimetype-rendered");
		const out = await reg.view("known", {
			path: "known://x",
			attributes: { mimetype: "text/markdown" },
		});
		assert.equal(out, "mimetype-rendered");
	});

	it("scheme view runs when no mimetype handler is registered for the entry's mimetype", async () => {
		const reg = new ToolRegistry();
		reg.onView("known", async () => "scheme-rendered");
		reg.onViewByMimetype("application/pdf", async () => "pdf");
		const out = await reg.view("known", {
			path: "known://x",
			attributes: { mimetype: "text/markdown" },
		});
		assert.equal(out, "scheme-rendered");
	});

	it("scheme view runs when entry has no mimetype attribute", async () => {
		const reg = new ToolRegistry();
		reg.onView("set", async () => "scheme");
		reg.onViewByMimetype("text/markdown", async () => "mt");
		const out = await reg.view("set", { path: "x", attributes: {} });
		assert.equal(out, "scheme");
	});

	it("entry.attributes string-form is parsed before mimetype lookup", async () => {
		const reg = new ToolRegistry();
		reg.onView("known", async () => "scheme");
		reg.onViewByMimetype("text/markdown", async () => "mt");
		const out = await reg.view("known", {
			path: "known://x",
			attributes: JSON.stringify({ mimetype: "text/markdown" }),
		});
		assert.equal(out, "mt");
	});

	it("hasMimetypeView reflects whether a mimetype view is registered", () => {
		const reg = new ToolRegistry();
		assert.equal(reg.hasMimetypeView("text/markdown"), false);
		reg.onViewByMimetype("text/markdown", async () => "x");
		assert.equal(reg.hasMimetypeView("text/markdown"), true);
	});

	it("log entries skip mimetype dispatch — action handler always wins for logs", async () => {
		const reg = new ToolRegistry();
		reg.onView("get", async () => "action-rendered");
		reg.onViewByMimetype("text/markdown", async () => "mimetype-rendered");
		// Materialized log entry: scheme="log", action segment projects via
		// "get" view, mimetype attr is metadata only.
		const out = await reg.view("get", {
			path: "log://1/1/1/get",
			scheme: "log",
			attributes: { mimetype: "text/markdown", action: "get" },
		});
		assert.equal(
			out,
			"action-rendered",
			"action handler wins; mimetype dispatch skipped for log entries",
		);
	});

	it("names sorts using TOOL_ORDER and pins update last", () => {
		const reg = new ToolRegistry();
		for (const n of ["update", "set", "think", "get", "extra"])
			reg.ensureTool(n);
		const names = reg.names;
		assert.equal(names[0], "think");
		assert.equal(names.at(-1), "update");
		assert.ok(names.indexOf("get") < names.indexOf("set"));
	});

	it("names places out-of-list tools alphabetically after known ones", () => {
		const reg = new ToolRegistry();
		for (const n of ["set", "zeta", "alpha"]) reg.ensureTool(n);
		const names = reg.names;
		assert.equal(names[0], "set");
		assert.deepEqual(names.slice(1), ["alpha", "zeta"]);
	});

	it("advertisedNames excludes hidden tools", () => {
		const reg = new ToolRegistry();
		for (const n of ["think", "set", "secret"]) reg.ensureTool(n);
		reg.markHidden("secret");
		assert.deepEqual(reg.advertisedNames, ["think", "set"]);
	});

	it("resolveForLoop ask mode excludes 'sh'", () => {
		const reg = new ToolRegistry();
		for (const n of ["think", "set", "sh"]) reg.ensureTool(n);
		const names = reg.resolveForLoop("ask");
		assert.equal(names.has("sh"), false);
		assert.equal(names.has("think"), true);
	});

	it("resolveForLoop noInteraction excludes 'ask_user'", () => {
		const reg = new ToolRegistry();
		for (const n of ["think", "ask_user"]) reg.ensureTool(n);
		const names = reg.resolveForLoop("act", { noInteraction: true });
		assert.equal(names.has("ask_user"), false);
	});

	it("resolveForLoop noWeb excludes 'search'", () => {
		const reg = new ToolRegistry();
		for (const n of ["think", "search"]) reg.ensureTool(n);
		const names = reg.resolveForLoop("act", { noWeb: true });
		assert.equal(names.has("search"), false);
	});

	it("resolveForLoop noProposals excludes ask_user/env/sh", () => {
		const reg = new ToolRegistry();
		for (const n of ["think", "ask_user", "env", "sh"]) reg.ensureTool(n);
		const names = reg.resolveForLoop("act", { noProposals: true });
		assert.equal(names.has("ask_user"), false);
		assert.equal(names.has("env"), false);
		assert.equal(names.has("sh"), false);
		assert.equal(names.has("think"), true);
	});

	it("entries() yields all registered [name, def] pairs", () => {
		const reg = new ToolRegistry();
		reg.ensureTool("set");
		reg.ensureTool("think");
		const names = [...reg.entries()].map(([n]) => n).toSorted();
		assert.deepEqual(names, ["set", "think"]);
	});
});
