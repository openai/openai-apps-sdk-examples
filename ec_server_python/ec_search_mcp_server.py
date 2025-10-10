from __future__ import annotations

"""
MCP server for an EC product search demo.

This implementation mirrors the patterns used in the `pizzaz_server_python` example from
the open source `openai-apps-sdk-examples` repository.  It defines a single tool
(`ec-search`) that performs a simple product search over a static dataset and returns
results alongside an embedded widget.  The widget consists of inline HTML, CSS and
JavaScript which the ChatGPT Apps SDK can load and hydrate to render the search results
in the UI.

To run this server locally you must install the official Model Context Protocol (MCP)
Python SDK, including its FastAPI extra:

```
pip install mcp[fastapi]
```

Once installed, start the server with:

```
uvicorn ec_server_python.main:app --port 8000
```

The server exposes the following endpoints:

* `/mcp` – Server‑Sent Events stream for Apps SDK clients.
* `/mcp/messages` – POST endpoint for MCP messages such as `call_tool` requests.

The tool input schema accepts a `query` string and optional `minPrice`, `maxPrice` and
`sortBy` arguments.  It returns a list of products that match the query and price range,
sorted accordingly.  Each product includes a name, description, price, rating and
image URL.  The structured content is passed to the frontend widget via
`window.postMessage` where it is rendered into a simple card layout.
"""

from dataclasses import dataclass
from typing import Any, Dict, List

import mcp.types as types
from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, ConfigDict, Field, ValidationError

# Standard library
import os

# Third‑party
import requests  # type: ignore
from bs4 import BeautifulSoup  # type: ignore


@dataclass(frozen=True)
class ECWidget:
    """Definition for a single EC search widget."""
    identifier: str
    title: str
    template_uri: str
    invoking: str
    invoked: str
    html: str
    response_text: str


# Inline widget HTML with embedded style and script.  This markup contains all the
# necessary UI code so no external assets are required.  When the Apps SDK
# processes a tool call it will embed this HTML into an iframe and send a
# `postMessage` with the structured content.  The script listens for that
# message and populates the DOM accordingly.
_INLINE_WIDGET_HTML = (
    '<div id="ec-search-root"></div>\n'
    '<style>'
    'body { font-family: sans-serif; margin: 0; padding: 1rem; background: #f7f7f7; }'
    '.product-card { border: 1px solid #ccc; border-radius: 8px; padding: 1rem; margin-bottom: 1rem; background-color: #fff; }'
    '.product-card h3 { margin-top: 0; }'
    '.product-card p { margin-bottom: 0.5rem; }'
    '.product-card img { width: 100%; height: auto; border-radius: 8px; display: block; }'
    '.product-link { text-decoration: none; color: inherit; }'
    '</style>\n'
    '<script type="module">\n'
    'window.addEventListener("message", (event) => {\n'
    '  const data = event.data;\n'
    '  if (data && data.structuredContent && Array.isArray(data.structuredContent.products)) {\n'
    '    const root = document.getElementById("ec-search-root");\n'
    '    root.innerHTML = "";\n'
    '    data.structuredContent.products.forEach((product) => {\n'
    '      const card = document.createElement("div");\n'
    '      card.className = "product-card";\n'
    '      // Wrap the image and title in a link so clicking opens the product page\n'
    '      const link = document.createElement("a");\n'
    '      link.className = "product-link";\n'
    '      link.href = product.url || "#";\n'
    '      link.target = "_blank";\n'
    '      if (product.image) {\n'
    '        const img = document.createElement("img");\n'
    '        img.src = product.image;\n'
    '        link.appendChild(img);\n'
    '      }\n'
    '      const title = document.createElement("h3");\n'
    '      title.textContent = product.name;\n'
    '      link.appendChild(title);\n'
    '      card.appendChild(link);\n'
    '      if (product.description) {\n'
    '        const desc = document.createElement("p");\n'
    '        desc.textContent = product.description;\n'
    '        card.appendChild(desc);\n'
    '      }\n'
    '      if (product.price !== undefined && product.price !== null) {\n'
    '        const price = document.createElement("p");\n'
    '        price.textContent = "Price: " + product.price;\n'
    '        card.appendChild(price);\n'
    '      }\n'
    '      root.appendChild(card);\n'
    '    });\n'
    '  }\n'
    '});\n'
    '</script>'
)


# Define the single widget our server exposes.  Additional widgets can be added
# to this list if you implement more tools.
widgets: List[ECWidget] = [
    ECWidget(
        identifier="ec-search",
        title="EC Product Search",
        template_uri="ui://widget/ec-search.html",
        invoking="Searching for products",
        invoked="Displayed product search results",
        html=_INLINE_WIDGET_HTML,
        response_text="Rendered EC search results!",
    ),
]

