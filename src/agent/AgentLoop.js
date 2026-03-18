import { exec } from "node:child_process";
import crypto from "node:crypto";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/**
 * AgentLoop: Coordinates the autonomous Rumsfeld Loop.
 * The loop completes when all tasks in the <tasks> block are marked [x].
 */
export default class AgentLoop {
	#db;
	#llmProvider;
	#hooks;
	#turnBuilder;
	#responseParser;
	#findingsManager;

	constructor(
		db,
		llmProvider,
		hooks,
		turnBuilder,
		responseParser,
		findingsManager,
	) {
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
		const project = await this.#db.get_project_by_id.get({
			id: sessions[0].project_id,
		});

		let currentRunId = runId;
		let sequenceOffset = 0;
		const historyMessages = [];

		if (currentRunId) {
			const existingRun = await this.#db.get_run_by_id.get({
				id: currentRunId,
			});
			if (!existingRun || existingRun.session_id !== sessionId) {
				throw new Error(`Run '${currentRunId}' not found in this session.`);
			}
			const previousTurns = await this.#db.get_turns_by_run_id.all({
				run_id: currentRunId,
			});

			// 1. Resolve findings from info tags in the user prompt
			const infoTags = this.#responseParser
				.parseActionTags(prompt)
				.filter((t) => t.tagName === "info");
			const { remainingCount, proposed } =
				await this.#findingsManager.resolveOutstandingFindings(
					project.path,
					currentRunId,
					prompt,
					infoTags,
				);

			// 2. Load History from DB (Strict Turn Order)
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
			if (remainingCount > 0) {
				return {
					runId: currentRunId,
					content: `Blocked: ${remainingCount} proposed action(s) still require resolution.`,
					status: "proposed",
					diffs: proposed
						.filter((f) => f.status === "proposed")
						.map((f) => ({
							id: f.id,
							runId: currentRunId,
							type: f.type,
							file: f.file,
							patch: f.patch,
							status: f.status,
						})),
					commands: proposed
						.filter((f) => f.status === "proposed" && f.category === "command")
						.map((f) => ({
							id: f.id,
							type: f.type,
							command: f.patch,
							status: f.status,
						})),
					notifications: [
						{
							type: "notify",
							text: `${remainingCount} action(s) still pending resolution.`,
							level: "warn",
						},
					],
				};
			}

			// 4. UNBLOCKED: mark run as running and continue to autonomous loop
			await this.#db.update_run_status.run({
				id: currentRunId,
				status: "running",
			});
		} else {
			currentRunId = crypto.randomUUID();
			await this.#db.create_run.run({
				id: currentRunId,
				session_id: sessionId,
				type,
				config: JSON.stringify({ model, activeFiles }),
			});
		}

		let currentActiveFiles = [...(activeFiles || [])];
		let loopPrompt = prompt;
		const requestedModel = model || process.env.RUMMY_MODEL_DEFAULT;

		while (true) {
			const turnObj = await this.#turnBuilder.build({
				type,
				project,
				sessionId,
				prompt: loopPrompt,
				model: requestedModel,
				activeFiles: currentActiveFiles,
				db: this.#db,
				sequence: sequenceOffset,
			});

			const currentTurnMessages = await turnObj.serialize();
			const newUserMsg = currentTurnMessages.find((m) => m.role === "user");

			const filteredMessages = await this.#hooks.llm.messages.filter(
				[
					...currentTurnMessages.filter((m) => m.role === "system"),
					...historyMessages,
					newUserMsg,
				].filter(Boolean),
				{ model: requestedModel, sessionId, runId: currentRunId },
			);

			// Prefill to anchor model
			const prefill = "<tasks>\n- [";
			const finalMessages = [
				...filteredMessages,
				{ role: "assistant", content: prefill },
			];

			// Persist User turn
			await this.#db.create_turn.run({
				run_id: currentRunId,
				sequence_number: sequenceOffset,
				payload: JSON.stringify(newUserMsg),
				prompt_tokens: 0,
				completion_tokens: 0,
				total_tokens: 0,
				cost: 0,
			});

			const targetModel =
				process.env[`RUMMY_MODEL_${requestedModel}`] || requestedModel;
			if (process.env.RUMMY_DEBUG === "true")
				console.log(`[LLM] Target Model: ${targetModel}`);

			await this.#hooks.llm.request.started.emit({
				runId: currentRunId,
				model: targetModel,
				messages: finalMessages,
			});
			const result = await this.#llmProvider.completion(
				finalMessages,
				targetModel,
			);
			await this.#hooks.llm.request.completed.emit({
				runId: currentRunId,
				result,
			});

			const responseMessage = result.choices?.[0]?.message;
			const mergedContent = this.#responseParser.mergePrefill(
				prefill,
				responseMessage?.content || "",
			);
			const finalResponse = await this.#hooks.llm.response.filter(
				{ ...responseMessage, content: mergedContent },
				{ model: requestedModel, sessionId, runId: currentRunId },
			);

			const usage = result.usage || {
				prompt_tokens: 0,
				completion_tokens: 0,
				total_tokens: 0,
				cost: 0,
			};

			// Persist Assistant turn
			const completedTurn = await this.#db.create_turn.run({
				run_id: currentRunId,
				sequence_number: sequenceOffset + 1,
				payload: JSON.stringify(finalResponse),
				prompt_tokens: usage.prompt_tokens || 0,
				completion_tokens: usage.completion_tokens || 0,
				total_tokens: usage.total_tokens || 0,
				cost: usage.cost || 0,
			});

			const turnId = completedTurn.lastInsertRowid;
			if (finalResponse?.reasoning_content)
				this.#responseParser.appendAssistantContent(
					turnObj,
					"reasoning_content",
					finalResponse.reasoning_content,
				);
			if (finalResponse?.content)
				this.#responseParser.appendAssistantContent(
					turnObj,
					"content",
					finalResponse.content,
				);
			turnObj.assistant.meta.add({
				...usage,
				alias: requestedModel,
				actualModel: result.model,
				displayModel: this.#resolveAlias(requestedModel),
			});

			const atomicResult = {
				runId: currentRunId,
				model: {
					requested: requestedModel,
					alias: this.#resolveAlias(requestedModel),
					target: targetModel,
					actual: result.model,
					display: this.#resolveAlias(requestedModel),
				},
				content: finalResponse?.content || "",
				reasoning: finalResponse?.reasoning_content || null,
				finishReason: result.choices?.[0]?.finish_reason || "stop",
				usage: {
					promptTokens: usage.prompt_tokens || 0,
					completionTokens: usage.completion_tokens || 0,
					totalTokens: usage.total_tokens || 0,
					cost: usage.cost || 0,
				},
				activeFiles: currentActiveFiles,
				diffs: [],
				commands: [],
				notifications: [],
				openaiRaw: result,
			};

			const tags = this.#responseParser.parseActionTags(
				finalResponse?.content || "",
			);
			await this.#findingsManager.populateFindings(
				project.path,
				atomicResult,
				tags,
			);
			await this.#hooks.run.step.completed.emit({
				runId: currentRunId,
				turn: turnObj,
			});

			const tasksTag = tags.find((t) => t.tagName === "tasks");
			const tasksText = tasksTag
				? this.#responseParser.getNodeText(tasksTag).trim()
				: "";
			if (tasksText)
				await this.#hooks.run.progress.emit({
					runId: currentRunId,
					sessionId,
					tasks: tasksText,
					status: "Agent is thinking...",
				});

			const isComplete = tasksText.length > 0 && !tasksText.includes("- [ ]");
			const gatherReadTags = tags.filter((t) => t.tagName === "read");
			const gatherCmdTags = tags.filter(
				(t) => t.tagName === "env" || t.tagName === "run",
			);
			const breakingTags = tags.filter((t) =>
				["create", "delete", "edit", "prompt_user"].includes(t.tagName),
			);

			// TERMINATION
			if (
				breakingTags.length > 0 ||
				isComplete ||
				(gatherReadTags.length === 0 && gatherCmdTags.length === 0)
			) {
				await this.#db.update_run_status.run({
					id: currentRunId,
					status:
						type === "act" && breakingTags.length > 0
							? "proposed"
							: "completed",
				});
				for (const diff of atomicResult.diffs) {
					const res = await this.#db.insert_finding_diff.run({
						run_id: currentRunId,
						turn_id: turnId,
						type: diff.type,
						file_path: diff.file,
						patch: diff.patch,
					});
					diff.id = res.lastInsertRowid;
				}
				for (const cmd of atomicResult.commands) {
					const res = await this.#db.insert_finding_command.run({
						run_id: currentRunId,
						turn_id: turnId,
						type: cmd.type,
						command: cmd.command,
					});
					cmd.id = res.lastInsertRowid;
				}
				for (const notif of atomicResult.notifications) {
					await this.#db.insert_finding_notification.run({
						run_id: currentRunId,
						turn_id: turnId,
						type: notif.type,
						text: notif.text,
						level: notif.level || null,
						append: notif.append !== undefined ? (notif.append ? 1 : 0) : null,
					});
				}
				const finalResult = await this.#hooks.run.turn.filter(atomicResult, {
					turn: turnObj,
					sessionId,
					type,
				});
				if (atomicResult.analysis) finalResult.analysis = atomicResult.analysis;
				await hook.completed.emit({
					runId: currentRunId,
					sessionId,
					model: targetModel,
					turn: turnObj,
					usage,
					result: finalResult,
				});
				return finalResult;
			}

			// Autonomous Gathering Cycle
			const infoParts = [];
			if (gatherReadTags.length > 0) {
				const newFiles = gatherReadTags
					.map((t) => t.attrs.find((a) => a.name === "file")?.value)
					.filter(Boolean);
				currentActiveFiles = [
					...new Set([...currentActiveFiles, ...new Set(newFiles)]),
				];
				infoParts.push(
					`Read ${newFiles.length} file(s): ${newFiles.join(", ")}`,
				);
			}
			for (const tag of gatherCmdTags) {
				const cmd = this.#responseParser.getNodeText(tag).trim();
				try {
					const { stdout, stderr } = await execAsync(cmd, {
						cwd: project.path,
					});
					const output = (stdout + stderr).trim();
					infoParts.push(
						`Executed ${tag.tagName}: '${cmd}'\nOutput:\n${output || "(no output)"}`,
					);
				} catch (err) {
					infoParts.push(
						`Failed to execute ${tag.tagName}: '${cmd}'\nError: ${err.message}`,
					);
				}
			}

			// Sync history memory
			historyMessages.push(newUserMsg);
			historyMessages.push(finalResponse);
			sequenceOffset += 2;
			loopPrompt = `<info>\n${infoParts.join("\n\n")}\n\nContent and results are now available in the system context.</info>`;
		}
	}

	#resolveAlias(modelId) {
		if (!modelId) return modelId;
		if (process.env[`RUMMY_MODEL_${modelId}`]) return modelId;
		for (const key of Object.keys(process.env)) {
			if (key.startsWith("RUMMY_MODEL_") && process.env[key] === modelId)
				return key.replace("RUMMY_MODEL_", "");
		}
		return modelId;
	}
}
