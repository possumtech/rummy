import { WebSocket } from "ws";

export default class RpcClient {
	#ws;
	#url;

	constructor(url) {
		this.#url = url;
	}

	async connect() {
		this.#ws = new WebSocket(this.#url);
		this.#ws.on("message", (data) => {
			const msg = JSON.parse(data.toString());
			if (msg.method && !msg.id) {
				// This is a notification
				this.#handleNotification(msg);
			}
		});

		return new Promise((resolve, reject) => {
			this.#ws.on("open", resolve);
			this.#ws.on("error", reject);
		});
	}

	#notifications = [];
	#notificationWaiters = [];

	#handleNotification(msg) {
		this.#notifications.push(msg);
		const waiters = [...this.#notificationWaiters];
		this.#notificationWaiters = [];
		for (const w of waiters) {
			if (w.filter(msg)) {
				w.resolve(msg);
			} else {
				this.#notificationWaiters.push(w);
			}
		}
	}

	async waitForNotification(filter = () => true, timeout = 5000) {
		const existing = this.#notifications.find(filter);
		if (existing) {
			this.#notifications = this.#notifications.filter((n) => n !== existing);
			return existing;
		}

		return new Promise((resolve, reject) => {
			const t = setTimeout(
				() => reject(new Error("Timeout waiting for notification")),
				timeout,
			);
			this.#notificationWaiters.push({
				filter,
				resolve: (msg) => {
					clearTimeout(t);
					resolve(msg);
				},
			});
		});
	}

	async call(
		method,
		params = {},
		id = Math.random().toString(36).slice(2),
		timeoutMs = 30000,
	) {
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(
				() => reject(new Error(`RPC Timeout: ${method}`)),
				timeoutMs,
			);

			const handler = (data) => {
				const msg = JSON.parse(data.toString());
				if (msg.id === id) {
					clearTimeout(timeout);
					this.#ws.off("message", handler);
					if (msg.error) reject(new Error(msg.error.message));
					else resolve(msg.result);
				}
			};

			this.#ws.on("message", handler);
			this.#ws.send(JSON.stringify({ jsonrpc: "2.0", method, params, id }));
		});
	}

	close() {
		if (this.#ws) this.#ws.close();
	}
}
