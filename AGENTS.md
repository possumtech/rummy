# RUMMY: File Visibility Superstrate (Authoritative Context Control)

This document defines how Rummy manages the model's perception of the codebase. It establishes a **superstrate** (authoritative layer) that overrides Git or filesystem permissions.

## 1. The Visibility Matrix

The `visibility` state in the `repo_map_files` table is the source of truth for all Rummy and model operations.

| Visibility | RepoMap (Symbols) | Content (Body) | Edit (Write) | Notes |
| :--- | :---: | :---: | :---: | :--- |
| **`active`** | Yes | Yes | **YES** | Files the model is currently working on. |
| **`read_only`**| Yes | Yes | **NO** | Reference files. Model sees `<file read-only="true">`. |
| **`mappable`** | **YES** | No | No | Visible to model's "map" for context/navigation. |
| **`ignored`** | No | No | No | Completely hidden from the model. |

## 2. The Superstrate Hierarchy

The system follows a strict hierarchy to determine what the model sees.

1.  **Persistent Superstrate (Database)**: The `visibility` column in `repo_map_files` is final. If a file is marked `ignored`, the model **never** sees it.
2.  **Volatile State (Client Buffers)**: The list of `projectBufferFiles` sent by the client is a hint.
    *   If a buffer's visibility is `active`, it is sent to the model with full body.
    *   If a buffer's visibility is `read_only`, it is sent to the model with full body and `read-only="true"`.
    *   If a buffer's visibility is `mappable` or `ignored`, its content is **rejected** and never reaches the model.
3.  **Base Layer (Git/FS)**: Git provides the initial state (e.g., untracked vs. ignored), but this is strictly a **one-time or background suggestion** that is overridden by the database.

## 3. Client Interaction Model: Focus Control

The following semantic RPC commands are the primary way for a client to manage what the model sees. All support **glob patterns**.

### RPC: `activate`
Make files matching a pattern fully visible and editable.
```json
{ "method": "activate", "params": { "pattern": "src/*.js" } }
```

### RPC: `readOnly`
Make files matching a pattern visible but forbidden from being edited.
```json
{ "method": "readOnly", "params": { "pattern": "lib/**/*.js" } }
```

### RPC: `ignore`
Hide files matching a pattern entirely from the model's sight.
```json
{ "method": "ignore", "params": { "pattern": "**/*.log" } }
```

### RPC: `drop`
Demote files matching a pattern to "mappable" (symbols only). Ideal for clearing focus.
```json
{ "method": "drop", "params": { "pattern": "*" } }
```

---

### Meta RPC Methods

#### `fileStatus`
Retrieves the current authoritative state of a file.
```json
{ "method": "fileStatus", "params": { "path": "src/logic.js" } }
```

#### `getFiles`
Returns the visibility status for the entire project tree.
```json
{ "method": "getFiles", "params": {} }
```

## 4. Implementation Guidelines

*   **`AgentLoop.js`**: Before constructing the `<context>` block for the model, filter all `projectBufferFiles` against the database's `active` or `read_only` status.
*   **`RepoMap.js`**: When generating the symbolic map, only include files with visibility `active`, `read_only`, or `mappable`.
*   **`ProjectAgent.js`**: Reconcile Git status into the database but preserve any explicit overrides made by the user.
