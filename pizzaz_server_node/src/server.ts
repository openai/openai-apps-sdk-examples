import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync, readdirSync, Dirent } from "node:fs";
import { resolve } from "node:path";
import { URL, fileURLToPath } from "node:url";
import crypto from "node:crypto";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import 'dotenv/config';
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type CallToolRequest,
  type ListResourceTemplatesRequest,
  type ListResourcesRequest,
  type ListToolsRequest,
  type ReadResourceRequest,
  type Resource,
  type ResourceTemplate,
  type Tool
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import pkg from "../../package.json" with { type: "json" };
import markers from "../../src/pizzaz/markers.json" with { type: "json" };

const CDN_BASE = "https://persistent.oaistatic.com/ecosystem-built-assets";
const CDN_VERSION = "0038";

function getEnv(key: string): string | undefined {
  const value = process.env[key];
  return value === undefined ? undefined : value;
}

// Environment variables - only these three are supported
const ENVIRONMENT = (getEnv("ENVIRONMENT") ?? "").trim();
const DOMAIN = (getEnv("DOMAIN") ?? "").trim() || undefined;
const PORT = (getEnv("PORT") ?? "").trim() || undefined;

// Determine asset serving strategy based on ENVIRONMENT and DOMAIN
const environment = ENVIRONMENT.toLowerCase();
const isLocalEnv = environment === "local" || environment === "dev" || environment === "development";
const rawDevAssetOrigin = DOMAIN ?? (isLocalEnv ? "http://localhost:4444" : undefined);
const devAssetOrigin = rawDevAssetOrigin?.replace(/\/$/, "");

// When using the Vite dev server (`pnpm run dev`), assets are served without the hash suffix
const devAssetUseHash = !isLocalEnv;

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(__dirname, "../../");
const assetsDir = resolve(repoRoot, "assets");

function discoverAssetHash(dir: string): string | undefined {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") {
      console.warn(`Failed to scan assets directory for hash: ${err.message}`);
    }
    return undefined;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = entry.name.match(/^[a-z0-9-]+-([0-9a-f]{4})\.(?:js|css|html)$/);
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

const computedAssetHash = crypto
  .createHash("sha256")
  .update((pkg as { version: string }).version, "utf8")
  .digest("hex")
  .slice(0, 4);

const assetHash = (
  process.env.ASSET_HASH?.trim().toLowerCase() ||
  discoverAssetHash(assetsDir) ||
  computedAssetHash
).toLowerCase();

// In dev with un-hashed assets, derive a version tag from the process start minute
const isDevUnhashed = Boolean(devAssetOrigin) && !devAssetUseHash;
const autoDevVersion = isDevUnhashed
  ? `dev-${Math.floor(Date.now() / 60_000).toString(36)}`
  : undefined;
const templateVersion = (autoDevVersion ?? assetHash).toLowerCase();

// Default pizza video (public-domain fallback that does not expire).
const DEFAULT_PIZZA_VIDEO_URL =
  "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

const videoScriptSnippet = `<script>window.__PIZZAZ_VIDEO_URL__ = ${JSON.stringify(DEFAULT_PIZZA_VIDEO_URL)};<\/script>`;

type TemplateParameterDefinition = {
  name: string;
  description?: string;
};

type PizzaPlace = {
  id: string;
  name: string;
  description?: string;
  city?: string;
  rating?: number;
  thumbnail?: string;
  toppings?: string[];
  priceRange?: string;
  menu?: MenuItem[];
  [key: string]: unknown;
};

type MenuItem = {
  id: string;
  name: string;
  description?: string;
  price?: string;
  toppings?: string[];
  image?: string;
};

type DynamicTemplateConfig = {
  uriTemplateBase: string;
  description?: string;
  parameters: TemplateParameterDefinition[];
  render?: (params: Record<string, string>, context: { baseHtml: string }) => string;
};

type PizzazWidget = {
  id: string;
  title: string;
  templateUri: string;
  outputTemplate: string;
  invoking: string;
  invoked: string;
  html: string;
  responseText: string;
  templateParameters?: TemplateParameterDefinition[];
};

