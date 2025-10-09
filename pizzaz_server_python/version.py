"""
Centralized version management for the Apps SDK examples
This module provides a single source of truth for version hashes
and asset URLs to avoid hardcoded version references across the codebase.
"""

import hashlib
import json
import os
from pathlib import Path
from typing import Dict, Literal, Optional


# Read package.json version
package_json_path = Path(__file__).parent.parent / "package.json"
with open(package_json_path, "r") as f:
    package_json = json.load(f)
version = package_json["version"]


# Generate version hash (same logic as build-all.mts)
def get_version_hash() -> str:
    """Generate version hash from package.json version."""
    return hashlib.sha256(version.encode("utf-8")).hexdigest()[:4]


# Asset URL configuration
class AssetConfig:
    """Configuration for asset URLs."""

    def __init__(
        self,
        base_url: str = "https://persistent.oaistatic.com/ecosystem-built-assets",
        is_development: bool = False,
    ):
        self.base_url = base_url
        self.is_development = is_development


# Default configuration
DEFAULT_CONFIG = AssetConfig()


def get_asset_url(
    widget_name: str,
    asset_type: Literal["css", "js", "html"],
    config: AssetConfig = DEFAULT_CONFIG,
) -> str:
    """Get asset URL for a specific widget."""
    version_hash = get_version_hash()
    filename = f"{widget_name}-{version_hash}.{asset_type}"

    if config.is_development:
        # For local development, use relative paths
        return f"/assets/{filename}"

    # For production, use the configured base URL
    return f"{config.base_url}/{filename}"


def generate_widget_html(
    widget_name: str, config: AssetConfig = DEFAULT_CONFIG
) -> str:
    """Generate HTML markup for a widget."""
    css_url = get_asset_url(widget_name, "css", config)
    js_url = get_asset_url(widget_name, "js", config)
    root_id = f"{widget_name}-root"

    return f'''
<div id="{root_id}"></div>
<link rel="stylesheet" href="{css_url}">
<script type="module" src="{js_url}"></script>
    '''.strip()


def get_version_info() -> Dict[str, str]:
    """Get current version information."""
    from datetime import datetime

    return {
        "version": version,
        "hash": get_version_hash(),
        "timestamp": datetime.now().isoformat(),
    }