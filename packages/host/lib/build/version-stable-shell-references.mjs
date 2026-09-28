import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// The build writes content-addressed filenames only under `assets/`. Every
// other file the app shell names — `@embroider/virtual/vendor.js`, which sets
// `window.EmberENV`, `@embroider/virtual/app.css`, the icons — keeps its path
// from one build to the next.
//
// A browser caches a response under its URL, and a stable path says nothing
// about whether the bytes behind it changed. Revalidation catches a change only
// for a copy stored under a directive that asks for it; a copy stored under a
// long-lived `immutable` one is reused as-is for as long as the browser keeps
// it. So any browser holding such a copy runs that file's bytes whatever the
// deploy serves, even when the shell it loaded is current.
//
// Naming each of those files by a digest of its own bytes takes the cached copy
// out of the question. The shell revalidates on every load, so a changed file
// is requested under a URL no cache holds, while an unchanged one keeps its URL
// and the copy already cached for it. The query only changes the browser's
// cache key: neither the CDN nor the bucket behind it gives `v` a meaning, so
// every spelling of the URL is answered with the object currently at the path.
// Which `Cache-Control` each file is uploaded with is decided separately, in
// config/deploy.js.
//
// The realm-server replaces the shell's icon links with its own unversioned
// ones, so the icons' versions reach only a shell served straight from the CDN.

// A root-relative `src` / `href`. A protocol-relative `//host/…` reference is
// not the dist's, and one that already carries a query or fragment is left as
// its author wrote it.
const ROOT_RELATIVE_REFERENCE = /(?<=\s)(src|href)="\/(?!\/)([^"?#]+)"/g;

const CONTENT_ADDRESSED = 'assets/';

export function contentVersion(bytes) {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 8);
}

// `readDistFile(relativePath)` returns the bytes the build wrote at that path,
// or undefined when it wrote nothing there. A reference to a path the dist does
// not contain is left unversioned rather than failing the build here; the dist
// check in support/deploy-cache-control.test.mts is what holds a shipped shell
// to naming every stable file by its content.
export function versionStableShellReferences(html, readDistFile) {
  return html.replace(
    ROOT_RELATIVE_REFERENCE,
    (reference, attribute, relativePath) => {
      if (relativePath.startsWith(CONTENT_ADDRESSED)) {
        return reference;
      }
      let bytes = readDistFile(relativePath);
      if (bytes === undefined) {
        return reference;
      }
      return `${attribute}="/${relativePath}?v=${contentVersion(bytes)}"`;
    },
  );
}

export function readDistFileFrom(outDir) {
  return (relativePath) => {
    let file = path.join(outDir, relativePath);
    return existsSync(file) && statSync(file).isFile()
      ? readFileSync(file)
      : undefined;
  };
}

// Rewrites the shell after the bundle is on disk, so every file it names —
// emitted chunks, embroider's virtual files, copies from `public/` — is there
// to be hashed. Build-only: the dev server serves its own shell and its own
// cache headers.
export function versionStableShellReferencesPlugin() {
  let outDir;
  return {
    name: 'version-stable-shell-references',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      let shell = path.join(outDir, 'index.html');
      if (!existsSync(shell)) {
        return;
      }
      let html = await readFile(shell, 'utf8');
      await writeFile(
        shell,
        versionStableShellReferences(html, readDistFileFrom(outDir)),
      );
    },
  };
}
