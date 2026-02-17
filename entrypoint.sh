#!/bin/bash
set -e

# Link volume-mounted config directories into home
# This ensures auth tokens and settings persist across restarts

# code-server config
if [ ! -L "$HOME/.config/code-server" ]; then
    mkdir -p /config/code-server
    rm -rf "$HOME/.config/code-server"
    ln -sf /config/code-server "$HOME/.config/code-server"
fi

# Claude Code config
if [ ! -L "$HOME/.claude" ]; then
    mkdir -p /config/claude
    # Preserve any existing claude config
    if [ -d "$HOME/.claude" ] && [ ! -L "$HOME/.claude" ]; then
        cp -rn "$HOME/.claude/." /config/claude/ 2>/dev/null || true
    fi
    rm -rf "$HOME/.claude"
    ln -sf /config/claude "$HOME/.claude"
fi

# Set up code-server config if it doesn't exist
CONFIG_FILE="/config/code-server/config.yaml"
if [ ! -f "$CONFIG_FILE" ]; then
    mkdir -p /config/code-server
    cat > "$CONFIG_FILE" <<EOF
bind-addr: 0.0.0.0:8443
auth: password
password: ${PASSWORD:-changeme}
cert: false
EOF
    echo "Created default code-server config"
fi

# Update password if PASSWORD env var is set and config exists
if [ -n "$PASSWORD" ]; then
    sed -i "s/^password:.*/password: ${PASSWORD}/" "$CONFIG_FILE"
fi

echo "Starting code-server on port 8443..."
exec code-server --config "$CONFIG_FILE" /projects
