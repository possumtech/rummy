import HookRegistry from "./HookRegistry.js";
import RpcRegistry from "./RpcRegistry.js";
import ToolRegistry from "./ToolRegistry.js";

export default function createHooks(debug = false) {
	const registry = new HookRegistry(debug);
	const tools = new ToolRegistry();

	const createEvent = (tag) => ({
		on: (callback, priority) => registry.addEvent(tag, callback, priority),
		off: (callback) => registry.removeEvent(tag, callback),
		emit: (...args) => registry.emitEvent(tag, ...args),
	});

	const createFilter = (tag) => ({
		addFilter: (callback, priority) =>
			registry.addFilter(tag, callback, priority),
		filter: (value, ...args) => registry.applyFilters(tag, value, ...args),
	});

	return {
		onTurn: registry.onTurn.bind(registry),
		processTurn: registry.processTurn.bind(registry),

		boot: {
			completed: createEvent("boot.completed"),
		},
		project: {
			init: {
				started: createEvent("project.init.started"),
				completed: createEvent("project.init.completed"),
			},
			files: {
				update: {
					started: createEvent("project.files.update.started"),
					completed: createEvent("project.files.update.completed"),
				},
			},
		},
		run: {
			created: createEvent("run.created"),
			started: createEvent("run.started"),
			config: createFilter("run.config"),
			step: {
				completed: createEvent("run.step.completed"),
			},
			wake: createEvent("run.wake"),
		},
		loop: {
			started: createEvent("loop.started"),
			completed: createEvent("loop.completed"),
		},
		turn: {
			started: createEvent("turn.started"),
			beforeDispatch: createFilter("turn.beforeDispatch"),
			response: createEvent("turn.response"),
			dispatched: createEvent("turn.dispatched"),
			completed: createEvent("turn.completed"),
			verdict: createFilter("turn.verdict"),
		},
		proposal: {
			prepare: createEvent("proposal.prepare"),
			pending: createEvent("proposal.pending"),
			accepting: createFilter("proposal.accepting"),
			content: createFilter("proposal.content"),
			accepted: createEvent("proposal.accepted"),
			rejected: createEvent("proposal.rejected"),
		},
		assembly: {
			system: createFilter("assembly.system"),
			user: createFilter("assembly.user"),
		},
		instructions: {
			toolDocs: createFilter("instructions.toolDocs"),
		},
		ask: {
			started: createEvent("ask.started"),
			completed: createEvent("ask.completed"),
		},
		act: {
			started: createEvent("act.started"),
			completed: createEvent("act.completed"),
		},
		llm: {
			request: {
				started: createEvent("llm.request.started"),
				completed: createEvent("llm.request.completed"),
			},
			messages: createFilter("llm.messages"),
			response: createFilter("llm.response"),
			reasoning: createFilter("llm.reasoning"),
			providers: [],
		},
		file: {},
		prompt: {
			tools: createFilter("prompt.tools"),
		},
		entry: {
			recording: createFilter("entry.recording"),
			created: createEvent("entry.created"),
			changed: createEvent("entry.changed"),
		},
		tool: {
			before: createEvent("tool.before"),
			after: createEvent("tool.after"),
		},
		context: {
			materialized: createEvent("context.materialized"),
		},
		action: {},
		error: {
			log: createEvent("error.log"),
		},
		stream: {
			cancelled: createEvent("stream.cancelled"),
		},
		ui: {
			render: createEvent("ui.render"),
			notify: createEvent("ui.notify"),
		},
		socket: {
			message: {
				raw: createFilter("socket.message.raw"),
			},
		},
		rpc: {
			started: createEvent("rpc.started"),
			completed: createEvent("rpc.completed"),
			error: createEvent("rpc.error"),
			request: createFilter("rpc.request"),
			response: {
				result: createFilter("rpc.response.result"),
			},
			registry: new RpcRegistry(),
		},
		agent: {},
		tools,

		addFilter: registry.addFilter.bind(registry),
		applyFilters: registry.applyFilters.bind(registry),
		addEvent: registry.addEvent.bind(registry),
		emitEvent: registry.emitEvent.bind(registry),
	};
}
