# Shopping cart MCP server (Python)

This example keeps cart business state on the MCP server instead of storing it
in widget state. The widget receives the current snapshot through
`structuredContent` and uses an app-only MCP tool to save quantity changes.

## Installation

Use the same dependencies as the other FastMCP Python examples:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r shopping_cart_python/requirements.txt
```

## Run the server

In one shell, build and serve the static assets from the repository root:

```bash
pnpm run build
pnpm run serve
```

In another shell, start the shopping-cart server:

```bash
python shopping_cart_python/main.py
# or
python -m uvicorn shopping_cart_python.main:app --host 0.0.0.0 --port 8000
```

The MCP endpoint uses Streamable HTTP at `http://127.0.0.1:8000/mcp`. Connect
with the MCP Inspector or follow OpenAI's
[connect and test guide](https://developers.openai.com/plugins/deploy/connect-chatgpt).

## How the state flow works

- `add_to_cart` adds items to the server's cart and returns the complete cart
  snapshot (`cartId` and `items`) in `structuredContent`.
- The widget calls the app-only `update_cart` tool when a user increments,
  decrements, or removes an item. The server replaces its cart contents and
  returns the updated snapshot.
- The server does not set `openai/widgetSessionId`. That value is host-provided;
  it is not an application-defined cart identifier.
- MCP `structuredContent` is available to both the model and the widget. Do not
  use it as a place for secrets or data that should be hidden from the model.

## Production considerations

This demo stores carts in a process-local dictionary. The data disappears when
the process restarts and is not shared across multiple server instances.
Production implementations should authenticate callers, authorize access to
each cart, and persist the cart in a user-scoped datastore. The server-side
store—not `widgetState`—should remain the source of truth for cart contents.

## Example demo flow

- Ask "Add 2 eggs to my cart" to create the cart and add eggs.
- Say "Now add milk" to add milk to that cart.
- Use the widget's `+` and `-` controls to update quantities; each change is
  sent to the server and reflected in the returned cart snapshot.
