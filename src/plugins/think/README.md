# think {#think_plugin}

Provides a `<think>` tag for model reasoning. Not a tool — does not
appear in the tool list.

## Registration

- **Scheme**: `think` — `category: "logging"`, `model_visible: 0`.
  The namespace exists as an extension surface for future
  reasoning-capture plugins; current core flow merges `<think>`
  content into the reasoning channel rather than persisting
  per-entry.
- **No handler, no view, no tool registration.**

## Behavior

The model writes `<think>reasoning</think>` before tool commands.
XmlParser captures it; the `llm.reasoning` filter folds its body
into `reasoning_content` for models without a server-side
reasoning channel. Models with extended thinking use that
capability independently. The `<think>` tag is a floor — every
model gets at least this.