type WidgetConfig = {
  id: string;
  title: string;
  templateUriBase: string;
  invoking: string;
  invoked: string;
  responseText: string;
  assetName: string;
  dynamicTemplate?: DynamicTemplateConfig;
};

function devHostedWidgetHtml(assetName: string): string | undefined {
  if (!devAssetOrigin) {
    return undefined;
  }

  // Only serve from the dev origin if a corresponding entry exists under src/
  // This avoids emitting broken links for widgets that rely on CDN-only assets.
  const srcDir = resolve(repoRoot, "src", assetName);
  if (!existsSync(srcDir)) {
    return undefined;
  }

  const hashSegment = devAssetUseHash ? `-${assetHash}` : "";
  const cssHref = `${devAssetOrigin}/${assetName}${hashSegment}.css`;
  const jsSrc = `${devAssetOrigin}/${assetName}${hashSegment}.js`;
  const extraScript = assetName === "pizzaz-video" ? videoScriptSnippet : "";

  return `
<div id="${assetName}-root"></div>
<link rel="stylesheet" href="${cssHref}">
<script type="module" src="${jsSrc}"></script>
${extraScript}
  `.trim();
}

function inlineWidgetHtml(assetName: string): string | undefined {
  const cssPath = resolve(assetsDir, `${assetName}-${assetHash}.css`);
  const jsPath = resolve(assetsDir, `${assetName}-${assetHash}.js`);

  // If either file is missing, silently skip inlining and allow CDN/dev fallback.
  if (!existsSync(cssPath) || !existsSync(jsPath)) {
    return undefined;
  }

  try {
    const css = readFileSync(cssPath, "utf8");
    const js = readFileSync(jsPath, "utf8");

    const extraScript = assetName === "pizzaz-video" ? videoScriptSnippet : "";

    return `
<div id="${assetName}-root"></div>
<style>
${css}
</style>
<script type="module">
${js}
</script>
${extraScript}
    `.trim();
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    // Only warn on unexpected read errors; ENOENT is already handled above.
    if (err.code !== "ENOENT") {
      console.warn(
        `Failed to inline local assets for ${assetName}: ${err.message}. Falling back to CDN.`,
      );
    }
    return undefined;
  }
}

function cdnWidgetHtml(assetName: string): string {
  const extraScript = assetName === "pizzaz-video" ? videoScriptSnippet : "";

  return `
<div id="${assetName}-root"></div>
<link rel="stylesheet" href="${CDN_BASE}/${assetName}-${CDN_VERSION}.css">
<script type="module" src="${CDN_BASE}/${assetName}-${CDN_VERSION}.js"></script>
${extraScript}
  `.trim();
}

function buildWidgetHtml(assetName: string): string {
  const devHtml = devHostedWidgetHtml(assetName);
  if (devHtml) {
    return devHtml;
  }

  if (!ENVIRONMENT) {
    console.info(`No ENVIRONMENT set; falling back to CDN assets for ${assetName}`);
    return cdnWidgetHtml(assetName);
  }

  return inlineWidgetHtml(assetName) ?? cdnWidgetHtml(assetName);
}

const TEMPLATE_PARAM_GLOBAL = "__PIZZAZ_TEMPLATE_PARAMS__";

function appendTemplateParamsScript(baseHtml: string, params: Record<string, string>): string {
  const keys = Object.keys(params);
  if (keys.length === 0) {
    return baseHtml;
  }

  const serialized = JSON.stringify(params);
  const paramScript = `<script>window.${TEMPLATE_PARAM_GLOBAL} = ${serialized};<\/script>`;
  return `${baseHtml}\n${paramScript}`;
}

