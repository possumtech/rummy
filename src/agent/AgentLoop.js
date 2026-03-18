import crypto from "node:crypto";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/**
 * AgentLoop: Coordinates the autonomous Rumsfeld Loop.
 * The Loop Arbiter enforces Hierarchical Priority: Gather > Action > Summary.
 */
export default class AgentLoop {
	#db;
	#llmProvider;
	#hooks;
	#turnBuilder;
	#responseParser;
	#findingsManager;

	constructor(db, llmProvider, hooks, turnBuilder, responseParser, findingsManager) {
		this.#db = db;
		this.#llmProvider = llmProvider;
		this.#hooks = hooks;
		this.#turnBuilder = turnBuilder;
		this.#responseParser = responseParser;
		this.#findingsManager = findingsManager;
	}

	async run(type, sessionId, model, prompt, activeFiles = [], runId = null) {
		const hook = type === "ask" ? this.#hooks.ask : this.#hooks.act;
		await hook.started.emit({ sessionId, model, prompt, activeFiles, runId });

		const sessions = await this.#db.get_session_by_id.all({ id: sessionId });
		const project = await this.#db.get_project_by_id.get({ id: sessions[0].project_id });

		let currentRunId = runId;
		let sequenceOffset = 0;
		const historyMessages = [];
		let yolo = false;

		if (currentRunId) {
			const existingRun = await this.#db.get_run_by_id.get({ id: currentRunId });
			if (!existingRun || existingRun.session_id !== sessionId) {
				throw new Error(`Run '${currentRunId}' not found in this session.`);
			}
			
			const config = JSON.parse(existingRun.config || "{}");
			yolo = config.yolo === true;

			const previousTurns = await this.#db.get_turns_by_run_id.all({ run_id: currentRunId });

			// 1. Resolve findings (YOLO or via info tags)
			const infoTags = this.#responseParser.parseActionTags(prompt).filter((t) => t.tagName === "info");
			
			if (yolo) {
				const findings = await this.#db.get_findings_by_run_id.all({ run_id: currentRunId });
				const proposed = findings.filter(f => f.status === "proposed");
				for (const f of proposed) {
					if (f.category === "diff") await this.#findingsManager.applyDiff(project.path, f);
					await (f.category === "diff" 
						? this.#db.update_finding_diff_status.run({ id: f.id, status: "accepted" })
						: this.#db.update_finding_command_status.run({ id: f.id, status: "accepted" }));
				}
			}

			const { remainingCount, proposed } = await this.#findingsManager.resolveOutstandingFindings(
				project.path, currentRunId, prompt, infoTags
			);

			// 2. Load History from DB
			for (const turn of previousTurns) {
				const payload = JSON.parse(turn.payload);
				const msgs = Array.isArray(payload) ? payload : [payload];
				for (const m of msgs) {
					if (m.role === "user" || m.role === "assistant") {
						const last = historyMessages.at(-1);
						if (!last || last.role !== m.role || last.content !== m.content) {
							historyMessages.push(m);
						}
					}
				}
				sequenceOffset = Math.max(sequenceOffset, turn.sequence_number + 1);
			}

			// 3. Block if findings are still pending
			if (remainingCount > 0 && !yolo) {
				return {
					runId: currentRunId,
					content: `Blocked: ${remainingCount} proposed action(s) still require resolution.`,
					status: "proposed",
					diffs: proposed.filter((f) => f.status === "proposed").map((f) => ({
						id: f.id, runId: currentRunId, type: f.type, file: f.file, patch: f.patch, status: f.status
					})),
					commands: proposed.filter((f) => f.status === "proposed" && f.category === "command").map((f) => ({
						id: f.id, type: f.type, command: f.patch, status: f.status
					})),
					notifications: [{ type: "notify", text: `${remainingCount} action(s) still pending resolution.`, level: "warn" }]
				};
			}

			await this.#db.update_run_status.run({ id: currentRunId, status: "running" });
		} else {
			currentRunId = crypto.randomUUID();
			yolo = prompt.includes("RUMMY_YOLO") || activeFiles?.yolo === true;
			await this.#db.create_run.run({ id: currentRunId, session_id: sessionId, type, config: JSON.stringify({ model, activeFiles, yolo }) });
		}

		let currentActiveFiles = Array.isArray(activeFiles) ? [...activeFiles] : [];
		let loopPrompt = prompt;
		const requestedModel = model || process.env.RUMMY_MODEL_DEFAULT;

		while (true) {
			const lastAssistantMsg = historyMessages.filter(m => m.role === "assistant").at(-1);
			const previousTags = this.#responseParser.parseActionTags(lastAssistantMsg?.content || loopPrompt);
			const unknownTag = previousTags.find(t => t.tagName === "unknown");
			const hasUnknowns = unknownTag ? this.#responseParser.getNodeText(unknownTag).trim().length > 0 : true;
			const tasksTagPrev = previousTags.find(t => t.tagName === "tasks");
			const tasksTextPrev = tasksTagPrev ? this.#responseParser.getNodeText(tasksTagPrev).trim() : "";
			const tasksComplete = tasksTextPrev.length > 0 && !tasksTextPrev.includes("- [ ]");

			const turnObj = await this.#turnBuilder.build({
				type, project, sessionId, prompt: loopPrompt, model: requestedModel, 
				activeFiles: currentActiveFiles, db: this.#db, sequence: sequenceOffset,
				hasUnknowns, tasksComplete
			});