# MIME type used for widget HTML.  This matches the skybridge spec used in
# the Apps SDK examples.
MIME_TYPE = "text/html+skybridge"


# Index widgets by identifier and URI for quick lookup.
WIDGETS_BY_ID: Dict[str, ECWidget] = {widget.identifier: widget for widget in widgets}
WIDGETS_BY_URI: Dict[str, ECWidget] = {widget.template_uri: widget for widget in widgets}


class ECSearchInput(BaseModel):
    """
    Input model for the EC search tool.  The fields mirror the JSON schema
    specification returned from `list_tools`.  Pydantic handles validation
    and type coercion.
    """
    query: str = Field(
        ...,
        alias="query",
        description="Search query string.",
    )
    min_price: float | None = Field(
        None,
        alias="minPrice",
        description="Minimum price filter.",
    )
    max_price: float | None = Field(
        None,
        alias="maxPrice",
        description="Maximum price filter.",
    )
    sort_by: str | None = Field(
        None,
        alias="sortBy",
        description="Sort order: priceAsc, priceDesc, ratingAsc, ratingDesc.",
    )

    # Ensure aliases are respected when parsing from dictionaries and forbid extra
    # properties to surface clear validation errors.
    model_config = ConfigDict(populate_by_name=True, extra="forbid")


# JSON Schema definition used by the Apps SDK to validate tool arguments.  It
# matches the fields of ECSearchInput.
TOOL_INPUT_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "query": {
            "type": "string",
            "description": "Search query string.",
        },
        "minPrice": {
            "type": "number",
            "description": "Minimum price filter.",
        },
        "maxPrice": {
            "type": "number",
            "description": "Maximum price filter.",
        },
        "sortBy": {
            "type": "string",
            "description": "Sort order: priceAsc, priceDesc, ratingAsc, ratingDesc.",
        },
    },
    "required": ["query"],
    "additionalProperties": False,
}


# Instantiate the FastMCP helper.  This creates an internal MCP server and
# exposes list and call endpoints based on the functions decorated below.
mcp = FastMCP(
    name="ec-search-python",
    sse_path="/mcp",
    message_path="/mcp/messages",
    stateless_http=True,
)


# Example dataset.  In a real application you would query your product
# catalogue or an external search API.  For demonstration purposes a small
# static list is sufficient.
_PRODUCTS: List[Dict[str, Any]] = [
    {
        "id": "1",
        "name": "Wireless Bluetooth Earbuds",
        "description": "Noise‑cancelling wireless earbuds with long battery life.",
        "price": 45.99,
        "rating": 4.5,
        "image": "https://images.unsplash.com/photo-1517430816045-df4b7de7ab05?auto=format&fit=crop&w=400&q=60",
    },
    {
        "id": "2",
        "name": "Smartphone Case",
        "description": "Durable and slim phone case for a variety of models.",
        "price": 19.99,
        "rating": 4.0,
        "image": "https://images.unsplash.com/photo-1503602642458-232111445657?auto=format&fit=crop&w=400&q=60",
    },
    {
        "id": "3",
        "name": "Gaming Laptop",
        "description": "High‑performance laptop with powerful graphics.",
        "price": 1299.00,
        "rating": 4.8,
        "image": "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=400&q=60",
    },
    {
        "id": "4",
        "name": "Wireless Mouse",
        "description": "Ergonomic wireless mouse with adjustable DPI.",
        "price": 25.50,
        "rating": 4.3,
        "image": "https://images.unsplash.com/photo-1581291518857-4e27b48ff24e?auto=format&fit=crop&w=400&q=60",
    },
    {
        "id": "5",
        "name": "Mechanical Keyboard",
        "description": "RGB backlit mechanical keyboard with blue switches.",
        "price": 89.99,
        "rating": 4.6,
        "image": "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=400&q=60",
    },
]