function escapeRegexSegment(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type CompiledUriTemplate = {
  regex: RegExp;
  parameterNames: string[];
};

function compileUriTemplate(uriTemplate: string): CompiledUriTemplate {
  const parameterNames: string[] = [];
  const placeholderRegex = /\{([^}]+)\}/g;
  let lastIndex = 0;
  let pattern = "";
  let match: RegExpExecArray | null;

  while ((match = placeholderRegex.exec(uriTemplate)) !== null) {
    const [placeholder, paramName] = match;
    pattern += escapeRegexSegment(uriTemplate.slice(lastIndex, match.index));
    parameterNames.push(paramName);
    pattern += `(?<${paramName}>[^/?#]+)`;
    lastIndex = match.index + placeholder.length;
  }

  pattern += escapeRegexSegment(uriTemplate.slice(lastIndex));

  return {
    parameterNames,
    regex: new RegExp(`^${pattern}$`)
  };
}

type ResourceTemplateHandler = {
  widget: PizzazWidget;
  template: ResourceTemplate;
  compiled: CompiledUriTemplate;
  render: (params: Record<string, string>) => string;
};

function fillUriTemplate(uriTemplate: string, params: Record<string, string>): string {
  return uriTemplate.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    const value = params[name];
    return encodeURIComponent(value ?? "");
  });
}

type WidgetMetaOptions = {
  outputTemplate?: string;
  includeParameterSchema?: boolean;
  parameterValues?: Record<string, string>;
  resolvedUri?: string;
};

