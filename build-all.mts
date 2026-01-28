import { build, type InlineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fg from "fast-glob";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import pkg from "./package.json" with { type: "json" };
import tailwindcss from "@tailwindcss/vite";

const entries = fg.sync("examples/**/ui/**/index.{tsx,jsx}");

const PER_ENTRY_CSS_GLOB = "**/*.{css,pcss,scss,sass}";
const PER_ENTRY_CSS_IGNORE = "**/*.module.*".split(",").map((s) => s.trim());
const GLOBAL_CSS_LIST = [path.resolve("examples/_shared/ui/index.css")];

const targets: string[] = [
  "todo",
  "solar-system",
  "pizzaz",
  "pizzaz-carousel",
  "pizzaz-list",
  "pizzaz-albums",
  "pizzaz-shop",
  "mixed-auth-search",
  "mixed-auth-past-orders",
  "kitchen-sink-lite",
  "shopping-cart",
];
const builtByApp = new Map<string, string[]>();

type Entry = {
  app: string;
  name: string;
  file: string;
};

function parseEntry(file: string): Entry {
  const entryAbs = path.resolve(file);
  const rel = path.relative(process.cwd(), entryAbs);
  const parts = rel.split(path.sep);

  // examples/<app>/ui/<name>/index.tsx
  if (parts.length < 5 || parts[0] !== "examples" || parts[2] !== "ui") {
    throw new Error(`Unexpected entry path: ${file}`);
  }

  return {
    app: parts[1],
    name: path.basename(path.dirname(entryAbs)),
    file,
  };
}

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

const selectedEntries = entries
  .map(parseEntry)
  .filter((entry) => (targets.length ? targets.includes(entry.name) : true))
  .sort((a, b) => {
    const appCmp = a.app.localeCompare(b.app);
    if (appCmp !== 0) return appCmp;
    return a.name.localeCompare(b.name);
  });

const entriesByApp = new Map<string, Entry[]>();
for (const entry of selectedEntries) {
  const list = entriesByApp.get(entry.app) ?? [];
  list.push(entry);
  entriesByApp.set(entry.app, list);
}

for (const [app, appEntries] of entriesByApp) {
  const outDir = path.join("examples", app, "assets");
  fs.rmSync(outDir, { recursive: true, force: true });

  for (const entry of appEntries) {
    const name = entry.name;
    const file = entry.file;

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

    console.group(`Building ${app}/${name} (react)`);
    await build(createConfig());
    console.groupEnd();

    const builtNames = builtByApp.get(app) ?? [];
    builtNames.push(name);
    builtByApp.set(app, builtNames);

    console.log(`Built ${app}/${name}`);
  }
}

const h = crypto
  .createHash("sha256")
  .update(pkg.version, "utf8")
  .digest("hex")
  .slice(0, 4);

console.log("new hash: ", h);

const ASSET_BASE_URL_PLACEHOLDER = "__ASSET_BASE_URL__";

for (const [app, builtNames] of builtByApp) {
  const outDir = path.join("examples", app, "assets");

  const outputs = fs
    .readdirSync(outDir)
    .filter((f) => f.endsWith(".js") || f.endsWith(".css"))
    .map((f) => path.join(outDir, f))
    .filter((p) => fs.existsSync(p));

  console.group(`Hashing outputs for ${app}`);
  for (const out of outputs) {
    const dir = path.dirname(out);
    const ext = path.extname(out);
    const base = path.basename(out, ext);
    const newName = path.join(dir, `${base}-${h}${ext}`);

    fs.renameSync(out, newName);
    console.log(`${out} -> ${newName}`);
  }
  console.groupEnd();

  for (const name of builtNames) {
    const hashedHtmlPath = path.join(outDir, `${name}-${h}.html`);
    const liveHtmlPath = path.join(outDir, `${name}.html`);
    const html = `<!doctype html>
<html>
<head>
  <script type="module" src="${ASSET_BASE_URL_PLACEHOLDER}/${name}-${h}.js"></script>
  <link rel="stylesheet" href="${ASSET_BASE_URL_PLACEHOLDER}/${name}-${h}.css">
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
}
