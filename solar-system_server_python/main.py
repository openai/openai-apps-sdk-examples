"""Solar system MCP server implemented with the Python FastMCP helper."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import os
import json
import time
from dotenv import load_dotenv
from typing import Any, Dict, List
import re

import mcp.types as types
from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, ConfigDict, Field, ValidationError

MIME_TYPE = "text/html+skybridge"

# Repo root for locating package.json if needed, and .env file
REPO_ROOT = Path(__file__).resolve().parents[1]

# Load .env from this server directory if present; OS env takes precedence
try:
    load_dotenv(REPO_ROOT / "solar-system_server_python" / ".env")
except Exception:
    pass

# Asset configuration mirrors the Pizzaz servers
CDN_BASE = "https://persistent.oaistatic.com/ecosystem-built-assets"
CDN_VERSION = "0038"


def _get_env(key: str) -> str | None:
    return os.environ.get(key)


# Environment variables - only these three are supported
ENVIRONMENT = (_get_env("ENVIRONMENT") or "").strip()
DOMAIN = (_get_env("DOMAIN") or "").strip() or None
PORT = (_get_env("PORT") or "").strip() or None

# Compute a default 4-char asset hash from package version
ASSETS_DIR = REPO_ROOT / "assets"
try:
    with (REPO_ROOT / "package.json").open("r", encoding="utf-8") as _pkg:
        _version = json.load(_pkg)["version"]
except Exception:
    _version = "0.0.0"
import hashlib
_default_asset_hash = hashlib.sha256(_version.encode("utf-8")).hexdigest()[:4]

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

def _discover_asset_hash() -> str | None:
    try:
        candidates = sorted(
            ASSETS_DIR.glob("solar-system-*.js"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
    except FileNotFoundError:
        return None
    except OSError:
        return None

    pattern = re.compile(r"^solar-system-([0-9a-f]{4})\.js$")
    for candidate in candidates:
        match = pattern.match(candidate.name)
        if match:
            return match.group(1)
    return None


_asset_hash = (
    (_get_env("ASSET_HASH") or "").strip().lower()
    or (_discover_asset_hash() or _default_asset_hash).lower()
)

# Derive a version tag from the process start minute when serving un-hashed dev assets
_is_dev_unhashed = bool(_dev_asset_origin) and (not _dev_asset_hashed)
_auto_dev_version = None
if _is_dev_unhashed:
    _auto_dev_version = f"dev-{int(time.time() // 60):x}"

_template_version = (_auto_dev_version or _asset_hash).lower()
_version_suffix = f"?v={_template_version}" if _template_version else ""
PLANETS = [
    "Mercury",
    "Venus",
    "Earth",
    "Mars",
    "Jupiter",
    "Saturn",
    "Uranus",
    "Neptune",
]
PLANET_ALIASES = {
    "terra": "Earth",
    "gaia": "Earth",
    "soliii": "Earth",
    "tellus": "Earth",
    "ares": "Mars",
    "jove": "Jupiter",
    "zeus": "Jupiter",
    "cronus": "Saturn",
    "ouranos": "Uranus",
    "poseidon": "Neptune",
}
PLANET_DESCRIPTIONS = {
    "Mercury": "Mercury is the smallest planet in the Solar System and the closest to the Sun. It has a rocky, cratered surface and extreme temperature swings.",
    "Venus": "Venus, similar in size to Earth, is cloaked in thick clouds of sulfuric acid with surface temperatures hot enough to melt lead.",
    "Earth": "Earth is the only known planet to support life, with liquid water covering most of its surface and a protective atmosphere.",
    "Mars": "Mars, the Red Planet, shows evidence of ancient rivers and volcanoes and is a prime target in the search for past life.",
    "Jupiter": "Jupiter is the largest planet, a gas giant with a Great Red Spot—an enormous storm raging for centuries.",
    "Saturn": "Saturn is famous for its stunning ring system composed of billions of ice and rock particles orbiting the planet.",
    "Uranus": "Uranus is an ice giant rotating on its side, giving rise to extreme seasonal variations during its long orbit.",
    "Neptune": "Neptune, the farthest known giant, is a deep-blue world with supersonic winds and a faint ring system.",
}
DEFAULT_PLANET = "Earth"


@dataclass(frozen=True)
class SolarWidget:
    identifier: str
    title: str
    template_uri: str
    invoking: str
    invoked: str
    html: str
    response_text: str


def _inline_widget_markup() -> str | None:
    css_path = ASSETS_DIR / f"solar-system-{_asset_hash}.css"
    js_path = ASSETS_DIR / f"solar-system-{_asset_hash}.js"
    try:
        css = css_path.read_text(encoding="utf-8")
        js = js_path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None
    except OSError:
        return None

    return (
        '<div id="solar-system-root"></div>\n'
        f"<style>\n{css}\n</style>\n"
        f"<script type=\"module\">\n{js}\n</script>"
    )


def _solar_widget_html() -> str:
    # Dev origin path (optionally hashed filenames) if configured
    if _dev_asset_origin:
        hash_segment = f"-{_asset_hash}" if _dev_asset_hashed else ""
        css_href = f"{_dev_asset_origin}/solar-system{hash_segment}.css"
        js_src = f"{_dev_asset_origin}/solar-system{hash_segment}.js"
        return (
            '<div id="solar-system-root"></div>\n'
            f'<link rel="stylesheet" href="{css_href}">\n'
            f'<script type="module" src="{js_src}"></script>'
        )

    if not ENVIRONMENT:
        return (
            '<div id="solar-system-root"></div>\n'
            f'<link rel="stylesheet" href="{CDN_BASE}/solar-system-{CDN_VERSION}.css">\n'
            f'<script type="module" src="{CDN_BASE}/solar-system-{CDN_VERSION}.js"></script>'
        )

    # Inline local hashed assets when available
    inline = _inline_widget_markup()
    if inline is not None:
        return inline

    # CDN fallback
    return (
        '<div id="solar-system-root"></div>\n'
        f'<link rel="stylesheet" href="{CDN_BASE}/solar-system-{CDN_VERSION}.css">\n'
        f'<script type="module" src="{CDN_BASE}/solar-system-{CDN_VERSION}.js"></script>'
    )


WIDGET = SolarWidget(
    identifier="solar-system",
    title="Explore the Solar System",
    template_uri=f"ui://widget/solar-system.html{_version_suffix}",
    invoking="Charting the solar system",
    invoked="Solar system ready",
    html=_solar_widget_html(),
    response_text="Solar system ready",
)


class SolarInput(BaseModel):
    """Schema describing the solar system focus request."""

    planet_name: str = Field(
        DEFAULT_PLANET,
        alias="planetName",
        description="Planet to focus in the widget (case insensitive).",
    )
    auto_orbit: bool = Field(
        True,
        alias="autoOrbit",
        description="Whether to keep the camera orbiting if the target planet is missing.",
    )

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


mcp = FastMCP(
    name="solar-system-python",
    stateless_http=True,
)

TOOL_INPUT_SCHEMA: Dict[str, Any] = SolarInput.model_json_schema()


def _resource_description(widget: SolarWidget) -> str:
    return f"{widget.title} widget markup"


def _tool_meta(widget: SolarWidget) -> Dict[str, Any]:
    return {
        "openai/outputTemplate": widget.template_uri,
        "openai/toolInvocation/invoking": widget.invoking,
        "openai/toolInvocation/invoked": widget.invoked,
        "openai/widgetAccessible": True,
        "openai/resultCanProduceWidget": True,
        "annotations": {
          "destructiveHint": False,
          "openWorldHint": False,
          "readOnlyHint": True
        }
    }


def _embedded_widget_resource(widget: SolarWidget) -> types.EmbeddedResource:
    text_contents = types.TextResourceContents(
        uri=widget.template_uri,  # type: ignore[arg-type]
        mimeType=MIME_TYPE,
        text=widget.html,
    )
    return types.EmbeddedResource(type="resource", resource=text_contents)


def _normalize_planet(name: str) -> str | None:
    if not name:
        return DEFAULT_PLANET

    key = name.strip().lower()
    if not key:
        return DEFAULT_PLANET

    clean = ''.join(ch for ch in key if ch.isalnum())

    for planet in PLANETS:
        planet_key = ''.join(ch for ch in planet.lower() if ch.isalnum())
        if clean == planet_key or key == planet.lower():
            return planet

    alias = PLANET_ALIASES.get(clean)
    if alias:
        return alias

    for planet in PLANETS:
        planet_key = ''.join(ch for ch in planet.lower() if ch.isalnum())
        if planet_key.startswith(clean):
            return planet

    return None


@mcp._mcp_server.list_tools()
async def _list_tools() -> List[types.Tool]:
    return [
        types.Tool(
            name="focus-solar-planet",
            title=WIDGET.title,
            description="Render the solar system widget centered on the requested planet.",
            inputSchema=TOOL_INPUT_SCHEMA,
            _meta=_tool_meta(WIDGET),
        )
    ]


@mcp._mcp_server.list_resources()
async def _list_resources() -> List[types.Resource]:
    return [
        types.Resource(
            name=WIDGET.title,
            title=WIDGET.title,
            uri=WIDGET.template_uri,  # type: ignore[arg-type]
            description=_resource_description(WIDGET),
            mimeType=MIME_TYPE,
            _meta=_tool_meta(WIDGET),
        )
    ]


@mcp._mcp_server.list_resource_templates()
async def _list_resource_templates() -> List[types.ResourceTemplate]:
    return [
        types.ResourceTemplate(
            name=WIDGET.title,
            title=WIDGET.title,
            uriTemplate=WIDGET.template_uri,  # type: ignore[arg-type]
            description=_resource_description(WIDGET),
            mimeType=MIME_TYPE,
            _meta=_tool_meta(WIDGET),
        )
    ]


async def _handle_read_resource(req: types.ReadResourceRequest) -> types.ServerResult:
    resource_uri = str(req.params.uri)

    if resource_uri != WIDGET.template_uri:
        return types.ServerResult(
            types.ReadResourceResult(
                contents=[],
                _meta={"error": f"Unknown resource: {req.params.uri}"},
            )
        )

    contents: List[types.TextResourceContents | types.BlobResourceContents] = [
        types.TextResourceContents(
            uri=WIDGET.template_uri,  # type: ignore[arg-type]
            mimeType=MIME_TYPE,
            text=WIDGET.html,
            _meta=_tool_meta(WIDGET),
        )
    ]

    return types.ServerResult(
        types.ReadResourceResult(contents=contents)  # type: ignore[arg-type,call-arg]
    )


async def _call_tool_request(req: types.CallToolRequest) -> types.ServerResult:
    arguments = req.params.arguments or {}
    try:
        payload = SolarInput.model_validate(arguments)
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
            )  # type: ignore[call-arg]
        )

    planet = _normalize_planet(payload.planet_name)
    if planet is None:
        return types.ServerResult(
            types.CallToolResult(
                content=[
                    types.TextContent(
                        type="text",
                        text=(
                            "Unknown planet. Provide one of: "
                            + ", ".join(PLANETS)
                        ),
                    )
                ],
                isError=True,
            )  # type: ignore[call-arg]
        )

    widget_resource = _embedded_widget_resource(WIDGET)
    meta: Dict[str, Any] = {
        "openai.com/widget": widget_resource.model_dump(mode="json"),
        "openai/outputTemplate": WIDGET.template_uri,
        "openai/toolInvocation/invoking": WIDGET.invoking,
        "openai/toolInvocation/invoked": WIDGET.invoked,
        "openai/widgetAccessible": True,
        "openai/resultCanProduceWidget": True,
    }

    description = PLANET_DESCRIPTIONS.get(planet, "")
    structured = {
        "planet_name": planet,
        "planet_description": description,
        "autoOrbit": payload.auto_orbit,
    }
    message = f"Centered the solar system view on {planet}."

    return types.ServerResult(
        types.CallToolResult(
            content=[
                types.TextContent(
                    type="text",
                    text=message,
                )
            ],
            structuredContent=structured,
            _meta=meta,
        )  # type: ignore[call-arg]
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
except Exception:  # pragma: no cover - middleware is optional
    pass


if __name__ == "__main__":
    import uvicorn
    try:
        _port = int(PORT or "8000")
    except Exception:
        _port = 8000
    uvicorn.run(app, host="0.0.0.0", port=_port)
