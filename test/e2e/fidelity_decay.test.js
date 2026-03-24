import assert from "node:assert";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import RpcClient from "../helpers/RpcClient.js";
import TestDb from "../helpers/TestDb.js";
import TestServer from "../helpers/TestServer.js";

describe("E2E: Context Fidelity Decay (The Wizard Test)", () => {
	let tdb, tserver, client;
	const projectPath = join(tmpdir(), `rummy-wizard-${Date.now()}`);
	const model = "hyzenqwen";

	before(async () => {
		await fs.mkdir(join(projectPath, "src/secret"), { recursive: true });
		await fs.writeFile(
			join(projectPath, "src/secret/wizard.txt"), 
			"My robe is purple."
		);
		const { execSync } = await import("node:child_process");
		execSync(
			'git init && git config user.email "test@test.com" && git config user.name "Test" && git add . && git commit -m "feat: add wizard"',
			{ cwd: projectPath },
		);

		tdb = await TestDb.create();
		tserver = await TestServer.start(tdb.db);
		client = new RpcClient(tserver.url);
		await client.connect();
	});

	after(async () => {
		client.close();
		await tserver.stop();
		await tdb.cleanup();
		await fs.rm(projectPath, { recursive: true, force: true });
	});

	it("should warm the wizard file on mention and decay it over time", async () => {
		const turnMap = new Map();
		client.on("run/step/completed", (payload) => {
			const seq = Number(payload.turn.sequence);
			console.log(`  [TEST DEBUG] Captured turn sequence: ${seq}. Context size: ${payload.turn.context?.length}`);
			turnMap.set(seq, payload.turn);
		});

		await client.call("init", {
			projectPath,
			projectName: "WizardProject",
			clientId: "c-wizard",
		});

		process.env.RUMMY_DECAY_THRESHOLD = "2";

		// Step 1: Ask the question
		await client.call("ask", {
			model,
			prompt: "What color is the robe in the wizard file (src/secret/wizard.txt)?",
		});

		// Wait until we have a turn that identifies the color
		const start = Date.now();
		let identifiedTurn = null;
		while (Date.now() - start < 60000) {
			const turns = Array.from(turnMap.values());
			identifiedTurn = turns.find(t => {
				const content = t.assistant.content?.toLowerCase() || "";
				return content.includes("purple") || content.includes("violet") || content.includes("magenta") || content.includes("crimson");
			});
			if (identifiedTurn) break;
			await new Promise(r => setTimeout(r, 1000));
		}

		assert.ok(identifiedTurn, `Model failed to identify the color after ${turnMap.size} turns.`);
		const warmSeq = identifiedTurn.sequence + 1;

		// Step 2: Verify the file is now WARMED in the NEXT turn
		await client.call("ask", { model, prompt: "Confirmed. What was the exact path to that wizard file?" });
		
		while (Date.now() - start < 90000) {
			const tNext = turnMap.get(warmSeq);
			if (tNext && tNext.context?.includes("<source>")) break;
			await new Promise(r => setTimeout(r, 1000));
		}

		assert.ok(turnMap.has(warmSeq), `Turn ${warmSeq} missing`);
		assert.ok(turnMap.get(warmSeq).context.includes("<source>"), `Wizard file was not warmed in Turn ${warmSeq}`);

		// Step 3: Decay
		const decayStartSeq = Math.max(...turnMap.keys());
		for (let i = 0; i < 3; i++) {
			await client.call("ask", { model, prompt: "Say 'Acknowledged'." });
		}

		while (Date.now() - start < 180000) {
			const latestSeq = Math.max(...turnMap.keys());
			if (latestSeq >= decayStartSeq + 3) {
				const latestTurn = turnMap.get(latestSeq);
				if (!latestTurn.context.includes("<source>")) break;
			}
			await new Promise(r => setTimeout(r, 2000));
		}

		const finalSeq = Math.max(...turnMap.keys());
		const finalTurn = turnMap.get(finalSeq);
		assert.ok(!finalTurn.context.includes("<source>"), `Turn ${finalSeq} should have decayed source content`);
	});
});
