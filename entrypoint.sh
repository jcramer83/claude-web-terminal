#!/bin/bash
set -e

# Ensure .claude directory structure exists and is owned by claude user
# This is needed because Docker volumes mount as root
dirs=(
  "$HOME/.claude"
  "$HOME/.claude/debug"
  "$HOME/.claude/statsig"
  "$HOME/.claude/projects"
)

for dir in "${dirs[@]}"; do
  mkdir -p "$dir"
done

exec node /app/server.js
