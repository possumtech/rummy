import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Entries from "./Entries.js";
import { EntryOverflowError } from "./errors.js";

function mockDb({ entryExists = () => null } = {}) {
	return {
		get_all_schemes: { all: async () => [] },
		next_turn: { run: async () => ({}), get: async () => ({ turn: 1 }) },
		next_loop_turn: { get: async () => ({ turn: 1 }) },
		next_turn_seq: { get: async () => ({ seq: 1 }) },
		get_loop_sequence: { get: async () => ({ sequence: 1 }) },
		get_entry_body: { get: async ({ path }) => entryExists(path) },
	};
}

describe("Entries.scheme (static)", () => {
	it("returns null for nullish/empty paths", () => {
		assert.equal(Entries.scheme(null), null);
		assert.equal(Entries.scheme(undefined), null);
		assert.equal(Entries.scheme(""), null);
	});

	it("returns null for bare paths (no ://)", () => {
		assert.equal(Entries.scheme("src/app.js"), null);
		assert.equal(Entries.scheme("README.md"), null);
	});

	it("extracts scheme from prefix://...", () => {
		assert.equal(Entries.scheme("known://auth"), "known");
		assert.equal(Entries.scheme("log://turn_1/set/x"), "log");
		assert.equal(Entries.scheme("https://example.com"), "https");
	});

	it("returns null when :// is at index 0 (empty scheme)", () => {
		assert.equal(Entries.scheme("://x"), null);
	});
});

describe("Entries.normalizePath (static)", () => {
	it("returns bare path unchanged", () => {
		assert.equal(Entries.normalizePath("src/app.js"), "src/app.js");
		assert.equal(Entries.normalizePath("README.md"), "README.md");
	});

	it("strips a leading ./ on bare paths so ./main.go and main.go collide", () => {
		// CC-17 path-form split: models that wrote `./main.go` were
		// landing in a phantom entry separate from the scanner-
		// registered `main.go`, so SEARCH/REPLACE edits couldn't see
		// the original body.
		assert.equal(Entries.normalizePath("./main.go"), "main.go");
		assert.equal(Entries.normalizePath("./src/app.js"), "src/app.js");
		// Don't touch parent-relative or absolute forms.
		assert.equal(Entries.normalizePath("../parent.js"), "../parent.js");
		assert.equal(Entries.normalizePath("/abs/path.js"), "/abs/path.js");
	});

	it("lowercases scheme", () => {
		assert.equal(Entries.normalizePath("KNOWN://Foo"), "known://Foo");
	});

	it("preserves slashes in the rest, encodes segments", () => {
		assert.equal(Entries.normalizePath("known://a/b c/d"), "known://a/b_c/d");
	});

	it("decode-then-re-encodes is idempotent", () => {
		const once = Entries.normalizePath("known://hello world");
		const twice = Entries.normalizePath(once);
		assert.equal(once, twice);
	});

	it("falls back to direct re-encode on decode failure (malformed %)", () => {
		// Lone % is not a valid percent-escape; decodeURIComponent throws.
		const out = Entries.normalizePath("known://50%");
		assert.equal(out, "known://50%25");
	});
});

