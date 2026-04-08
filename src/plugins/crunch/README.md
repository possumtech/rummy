# crunch

Mid-cascade entry summarization. Compresses known entries into ≤80-char keyword strings when the budget cascade demotes them from full to summary fidelity.

## Registration

- **Tool**: none (not model-facing)
- **Scheme**: none
- **Event**: `cascade.summarize`

## Behavior

When the budget cascade demotes entries that lack `attributes.summary`, it emits `cascade.summarize` with the batch. This plugin:

1. Builds a prompt asking the model to compress each entry to ≤80 chars of searchable keywords
2. Makes one direct LLM call via the `complete` closure (no run/loop/turn)
3. Parses the response (one line per entry: `path → keywords`)
4. Writes each summary to `attributes.summary` via `KnownStore.setAttributes()`

The `ToolRegistry.view()` fallback renders `attributes.summary` at summary fidelity automatically.

## Cost

One LLM call per demotion batch with unsummarized entries. Summaries persist on the entry — future demotions skip the call.

## Debug

Set `RUMMY_DEBUG=true` to log full request/response packets.
