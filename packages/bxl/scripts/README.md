# Scripts

Build, size-report, and release helpers.

| Script              | Purpose                                              |
| ------------------- | ---------------------------------------------------- |
| `build.mjs`         | esbuild ESM + CJS Node outputs, browser IIFE/ESM,   |
|                     | minified + gzipped + content-hashed CDN artifacts,   |
|                     | `manifest.json`, `sri.json`.                         |
| `size-report.mjs`   | Print linter / compiler / runtime bundle sizes.      |
|                     | With `--check`, fails the build when a budget breaks.|

Added in v0.2:

- `serve-playground.mjs`  — static server for the HTML playground.
- `verify-bundle.mjs`     — SRI + tree-shake assertions.
