FROM node:20-slim

# Install build tools for node-pty and useful utilities
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    git \
    curl \
    ca-certificates \
    gosu \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Create non-root user
RUN useradd -m -s /bin/bash -d /home/claude claude

WORKDIR /app

# Copy package files and install dependencies
COPY package.json ./
RUN npm install --production

# Copy application code
COPY server.js ./
COPY public/ ./public/

# Create workspace and config directories with correct ownership
RUN mkdir -p /workspace /home/claude/.claude/debug /home/claude/.claude/statsig /home/claude/.claude/projects \
    && chown -R claude:claude /workspace /home/claude /app

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENV HOME=/home/claude

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
