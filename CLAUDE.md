# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Web Terminal is a browser-based terminal and chat interface for the Claude Code CLI. It uses xterm.js + node-pty for full terminal emulation over WebSocket, with an optional chat UI that streams responses via SSE.

## Development Commands

```bash
# Run locally (requires node-pty native build tools)
npm install
node server.js

# Docker (primary development method)
docker compose build --no-cache    # rebuild with latest Claude Code CLI
docker compose up -d               # start container
docker compose logs -f             # view logs
```

The server runs on port 3000. No test suite or linter is configured.

## Architecture

**Single-server monolith** — `server.js` (Express) handles everything: HTTP routes, WebSocket upgrades, PTY lifecycle, file API, and chat streaming. All state is in-memory (no database).

### Core Data Flow

```
Browser (xterm.js) ←→ WebSocket ←→ server.js ←→ node-pty (bash shell)
Browser (chat.js)  ←→ SSE       ←→ server.js ←→ claude CLI subprocess
```

### Server Components (server.js)

- **Session Map** — In-memory `Map()` of PTY sessions. Each session holds: pty process, connected WebSocket clients, scrollback buffer (200KB cap), metadata.
- **WebSocket handler** — Bidirectional terminal I/O at `/ws/:sessionId`. Replays scrollback on new client connection. Message types: `input`, `output`, `resize`, `exit`.
- **Chat endpoint** — `POST /api/chat` spawns `claude` CLI with `--output-format stream-json`, parses stdout JSON events, and forwards text deltas as SSE.
- **File API** — CRUD operations on `/workspace` directory. All paths validated against workspace root to prevent traversal.
- **Auth** — Optional basic auth via `AUTH_USER`/`AUTH_PASSWORD` env vars, session-based with express-session.

### Frontend (public/)

- **terminal.js** — xterm.js terminal with WebSocket client, special keys toolbar (Ctrl/Alt/Tab/Esc/arrows), file browser sidebar, search, clipboard handling. IIFE pattern.
- **chat.js** — Chat UI with SSE streaming, markdown rendering (marked.js via CDN), localStorage-backed conversation history (max 50).
- **style.css** — 4 themes (Default/Monokai/Dracula/Nord) via CSS custom properties. Theme-specific xterm.js color objects are duplicated in terminal.js.

### Docker

- `Dockerfile` — node:20-slim base, installs `@anthropic-ai/claude-code@latest` globally, creates non-root `claude` user.
- `entrypoint.sh` — Fixes volume permissions, then runs server as `claude` user via `gosu`.
- Volumes: `claude-home` (persists Claude OAuth/config), `workspace` (user files).
- CI: GitHub Actions builds and pushes to GHCR on master push.

## Key Conventions

- Frontend JS uses vanilla JS (no framework), IIFE-wrapped to avoid globals.
- All WebSocket messages are JSON: `{type: string, data?: string, cols?: number, rows?: number}`.
- Theme state stored in `localStorage('theme')`, chat history in `localStorage('chatHistory')`.
- File operations are sandboxed to `/workspace` via `path.resolve()` validation.
- PTY sessions auto-cleanup after idle timeout (default 12 hours, configurable via `IDLE_TIMEOUT_HOURS`).

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `ANTHROPIC_API_KEY` | Claude API key (alternative to OAuth) | — |
| `AUTH_USER` / `AUTH_PASSWORD` | Basic auth credentials | auth disabled |
| `IDLE_TIMEOUT_HOURS` | Kill idle sessions after N hours (0=never) | 12 |
| `TZ` | Container timezone | America/Chicago |
