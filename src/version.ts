import fs from "fs";
import path from "path";
import crypto from "crypto";

/**
 * Centralized version management for the Apps SDK examples
 * This module provides a single source of truth for version hashes
 * and asset URLs to avoid hardcoded version references across the codebase.
 */

// Read package.json version
const packageJsonPath = path.resolve("package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const version = packageJson.version;

// Generate version hash (same logic as build-all.mts)
export function getVersionHash(): string {
  return crypto
    .createHash("sha256")
    .update(version, "utf8")
    .digest("hex")
    .slice(0, 4);
}

// Asset URL configuration
export interface AssetConfig {
  /** Base URL for built assets */
  baseUrl: string;

  /** Whether to use local development mode */
  isDevelopment?: boolean;
}

// Default configuration
export const DEFAULT_CONFIG: AssetConfig = {
  baseUrl: "https://persistent.oaistatic.com/ecosystem-built-assets",
  isDevelopment: false
};

/**
 * Get asset URL for a specific widget
 */
export function getAssetUrl(widgetName: string, assetType: "css" | "js" | "html", config: AssetConfig = DEFAULT_CONFIG): string {
  const versionHash = getVersionHash();
  const filename = `${widgetName}-${versionHash}.${assetType}`;

  if (config.isDevelopment) {
    // For local development, use relative paths
    return `/assets/${filename}`;
  }

  // For production, use the configured base URL
  return `${config.baseUrl}/${filename}`;
}

/**
 * Get all available widget names
 */
export function getWidgetNames(): string[] {
  return [
    "pizzaz",
    "pizzaz-carousel",
    "pizzaz-albums",
    "pizzaz-list",
    "pizzaz-video",
    "solar-system",
    "todo"
  ];
}

/**
 * Generate HTML markup for a widget
 */
export function generateWidgetHtml(widgetName: string, config: AssetConfig = DEFAULT_CONFIG): string {
  const cssUrl = getAssetUrl(widgetName, "css", config);
  const jsUrl = getAssetUrl(widgetName, "js", config);
  const rootId = `${widgetName}-root`;

  return `
<div id="${rootId}"></div>
<link rel="stylesheet" href="${cssUrl}">
<script type="module" src="${jsUrl}"></script>
  `.trim();
}

/**
 * Get current version information
 */
export function getVersionInfo() {
  return {
    version,
    hash: getVersionHash(),
    timestamp: new Date().toISOString()
  };
}