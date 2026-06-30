// Scan deployed realm source on the read-only EFS mount (the aws-access
// fs-explorer SSM tunnel — a Caddy file server with JSON directory listings)
// for modules that still carry the `isUsed` field option, and write the hit
// list that apply-deployed.ts consumes (`--hits`).
//
//   node scan-deployed-isused.mjs <efs-base> <root> <out.json> [--concurrency N]
//     efs-base : local tunnel base, e.g. http://localhost:58080
//     root     : EFS path to crawl, e.g. /realms/ (user realms) or / (all)
//
// Reads only — no auth, no writes. Output: { root, files_scanned, hit_files,
// by_realm, hits: [{ path, count }] }. Published copies live under
// /realms/_published/ and are republished (not directly stripped), so the
// caller decides whether to act on them.

import { writeFileSync } from 'node:fs';

let [efsBase, root, out] = process.argv.slice(2);
let ci = process.argv.indexOf('--concurrency');
let CONCURRENCY = ci > -1 ? Number(process.argv[ci + 1]) : 24;
if (!efsBase || !root || !out) {
  throw new Error(
    'usage: node scan-deployed-isused.mjs <efs-base> <root> <out.json> [--concurrency N]',
  );
}

async function get(path, asJson) {
  let last;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      let res = await fetch(efsBase + path, {
        headers: asJson ? { Accept: 'application/json' } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return asJson ? await res.json() : await res.text();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw last;
}

async function listdir(path) {
  try {
    let data = await get(path, true);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// Walk directories depth-first, collecting .gts/.ts file paths.
let files = [];
let dirs = 0;
async function walk(path) {
  dirs++;
  if (dirs % 200 === 0)
    process.stderr.write(`  …walked ${dirs} dirs, ${files.length} files\n`);
  for (let entry of await listdir(path)) {
    let name = entry.name ?? '';
    if (entry.is_dir) {
      if (name === '.boxel-history' || name.startsWith('.git')) continue;
      await walk(path + name + '/');
    } else if (name.endsWith('.gts') || name.endsWith('.ts')) {
      files.push(path + name);
    }
  }
}
process.stderr.write(`Walking ${root} …\n`);
await walk(root);
process.stderr.write(`Walk done: ${dirs} dirs, ${files.length} files\n`);

// Fetch each file and record the ones containing `isUsed`. Bounded concurrency.
let hits = [];
let checked = 0;
let i = 0;
async function worker() {
  while (i < files.length) {
    let path = files[i++];
    try {
      let body = await get(path, false);
      if (body.includes('isUsed')) {
        let count = body.split('isUsed').length - 1;
        hits.push({ path, count });
      }
    } catch {
      // leave unrecorded; a transient miss is re-found on a re-run
    }
    if (++checked % 500 === 0)
      process.stderr.write(
        `  …checked ${checked}/${files.length}, ${hits.length} hits\n`,
      );
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

// Group hits by realm: /realms/<user>/<realm>/ or a /<system>/ root.
let byRealm = {};
for (let h of hits) {
  let parts = h.path.split('/').filter(Boolean);
  let realm =
    parts[0] === 'realms' && parts.length >= 3
      ? `/${parts.slice(0, 3).join('/')}/`
      : `/${parts[0]}/`;
  (byRealm[realm] ??= []).push(h.path);
}

hits.sort((a, b) => a.path.localeCompare(b.path));
writeFileSync(
  out,
  JSON.stringify(
    {
      root,
      files_scanned: files.length,
      hit_files: hits.length,
      by_realm: Object.fromEntries(
        Object.entries(byRealm)
          .map(([k, v]) => [k, v.sort()])
          .sort(),
      ),
      hits,
    },
    null,
    2,
  ),
);
process.stderr.write(
  `\n${hits.length} file(s) with isUsed across ${Object.keys(byRealm).length} realm(s). Wrote ${out}\n`,
);
