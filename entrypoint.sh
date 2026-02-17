#!/bin/bash
set -e

# Fix ownership on mounted volumes (runs as root, then drops to claude)
chown -R claude:claude /home/claude /workspace 2>/dev/null || true
gosu claude mkdir -p /home/claude/.claude/debug /home/claude/.claude/statsig /home/claude/.claude/projects /home/claude/.config

exec gosu claude node /app/server.js
