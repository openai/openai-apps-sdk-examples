
curl -X POST http://127.0.0.1:8000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }'

curl -X POST https://pilar-subchronical-elizabeth.ngrok-free.dev/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }'


curl -X POST http://127.0.0.1:8000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "pizza-map",
    "arguments": {"pizzaTopping": "mushroom"}
  }
  }'

curl -X POST http://127.0.0.1:8000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "choose-question",
      "arguments": {
        "question":"What kind of chat would you like to have today?","choices":["Casual conversation","Deep discussion","Fun quiz","Learning something new"]
      }
    }
  }'


{"question":"What kind of chat would you like to have today?","choices":["Casual conversation","Deep discussion","Fun quiz","Learning something new"]}