function widgetMeta(widget: PizzazWidget, options: WidgetMetaOptions = {}): Record<string, unknown> {
  const {
    outputTemplate = widget.outputTemplate,
    includeParameterSchema = false,
    parameterValues,
    resolvedUri
  } = options;

  const meta: Record<string, unknown> = {
    "openai/outputTemplate": outputTemplate,
    "openai/toolInvocation/invoking": widget.invoking,
    "openai/toolInvocation/invoked": widget.invoked,
    "openai/widgetAccessible": true,
    "openai/resultCanProduceWidget": true
  };

  if (includeParameterSchema && widget.templateParameters?.length) {
    meta["openai/outputTemplateSchema"] = Object.fromEntries(
      widget.templateParameters.map((param) => [
        param.name,
        {
          type: "string",
          ...(param.description ? { description: param.description } : {})
        }
      ])
    );
  }

  if (parameterValues && Object.keys(parameterValues).length > 0) {
    meta["openai/outputTemplateValues"] = parameterValues;
  }

  if (resolvedUri) {
    meta["openai/outputTemplateResolved"] = resolvedUri;
  }

  return meta;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function findTopping(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return toppingsByNormalized.get(normalize(value));
}

function parsePrice(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const match = value.match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    return undefined;
  }
  const parsed = Number.parseFloat(match[0]);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function computePriceRange(menu: MenuItem[] | undefined): string | undefined {
  if (!menu || menu.length === 0) {
    return undefined;
  }

  const values = menu
    .map((item) => parsePrice(item.price))
    .filter((value): value is number => typeof value === "number" && !Number.isNaN(value));

  if (values.length === 0) {
    return undefined;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const format = (value: number) => `$${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2)}`;

  if (Math.abs(min - max) < 0.01) {
    return format(min);
  }

  return `${format(min)}–${format(max)}`;
}

function findPizza(value: string | undefined): MenuItemWithRestaurant | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = normalize(value);

  const byId = menuItemsById.get(normalized);
  if (byId) {
    return byId;
  }

  const byName = menuItemsByNormalizedName.get(normalized);
  if (byName) {
    return byName;
  }

  return menuItems.find(
    (item) => normalize(item.name) === normalized || normalize(item.id) === normalized
  );
}

const widgetConfigs: WidgetConfig[] = [
  {
    id: "pizza-map",
    title: "Show Pizza Map",
    templateUriBase: "ui://widget/pizza-map.html",
    invoking: "Hand-tossing a map",
    invoked: "Served a fresh map",
    responseText: "Rendered a pizza map!",
    assetName: "pizzaz"
  },
  {
    id: "pizza-carousel",
    title: "Show Pizza Carousel",
    templateUriBase: "ui://widget/pizza-carousel.html",
    invoking: "Carousel some spots",
    invoked: "Served a fresh carousel",
    responseText: "Rendered a pizza carousel!",
    assetName: "pizzaz-carousel"
  },
  {
    id: "pizza-albums",
    title: "Show Pizza Album",
    templateUriBase: "ui://widget/pizza-albums.html",
    invoking: "Hand-tossing an album",
    invoked: "Served a fresh album",
    responseText: "Rendered a pizza album!",
    assetName: "pizzaz-albums"
  },
  {
    id: "pizza-list",
    title: "Show Pizza List",
    templateUriBase: "ui://widget/pizza-list.html",
    invoking: "Hand-tossing a list",
    invoked: "Served a fresh list",
    responseText: "Rendered a pizza list!",
    assetName: "pizzaz-list",
    dynamicTemplate: {
      uriTemplateBase: "ui://widget/pizza-list/{pizzaTopping}.html",
      description: "Pizza list widget filtered by topping.",
      parameters: [
        {
          name: "pizzaTopping",
          description: "Name of the topping to highlight in the list."
        }
      ]
    }
  },
  {
    id: "pizza-video",
    title: "Show Pizza Video",
    templateUriBase: "ui://widget/pizza-video.html",
    invoking: "Hand-tossing a video",
    invoked: "Served a fresh video",
    responseText: "Rendered a pizza video!",
    assetName: "pizzaz-video"
  }
];

const versionSuffix = templateVersion ? `?v=${templateVersion}` : "";

const resources: Resource[] = [];
const resourceTemplates: ResourceTemplate[] = [];
const resourceTemplateHandlers: ResourceTemplateHandler[] = [];

const restaurants: PizzaPlace[] = ((markers as { places?: PizzaPlace[] }).places ?? []).map((place) => {
  const toppingSet = new Set<string>();

  (place.toppings ?? [])
    .map((topping) => topping.trim())
    .filter(Boolean)
    .forEach((topping) => toppingSet.add(topping));

  const menu = (place.menu ?? []).map((menuItem) => {
    const sanitizedToppings = (menuItem.toppings ?? [])
      .map((topping) => topping.trim())
      .filter(Boolean);
    sanitizedToppings.forEach((topping) => toppingSet.add(topping));

    return {
      ...menuItem,
      toppings: sanitizedToppings,
      image: menuItem.image ?? place.thumbnail
    } satisfies MenuItem;
  });

  const priceRange = computePriceRange(menu);

  return {
    ...place,
    toppings: Array.from(toppingSet),
    menu,
    priceRange
  } satisfies PizzaPlace;
});

type MenuItemWithRestaurant = MenuItem & { restaurant: PizzaPlace };

const menuItems: MenuItemWithRestaurant[] = restaurants.flatMap((place) =>
  (place.menu ?? []).map((item) => ({
    ...item,
    restaurant: place
  }))
);

const restaurantsById = new Map<string, PizzaPlace>();
const restaurantsByNormalizedName = new Map<string, PizzaPlace>();

restaurants.forEach((place) => {
  restaurantsById.set(place.id.toLowerCase(), place);
  restaurantsByNormalizedName.set(place.name.toLowerCase(), place);
});

const menuItemsById = new Map<string, MenuItemWithRestaurant>();
const menuItemsByNormalizedName = new Map<string, MenuItemWithRestaurant>();

menuItems.forEach((item) => {
  menuItemsById.set(item.id.toLowerCase(), item);
  menuItemsByNormalizedName.set(item.name.toLowerCase(), item);
});

const allToppings = Array.from(
  new Set(menuItems.flatMap((item) => item.toppings ?? []))
).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

const toppingsByNormalized = new Map<string, string>();
allToppings.forEach((topping) => {
  toppingsByNormalized.set(topping.toLowerCase(), topping);
});

const widgets: PizzazWidget[] = widgetConfigs.map((config) => {
  const templateUri = `${config.templateUriBase}${versionSuffix}`;
  const outputTemplateBase = config.dynamicTemplate?.uriTemplateBase ?? config.templateUriBase;
  const outputTemplate = `${outputTemplateBase}${versionSuffix}`;
  const baseHtml = buildWidgetHtml(config.assetName);

  const widget: PizzazWidget = {
    id: config.id,
    title: config.title,
    templateUri,
    outputTemplate,
    invoking: config.invoking,
    invoked: config.invoked,
    responseText: config.responseText,
    html: baseHtml,
    templateParameters: config.dynamicTemplate?.parameters
  };

  const resourceDescription = `${config.title} widget markup`;

  resources.push({
    uri: templateUri,
    name: config.title,
    description: resourceDescription,
    mimeType: "text/html+skybridge",
    _meta: widgetMeta(widget, { outputTemplate: templateUri })
  });

  resourceTemplates.push({
    uriTemplate: templateUri,
    name: config.title,
    description: resourceDescription,
    mimeType: "text/html+skybridge",
    _meta: widgetMeta(widget, { outputTemplate: templateUri })
  });

  if (config.dynamicTemplate) {
    const dynamicUriTemplate = `${config.dynamicTemplate.uriTemplateBase}${versionSuffix}`;
    const compiled = compileUriTemplate(dynamicUriTemplate);
    const render = config.dynamicTemplate.render
      ? (params: Record<string, string>) => config.dynamicTemplate!.render!(params, { baseHtml })
      : (params: Record<string, string>) => appendTemplateParamsScript(baseHtml, params);

    const templatedResource: ResourceTemplate = {
      uriTemplate: dynamicUriTemplate,
      name: config.title,
      description: config.dynamicTemplate.description ?? `${config.title} widget markup (templated)`,
      mimeType: "text/html+skybridge",
      _meta: widgetMeta(widget, {
        outputTemplate: dynamicUriTemplate,
        includeParameterSchema: true
      })
    };

    resourceTemplates.push(templatedResource);
    resourceTemplateHandlers.push({
      widget,
      template: templatedResource,
      compiled,
      render
    });
  }

  return widget;
});

const widgetsById = new Map<string, PizzazWidget>();
const widgetsByUri = new Map<string, PizzazWidget>();

widgets.forEach((widget) => {
  widgetsById.set(widget.id, widget);
  widgetsByUri.set(widget.templateUri, widget);
});

const toolInputSchema = {
  type: "object",
  properties: {
    pizzaTopping: {
      type: "string",
      description: "Topping to mention when rendering the widget."
    }
  },
  required: [],
  additionalProperties: false
} as const;

const toolInputParser = z.object({
  pizzaTopping: z.string().optional()
});

const widgetTools: Tool[] = widgets.map((widget) => ({
  name: widget.id,
  description: widget.title,
  inputSchema: toolInputSchema,
  title: widget.title,
  _meta: widgetMeta(widget, { includeParameterSchema: true })
}));

const availableToppingsTool: Tool = {
  name: "list-pizza-toppings",
  title: "List Available Pizza Toppings",
  description: "Lists every pizza topping supported by the Pizzaz widgets.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false
  },
  _meta: {
    "openai/widgetAccessible": false,
    "openai/resultCanProduceWidget": false
  }
};

