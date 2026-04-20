# Minimal devcontainer for openai-apps-sdk-examples
FROM mcr.microsoft.com/vscode/devcontainers/typescript-node:0-18

# Install pnpm
RUN npm install -g pnpm

# Set up workspace
WORKDIR /workspaces/openai-apps-sdk-examples

# Default shell
SHELL ["/bin/bash", "-c"]

# Minimal extensions (optional)
# You can add extensions here if needed

# Expose ports for servers
EXPOSE 4444 8000
