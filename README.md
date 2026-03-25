# RUMMY: Relational Underpinned Model Manager & Yield-engine

Rummy is a high-integrity agent service that orchestrates LLM sessions via the **Rumsfeld Loop** architecture. It treats your codebase as a relational source of truth, managing state, discovery, and file modifications through a shared SQLite backend.

## Key Features

- **The Rumsfeld Loop:** A strict cognitive lifecycle (Observe, Orient, Decide, Act) that enforces discovery before modification to eliminate hallucinations.
- **Relational Integrity:** SQLite-backed state machine with declarative diff resolution and mandatory user-approval gates.
- **Adaptive Context:** Dynamic repository mapping that "squishes" file details (Full -> Signatures -> Paths) based on relevance and token budget.
- **Atomic Turns:** Consolidated WebSocket protocol that bundles content, diffs, and commands into single, deterministic responses.
- **Dumb Client Philosophy:** Designed to run lean on hardware like Raspberry Pi 5 by offloading all heavy parsing and state management to the server.

## Installation

```bash
git clone https://github.com/possumtech/rummy
cd rummy/main
npm install
cp .env.example .env
# Add your OPENROUTER_API_KEY to .env
```

## Usage

### Start the Service
```bash
npm start   # Production mode (port 3044)
npm run dev # Watch mode with dev database (port 3045)
```

### Protocol
Rummy communicates via JSON-RPC 2.0 over WebSockets. It uses a structured XML pipeline internally to build prompts and parse agent actions.

## The Rumsfeld Loop

Every turn, the model must declare what it knows, what it doesn't, and what it
plans to do — before it can act. This is enforced by protocol validation:

1. `<todo>`: Plan of action with verb-prefixed items (`- [ ] edit: fix the bug`).
2. `<known>`: Facts, analysis, and plans gathered so far.
3. `<unknown>`: What still needs to be discovered. Empty when nothing remains.

The model cannot skip steps or fabricate confidence. Discovery before modification
is structurally enforced, not requested.

See `ARCHITECTURE.md` for the full specification and `system.ask.md`/`system.act.md`
for the model-facing prompts. The `discover` RPC method returns the live protocol
reference at runtime.
