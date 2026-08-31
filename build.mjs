// Build: bundle the client (src + vendored three.js) into dist/ with esbuild.
import { mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));
const outdir = resolve(root, "dist");

mkdirSync(outdir, { recursive: true });

await esbuild.build({
  entryPoints: [resolve(root, "src", "bootstrap.js")],
  bundle: true,
  format: "esm",
  target: ["es2020"],
  outfile: resolve(outdir, "bootstrap.js"),
  logLevel: "warning",
});

copyFileSync(resolve(root, "src", "style.css"), resolve(outdir, "style.css"));
copyFileSync(resolve(root, "starhermit.txt"), resolve(outdir, "starhermit.txt"));

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="color-scheme" content="dark" />
<title>Physics Foundry</title>
<link rel="stylesheet" href="./style.css" />
<script type="module" src="./bootstrap.js"></script>
</head>
<body class="pf-body">
<noscript><p style="padding:2rem;text-align:center">JavaScript is required to play Physics Foundry.</p></noscript>
<div id="pf-shell" class="pf-shell"></div>
</body>
</html>
`;
writeFileSync(resolve(outdir, "index.html"), html);

console.log("build ok -> dist/");
