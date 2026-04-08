# crunch

Mid-cascade entry summarization. When the crunch spiral demotes entries from
full to summary fidelity, this plugin compresses their bodies into ≤80-char
keyword strings stored as `attributes.summary`. ToolRegistry.view() prepends
these summaries above plugin output at summary fidelity. Subsequent crunch
spiral passes halve summaries deterministically (no LLM call).

Not a model-facing tool. No scheme registration. Subscribes to `cascade.summarize`.
