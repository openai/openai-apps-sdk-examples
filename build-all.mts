import { build, type InlineConfig, type Plugin } from "vite";
import dotenv from "dotenv";
import react from "@vitejs/plugin-react";
import fg from "fast-glob";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import tailwindcss from "@tailwindcss/vite";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const entries = fg.sync("src/**/index.{tsx,jsx}");
const outDir = "assets";

const PER_ENTRY_CSS_GLOB = "**/*.{css,pcss,scss,sass}";
const PER_ENTRY_CSS_IGNORE = "**/*.module.*".split(",").map((s) => s.trim());
const GLOBAL_CSS_LIST = [path.resolve("src/index.css")];

const targets: string[] = [
  "todo",
  "solar-system",
  "cards-against-ai",
  "pizzaz",
  "pizzaz-carousel",
  "pizzaz-list",
  "pizzaz-albums",
  "pizzaz-shop",
  "mixed-auth-search",
  "mixed-auth-past-orders",
  "kitchen-sink-lite",
  "shopping-cart",
  "show-tool-result",
  "send-message",
  "update-model-context",
  "call-server-tool",
  "host-theming",
  "open-link",
  "request-display-mode",
  "streaming-tool-input",
  "get-host-capabilities",
  "get-host-context",
  "get-host-version",
];

function cliTargets(argv: string[]): string[] {
  const values: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--target" || arg === "--targets") {
      const value = argv[i + 1];
      if (value) {
        values.push(value);
        i += 1;
      }
      continue;
    }

    if (arg.startsWith("--target=") || arg.startsWith("--targets=")) {
      values.push(arg.slice(arg.indexOf("=") + 1));
    }
  }

  return values.flatMap((value) =>
    value
      .split(",")
      .map((target) => target.trim())
      .filter(Boolean)
  );
}

const requestedTargets = cliTargets(process.argv.slice(2));
if (requestedTargets.length) {
  targets.length = 0;
  targets.push(...requestedTargets);
}

const builtNames: string[] = [];

function wrapEntryPlugin(
  virtualId: string,
  entryFile: string,
  cssPaths: string[]
): Plugin {
  return {
    name: `virtual-entry-wrapper:${entryFile}`,
    resolveId(id) {
      if (id === virtualId) return id;
    },
    load(id) {
      if (id !== virtualId) {
        return null;
      }

      const cssImports = cssPaths
        .map((css) => `import ${JSON.stringify(css)};`)
        .join("\n");

      return `
    ${cssImports}
    export * from ${JSON.stringify(entryFile)};

    import * as __entry from ${JSON.stringify(entryFile)};
    export default (__entry.default ?? __entry.App);

    import ${JSON.stringify(entryFile)};
  `;
    },
  };
}

fs.rmSync(outDir, { recursive: true, force: true });

for (const file of entries) {
  const name = path.basename(path.dirname(file));
  if (targets.length && !targets.includes(name)) {
    continue;
  }

  const entryAbs = path.resolve(file);
  const entryDir = path.dirname(entryAbs);

  // Collect CSS for this entry using the glob(s) rooted at its directory
  const perEntryCss = fg.sync(PER_ENTRY_CSS_GLOB, {
    cwd: entryDir,
    absolute: true,
    dot: false,
    ignore: PER_ENTRY_CSS_IGNORE,
  });

  // Global CSS (Tailwind, etc.), only include those that exist
  const globalCss = GLOBAL_CSS_LIST.filter((p) => fs.existsSync(p));

  // Final CSS list (global first for predictable cascade)
  const cssToInclude = [...globalCss, ...perEntryCss].filter((p) =>
    fs.existsSync(p)
  );

  const virtualId = `\0virtual-entry:${entryAbs}`;

  const createConfig = (): InlineConfig => ({
    plugins: [
      wrapEntryPlugin(virtualId, entryAbs, cssToInclude),
      tailwindcss(),
      react(),
      {
        name: "remove-manual-chunks",
        outputOptions(options) {
          if ("manualChunks" in options) {
            delete (options as any).manualChunks;
          }
          return options;
        },
      },
    ],
    esbuild: {
      jsx: "automatic",
      jsxImportSource: "react",
      target: "es2022",
    },
    build: {
      target: "es2022",
      outDir,
      emptyOutDir: false,
      chunkSizeWarningLimit: 2000,
      minify: "esbuild",
      cssCodeSplit: false,
      rollupOptions: {
        input: virtualId,
        output: {
          format: "es",
          entryFileNames: `${name}.js`,
          inlineDynamicImports: true,
          assetFileNames: (info) =>
            (info.name || "").endsWith(".css")
              ? `${name}.css`
              : `[name]-[hash][extname]`,
        },
        preserveEntrySignatures: "allow-extension",
        treeshake: true,
      },
    },
  });

  console.group(`Building ${name} (react)`);
  await build(createConfig());
  console.groupEnd();
  builtNames.push(name);
  console.log(`Built ${name}`);
}

