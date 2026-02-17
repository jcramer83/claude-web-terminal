#!/bin/bash
set -e

# Fix ownership on mounted volumes (runs as root)
chown -R claude:claude /home/claude/.claude /workspace

# Create required subdirectories
su claude -c "mkdir -p /home/claude/.claude/debug /home/claude/.claude/statsig /home/claude/.claude/projects"

# Drop to claude user and start the server
exec su claude -c "node /app/server.js"
