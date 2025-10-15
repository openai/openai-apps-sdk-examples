import { build, type InlineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fg from "fast-glob";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import pkg from "./package.json" with { type: "json" };
import tailwindcss from "@tailwindcss/vite";

const entries = fg.sync("src/**/index.{tsx,jsx}");
const outDir = "assets";

const PER_ENTRY_CSS_GLOB = "**/*.{css,pcss,scss,sass}";
const PER_ENTRY_CSS_IGNORE = "**/*.module.*".split(",").map((s) => s.trim());
const GLOBAL_CSS_LIST = [path.resolve("src/index.css")];

const targets: string[] = [
  "todo",
  "solar-system",
  "pizzaz",
  "pizzaz-carousel",
  "pizzaz-list",
  "pizzaz-albums",
  "pizzaz-video",
];
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
  .readdirSync("assets")
  .filter((f) => f.endsWith(".js") || f.endsWith(".css"))
  .map((f) => path.join("assets", f))
  .filter((p) => fs.existsSync(p));

const renamed = [];

const buildSalt = process.env.BUILD_SALT ?? new Date().toISOString();

const h = crypto
  .createHash("sha256")
  .update(`${pkg.version}:${buildSalt}`, "utf8")
  .digest("hex")
  .slice(0, 4);

console.group("Hashing outputs");
for (const out of outputs) {
  const dir = path.dirname(out);
  const ext = path.extname(out);
  const base = path.basename(out, ext);
  const newName = path.join(dir, `${base}-${h}${ext}`);

  fs.renameSync(out, newName);
  renamed.push({ old: out, neu: newName });
  console.log(`${out} -> ${newName}`);
}
console.groupEnd();

console.log("new hash: ", h);

for (const name of builtNames) {
  const dir = outDir;
  const htmlPath = path.join(dir, `${name}-${h}.html`);
  const cssPath = path.join(dir, `${name}-${h}.css`);
  const jsPath = path.join(dir, `${name}-${h}.js`);

  const cssHref = fs.existsSync(cssPath)
    ? `/${path.basename(cssPath)}?v=${h}`
    : undefined;
  const jsSrc = fs.existsSync(jsPath)
    ? `/${path.basename(jsPath)}?v=${h}`
    : undefined;

  const extraScript = name === "pizzaz-video"
    ? "\n  <script>window.__PIZZAZ_VIDEO_URL__ = \"https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4\";<\\/script>"
    : "";

  const html = [
    "<!doctype html>",
    "<html>",
    "<head>",
    cssHref ? `  <link rel=\"stylesheet\" href=\"${cssHref}\">` : "",
    "</head>",
    "<body>",
    `  <div id=\"${name}-root\"></div>`,
    jsSrc ? `  <script type=\"module\" src=\"${jsSrc}\"></script>` : "",
    extraScript,
    "</body>",
    "</html>",
  ]
    .filter(Boolean)
    .join("\n");

  fs.writeFileSync(htmlPath, html, { encoding: "utf8" });
  console.log(`${htmlPath} (generated)`);

  const stableHtmlPath = path.join(dir, `${name}.html`);
  fs.writeFileSync(stableHtmlPath, html, { encoding: "utf8" });
  console.log(`${stableHtmlPath} (generated)`);

  const cleanUrlDir = path.join(dir, name);
  fs.mkdirSync(cleanUrlDir, { recursive: true });
  const cleanUrlIndexPath = path.join(cleanUrlDir, "index.html");
  const cleanHtml = html
    .replace(`href="${cssHref ?? ""}"`, cssHref ? `href="${cssHref}"` : "")
    .replace(`src="${jsSrc ?? ""}"`, jsSrc ? `src="${jsSrc}"` : "");

  fs.writeFileSync(cleanUrlIndexPath, cleanHtml, { encoding: "utf8" });
  console.log(`${cleanUrlIndexPath} (generated)`);
}