def _search_rakuten(query: str, hits: int = 10) -> List[Dict[str, Any]]:
    """
    Scrape Rakuten search results for the given keyword without using the API.
    This function issues a GET request to the public search page and attempts to
    parse out product information using BeautifulSoup.  Note that Rakuten may
    change their markup or block automated requests.  If scraping fails, an
    empty list is returned.
    """
    # Encode query for the URL.  Rakuten's search URL expects UTF‑8 encoded
    # characters directly in the path.
    from urllib.parse import quote

    encoded = quote(query)
    url = f"https://search.rakuten.co.jp/search/mall/{encoded}/"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Safari/537.36",
        "Accept-Language": "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",
    }
    try:
        resp = requests.get(url, headers=headers, timeout=10)
        if resp.status_code != 200:
            return []
        soup = BeautifulSoup(resp.text, "html.parser")
        items = soup.select(".searchresultitem")
        results: List[Dict[str, Any]] = []
        for item in items:
            # Product name and URL
            anchor = item.select_one(".title a")
            if anchor is None:
                continue
            name = anchor.get_text(strip=True)
            url_ = anchor["href"]
            # Image
            img_el = item.select_one("img")
            image_url = img_el["src"] if img_el else None
            # Price (remove commas and currency symbols)
            price_el = item.select_one(".important em") or item.select_one(".price")
            price = None
            if price_el:
                text = price_el.get_text(strip=True)
                text = text.replace(",", "").replace("¥", "").strip()
                try:
                    price = float(text)
                except Exception:
                    price = None
            results.append({
                "name": name,
                "description": None,
                "price": price,
                "rating": None,
                "image": image_url,
                "url": url_,
            })
            if len(results) >= hits:
                break
        return results
    except Exception:
        return []


def _search_yahoo(query: str, hits: int = 10) -> List[Dict[str, Any]]:
    """
    Scrape Yahoo! Shopping search results without using an API key.  The
    function performs an HTTP GET to Yahoo's search page and parses out
    product information with BeautifulSoup.  Yahoo may change their markup
    frequently or block scraping, so this function may fail and return an
    empty list.
    """
    from urllib.parse import quote
    encoded = quote(query)
    url = f"https://shopping.yahoo.co.jp/search?p={encoded}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Safari/537.36",
        "Accept-Language": "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",
    }
    try:
        resp = requests.get(url, headers=headers, timeout=10)
        if resp.status_code != 200:
            return []
        soup = BeautifulSoup(resp.text, "html.parser")
        # Yahoo! Shopping results may be contained within div elements with class 'ElSet_Item'
        items = soup.select("li[data-zaimoku='list']")
        if not items:
            items = soup.select(".elItem") or soup.select("li")
        results: List[Dict[str, Any]] = []
        for item in items:
            # Try to extract product link and name
            anchor = item.find('a')
            if not anchor:
                continue
            url_ = anchor.get('href')
            name_el = anchor.find('h3') or anchor.find('h2') or anchor
            name = name_el.get_text(strip=True) if name_el else None
            # Image
            img_el = anchor.find('img') or item.find('img')
            image_url = img_el.get('src') if img_el else None
            # Price
            price = None
            price_el = item.find('span', class_='elPrice') or item.find('span', class_='Price')
            if price_el:
                text = price_el.get_text(strip=True)
                text = text.replace(',', '').replace('¥', '').strip()
                try:
                    price = float(text)
                except Exception:
                    price = None
            # Description (optional)
            desc_el = item.find('p', class_='elDescription')
            desc = desc_el.get_text(strip=True) if desc_el else None
            if name:
                results.append({
                    "name": name,
                    "description": desc,
                    "price": price,
                    "rating": None,
                    "image": image_url,
                    "url": url_,
                })
                if len(results) >= hits:
                    break
        return results
    except Exception:
        return []


def _merge_and_filter(results: List[Dict[str, Any]], query: str, min_price: float | None, max_price: float | None) -> List[Dict[str, Any]]:
    """
    Merge results from multiple sources, filter by price and keyword, and remove
    duplicates based on the product URL.  Only products whose name or
    description contain the query are included.  If both `min_price` and
    `max_price` are provided, products outside the range are dropped.
    """
    seen_urls = set()
    filtered: List[Dict[str, Any]] = []
    query_lower = query.lower()
    for prod in results:
        url_ = prod.get("url")
        if not url_ or url_ in seen_urls:
            continue
        name = (prod.get("name") or "").lower()
        desc = (prod.get("description") or "").lower()
        if query_lower not in name and query_lower not in desc:
            continue
        price = prod.get("price")
        # Skip items without a numeric price when filters are specified
        if min_price is not None and isinstance(price, (int, float)) and price < min_price:
            continue
        if max_price is not None and isinstance(price, (int, float)) and price > max_price:
            continue
        seen_urls.add(url_)
        filtered.append(prod)
    return filtered


