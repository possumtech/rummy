import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import Skill from "./skill.js";

function makeCore() {
	const schemes = [];
	let handler = null;
	let hidden = false;
	return {
		registerScheme: (opts) => schemes.push(opts),
		on: (event, fn) => {
			if (event === "handler") handler = fn;
		},
		markHidden: () => {
			hidden = true;
		},
		_schemes: schemes,
		_handler: () => handler,
		_hidden: () => hidden,
	};
}

function makeStore() {
	const writes = [];
	return {
		writes,
		set: async (params) => {
			writes.push(params);
		},
	};
}

function rummyCtxFor(store, projectRoot) {
	return {
		entries: store,
		sequence: 0,
		runId: "r1",
		loopId: null,
		projectId: "p1",
		db: {
			get_project_by_id: {
				get: async () => ({ project_root: projectRoot }),
			},
		},
	};
}

describe("Skill plugin", () => {
	let tmp;

	beforeEach(async () => {
		tmp = await mkdtemp(join(tmpdir(), "skill-test-"));
	});

	afterEach(async () => {
		await rm(tmp, { recursive: true, force: true });
	});

	it("registers skill scheme + handler, hides the tool from model advertisement", async () => {
		const core = makeCore();
		new Skill(core);
		assert.deepEqual(core._schemes, [{ name: "skill", category: "data" }]);
		assert.equal(typeof core._handler(), "function");
		// Host-mediated only: RPC tool fallback dispatches the handler;
		// the model never sees <skill> in <system_commands>.
		assert.equal(
			core._hidden(),
			true,
			"skill tool is hidden from advertisement",
		);
	});

	it("emits validation failure when path missing", async () => {
		const core = makeCore();
		new Skill(core);
		const store = makeStore();
		await core._handler()(
			{ attributes: {}, resultPath: "log://1/0/1/skill" },
			rummyCtxFor(store, tmp),
		);
		const fail = store.writes.find((w) => w.state === "failed");
		assert.ok(fail);
		assert.equal(fail.outcome, "validation");
	});

	it("ingests single .md file as skill://<basename> (indexed)", async () => {
		await writeFile(join(tmp, "playbook.md"), "# playbook root");
		const core = makeCore();
		new Skill(core);
		const store = makeStore();
		await core._handler()(
			{
				attributes: { path: "playbook.md" },
				resultPath: "log://1/0/1/skill",
			},
			rummyCtxFor(store, tmp),
		);
		const entry = store.writes.find((w) => w.path === "skill://playbook");
		assert.ok(entry);
		assert.equal(entry.body, "# playbook root");
		assert.equal(entry.visibility, "indexed");
		const result = store.writes.find((w) => w.path === "log://1/0/1/skill");
		assert.equal(result.state, "resolved");
	});

	it("ingests folder: index.md → root indexed, others archived; foo/index.md collapses", async () => {
		const root = join(tmp, "playbook");
		await mkdir(join(root, "foo"), { recursive: true });
		await writeFile(join(root, "index.md"), "root");
		await writeFile(join(root, "intro.md"), "intro page");
		await writeFile(join(root, "foo", "index.md"), "foo root");
		await writeFile(join(root, "foo", "bar.md"), "foo bar");

		const core = makeCore();
		new Skill(core);
		const store = makeStore();
		await core._handler()(
			{
				attributes: { path: "playbook" },
				resultPath: "log://1/0/1/skill",
			},
			rummyCtxFor(store, tmp),
		);

		const byPath = Object.fromEntries(
			store.writes
				.filter((w) => w.path?.startsWith("skill://"))
				.map((w) => [w.path, w]),
		);
		assert.ok(byPath["skill://playbook"]);
		assert.equal(byPath["skill://playbook"].visibility, "indexed");
		assert.equal(byPath["skill://playbook/intro"].visibility, "archived");
		assert.equal(byPath["skill://playbook/foo"].body, "foo root");
		assert.equal(byPath["skill://playbook/foo"].visibility, "archived");
		assert.equal(byPath["skill://playbook/foo/bar"].body, "foo bar");
	});

	it("emits not_found when relative path doesn't resolve", async () => {
		const core = makeCore();
		new Skill(core);
		const store = makeStore();
		await core._handler()(
			{
				attributes: { path: "nope.md" },
				resultPath: "log://1/0/1/skill",
			},
			rummyCtxFor(store, tmp),
		);
		const fail = store.writes.find((w) => w.state === "failed");
		assert.ok(fail);
		assert.equal(fail.outcome, "not_found");
	});
});
