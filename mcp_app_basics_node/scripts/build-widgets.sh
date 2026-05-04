#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
SERVER_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
ROOT_DIR=$(cd "$SERVER_DIR/.." && pwd)

TARGETS="show-tool-result,send-message,update-model-context,call-server-tool,host-theming,open-link,request-display-mode,streaming-tool-input,get-host-capabilities,get-host-context,get-host-version"
ASSET_HASH_SALT=${ASSET_HASH_SALT:-"$(date +%Y%m%d%H%M%S)-$$"}

cd "$ROOT_DIR"
ASSET_HASH_SALT="$ASSET_HASH_SALT" pnpm run build -- --target "$TARGETS"
