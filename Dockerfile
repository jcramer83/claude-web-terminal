FROM node:20-slim

# Install build tools for node-pty and useful utilities
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    git \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Create app directory
WORKDIR /app

# Copy package files and install dependencies
COPY package.json ./
RUN npm install --production

# Copy application code
COPY server.js ./
COPY public/ ./public/

# Create workspace directory
RUN mkdir -p /workspace

EXPOSE 3000

CMD ["node", "server.js"]
