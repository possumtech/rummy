import RummyContext from "../hooks/RummyContext.js";
import { ContextExceededError } from "../llm/errors.js";
import { PermissionError } from "./errors.js";
import materializeContext from "./materializeContext.js";
import XmlParser from "./XmlParser.js";

export default class TurnExecutor {
	#db;
	#llmProvider;
	#hooks;
	#entries;

	constructor(db, llmProvider, hooks, entries) {
		this.#db = db;
		this.#llmProvider = llmProvider;
		this.#hooks = hooks;
		this.#entries = entries;
	}

	async execute({
		mode,
		project,
		projectId,
		currentRunId,
		currentAlias,
		currentLoopId,
		requestedModel,
		loopPrompt,
		loopIteration,
		noRepo,
		noWeb,
		noInteraction,
		noProposals,
		yolo,
		toolSet,
		contextSize,
		options,
		signal,
	}) {
		const turn = await this.#entries.nextTurn(currentRunId);

		const turnRow = await this.#db.create_turn.get({
			run_id: currentRunId,
			loop_id: currentLoopId,
			sequence: turn,
		});

		const rummy = new RummyContext(
			{
				tag: "turn",
				attrs: {},
				content: null,
				children: [
					{ tag: "system", attrs: {}, content: null, children: [] },
					{ tag: "context", attrs: {}, content: null, children: [] },
					{ tag: "user", attrs: {}, content: null, children: [] },
					{ tag: "assistant", attrs: {}, content: null, children: [] },
				],
			},
			{
				hooks: this.#hooks,
				db: this.#db,
				store: this.#entries,
				project,
				type: mode,
				sequence: turn,
				runId: currentRunId,
				loopId: currentLoopId,
				turnId: turnRow.id,
				noRepo,
				noWeb,
				noInteraction,
				noProposals,
				yolo,
				toolSet,
				contextSize,
				systemPrompt: null,
				loopPrompt,
				signal,
			},
		);
		await this.#hooks.turn.started.emit({
			rummy,
			mode,
			prompt: loopPrompt,
			isContinuation: options?.isContinuation,
			loopIteration,
		});

		await this.#hooks.processTurn(rummy);

		const runRow = await this.#db.get_run_by_id.get({ id: currentRunId });

		const budgetCtx = {
			runId: currentRunId,
			loopId: currentLoopId,
			turn,
			systemPrompt: "",
			persona: runRow.persona,
			mode,
			toolSet,
			loopIteration,
		};
		const initial = await materializeContext({
			db: this.#db,
			hooks: this.#hooks,
			contextSize,
			...budgetCtx,
		});

		await this.#hooks.context.materialized.emit({
			runId: currentRunId,
			turn,
			rowCount: initial.rows.length,
		});

		const dispatchPacket = await this.#hooks.turn.beforeDispatch.filter(
			{
				contextSize,
				messages: initial.messages,
				rows: initial.rows,
				lastPromptTokens: initial.lastContextTokens,
				assembledTokens: 0,
				ok: true,
				overflow: null,
			},
			{ rummy, ctx: budgetCtx },
		);
		const messages = dispatchPacket.messages;
		const assembledTokens = dispatchPacket.assembledTokens;

		if (!dispatchPacket.ok) {
			return {
				turn,
				turnId: turnRow.id,
				recorded: [],
				summaryText: null,
				updateText: null,
				assembledTokens,
				contextSize,
				overflow: dispatchPacket.overflow,
			};
		}

		const filteredMessages = await this.#hooks.llm.messages.filter(messages, {
			model: requestedModel,
			projectId,
			runId: currentRunId,
			runAlias: runRow?.alias || `run_${currentRunId}`,
			turn,
		});

		await this.#hooks.llm.request.started.emit({ model: requestedModel, turn });
		let rawResult;
		try {
			rawResult = await this.#llmProvider.completion(
				filteredMessages,
				requestedModel,
				{
					temperature: options?.temperature,
					signal,
					// Stable per-run id for provider prompt caching.
					runAlias: runRow?.alias || `run_${currentRunId}`,
					// Real prompt_tokens for accurate max_tokens derivation.
					lastPromptTokens: initial.lastContextTokens,
				},
			);
		} catch (err) {
			if (err instanceof ContextExceededError) {
				await this.#hooks.error.log.emit({
					store: this.#entries,
					runId: currentRunId,
					turn,
					loopId: currentLoopId,
					message: `LLM context exceeded: ${err.message}`,
					status: 413,
				});
				return {
					turn,
					turnId: turnRow.id,
					recorded: [],
					summaryText: null,
					updateText: null,
					assembledTokens,
					contextSize,
				};
			}
			// LLM fetch hit per-call ceiling → 504 strike (recoverable).
			// signal.aborted is OUR drain — re-throw to end run at 499.
			if (err?.name === "TimeoutError" || err?.name === "AbortError") {
				if (signal?.aborted) throw err;
				await this.#hooks.error.log.emit({
					store: this.#entries,
					runId: currentRunId,
					turn,
					loopId: currentLoopId,
					message: `LLM call timed out: ${err.message}`,
					status: 504,
				});
				return {
					turn,
					turnId: turnRow.id,
					recorded: [],
					summaryText: null,
					updateText: null,
					assembledTokens,
					contextSize,
				};
			}
			throw err;
		}
		const result = await this.#hooks.llm.response.filter(rawResult, {
			model: requestedModel,
			projectId,
			runId: currentRunId,
		});
		await this.#hooks.llm.request.completed.emit({
			model: requestedModel,
			turn,
			usage: result.usage,
		});
		const responseMessage = result.choices?.[0]?.message;
		const content = responseMessage?.content ? responseMessage.content : "";

		const { commands, warnings, unparsed } = XmlParser.parse(content);
		// Parser warnings are recovered emissions — visible to the model,
		// no strike.
		for (const w of warnings) {
			await this.#hooks.error.log.emit({
				store: this.#entries,
				runId: currentRunId,
				turn,
				message: w,
				loopId: currentLoopId,
				status: 422,
				soft: true,
			});
		}
		if (commands.length === 0 && unparsed?.trim() && warnings.length === 0) {
			await this.#hooks.error.log.emit({
				store: this.#entries,
				runId: currentRunId,
				turn,
				loopId: currentLoopId,
				message: "Response contained no actionable tags.",
				status: 422,
			});
		}

		// Skip dispatch when commands but no <update> — broken turn, no side
		// effects. The missing-update strike fires from update.resolve below.
		const hasUpdate = commands.some((c) => c.name === "update");
		const skipDispatch = commands.length > 0 && !hasUpdate;

		if (responseMessage) {
			const seed = responseMessage.reasoning_content
				? responseMessage.reasoning_content
				: "";
			const merged = await this.#hooks.llm.reasoning.filter(seed, { commands });
			responseMessage.reasoning_content = merged ? merged : null;
		}

		const systemMsg = filteredMessages.find((m) => m.role === "system");
		const userMsg = filteredMessages.find((m) => m.role === "user");
		await this.#hooks.turn.response.emit({
			rummy,
			turn,
			result,
			responseMessage,
			content,
			commands,
			unparsed,
			assembledTokens,
			contextSize,
			systemMsg: systemMsg?.content,
			userMsg: userMsg?.content,
		});

		const recorded = [];
		if (!skipDispatch) {
			for (const cmd of commands) {
				const entry = await this.#record(
					currentRunId,
					currentLoopId,
					turn,
					mode,
					cmd,
				);
				if (entry) recorded.push(entry);
			}
		}

		// Sequential dispatch; abort-after-failure; proposals notify-and-await.
		let abortAfter = null;

		for (const entry of recorded) {
			if (entry.state === "failed" || entry.state === "cancelled") continue;

			if (abortAfter) {
				const errorMsg = `Aborted — preceding <${abortAfter}> failed.`;
				await this.#entries.set({
					runId: currentRunId,
					turn,
					path: entry.resultPath || entry.path,
					body: errorMsg,
					state: "failed",
					outcome: "aborted",
					attributes: { error: errorMsg },
					loopId: currentLoopId,
				});
				continue;
			}

			await this.#hooks.tool.before.emit({ entry, rummy });
			try {
				await this.#hooks.tools.dispatch(entry.scheme, entry, rummy);
			} catch (dispatchErr) {
				// PermissionError → soft 403, no sibling abort.
				if (dispatchErr instanceof PermissionError) {
					await this.#hooks.error.log.emit({
						store: this.#entries,
						runId: currentRunId,
						turn,
						loopId: currentLoopId,
						message: dispatchErr.message,
						status: 403,
					});
					continue;
				}
				await this.#hooks.error.log.emit({
					store: this.#entries,
					runId: currentRunId,
					turn,
					loopId: currentLoopId,
					message: `Dispatch crash in ${entry.scheme}: ${dispatchErr.message}`,
					status: 500,
				});
				abortAfter = entry.scheme;
				continue;
			}
			await this.#hooks.tool.after.emit({ entry, rummy });
			await this.#hooks.entry.created.emit(entry);

			await this.#hooks.proposal.prepare.emit({ rummy, recorded: [entry] });

			const proposed = await this.#entries.getUnresolved(currentRunId);
			for (const p of proposed) {
				await this.#hooks.proposal.pending.emit({
					projectId,
					run: currentAlias,
					proposed: [p],
					rummy,
				});
				await this.#entries.waitForResolution(currentRunId, p.path);
				const resolved = await this.#entries.getState(currentRunId, p.path);
				if (resolved?.status >= 400) abortAfter = entry.scheme;
			}

			if (!abortAfter) {
				const entryPath = entry.resultPath || entry.path;
				const row = await this.#entries.getState(currentRunId, entryPath);
				if (row?.status >= 400) abortAfter = entry.scheme;
			}
		}

		await this.#hooks.turn.dispatched.emit({
			contextSize,
			ctx: budgetCtx,
			rummy,
		});

		const { summaryText, updateText } = await this.#hooks.update.resolve({
			recorded,
			content,
			commands,
			runId: currentRunId,
			turn,
			loopId: currentLoopId,
			rummy,
		});

		const askUserEntry = recorded.find((e) => e.scheme === "ask_user");

		const turnResult = {
			turn,
			turnId: turnRow.id,
			recorded,
			summaryText,
			updateText,
			askUserCmd: askUserEntry,
			model: result.model ? result.model : requestedModel,
			modelAlias: requestedModel,
			temperature: options?.temperature,
			contextSize,
			assembledTokens,
			usage: result.usage,
		};

		await this.#hooks.turn.completed.emit(turnResult);

		return turnResult;
	}

	async #record(runId, loopId, turn, mode, cmd) {
		const scheme = cmd.name;
		let rawTarget = "";
		if (cmd.path) rawTarget = cmd.path;
		else if (cmd.command) rawTarget = cmd.command;
		else if (cmd.question) rawTarget = cmd.question;
		// Reject reasoning-bleed in path-shaped fields only.
		if (cmd.path && (cmd.path.length > 2048 || /\p{Cc}/u.test(cmd.path))) {
			const rejectPath = await this.#entries.logPath(
				runId,
				turn,
				scheme,
				"invalid",
			);
			await this.#entries.set({
				runId,
				turn,
				path: rejectPath,
				body: "Invalid path.",
				state: "failed",
				outcome: "validation",
				attributes: { action: scheme },
				loopId,
			});
			return {
				scheme,
				path: rejectPath,
				body: "",
				attributes: {},
				state: "failed",
				outcome: "validation",
				resultPath: rejectPath,
			};
		}
		const target = rawTarget;
		const resultPath = await this.#entries.logPath(runId, turn, scheme, target);

		const { name: _, ...attributes } = cmd;
		if (cmd.path) attributes.path = target;

		let body = "";
		if (cmd.body) body = cmd.body;
		else if (cmd.command) body = cmd.command;
		else if (cmd.question) body = cmd.question;

		const filtered = await this.#hooks.entry.recording.filter(
			{
				scheme,
				path: resultPath,
				body,
				attributes,
				state: "resolved",
				outcome: null,
			},
			{ store: this.#entries, runId, turn, loopId, mode },
		);
		if (filtered.state === "failed" || filtered.state === "cancelled") {
			await this.#entries.set({
				runId,
				turn,
				loopId,
				path: filtered.path,
				body: filtered.body,
				state: filtered.state,
				outcome: filtered.outcome,
				attributes: filtered.attributes,
			});
			return { ...filtered, resultPath: filtered.path };
		}

		return {
			scheme: filtered.scheme,
			path: filtered.path,
			body: filtered.body,
			attributes: filtered.attributes,
			state: "resolved",
			resultPath: filtered.path,
		};
	}
}