def _search_amazon(query: str, hits: int = 10) -> List[Dict[str, Any]]:
    """
    Scrape Amazon Japan search results for a given keyword.  This function
    accesses the public search page and attempts to parse product information.
    Amazon employs aggressive anti‑scraping measures; therefore requests may
    return HTTP 403 or incomplete content.  If scraping fails, the function
    returns an empty list.  Use a realistic User‑Agent and accept‑language
    header to mimic a browser and improve the chances of success.
    """
    from urllib.parse import quote
    encoded = quote(query)
    url = "https://www.amazon.co.jp/s"
    params = {"k": encoded}
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Safari/537.36",
        "Accept-Language": "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",
    }
    try:
        resp = requests.get(url, params=params, headers=headers, timeout=10)
        if resp.status_code != 200:
            return []
        soup = BeautifulSoup(resp.text, "html.parser")
        # Amazon identifies search result items with data-component-type
        items = soup.select("div.s-result-item[data-component-type='s-search-result']")
        results: List[Dict[str, Any]] = []
        for item in items:
            # Name and link
            h2 = item.find("h2")
            if not h2:
                continue
            a_tag = h2.find("a")
            if not a_tag:
                continue
            name = a_tag.get_text(strip=True)
            href = a_tag.get("href")
            url_ = f"https://www.amazon.co.jp{href}" if href else None
            # Image
            img_el = item.select_one("img.s-image")
            image_url = img_el.get("src") if img_el else None
            # Price: Amazon uses multiple classes; attempt to parse
            price_whole = item.select_one("span.a-price-whole")
            price_fraction = item.select_one("span.a-price-fraction")
            price = None
            if price_whole:
                price_str = price_whole.get_text(strip=True)
                if price_fraction:
                    price_str += price_fraction.get_text(strip=True)
                price_str = price_str.replace(",", "").strip()
                try:
                    price = float(price_str)
                except Exception:
                    price = None
            # Description: Amazon search results do not include a description; leave None
            results.append({
                "name": name,
                "description": None,
                "price": price,
                "rating": None,
                "image": image_url,
                "url": url_,
            })
            if len(results) >= hits:
                break
        return results
    except Exception:
        return []


def _resource_description(widget: ECWidget) -> str:
    """Return a short description for the resource listing."""
    return f"{widget.title} widget markup"


def _tool_meta(widget: ECWidget) -> Dict[str, Any]:
    """
    Construct the metadata dictionary attached to tool listings and responses.
    This matches the format produced by the pizzaz examples and signals to
    ChatGPT that the result can produce a widget.
    """
    return {
        "openai/outputTemplate": widget.template_uri,
        "openai/toolInvocation/invoking": widget.invoking,
        "openai/toolInvocation/invoked": widget.invoked,
        "openai/widgetAccessible": True,
        "openai/resultCanProduceWidget": True,
        "annotations": {
            "destructiveHint": False,
            "openWorldHint": False,
            "readOnlyHint": True,
        },
    }


def _embedded_widget_resource(widget: ECWidget) -> types.EmbeddedResource:
    """
    Helper to wrap our widget markup in an EmbeddedResource object.  This is
    attached to the `_meta` field of the tool result to allow ChatGPT Apps
    SDK to load the widget.
    """
    return types.EmbeddedResource(
        type="resource",
        resource=types.TextResourceContents(
            uri=widget.template_uri,
            mimeType=MIME_TYPE,
            text=widget.html,
            title=widget.title,
        ),
    )


@mcp._mcp_server.list_tools()
async def _list_tools() -> List[types.Tool]:
    """Advertise the list of tools supported by this server."""
    return [
        types.Tool(
            name=widget.identifier,
            title=widget.title,
            description=widget.title,
            inputSchema=TOOL_INPUT_SCHEMA,
            _meta=_tool_meta(widget),
        )
        for widget in widgets
    ]


@mcp._mcp_server.list_resources()
async def _list_resources() -> List[types.Resource]:
    """Advertise the list of available resources (the widget HTML)."""
    return [
        types.Resource(
            name=widget.title,
            title=widget.title,
            uri=widget.template_uri,
            description=_resource_description(widget),
            mimeType=MIME_TYPE,
            _meta=_tool_meta(widget),
        )
        for widget in widgets
    ]


@mcp._mcp_server.list_resource_templates()
async def _list_resource_templates() -> List[types.ResourceTemplate]:
    """
    Advertise resource templates.  In this simple implementation a template is
    equivalent to the resource itself, but the API requires both.
    """
    return [
        types.ResourceTemplate(
            name=widget.title,
            title=widget.title,
            uriTemplate=widget.template_uri,
            description=_resource_description(widget),
            mimeType=MIME_TYPE,
            _meta=_tool_meta(widget),
        )
        for widget in widgets
    ]