const pizzaDetailToolInputSchema = {
  type: "object",
  properties: {
    pizzaName: {
      type: "string",
      description: "Name or identifier of the pizza to describe."
    }
  },
  required: ["pizzaName"],
  additionalProperties: false
} as const;

const pizzaDetailInputParser = z.object({
  pizzaName: z.string()
});

const pizzaDetailTool: Tool = {
  name: "describe-pizza-toppings",
  title: "Describe Pizza Toppings",
  description: "Lists the toppings for a specific pizza from the demo dataset.",
  inputSchema: pizzaDetailToolInputSchema,
  _meta: {
    "openai/widgetAccessible": false,
    "openai/resultCanProduceWidget": false
  }
};

const tools: Tool[] = [...widgetTools, availableToppingsTool, pizzaDetailTool];

function createPizzazServer(): Server {
  const server = new Server(
    {
      name: "pizzaz-node",
      version: "0.1.0"
    },
    {
      capabilities: {
        resources: {},
        tools: {}
      }
    }
  );

  server.setRequestHandler(ListResourcesRequestSchema, async (_request: ListResourcesRequest) => ({
    resources
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request: ReadResourceRequest) => {
    const widget = widgetsByUri.get(request.params.uri);

    if (widget) {
      return {
        contents: [
          {
            uri: widget.templateUri,
            mimeType: "text/html+skybridge",
            text: widget.html,
            _meta: widgetMeta(widget, {
              outputTemplate: widget.templateUri,
              resolvedUri: widget.templateUri
            })
          }
        ]
      };
    }

    for (const handler of resourceTemplateHandlers) {
      const match = handler.compiled.regex.exec(request.params.uri);
      const groups = match?.groups;

      if (!groups) {
        continue;
      }

      const params: Record<string, string> = {};
      handler.compiled.parameterNames.forEach((name) => {
        const value = groups[name];
        if (typeof value === "string" && value.length > 0) {
          let decoded = value;
          try {
            decoded = decodeURIComponent(value);
          } catch (error) {
            console.warn(`Failed to decode template parameter ${name}: ${(error as Error).message}`);
          }
          params[name] = decoded;
        }
      });

      const html = handler.render(params);

      return {
        contents: [
          {
            uri: request.params.uri,
            mimeType: "text/html+skybridge",
            text: html,
            _meta: widgetMeta(handler.widget, {
              outputTemplate: handler.template.uriTemplate,
              includeParameterSchema: true,
              parameterValues: params,
              resolvedUri: request.params.uri
            })
          }
        ]
      };
    }

    throw new Error(`Unknown resource: ${request.params.uri}`);
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async (_request: ListResourceTemplatesRequest) => ({
    resourceTemplates
  }));

  server.setRequestHandler(ListToolsRequestSchema, async (_request: ListToolsRequest) => ({
    tools
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
    if (request.params.name === availableToppingsTool.name) {
      const toppingsList = allToppings;
      return {
        content: [
          {
            type: "text",
            text: `Here are the toppings you can request: ${toppingsList
              .map((topping) => `“${topping}”`)
              .join(", ")}.`
          }
        ],
        structuredContent: {
          availableToppings: toppingsList
        },
        _meta: {
          "openai/widgetAccessible": false,
          "openai/resultCanProduceWidget": false
        }
      };
    }

    if (request.params.name === pizzaDetailTool.name) {
      const args = pizzaDetailInputParser.parse(request.params.arguments ?? {});
      const pizza = findPizza(args.pizzaName);

      if (!pizza) {
        const suggestions = menuItems
          .slice(0, 6)
          .map((item) => `${item.name} (${item.restaurant.name})`)
          .join(", ");
        return {
          content: [
            {
              type: "text",
              text: `I couldn’t find a pizza named “${args.pizzaName}”. Try one of these: ${suggestions}.`
            }
          ],
          structuredContent: {
            availablePizzas: menuItems.map((item) => ({
              id: item.id,
              name: item.name,
              price: item.price,
              toppings: item.toppings ?? [],
              restaurant: {
                id: item.restaurant.id,
                name: item.restaurant.name,
                city: item.restaurant.city,
                rating: item.restaurant.rating,
                priceRange: item.restaurant.priceRange
              }
            }))
          },
          _meta: {
            "openai/widgetAccessible": false,
            "openai/resultCanProduceWidget": false
          }
        };
      }

      const { restaurant, ...menuItem } = pizza;
      const toppings = menuItem.toppings ?? [];
      const toppingsText = toppings.length
        ? toppings.map((topping) => `“${topping}”`).join(", ")
        : "no recorded toppings";
      const priceFragment = menuItem.price ? ` It costs ${menuItem.price}.` : "";

      return {
        content: [
          {
            type: "text",
            text: `${menuItem.name} from ${restaurant.name} features ${toppingsText}.${priceFragment}`
          }
        ],
        structuredContent: {
          pizza: {
            id: menuItem.id,
            name: menuItem.name,
            description: menuItem.description,
            price: menuItem.price,
            toppings,
            image: menuItem.image
          },
          restaurant: {
            id: restaurant.id,
            name: restaurant.name,
            city: restaurant.city,
            description: restaurant.description,
            rating: restaurant.rating,
            thumbnail: restaurant.thumbnail,
            priceRange: restaurant.priceRange
          },
          toppings
        },
        _meta: {
          "openai/widgetAccessible": false,
          "openai/resultCanProduceWidget": false
        }
      };
    }

    const widget = widgetsById.get(request.params.name);

    if (!widget) {
      throw new Error(`Unknown tool: ${request.params.name}`);
    }

    const args = toolInputParser.parse(request.params.arguments ?? {});
    const rawTopping = args.pizzaTopping?.trim() ?? "";
    const matchedTopping = findTopping(rawTopping);
    const hasRecognizedTopping = Boolean(matchedTopping);

    const parameterValues = hasRecognizedTopping && widget.templateParameters?.length
      ? {
          pizzaTopping: matchedTopping as string
        }
      : undefined;

    const resolvedOutputTemplate = hasRecognizedTopping
      ? fillUriTemplate(widget.outputTemplate, parameterValues ?? {})
      : widget.templateUri;

    const metaOutputTemplate = hasRecognizedTopping ? widget.outputTemplate : widget.templateUri;

    return {
      content: [
        {
          type: "text",
          text: hasRecognizedTopping
            ? `${widget.responseText} Filtered by “${matchedTopping}”.`
            : `${widget.responseText} Showing all pizzas.`
        }
      ],
      structuredContent: {
        pizzaTopping: hasRecognizedTopping ? matchedTopping : null,
        availableToppings: allToppings,
        filterApplied: hasRecognizedTopping,
        requestedTopping: rawTopping || null
      },
      _meta: widgetMeta(widget, {
        includeParameterSchema: true,
        parameterValues,
        resolvedUri: resolvedOutputTemplate,
        outputTemplate: metaOutputTemplate
      })
    };
  });

  return server;
}

type SessionRecord = {
  server: Server;
  transport: SSEServerTransport;
};

const sessions = new Map<string, SessionRecord>();

const ssePath = "/mcp";
const postPath = "/mcp/messages";

async function handleSseRequest(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const server = createPizzazServer();
  const transport = new SSEServerTransport(postPath, res);
  const sessionId = transport.sessionId;

  sessions.set(sessionId, { server, transport });

  transport.onclose = async () => {
    sessions.delete(sessionId);
    await server.close();
  };

  transport.onerror = (error) => {
    console.error("SSE transport error", error);
  };

  try {
    await server.connect(transport);
  } catch (error) {
    sessions.delete(sessionId);
    console.error("Failed to start SSE session", error);
    if (!res.headersSent) {
      res.writeHead(500).end("Failed to establish SSE connection");
    }
  }
}

async function handlePostMessage(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  const sessionId = url.searchParams.get("sessionId");

  if (!sessionId) {
    res.writeHead(400).end("Missing sessionId query parameter");
    return;
  }

  const session = sessions.get(sessionId);

  if (!session) {
    res.writeHead(404).end("Unknown session");
    return;
  }

  try {
    await session.transport.handlePostMessage(req, res);
  } catch (error) {
    console.error("Failed to process message", error);
    if (!res.headersSent) {
      res.writeHead(500).end("Failed to process message");
    }
  }
}

const portEnv = Number(PORT ?? 8000);
const port = Number.isFinite(portEnv) ? portEnv : 8000;

const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (!req.url) {
    res.writeHead(400).end("Missing URL");
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "OPTIONS" && (url.pathname === ssePath || url.pathname === postPath)) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type"
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === ssePath) {
    await handleSseRequest(res);
    return;
  }

  if (req.method === "POST" && url.pathname === postPath) {
    await handlePostMessage(req, res, url);
    return;
  }

  res.writeHead(404).end("Not Found");
});

httpServer.on("clientError", (err: Error, socket) => {
  console.error("HTTP client error", err);
  socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

httpServer.listen(port, () => {
  console.log(`Pizzaz MCP server listening on http://localhost:${port}`);
  console.log(`  SSE stream: GET http://localhost:${port}${ssePath}`);
  console.log(`  Message post endpoint: POST http://localhost:${port}${postPath}?sessionId=...`);
});
