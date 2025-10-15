"""Pizzaz demo MCP server implemented with the Python FastMCP helper.

The server mirrors the Node example in this repository and exposes
widget-backed tools that render the Pizzaz UI bundle. Each handler returns the
HTML shell via an MCP resource and echoes the selected topping as structured
content so the ChatGPT client can hydrate the widget. The module also wires the
handlers into an HTTP/SSE stack so you can run the server with uvicorn on port
8000, matching the Node transport behavior."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Pattern, Tuple
import re

import hashlib
from dotenv import load_dotenv
import json
import logging
import os
import time
from urllib.parse import quote, unquote

import mcp.types as types
from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, ConfigDict, Field, ValidationError

logger = logging.getLogger(__name__)


REPO_ROOT = Path(__file__).resolve().parents[1]

# Load .env from this server directory if present, with OS env taking precedence
try:
    load_dotenv(REPO_ROOT / "pizzaz_server_python" / ".env")
except Exception:
    pass
ASSETS_DIR = REPO_ROOT / "assets"

with (REPO_ROOT / "package.json").open("r", encoding="utf-8") as package_file:
    _package_version = json.load(package_file)["version"]

DEFAULT_ASSET_HASH = hashlib.sha256(_package_version.encode("utf-8")).hexdigest()[:4]


def _discover_asset_hash() -> str | None:
    try:
        candidates = sorted(
            ASSETS_DIR.glob("*.js"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
    except FileNotFoundError:
        return None
    except OSError as exc:  # pragma: no cover
        logger.warning("Failed to scan assets directory for hash: %s", exc)
        return None

    pattern = re.compile(r"^[a-z0-9-]+-([0-9a-f]{4})\.js$")
    for candidate in candidates:
        match = pattern.match(candidate.name)
        if match:
            return match.group(1)
    return None


def _get_env(key: str) -> str | None:
    return os.environ.get(key)


# Environment variables - only these three are supported
ENVIRONMENT = (_get_env("ENVIRONMENT") or "").strip()
DOMAIN = (_get_env("DOMAIN") or "").strip() or None
PORT = (_get_env("PORT") or "").strip() or None

# Internal constants
CDN_BASE = "https://persistent.oaistatic.com/ecosystem-built-assets"
CDN_VERSION = "0038"

# Determine asset serving strategy based on ENVIRONMENT and DOMAIN
_environment = ENVIRONMENT.lower()
_is_env_local = _environment in {"local", "dev", "development"}

if DOMAIN:
    _dev_asset_origin = DOMAIN.rstrip("/")
elif _is_env_local:
    _dev_asset_origin = "http://localhost:4444"
else:
    _dev_asset_origin = None

# When using the Vite dev server (`pnpm run dev`), assets are served without the hash suffix
_dev_asset_hashed = not _is_env_local

asset_hash_override = (_get_env("ASSET_HASH") or "").strip().lower()
_asset_hash = asset_hash_override or (_discover_asset_hash() or DEFAULT_ASSET_HASH).lower()

# In dev with un-hashed assets, derive a version tag from the process start minute
_is_dev_unhashed = bool(_dev_asset_origin) and (not _dev_asset_hashed)
_auto_dev_version = None
if _is_dev_unhashed:
    # Auto-bump once per minute: dev-<base36(minutes since epoch)>
    _auto_dev_version = f"dev-{int(time.time() // 60):x}"

_template_version = (
    _auto_dev_version
    or _asset_hash
).lower()
_version_suffix = f"?v={_template_version}" if _template_version else ""

# Default pizza video (public-domain fallback that does not expire).
DEFAULT_PIZZA_VIDEO_URL = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"

VIDEO_URL_SCRIPT = f"<script>window.__PIZZAZ_VIDEO_URL__ = {json.dumps(DEFAULT_PIZZA_VIDEO_URL)};</script>"


@dataclass(frozen=True)
class PizzazWidget:
    identifier: str
    title: str
    template_uri: str
    output_template: str
    invoking: str
    invoked: str
    base_html: str
    response_text: str
    template_parameters: List[Dict[str, str]]


@dataclass(frozen=True)
class ResourceTemplateHandler:
    widget: PizzazWidget
    uri_template: str
    pattern: Pattern[str]
    parameter_names: List[str]
    render: Callable[[Dict[str, str]], str]


def _inline_widget_markup(asset_name: str) -> str | None:
    css_path = ASSETS_DIR / f"{asset_name}-{_asset_hash}.css"
    js_path = ASSETS_DIR / f"{asset_name}-{_asset_hash}.js"

    try:
        css = css_path.read_text(encoding="utf-8")
        js = js_path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None
    except OSError as exc:  # pragma: no cover
        logger.warning("Failed to load local assets for %s (%s)", asset_name, exc)
        return None

    extra = VIDEO_URL_SCRIPT if asset_name == "pizzaz-video" else ""

    return (
        f'<div id="{asset_name}-root"></div>\n'
        f"<style>\n{css}\n</style>\n"
        f"<script type=\"module\">\n{js}\n</script>\n"
        f"{extra}"
    )


def _cdn_widget_markup(asset_name: str) -> str:
    extra = VIDEO_URL_SCRIPT if asset_name == "pizzaz-video" else ""

    return (
        f'<div id="{asset_name}-root"></div>\n'
        f'<link rel="stylesheet" href="{CDN_BASE}/{asset_name}-{CDN_VERSION}.css">\n'
        f'<script type="module" src="{CDN_BASE}/{asset_name}-{CDN_VERSION}.js"></script>\n'
        f"{extra}"
    )


def _dev_hosted_widget_markup(asset_name: str) -> str | None:
    if not _dev_asset_origin:
        return None

    # Only serve from the dev origin if a corresponding entry exists under src/
    # This avoids emitting broken links for widgets that rely on CDN-only assets.
    src_dir = REPO_ROOT / "src" / asset_name
    if not src_dir.exists():
        return None

    hash_segment = f"-{_asset_hash}" if _dev_asset_hashed else ""
    css_href = f"{_dev_asset_origin}/{asset_name}{hash_segment}.css"
    js_src = f"{_dev_asset_origin}/{asset_name}{hash_segment}.js"

    extra = VIDEO_URL_SCRIPT if asset_name == "pizzaz-video" else ""

    return (
        f'<div id="{asset_name}-root"></div>\n'
        f'<link rel="stylesheet" href="{css_href}">\n'
        f'<script type="module" src="{js_src}"></script>\n'
        f"{extra}"
    )


def _build_widget_markup(asset_name: str) -> str:
    dev_markup = _dev_hosted_widget_markup(asset_name)
    if dev_markup is not None:
        logger.info("Serving %s from dev asset origin %s", asset_name, _dev_asset_origin)
        return dev_markup

    if not ENVIRONMENT:
        logger.info(
            "No ENVIRONMENT specified; falling back to CDN assets for %s",
            asset_name,
        )
        return _cdn_widget_markup(asset_name)

    inline = _inline_widget_markup(asset_name)
    if inline is not None:
        return inline

    logger.info(
        "Using CDN assets for %s (no matching local assets for hash %s in %s)",
        asset_name,
        _asset_hash,
        ASSETS_DIR,
    )
    return _cdn_widget_markup(asset_name)


TEMPLATE_PARAM_GLOBAL = "__PIZZAZ_TEMPLATE_PARAMS__"


def append_template_params_script(base_html: str, params: Dict[str, str]) -> str:
    if not params:
        return base_html

    serialized = json.dumps(params)
    # Escape the closing tag to avoid early termination when embedded inline
    script = f"<script>window.{TEMPLATE_PARAM_GLOBAL} = {serialized};<\\/script>"
    return f"{base_html}\n{script}"


def _escape_regex_segment(value: str) -> str:
    return re.escape(value)


def compile_uri_template(uri_template: str) -> tuple[Pattern[str], List[str]]:
    parameter_names: List[str] = []
    pattern_parts: List[str] = []
    last_index = 0

    for match in re.finditer(r"\{([^}]+)\}", uri_template):
        parameter = match.group(1)
        pattern_parts.append(_escape_regex_segment(uri_template[last_index:match.start()]))
        parameter_names.append(parameter)
        pattern_parts.append(f"(?P<{parameter}>[^/?#]+)")
        last_index = match.end()

    pattern_parts.append(_escape_regex_segment(uri_template[last_index:]))
    pattern = "".join(pattern_parts)
    return re.compile(f"^{pattern}$"), parameter_names


def fill_uri_template(template: str, params: Dict[str, str]) -> str:
    result = template
    for key, value in params.items():
        encoded = quote(value, safe="")
        result = result.replace(f"{{{key}}}", encoded)
    return result


def normalize(value: Optional[str]) -> str:
    if value is None:
        return ""
    return value.strip().lower()


def parse_price(value: Optional[str]) -> Optional[float]:
    if not value:
        return None
    match = re.search(r"-?\d+(?:\.\d+)?", value)
    if not match:
        return None
    try:
        parsed = float(match.group(0))
    except ValueError:
        return None
    return parsed


def compute_price_range(menu: List[Dict[str, Any]]) -> Optional[str]:
    prices = [price for item in menu if (price := parse_price(item.get("price")))]
    if not prices:
        return None

    min_price = min(prices)
    max_price = max(prices)

    def _format(val: float) -> str:
        return f"${val:.0f}" if abs(val - round(val)) < 1e-9 else f"${val:.2f}"

    if abs(min_price - max_price) < 0.01:
        return _format(min_price)

    return f"{_format(min_price)}–{_format(max_price)}"


def _load_markers() -> Dict[str, Any]:
    markers_path = REPO_ROOT / "src" / "pizzaz" / "markers.json"
    try:
        with markers_path.open("r", encoding="utf-8") as markers_file:
            return json.load(markers_file)
    except FileNotFoundError:
        logger.warning("Markers dataset not found at %s; proceeding with empty menu", markers_path)
    except json.JSONDecodeError as exc:
        logger.error("Failed to decode markers dataset %s: %s", markers_path, exc)
    return {"places": []}


def _prepare_restaurants(places: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    restaurants: List[Dict[str, Any]] = []
    menu_items: List[Dict[str, Any]] = []

    for place in places:
        toppings_set = {
            topping.strip()
            for topping in (place.get("toppings") or [])
            if isinstance(topping, str) and topping.strip()
        }

        sanitized_menu: List[Dict[str, Any]] = []
        for item in place.get("menu") or []:
            sanitized_toppings = [
                topping.strip()
                for topping in (item.get("toppings") or [])
                if isinstance(topping, str) and topping.strip()
            ]
            toppings_set.update(sanitized_toppings)

            sanitized_item = dict(item)
            sanitized_item["toppings"] = sanitized_toppings
            if not sanitized_item.get("image"):
                sanitized_item["image"] = place.get("thumbnail")
            sanitized_menu.append(sanitized_item)

        price_range = compute_price_range(sanitized_menu)

        restaurant = {
            **place,
            "toppings": sorted(toppings_set),
            "menu": sanitized_menu,
            "priceRange": price_range,
        }
        restaurants.append(restaurant)

        for sanitized_item in sanitized_menu:
            menu_items.append({**sanitized_item, "restaurant": restaurant})

    return restaurants, menu_items


_markers_data = _load_markers()
_places = _markers_data.get("places", []) if isinstance(_markers_data, dict) else []
RESTAURANTS, MENU_ITEMS = _prepare_restaurants(_places)

RESTAURANTS_BY_ID: Dict[str, Dict[str, Any]] = {
    normalize(restaurant.get("id")): restaurant
    for restaurant in RESTAURANTS
    if restaurant.get("id")
}

RESTAURANTS_BY_NORMALIZED_NAME: Dict[str, Dict[str, Any]] = {
    normalize(restaurant.get("name")): restaurant
    for restaurant in RESTAURANTS
    if restaurant.get("name")
}

MENU_ITEMS_BY_ID: Dict[str, Dict[str, Any]] = {
    normalize(item.get("id")): item
    for item in MENU_ITEMS
    if item.get("id")
}

MENU_ITEMS_BY_NORMALIZED_NAME: Dict[str, Dict[str, Any]] = {
    normalize(item.get("name")): item
    for item in MENU_ITEMS
    if item.get("name")
}

ALL_TOPPINGS: List[str] = sorted(
    {
        topping
        for item in MENU_ITEMS
        for topping in item.get("toppings") or []
        if isinstance(topping, str) and topping
    },
    key=lambda topping: topping.lower(),
)

TOPPINGS_BY_NORMALIZED: Dict[str, str] = {
    normalize(topping): topping for topping in ALL_TOPPINGS
}


def find_topping(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    return TOPPINGS_BY_NORMALIZED.get(normalize(value))


def find_pizza(value: Optional[str]) -> Optional[Dict[str, Any]]:
    if not value:
        return None

    normalized = normalize(value)
    if normalized in MENU_ITEMS_BY_ID:
        return MENU_ITEMS_BY_ID[normalized]
    if normalized in MENU_ITEMS_BY_NORMALIZED_NAME:
        return MENU_ITEMS_BY_NORMALIZED_NAME[normalized]

    for item in MENU_ITEMS:
        if normalize(item.get("name")) == normalized or normalize(item.get("id")) == normalized:
            return item
    return None

MIME_TYPE = "text/html+skybridge"


def widget_meta(
    widget: PizzazWidget,
    *,
    output_template: Optional[str] = None,
    include_parameter_schema: bool = False,
    parameter_values: Optional[Dict[str, str]] = None,
    resolved_uri: Optional[str] = None,
) -> Dict[str, Any]:
    meta: Dict[str, Any] = {
        "openai/outputTemplate": output_template or widget.output_template,
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

    if include_parameter_schema and widget.template_parameters:
        schema: Dict[str, Any] = {}
        for parameter in widget.template_parameters:
            name = parameter.get("name")
            if not name:
                continue
            entry: Dict[str, Any] = {"type": "string"}
            description = parameter.get("description")
            if description:
                entry["description"] = description
            schema[name] = entry
        if schema:
            meta["openai/outputTemplateSchema"] = schema

    if parameter_values:
        meta["openai/outputTemplateValues"] = parameter_values

    if resolved_uri:
        meta["openai/outputTemplateResolved"] = resolved_uri

    return meta


WidgetConfig = Dict[str, Any]

_WIDGET_CONFIGS: List[WidgetConfig] = [
    {
        "identifier": "pizza-map",
        "title": "Show Pizza Map",
        "template_uri_base": "ui://widget/pizza-map.html",
        "invoking": "Hand-tossing a map",
        "invoked": "Served a fresh map",
        "response_text": "Rendered a pizza map!",
        "asset_name": "pizzaz",
    },
    {
        "identifier": "pizza-carousel",
        "title": "Show Pizza Carousel",
        "template_uri_base": "ui://widget/pizza-carousel.html",
        "invoking": "Carousel some spots",
        "invoked": "Served a fresh carousel",
        "response_text": "Rendered a pizza carousel!",
        "asset_name": "pizzaz-carousel",
    },
    {
        "identifier": "pizza-albums",
        "title": "Show Pizza Album",
        "template_uri_base": "ui://widget/pizza-albums.html",
        "invoking": "Hand-tossing an album",
        "invoked": "Served a fresh album",
        "response_text": "Rendered a pizza album!",
        "asset_name": "pizzaz-albums",
    },
    {
        "identifier": "pizza-list",
        "title": "Show Pizza List",
        "template_uri_base": "ui://widget/pizza-list.html",
        "invoking": "Hand-tossing a list",
        "invoked": "Served a fresh list",
        "response_text": "Rendered a pizza list!",
        "asset_name": "pizzaz-list",
        "dynamic_template": {
            "uri_template_base": "ui://widget/pizza-list/{pizzaTopping}.html",
            "description": "Pizza list widget filtered by topping.",
            "parameters": [
                {
                    "name": "pizzaTopping",
                    "description": "Name of the topping to highlight in the list.",
                }
            ],
        },
    },
    {
        "identifier": "pizza-video",
        "title": "Show Pizza Video",
        "template_uri_base": "ui://widget/pizza-video.html",
        "invoking": "Hand-tossing a video",
        "invoked": "Served a fresh video",
        "response_text": "Rendered a pizza video!",
        "asset_name": "pizzaz-video",
    },
]


def _build_widget_collections() -> Tuple[
    List[PizzazWidget],
    List[types.Resource],
    List[types.ResourceTemplate],
    List[ResourceTemplateHandler],
]:
    widget_records: List[PizzazWidget] = []
    resources: List[types.Resource] = []
    resource_templates: List[types.ResourceTemplate] = []
    template_handlers: List[ResourceTemplateHandler] = []

    for config in _WIDGET_CONFIGS:
        template_uri_base = config["template_uri_base"]
        asset_name = config["asset_name"]
        template_uri = f"{template_uri_base}{_version_suffix}"

        dynamic_config = config.get("dynamic_template") or {}
        output_template_base = dynamic_config.get("uri_template_base", template_uri_base)
        output_template = f"{output_template_base}{_version_suffix}"

        base_html = _build_widget_markup(asset_name)
        template_parameters = [dict(param) for param in dynamic_config.get("parameters", [])]

        widget = PizzazWidget(
            identifier=config["identifier"],
            title=config["title"],
            template_uri=template_uri,
            output_template=output_template,
            invoking=config["invoking"],
            invoked=config["invoked"],
            base_html=base_html,
            response_text=config["response_text"],
            template_parameters=template_parameters,
        )
        widget_records.append(widget)

        description = f"{widget.title} widget markup"
        resource_meta = widget_meta(widget, output_template=widget.template_uri)

        resources.append(
            types.Resource(
                name=widget.title,
                uri=widget.template_uri,  # type: ignore[arg-type]
                description=description,
                mimeType=MIME_TYPE,
                _meta=resource_meta,
            )
        )

        static_template = types.ResourceTemplate(
            name=widget.title,
            uriTemplate=widget.template_uri,  # type: ignore[arg-type]
            description=description,
            mimeType=MIME_TYPE,
            _meta=resource_meta,
        )
        resource_templates.append(static_template)

        if dynamic_config:
            dynamic_uri_template = f"{dynamic_config['uri_template_base']}{_version_suffix}"
            pattern, parameter_names = compile_uri_template(dynamic_uri_template)
            templated_description = dynamic_config.get(
                "description",
                f"{widget.title} widget markup (templated)",
            )

            render_callable = dynamic_config.get("render")
            if callable(render_callable):
                def _dynamic_render(params: Dict[str, str], _render=render_callable, _base_html=base_html) -> str:
                    return _render(params, {"base_html": _base_html})
                render_func = _dynamic_render
            else:
                def _static_render(params: Dict[str, str], _base_html=base_html) -> str:
                    return append_template_params_script(_base_html, params)
                render_func = _static_render

            dynamic_meta = widget_meta(
                widget,
                output_template=dynamic_uri_template,
                include_parameter_schema=True,
            )

            resource_templates.append(
                types.ResourceTemplate(
                    name=widget.title,
                    uriTemplate=dynamic_uri_template,  # type: ignore[arg-type]
                    description=templated_description,
                    mimeType=MIME_TYPE,
                    _meta=dynamic_meta,
                )
            )

            template_handlers.append(
                ResourceTemplateHandler(
                    widget=widget,
                    uri_template=dynamic_uri_template,
                    pattern=pattern,
                    parameter_names=parameter_names,
                    render=render_func,
                )
            )

    return widget_records, resources, resource_templates, template_handlers


widgets, RESOURCES, RESOURCE_TEMPLATES, RESOURCE_TEMPLATE_HANDLERS = _build_widget_collections()


WIDGETS_BY_ID: Dict[str, PizzazWidget] = {widget.identifier: widget for widget in widgets}
WIDGETS_BY_URI: Dict[str, PizzazWidget] = {widget.template_uri: widget for widget in widgets}


class WidgetInput(BaseModel):
    """Schema for widget tools that accept an optional topping filter."""

    pizza_topping: Optional[str] = Field(
        default=None,
        alias="pizzaTopping",
        description="Topping to mention when rendering the widget.",
    )

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class PizzaDetailInput(BaseModel):
    """Schema for the pizza detail tool."""

    pizza_name: str = Field(
        ...,
        alias="pizzaName",
        description="Name or identifier of the pizza to describe.",
    )

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


mcp = FastMCP(
    name="pizzaz-python",
    stateless_http=True,
)


WIDGET_TOOL_INPUT_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "pizzaTopping": {
            "type": "string",
            "description": "Topping to mention when rendering the widget.",
        }
    },
    "required": [],
    "additionalProperties": False,
}

AVAILABLE_TOPPINGS_TOOL_NAME = "list-pizza-toppings"
AVAILABLE_TOPPINGS_TOOL_TITLE = "List Available Pizza Toppings"

AVAILABLE_TOPPINGS_TOOL_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {},
    "additionalProperties": False,
}

PIZZA_DETAIL_TOOL_NAME = "describe-pizza-toppings"
PIZZA_DETAIL_TOOL_TITLE = "Describe Pizza Toppings"

PIZZA_DETAIL_TOOL_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "pizzaName": {
            "type": "string",
            "description": "Name or identifier of the pizza to describe.",
        }
    },
    "required": ["pizzaName"],
    "additionalProperties": False,
}

@mcp._mcp_server.list_tools()
async def _list_tools() -> List[types.Tool]:
    widget_tools = [
        types.Tool(
            name=widget.identifier,
            title=widget.title,
            description=widget.title,
            inputSchema=deepcopy(WIDGET_TOOL_INPUT_SCHEMA),
            _meta=widget_meta(widget, include_parameter_schema=True),
        )
        for widget in widgets
    ]

    extra_tools = [
        types.Tool(
            name=AVAILABLE_TOPPINGS_TOOL_NAME,
            title=AVAILABLE_TOPPINGS_TOOL_TITLE,
            description="Lists every pizza topping supported by the Pizzaz widgets.",
            inputSchema=deepcopy(AVAILABLE_TOPPINGS_TOOL_SCHEMA),
            _meta={
                "openai/widgetAccessible": False,
                "openai/resultCanProduceWidget": False,
            },
        ),
        types.Tool(
            name=PIZZA_DETAIL_TOOL_NAME,
            title=PIZZA_DETAIL_TOOL_TITLE,
            description="Lists the toppings for a specific pizza from the demo dataset.",
            inputSchema=deepcopy(PIZZA_DETAIL_TOOL_SCHEMA),
            _meta={
                "openai/widgetAccessible": False,
                "openai/resultCanProduceWidget": False,
            },
        ),
    ]

    return widget_tools + extra_tools


@mcp._mcp_server.list_resources()
async def _list_resources() -> List[types.Resource]:
    return [deepcopy(resource) for resource in RESOURCES]


@mcp._mcp_server.list_resource_templates()
async def _list_resource_templates() -> List[types.ResourceTemplate]:
    return [deepcopy(template) for template in RESOURCE_TEMPLATES]


async def _handle_read_resource(req: types.ReadResourceRequest) -> types.ServerResult:
    uri = str(req.params.uri)

    widget = WIDGETS_BY_URI.get(uri)
    if widget is not None:
        contents: List[types.TextResourceContents | types.BlobResourceContents] = [
            types.TextResourceContents(
                uri=widget.template_uri,  # type: ignore[arg-type]
                mimeType=MIME_TYPE,
                text=widget.base_html,
                _meta=widget_meta(
                    widget,
                    output_template=widget.template_uri,
                    resolved_uri=widget.template_uri,
                ),
            )
        ]
        return types.ServerResult(types.ReadResourceResult(contents=contents))

    for handler in RESOURCE_TEMPLATE_HANDLERS:
        match = handler.pattern.match(uri)
        if not match:
            continue

        params: Dict[str, str] = {}
        group_dict = match.groupdict()
        for name in handler.parameter_names:
            value = group_dict.get(name)
            if not value:
                continue
            try:
                decoded = unquote(value)
            except Exception as exc:  # pragma: no cover - extremely unlikely
                logger.warning("Failed to decode template parameter %s=%s: %s", name, value, exc)
                decoded = value
            params[name] = decoded

        html = handler.render(params)
        contents = [
            types.TextResourceContents(
                uri=uri,  # type: ignore[arg-type]
                mimeType=MIME_TYPE,
                text=html,
                _meta=widget_meta(
                    handler.widget,
                    output_template=handler.uri_template,
                    include_parameter_schema=True,
                    parameter_values=params or None,
                    resolved_uri=uri,
                ),
            )
        ]
        return types.ServerResult(types.ReadResourceResult(contents=contents))

    return types.ServerResult(
        types.ReadResourceResult(
            contents=[],
            _meta={"error": f"Unknown resource: {req.params.uri}"},
        )
    )


async def _call_tool_request(req: types.CallToolRequest) -> types.ServerResult:
    tool_name = req.params.name

    if tool_name == AVAILABLE_TOPPINGS_TOOL_NAME:
        toppings_list = ALL_TOPPINGS
        toppings_text = ", ".join(f"“{topping}”" for topping in toppings_list)
        return types.ServerResult(
            types.CallToolResult(
                content=[
                    types.TextContent(
                        type="text",
                        text=f"Here are the toppings you can request: {toppings_text}.",
                    )
                ],
                structuredContent={"availableToppings": toppings_list},
                _meta={
                    "openai/widgetAccessible": False,
                    "openai/resultCanProduceWidget": False,
                },
            )
        )

    if tool_name == PIZZA_DETAIL_TOOL_NAME:
        arguments = req.params.arguments or {}
        try:
            payload = PizzaDetailInput.model_validate(arguments)
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

        pizza = find_pizza(payload.pizza_name)
        if pizza is None:
            suggestions = ", ".join(
                f"{item.get('name')} ({item.get('restaurant', {}).get('name')})"
                for item in MENU_ITEMS[:6]
            )
            return types.ServerResult(
                types.CallToolResult(
                    content=[
                        types.TextContent(
                            type="text",
                            text=f"I couldn’t find a pizza named “{payload.pizza_name}”. Try one of these: {suggestions}.",
                        )
                    ],
                    structuredContent={
                        "availablePizzas": [
                            {
                                "id": item.get("id"),
                                "name": item.get("name"),
                                "price": item.get("price"),
                                "toppings": item.get("toppings") or [],
                                "restaurant": {
                                    "id": item.get("restaurant", {}).get("id"),
                                    "name": item.get("restaurant", {}).get("name"),
                                    "city": item.get("restaurant", {}).get("city"),
                                    "rating": item.get("restaurant", {}).get("rating"),
                                    "priceRange": item.get("restaurant", {}).get("priceRange"),
                                },
                            }
                            for item in MENU_ITEMS
                        ]
                    },
                    _meta={
                        "openai/widgetAccessible": False,
                        "openai/resultCanProduceWidget": False,
                    },
                )
            )

        restaurant = pizza.get("restaurant", {})
        toppings = pizza.get("toppings") or []
        toppings_text = (
            ", ".join(f"“{topping}”" for topping in toppings)
            if toppings
            else "no recorded toppings"
        )
        price_fragment = f" It costs {pizza.get('price')}." if pizza.get("price") else ""

        return types.ServerResult(
            types.CallToolResult(
                content=[
                    types.TextContent(
                        type="text",
                        text=f"{pizza.get('name')} from {restaurant.get('name')} features {toppings_text}.{price_fragment}",
                    )
                ],
                structuredContent={
                    "pizza": {
                        "id": pizza.get("id"),
                        "name": pizza.get("name"),
                        "description": pizza.get("description"),
                        "price": pizza.get("price"),
                        "toppings": toppings,
                        "image": pizza.get("image"),
                    },
                    "restaurant": {
                        "id": restaurant.get("id"),
                        "name": restaurant.get("name"),
                        "city": restaurant.get("city"),
                        "description": restaurant.get("description"),
                        "rating": restaurant.get("rating"),
                        "thumbnail": restaurant.get("thumbnail"),
                        "priceRange": restaurant.get("priceRange"),
                    },
                    "toppings": toppings,
                },
                _meta={
                    "openai/widgetAccessible": False,
                    "openai/resultCanProduceWidget": False,
                },
            )
        )

    widget = WIDGETS_BY_ID.get(tool_name)
    if widget is None:
        return types.ServerResult(
            types.CallToolResult(
                content=[
                    types.TextContent(
                        type="text",
                        text=f"Unknown tool: {tool_name}",
                    )
                ],
                isError=True,
            )
        )

    arguments = req.params.arguments or {}
    try:
        payload = WidgetInput.model_validate(arguments)
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

    raw_topping = (payload.pizza_topping or "").strip()
    matched_topping = find_topping(raw_topping)
    has_recognized_topping = bool(matched_topping)

    parameter_values = (
        {"pizzaTopping": matched_topping} if has_recognized_topping and widget.template_parameters else None
    )

    resolved_output_template = (
        fill_uri_template(widget.output_template, parameter_values or {})
        if has_recognized_topping
        else widget.template_uri
    )

    meta_output_template = widget.output_template if has_recognized_topping else widget.template_uri

    response_text = (
        f"{widget.response_text} Filtered by “{matched_topping}”."
        if has_recognized_topping and matched_topping
        else f"{widget.response_text} Showing all pizzas."
    )

    return types.ServerResult(
        types.CallToolResult(
            content=[
                types.TextContent(
                    type="text",
                    text=response_text,
                )
            ],
            structuredContent={
                "pizzaTopping": matched_topping if has_recognized_topping else None,
                "availableToppings": ALL_TOPPINGS,
                "filterApplied": has_recognized_topping,
                "requestedTopping": raw_topping or None,
            },
            _meta=widget_meta(
                widget,
                include_parameter_schema=True,
                parameter_values=parameter_values,
                resolved_uri=resolved_output_template,
                output_template=meta_output_template,
            ),
        )
    )


mcp._mcp_server.request_handlers[types.CallToolRequest] = _call_tool_request
mcp._mcp_server.request_handlers[types.ReadResourceRequest] = _handle_read_resource


app = mcp.streamable_http_app()

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
    pass


if __name__ == "__main__":
    import uvicorn
    try:
        _port = int(PORT or "8000")
    except Exception:
        _port = 8000
    uvicorn.run(app, host="0.0.0.0", port=_port)
