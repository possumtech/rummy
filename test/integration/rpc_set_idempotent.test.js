/**
 * RPC `set` state-confirmation is idempotent (@resolution).
 *
 * Race: yolo (or AgentLoop.resolve) auto-accepts a proposal between
 * a client's poll-and-confirm. The client's follow-up
 * `set state=resolved body=""` finds the entry already resolved, so
 * the proposed→AgentLoop.resolve guard in `#dispatchSet` doesn't
 * fire. Without idempotency the raw write below it overwrites body
 * with the client's (often empty) payload, wiping content the first
 * resolver staged — and re-firing the `proposal.accepted` event
 * would double-materialize files on disk.
 *
 * Pre-set body shape contract pinned by
 * `proposal_wire_contract.test.js`. This file pins that the
 * second-confirmation path leaves that content alone, while a
 * legitimate `set state=X attributes={...}` on a terminal entry
 * still applies.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import Entries from "../../src/agent/Entries.js";
import RpcClient from "../helpers/RpcClient.js";
import TestDb from "../helpers/TestDb.js";
import TestServer from "../helpers/TestServer.js";

describe("RPC set state-confirmation is idempotent (@resolution)", () => {
	let tdb, tserver, entries, runAlias, runId, loopId, proposalPath;
	let client;

	before(async () => {
		tdb = await TestDb.create("rpc_set_idempotent");
		entries = new Entries(tdb.db);
		await entries.loadSchemes(tdb.db);
		const seed = await tdb.seedRun({ alias: "idem_race" });
		runAlias = "idem_race";
		runId = seed.runId;
		loopId = seed.loopId;
		proposalPath = await entries.logPath(runId, loopId, 1, "set");
		tserver = await TestServer.start(tdb);
		client = new RpcClient(tserver.url);
		await client.connect();
		await client.call("rummy/hello", {
			name: "idem-test",
			projectRoot: "/tmp/rpc_set_idempotent",
			clientVersion: "2.0.0",
		});
	});

	after(async () => {
		await client?.close();
		await tserver?.stop();
		await tdb?.cleanup();
	});

	it("duplicate state confirmation with empty body preserves the staged body", async () => {
		const staged = "@@ -1,1 +1,1 @@\n-old\n+new";
		// Simulate the first resolver (yolo or AgentLoop.resolve) having
		// already landed: entry sits at state=resolved with the udiff body
		// it staged via #preferExistingBody.
		await entries.set({
			runId,
			loopId,
			turn: 1,
			path: proposalPath,
			body: staged,
			state: "resolved",
			attributes: { path: "src/app.js", op: "search_replace" },
		});

		// Stale duplicate confirmation from a client that polled before
		// the first resolver landed. body="" mirrors AuditClient's auto-
		// resolve shape.
		const res = await client.call("set", {
			run: runAlias,
			path: proposalPath,
			state: "resolved",
			body: "",
		});
		assert.equal(res.ok, true);

		const body = await entries.getBody(runId, proposalPath);
		assert.equal(body, staged, "staged body survives duplicate confirm");
	});

	it("legitimate update with redundant state still applies (no-op is narrow)", async () => {
		const path = await entries.logPath(runId, loopId, 2, "set");
		await entries.set({
			runId,
			loopId,
			turn: 2,
			path,
			body: "@@ -1,1 +1,1 @@\n-a\n+b",
			state: "resolved",
			attributes: { path: "src/x.js", op: "search_replace" },
		});

		// Client passes state=resolved AND a real attributes update.
		// Idempotency check must not swallow this — attributes != null
		// means a meaningful payload, fall through to entries.set.
		const res = await client.call("set", {
			run: runAlias,
			path,
			state: "resolved",
			attributes: { path: "src/x.js", op: "search_replace", tags: "edited" },
		});
		assert.equal(res.ok, true);

		const attrs = await entries.getAttributes(runId, path);
		assert.equal(attrs.tags, "edited", "attrs update applied");
	});
});
