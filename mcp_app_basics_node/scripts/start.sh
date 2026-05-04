#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
SERVER_DIR=$(cd "$SCRIPT_DIR/.." && pwd)

sh "$SCRIPT_DIR/build-widgets.sh"

cd "$SERVER_DIR"
exec node --import tsx src/server.ts