describe("Entries instance methods (DB-backed)", () => {
	it("constructs with onChanged callback", () => {
		const calls = [];
		const e = new Entries(mockDb(), {
			onChanged: (event) => calls.push(event),
		});
		assert.ok(e);
	});

	it("nextTurn returns per-loop turn from next_loop_turn", async () => {
		const e = new Entries(mockDb());
		// runId=7, loopId=42 — mock returns turn=1 regardless.
		assert.equal(await e.nextTurn(7, 42), 1);
	});

	it("nextSeq returns the per-turn sequence from next_turn_seq", async () => {
		const e = new Entries(mockDb());
		assert.equal(await e.nextSeq(1, 1, 1), 1);
	});

	it("logPath produces log://<L>/<T>/<S>/<action>", async () => {
		// loopSeq=4, turn=3, seq=1, action=set
		const db = mockDb();
		db.get_loop_sequence.get = async () => ({ sequence: 4 });
		db.next_turn_seq.get = async () => ({ seq: 1 });
		const e = new Entries(db);
		const path = await e.logPath(7, 99, 3, "set");
		assert.equal(path, "log://4/3/1/set");
	});

	it("logPath fits in any sane path budget — no slug to grow", async () => {
		const db = mockDb();
		db.get_loop_sequence.get = async () => ({ sequence: 1 });
		db.next_turn_seq.get = async () => ({ seq: 1 });
		const e = new Entries(db);
		const path = await e.logPath(1, 1, 1, "set");
		assert.ok(path.length < 50, `logPath stays short: ${path.length}`);
	});

	it("slugPath uses summary, falls back to content, then sequence-only", async () => {
		const e = new Entries(mockDb());
		// summary wins (slugify preserves case; just lowercases via output)
		const a = await e.slugPath(1, "known", "the content body", "Auth Token");
		assert.match(a, /^known:\/\/[A-Za-z]+_[A-Za-z]+/);
		assert.match(a, /Auth/i);
		// content used when no summary
		const b = await e.slugPath(1, "known", "Login Flow", null);
		assert.match(b, /^known:\/\/[A-Za-z]+_[A-Za-z]+/);
		assert.match(b, /Login/i);
		// no source → sequence-only
		const c = await e.slugPath(1, "known", "", "");
		assert.match(c, /^known:\/\/\d+$/);
	});

	it("slugPath sequence-suffixes when slugified path already exists", async () => {
		let calls = 0;
		const db = mockDb({
			entryExists: () => (++calls === 1 ? { body: "exists" } : null),
		});
		const e = new Entries(db);
		const out = await e.slugPath(1, "known", "auth", null);
		assert.match(out, /^known:\/\/auth_\d+$/);
	});

	it("dedup returns base path on first attempt, suffix on collision", async () => {
		// Fresh: no collision
		const fresh = new Entries(mockDb());
		const a = await fresh.dedup(1, "known", "hello", 3);
		assert.equal(a, "known://turn_3/hello");

		// Collision: returns suffixed path
		let calls = 0;
		const colliding = new Entries(
			mockDb({ entryExists: () => (++calls === 1 ? { body: "x" } : null) }),
		);
		const b = await colliding.dedup(1, "known", "hello", 3);
		assert.match(b, /^known:\/\/turn_3\/hello_\d+$/);
	});

	it("dedup omits turn prefix when turn falsy", async () => {
		const e = new Entries(mockDb());
		assert.equal(await e.dedup(1, "known", "hello", 0), "known://hello");
		assert.equal(await e.dedup(1, "known", "hello", null), "known://hello");
	});

	it("set routes EntryOverflowError to onError callback and returns silently", async () => {
		const checkErr = new Error(
			"CHECK constraint failed: length(body) <= 104857600",
		);
		checkErr.code = "SQLITE_CONSTRAINT_CHECK";
		const db = {
			...mockDb(),
			upsert_entry: {
				get: async () => {
					throw checkErr;
				},
			},
		};
		const errors = [];
		const e = new Entries(db, {
			onError: (event) => errors.push(event),
		});
		// Pre-load schemes so set() doesn't try to fetch them mid-test.
		await e.loadSchemes();
		const huge = "x".repeat(200);
		await e.set({
			runId: 1,
			turn: 3,
			path: "data://turn_3/sh/big",
			body: huge,
			loopId: 7,
		});
		assert.equal(errors.length, 1);
		assert.ok(errors[0].error instanceof EntryOverflowError);
		assert.equal(errors[0].error.path, "data://turn_3/sh/big");
		assert.equal(errors[0].error.size, 200);
		assert.equal(errors[0].runId, 1);
		assert.equal(errors[0].turn, 3);
		assert.equal(errors[0].loopId, 7);
	});

	it("set propagates EntryOverflowError when no onError callback is registered", async () => {
		const checkErr = new Error(
			"CHECK constraint failed: length(body) <= 104857600",
		);
		checkErr.code = "SQLITE_CONSTRAINT_CHECK";
		const db = {
			...mockDb(),
			upsert_entry: {
				get: async () => {
					throw checkErr;
				},
			},
		};
		const e = new Entries(db);
		await e.loadSchemes();
		await assert.rejects(
			() =>
				e.set({
					runId: 1,
					turn: 1,
					path: "data://x",
					body: "abc",
				}),
			EntryOverflowError,
		);
	});

	it("set re-throws non-overflow SQL errors without invoking onError", async () => {
		const otherErr = new Error("UNIQUE constraint failed: entries.path");
		otherErr.code = "SQLITE_CONSTRAINT_UNIQUE";
		const db = {
			...mockDb(),
			upsert_entry: {
				get: async () => {
					throw otherErr;
				},
			},
		};
		const errors = [];
		const e = new Entries(db, {
			onError: (event) => errors.push(event),
		});
		await e.loadSchemes();
		await assert.rejects(
			() =>
				e.set({
					runId: 1,
					turn: 1,
					path: "data://x",
					body: "abc",
				}),
			/UNIQUE constraint/,
		);
		assert.equal(errors.length, 0);
	});

	it("loadSchemes populates the scheme cache", async () => {
		const rows = [
			{ name: "known", default_scope: "run", category: "data" },
			{ name: "log", default_scope: "run", category: "logging" },
		];
		const db = {
			...mockDb(),
			get_all_schemes: { all: async () => rows },
		};
		const e = new Entries(db);
		await e.loadSchemes();
		// Subsequent loads are idempotent (no error).
		await e.loadSchemes();
	});
});
