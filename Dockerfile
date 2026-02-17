FROM node:22-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    git \
    ssh \
    ca-certificates \
    sudo \
    procps \
    nano \
    && rm -rf /var/lib/apt/lists/*

# Install code-server
RUN curl -fsSL https://code-server.dev/install.sh | sh

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Create non-root user
RUN useradd -m -s /bin/bash -d /home/coder coder \
    && echo "coder ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/coder

# Create mount point directories
RUN mkdir -p /config /projects /home/coder/.config /home/coder/.claude \
    && chown -R coder:coder /home/coder /config /projects

COPY --chown=coder:coder entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

USER coder
WORKDIR /projects

EXPOSE 8443

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