const outputs = fs
  .readdirSync(outDir)
  .filter((f) => f.endsWith(".js") || f.endsWith(".css"))
  .sort()
  .map((f) => path.join(outDir, f))
  .filter((p) => fs.existsSync(p));

const outputHash = crypto.createHash("sha256");
for (const out of outputs) {
  outputHash.update(path.basename(out), "utf8");
  outputHash.update("\0", "utf8");
  outputHash.update(fs.readFileSync(out));
  outputHash.update("\0", "utf8");
}
const assetHashSalt = (process.env.ASSET_HASH_SALT ?? "").trim();
if (assetHashSalt) {
  outputHash.update("ASSET_HASH_SALT", "utf8");
  outputHash.update("\0", "utf8");
  outputHash.update(assetHashSalt, "utf8");
  outputHash.update("\0", "utf8");
}
const h = outputHash.digest("hex").slice(0, 8);

console.group("Hashing outputs");
for (const out of outputs) {
  const dir = path.dirname(out);
  const ext = path.extname(out);
  const base = path.basename(out, ext);
  const newName = path.join(dir, `${base}-${h}${ext}`);

  fs.renameSync(out, newName);
  console.log(`${out} -> ${newName}`);
}
console.groupEnd();

console.log("new hash: ", h);
if (assetHashSalt) {
  console.log("Using ASSET_HASH_SALT for generated asset URLs");
}

const defaultApiBaseUrl = "http://localhost:8000";
const apiBaseUrlCandidate = (
  process.env.VITE_API_BASE_URL ??
  process.env.API_BASE_URL ??
  ""
).trim();
const apiBaseUrlRaw =
  apiBaseUrlCandidate.length > 0 ? apiBaseUrlCandidate : defaultApiBaseUrl;
const normalizedApiBaseUrl =
  apiBaseUrlRaw.replace(/\/+$/, "") || defaultApiBaseUrl;
const defaultBaseUrl = `${normalizedApiBaseUrl}/assets`;
const baseUrlCandidate = (
  process.env.VITE_BASE_URL ??
  process.env.BASE_URL ??
  ""
).trim();
const baseUrlRaw =
  baseUrlCandidate.length > 0 ? baseUrlCandidate : defaultBaseUrl;
const normalizedBaseUrl = baseUrlRaw.replace(/\/+$/, "") || defaultBaseUrl;
const appUrlConfigJson = JSON.stringify({
  apiBaseUrl: normalizedApiBaseUrl,
  assetsBaseUrl: normalizedBaseUrl,
});
console.log(`Using BASE_URL ${normalizedBaseUrl} for generated HTML`);
console.log(`Using API_BASE_URL ${normalizedApiBaseUrl} for generated HTML`);

for (const name of builtNames) {
  const dir = outDir;
  const hashedHtmlPath = path.join(dir, `${name}-${h}.html`);
  const liveHtmlPath = path.join(dir, `${name}.html`);
  const html = `<!doctype html>
<html>
<head>
  <script>
    window.__APP_URL_CONFIG__ = ${appUrlConfigJson};
  </script>
  <script type="module" src="${normalizedBaseUrl}/${name}-${h}.js"></script>
  <link rel="stylesheet" href="${normalizedBaseUrl}/${name}-${h}.css">
</head>
<body>
  <div id="${name}-root"></div>
</body>
</html>
`;
  fs.writeFileSync(hashedHtmlPath, html, { encoding: "utf8" });
  fs.writeFileSync(liveHtmlPath, html, { encoding: "utf8" });
  console.log(`${liveHtmlPath}`);
}