			const currentTurnMessages = await turnObj.serialize();
			const newUserMsg = currentTurnMessages.find((m) => m.role === "user");

			const filteredMessages = await this.#hooks.llm.messages.filter(
				[...currentTurnMessages.filter((m) => m.role === "system"), ...historyMessages, newUserMsg].filter(Boolean),
				{ model: requestedModel, sessionId, runId: currentRunId }
			);

			const prefill = "<tasks>\n- [";
			const finalMessages = [...filteredMessages, { role: "assistant", content: prefill }];

			await this.#db.create_turn.run({
				run_id: currentRunId, sequence_number: sequenceOffset, payload: JSON.stringify(newUserMsg),
				prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost: 0
			});

			const targetModel = process.env[`RUMMY_MODEL_${requestedModel}`] || requestedModel;
			const result = await this.#llmProvider.completion(finalMessages, targetModel);

			const responseMessage = result.choices?.[0]?.message;
			const mergedContent = this.#responseParser.mergePrefill(prefill, responseMessage?.content || "");
			const finalResponse = await this.#hooks.llm.response.filter({ ...responseMessage, content: mergedContent }, { model: requestedModel, sessionId, runId: currentRunId });

			const usage = result.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost: 0 };
			const completedTurn = await this.#db.create_turn.run({
				run_id: currentRunId, sequence_number: sequenceOffset + 1, payload: JSON.stringify(finalResponse),
				prompt_tokens: usage.prompt_tokens || 0, completion_tokens: usage.completion_tokens || 0, total_tokens: usage.total_tokens || 0, cost: usage.cost || 0
			});

			const turnId = completedTurn.lastInsertRowid;
			if (finalResponse?.reasoning_content) this.#responseParser.appendAssistantContent(turnObj, "reasoning_content", finalResponse.reasoning_content);
			if (finalResponse?.content) this.#responseParser.appendAssistantContent(turnObj, "content", finalResponse.content);
			turnObj.assistant.meta.add({ ...usage, alias: requestedModel, actualModel: result.model, displayModel: this.#resolveAlias(requestedModel) });

			const atomicResult = {
				runId: currentRunId,
				model: { requested: requestedModel, alias: this.#resolveAlias(requestedModel), target: targetModel, actual: result.model, display: this.#resolveAlias(requestedModel) },
				content: finalResponse?.content || "", reasoning: finalResponse?.reasoning_content || null,
				usage: { promptTokens: usage.prompt_tokens || 0, completionTokens: usage.completion_tokens || 0, totalTokens: usage.total_tokens || 0, cost: usage.cost || 0 },
				activeFiles: currentActiveFiles, diffs: [], commands: [], notifications: [], openaiRaw: result
			};

			const tags = this.#responseParser.parseActionTags(finalResponse?.content || "");
			await this.#findingsManager.populateFindings(project.path, atomicResult, tags);
			await this.#hooks.run.step.completed.emit({ runId: currentRunId, turn: turnObj });

			const tasksTag = tags.find((t) => t.tagName === "tasks");
			const tasksText = tasksTag ? this.#responseParser.getNodeText(tasksTag).trim() : "";
			if (tasksText) await this.#hooks.run.progress.emit({ runId: currentRunId, sessionId, tasks: tasksText, status: "Agent is thinking..." });

			const isChecklistComplete = tasksText.length > 0 && !tasksText.includes("- [ ]");
			const gatherReadTags = tags.filter((t) => t.tagName === "read");
			const gatherCmdTags = tags.filter((t) => t.tagName === "env" || t.tagName === "run");
			const breakingTags = tags.filter((t) => ["create", "delete", "edit", "prompt_user"].includes(t.tagName));
			const summaryTag = tags.find(t => t.tagName === "summary");

			if (gatherReadTags.length > 0 || gatherCmdTags.length === 0 && gatherReadTags.length > 0 || gatherCmdTags.length > 0) {
				const infoParts = [];
				if (gatherReadTags.length > 0) {
					const newFiles = gatherReadTags.map((t) => t.attrs.find((a) => a.name === "file")?.value).filter(Boolean);
					currentActiveFiles = [...new Set([...currentActiveFiles, ...newFiles])];
					infoParts.push(`Read ${newFiles.length} file(s): ${newFiles.join(", ")}`);
				}
				for (const tag of gatherCmdTags) {
					const cmd = this.#responseParser.getNodeText(tag).trim();
					try {
						const { stdout, stderr } = await execAsync(cmd, { cwd: project.path });
						infoParts.push(`Executed ${tag.tagName}: '${cmd}'\nOutput:\n${(stdout + stderr).trim() || "(no output)"}`);
					} catch (err) {
						infoParts.push(`Failed to execute ${tag.tagName}: '${cmd}'\nError: ${err.message}`);
					}
				}
				historyMessages.push(newUserMsg);
				historyMessages.push(finalResponse);
				sequenceOffset += 2;
				loopPrompt = `<info>\n${infoParts.join("\n\n")}\n\nContent and results are now available in the system context.</info>`;
				continue; 
			}

			if (breakingTags.length > 0) {
				await this.#db.update_run_status.run({ id: currentRunId, status: "proposed" });
				for (const d of atomicResult.diffs) await this.#db.insert_finding_diff.run({ run_id: currentRunId, turn_id: turnId, type: d.type, file_path: d.file, patch: d.patch });
				for (const c of atomicResult.commands) await this.#db.insert_finding_command.run({ run_id: currentRunId, turn_id: turnId, type: c.type, command: c.command });
				const finalResult = await this.#hooks.run.turn.filter(atomicResult, { turn: turnObj, sessionId, type });
				await hook.completed.emit({ runId: currentRunId, sessionId, model: targetModel, turn: turnObj, usage, result: finalResult });
				return finalResult;
			}

			if (isChecklistComplete || summaryTag) {
				await this.#db.update_run_status.run({ id: currentRunId, status: "completed" });
				const finalResult = await this.#hooks.run.turn.filter(atomicResult, { turn: turnObj, sessionId, type });
				if (atomicResult.analysis) finalResult.analysis = atomicResult.analysis;
				await hook.completed.emit({ runId: currentRunId, sessionId, model: targetModel, turn: turnObj, usage, result: finalResult });
				return finalResult;
			}
			break;
		}
	}

	#resolveAlias(modelId) {
		if (!modelId) return modelId;
		if (process.env[`RUMMY_MODEL_${modelId}`]) return modelId;
		for (const key of Object.keys(process.env)) {
			if (key.startsWith("RUMMY_MODEL_") && process.env[key] === modelId) return key.replace("RUMMY_MODEL_", "");
		}
		return modelId;
	}
}