async def _handle_read_resource(req: types.ReadResourceRequest) -> types.ServerResult:
    """
    Handler for ReadResourceRequest.  Returns the widget HTML when the
    requested URI matches one of our widgets.
    """
    widget = WIDGETS_BY_URI.get(str(req.params.uri))
    if widget is None:
        return types.ServerResult(
            types.ReadResourceResult(
                contents=[],
                _meta={"error": f"Unknown resource: {req.params.uri}"},
            )
        )
    contents = [
        types.TextResourceContents(
            uri=widget.template_uri,
            mimeType=MIME_TYPE,
            text=widget.html,
            _meta=_tool_meta(widget),
        )
    ]
    return types.ServerResult(types.ReadResourceResult(contents=contents))


async def _call_tool_request(req: types.CallToolRequest) -> types.ServerResult:
    """
    Execute the EC search tool.  This validates inputs, performs a simple
    in-memory search over the product catalogue, sorts the results and
    returns them along with the widget metadata.
    """
    widget = WIDGETS_BY_ID.get(req.params.name)
    if widget is None:
        return types.ServerResult(
            types.CallToolResult(
                content=[
                    types.TextContent(
                        type="text",
                        text=f"Unknown tool: {req.params.name}",
                    )
                ],
                isError=True,
            )
        )
    arguments = req.params.arguments or {}
    try:
        payload = ECSearchInput.model_validate(arguments)
    except ValidationError as exc:
        return types.ServerResult(
            types.CallToolResult(
                content=[
                    types.TextContent(
                        type="text",
                        text=f"Input validation error: {exc.errors()}",
                    )
                ],
                isError=True,
            )
        )
    # Normalise inputs
    query = payload.query.lower()
    min_price = payload.min_price
    max_price = payload.max_price
    sort_by = (payload.sort_by or "").strip()
    # Perform live searches against supported e‑commerce APIs when available
    # Rakuten and Yahoo results are combined and then filtered
    combined_results: List[Dict[str, Any]] = []
    # Attempt to scrape from each supported marketplace.  These functions may
    # return an empty list if scraping fails or the site is inaccessible.
    combined_results.extend(_search_rakuten(query, hits=10))
    combined_results.extend(_search_yahoo(query, hits=10))
    combined_results.extend(_search_amazon(query, hits=10))
    # Merge, filter and deduplicate based on URL and price range
    filtered = _merge_and_filter(combined_results, query, min_price, max_price)
    # If no results from APIs, fall back to the built‑in demo dataset
    if not filtered:
        filtered = _merge_and_filter(_PRODUCTS, query, min_price, max_price)
    # Sorting
    if sort_by == "priceAsc":
        filtered.sort(key=lambda x: (x.get("price") if x.get("price") is not None else float('inf')))
    elif sort_by == "priceDesc":
        filtered.sort(key=lambda x: (x.get("price") if x.get("price") is not None else float('-inf')), reverse=True)
    elif sort_by == "ratingAsc":
        filtered.sort(key=lambda x: (x.get("rating") if x.get("rating") is not None else 0))
    elif sort_by == "ratingDesc":
        filtered.sort(key=lambda x: (x.get("rating") if x.get("rating") is not None else 0), reverse=True)
    # Limit to top 10 results
    limited = filtered[:10]
    structured = {"products": limited}
    # Embed the widget resource for the Apps SDK
    widget_resource = _embedded_widget_resource(widget)
    meta: Dict[str, Any] = {
        "openai.com/widget": widget_resource.model_dump(mode="json"),
        "openai/outputTemplate": widget.template_uri,
        "openai/toolInvocation/invoking": widget.invoking,
        "openai/toolInvocation/invoked": widget.invoked,
        "openai/widgetAccessible": True,
        "openai/resultCanProduceWidget": True,
    }
    return types.ServerResult(
        types.CallToolResult(
            content=[
                types.TextContent(
                    type="text",
                    text=widget.response_text,
                )
            ],
            structuredContent=structured,
            _meta=meta,
        )
    )


# Register the call and read handlers with the underlying MCP server.
mcp._mcp_server.request_handlers[types.CallToolRequest] = _call_tool_request
mcp._mcp_server.request_handlers[types.ReadResourceRequest] = _handle_read_resource


# Create the ASGI application.  The `streamable_http_app` method returns an
# application that supports both SSE and streamable HTTP.  This is what
# uvicorn will run.
app = mcp.streamable_http_app()

# Enable permissive CORS so that the widget resources can be fetched from the
# browser in development without additional configuration.
try:
    from starlette.middleware.cors import CORSMiddleware

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
        allow_credentials=False,
    )
except Exception:
    # Starlette is optional; ignore if unavailable
    pass


if __name__ == "__main__":
    import uvicorn

    # When run directly this will start the development server on port 8000.
    uvicorn.run("ec_server_python.main:app", host="0.0.0.0", port=8000)