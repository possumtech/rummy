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

## Cognitive Architecture

Rummy enforces a strict order of operations in every turn:
1. `<learned>`: What was just discovered.
2. `<unknown>`: What is still missing.
3. `<tasks>`: Checklist of objectives.
4. `ACTION`: One discrete tool call (`read`, `edit`, `run`, etc.).

This ensures the model remains grounded in the current filesystem state and never "guesses" code it hasn't read.

See `AGENTS.md` for the full architectural specification and `SOCKET_PROTOCOL.md` for API details.
